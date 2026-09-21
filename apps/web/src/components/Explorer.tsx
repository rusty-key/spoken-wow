"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import LineRow from "./LineRow";
import Key from "./Key";
import Pagination from "./Pagination";
import Player from "./Player";
import IgnoreDialog from "./IgnoreDialog";
import ReportDialog from "./ReportDialog";
import OverrideDialog from "./OverrideDialog";
import RegenerateDialog from "./RegenerateDialog";
import RegenerationPanel from "./RegenerationPanel";
import SearchBar from "./SearchBar";
import { Loading, Refreshing } from "@/components/Loading";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import type { Facets } from "@/lib/facets";
import { NARRATOR_VOICE } from "@/lib/generation/narration";
import {
  dismissQueue,
  fetchBatchJobs,
  fetchGenerationStatus,
  fetchQueue,
  queueBatch,
  regenerate,
  stopQueue,
  type BatchJob,
  type GenerationStatusResponse,
  type QueueSnapshot,
} from "@/lib/generation/client";
import { estimate as estimateBatch, LIST_RATE, type Estimate } from "@/lib/generation/billing";
import { useClearDirty } from "@/lib/generation/use-clear-dirty";
import { canConfigureGeneration, canRegenerate } from "@/lib/permissions";
import { isVoiceable } from "@/lib/text-gate";
import type { Filter, LineFilters, ResultLine, SearchResult } from "@/lib/search";
import { type Pending, receive, target, write } from "@/lib/url-echo";

/** What a line's Regenerate button is doing, keyed by lineId. */
export type LineState =
  | { phase: "busy" }
  | { phase: "done"; version: number }
  | { phase: "error"; message: string };

const DEBOUNCE_MS = 200;

function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

/** Everything that narrows the corpus, as the query string the two search endpoints read. */
function filterParams(filters: LineFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.filter && filters.filter !== "any") params.set("filter", filters.filter);
  if (filters.missingOnly) params.set("missing", "1");
  if (filters.race) params.set("race", filters.race);
  if (filters.gender) params.set("gender", filters.gender);
  if (filters.flavor) params.set("flavor", filters.flavor);
  if (filters.voice) params.set("voice", filters.voice);
  if (filters.source) params.set("source", filters.source);
  if (filters.npcType) params.set("type", filters.npcType);
  if (filters.includeProgress) params.set("progress", "1");
  if (filters.narration) params.set("narration", "1");
  if (filters.line) params.set("line", filters.line);
  if (filters.overridden) params.set("overridden", "1");
  if (filters.ignored) params.set("ignored", "1");
  if (filters.outdated) params.set("outdated", "1");
  if (filters.dirty) params.set("dirty", "1");
  if (filters.reports) params.set("fb", filters.reports);
  if (filters.generatedBefore) params.set("before", filters.generatedBefore);
  if (filters.generatedAfter) params.set("after", filters.generatedAfter);
  return params;
}

export default function Explorer({ facets }: { facets: Facets }) {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();
  const { data: session } = useSession();

  // Read once here and drilled down, rather than a hook per row: a page renders fifty
  // LineRows and the answer is the same for all of them.
  const showRegenerate = canRegenerate(session?.user.role);
  // Ignoring hides a line from everyone and takes it out of the module, which is the reach
  // the generation settings have rather than the reach a rewrite has. Same gate as the API.
  const canConfigure = canConfigureGeneration(session?.user.role);

  // The URL is the source of truth for a search, so a result is linkable and survives a
  // reload; `query` is the uncommitted keystroke state in front of it.
  const urlQuery = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);

  // Everything but the free-text query, which the input runs ahead of. Rebuilt from the URL
  // rather than held in state, so the back button is a working undo for a filter too.
  const filters = useMemo<LineFilters>(
    () => ({
      q: urlQuery,
      filter: (params.get("filter") as Filter) ?? "any",
      missingOnly: params.get("missing") === "1",
      race: params.get("race") ?? undefined,
      gender: params.get("gender") ?? undefined,
      flavor: params.get("flavor") ?? undefined,
      voice: params.get("voice") ?? undefined,
      source: (params.get("source") as LineFilters["source"]) ?? undefined,
      npcType: (params.get("type") as LineFilters["npcType"]) ?? undefined,
      includeProgress: params.get("progress") === "1",
      narration: params.get("narration") === "1",
      line: params.get("line") ?? undefined,
      overridden: params.get("overridden") === "1",
      ignored: params.get("ignored") === "1",
      outdated: params.get("outdated") === "1",
      dirty: params.get("dirty") === "1",
      reports: params.get("fb") === "open" ? "open" : undefined,
      generatedBefore: params.get("before") ?? undefined,
      generatedAfter: params.get("after") ?? undefined,
    }),
    [params, urlQuery],
  );

  const [query, setQuery] = useState(urlQuery);
  const [result, setResult] = useState<SearchResult | null>(null);
  // True from the start: the first search runs in an effect, after the first paint, and
  // until it answers the table has nothing to show but this.
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<ResultLine | null>(null);

  // Which voices exist and what is left of the character budget. Read once, and only for
  // someone who could act on it.
  const [status, setStatus] = useState<GenerationStatusResponse | null>(null);
  // Per-line regeneration state, and per-file version numbers used to bust the audio cache.
  const [lineStates, setLineStates] = useState<Record<string, LineState>>({});
  const [versions, setVersions] = useState<Record<string, number>>({});
  // Bumped to fetch the page again after something changed what it shows -- a new take, a
  // restore -- the way the zones and books explorers do. Take counts, staleness and the
  // pronunciation mark all arrive on the rows themselves now; there is no second copy of
  // them held here to keep in step.
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => setRefreshKey((key) => key + 1), []);
  // What has been cleared since this page was fetched, laid over the rows' own marks until
  // the next fetch brings the acknowledgement back from the server.
  const { cleared, clear: clearDirty } = useClearDirty("quests");
  // The line whose spoken text is being rewritten, or null.
  const [editing, setEditing] = useState<ResultLine | null>(null);
  const [ignoring, setIgnoring] = useState<ResultLine | null>(null);
  // Anyone can open this one, signed in or not - see ReportDialog.
  const [reporting, setReporting] = useState<ResultLine | null>(null);
  const [pendingBatch, setPendingBatch] = useState<{
    label: string;
    /**
     * The filters the estimate was quoted for, carried rather than re-read at confirm time.
     * The dialog can sit open while someone keeps typing, and enqueuing whatever the search
     * box says at the moment of the click would spend money on a set nobody was shown.
     */
    filters: string;
    jobs: BatchJob[];
    estimate: Estimate;
  } | null>(null);
  // The queue, as the server sees it. Null until the first poll answers.
  const [queue, setQueue] = useState<QueueSnapshot | null>(null);
  const [dismissed, setDismissed] = useState(false);
  // What the enqueue request itself answered, as opposed to what the queue is doing: a
  // `null` result or a nonzero `skipped` count is information about the click, not about the
  // batch, and the snapshot the poll returns has no room for it.
  const [queueNote, setQueueNote] = useState<string | null>(null);
  // The high-water mark of jobs already adopted, so a poll only carries what is new and a
  // tab that slept catches up in one request instead of missing the window.
  const cursor = useRef<string | null>(null);

  const searchInput = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLAudioElement>(null);

  // Query values written to the URL and not yet echoed back. See lib/url-echo: the input
  // runs ahead of the URL, so an echo that arrives mid-word must not be adopted.
  const pending = useRef<Pending>([]);

  useEffect(() => {
    const step = receive(pending.current, urlQuery);
    pending.current = step.pending;
    if (step.adopt) setQuery(urlQuery);
  }, [urlQuery]);

  /**
   * Write to the URL.
   *
   * Anything that changes what matches sends the reader back to page one, because page 9 of
   * a different result set is not where they were - and often does not exist. Only the pager
   * itself passes `page`.
   */
  const updateUrl = useCallback(
    (next: { page?: number } & Record<string, string | number | undefined>) => {
      const search = new URLSearchParams(params.toString());

      for (const [key, value] of Object.entries(next)) {
        if (key === "page") continue;
        if (value) search.set(key, String(value));
        else search.delete(key);
      }

      if (next.page !== undefined && next.page > 1) search.set("page", String(next.page));
      else search.delete("page");

      // The current path, never a literal "/": this explorer was the site root until the
      // merge moved it to /quests, and a hardcoded "/" sent every narrowing click to the
      // landing page carrying the filters it was asked for.
      router.replace(search.toString() ? `${pathname}?${search}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const updateFilters = useCallback(
    (next: Partial<LineFilters>) => {
      updateUrl({
        ...("filter" in next ? { filter: next.filter === "any" ? undefined : next.filter } : {}),
        ...("missingOnly" in next ? { missing: next.missingOnly ? "1" : undefined } : {}),
        ...("race" in next ? { race: next.race } : {}),
        ...("gender" in next ? { gender: next.gender } : {}),
        ...("flavor" in next ? { flavor: next.flavor } : {}),
        ...("voice" in next ? { voice: next.voice } : {}),
        ...("source" in next ? { source: next.source } : {}),
        ...("npcType" in next ? { type: next.npcType } : {}),
        ...("narration" in next ? { narration: next.narration ? "1" : undefined } : {}),
        ...("includeProgress" in next
          ? { progress: next.includeProgress ? "1" : undefined }
          : {}),
        ...("line" in next ? { line: next.line } : {}),
        ...("overridden" in next ? { overridden: next.overridden ? "1" : undefined } : {}),
        ...("outdated" in next ? { outdated: next.outdated ? "1" : undefined } : {}),
        ...("dirty" in next ? { dirty: next.dirty ? "1" : undefined } : {}),
        ...("reports" in next ? { fb: next.reports } : {}),
        ...("ignored" in next ? { ignored: next.ignored ? "1" : undefined } : {}),
        ...("generatedBefore" in next ? { before: next.generatedBefore } : {}),
        ...("generatedAfter" in next ? { after: next.generatedAfter } : {}),
      });
    },
    [updateUrl],
  );

  /**
   * Drop every filter, the query with them.
   *
   * Navigates to the bare path rather than deleting keys one by one: every parameter this
   * page reads either narrows the corpus or is the page number, and page 9 of the unfiltered
   * corpus is not where anyone wants to land. A key added later is then cleared by default,
   * which is the safer way for this to be wrong.
   *
   * The query is reset through `pending` as well, so the echo machinery does not treat the
   * cleared input as a stale value and put the old query back. See lib/url-echo.
   */
  const clearAll = useCallback(() => {
    setQuery("");
    pending.current = write(pending.current, "");
    router.replace(pathname, { scroll: false });
  }, [pathname, router]);

  // Held in a ref so the debounce below restarts on keystrokes only. `updateUrl` changes
  // identity on every param change, and letting that reset the timer would let a filter
  // toggle mid-word push the search out by another interval.
  const updateUrlRef = useRef(updateUrl);
  useEffect(() => {
    updateUrlRef.current = updateUrl;
  }, [updateUrl]);

  useEffect(() => {
    if (query === target(pending.current, urlQuery)) return;
    const timer = setTimeout(() => {
      pending.current = write(pending.current, query);
      updateUrlRef.current({ q: query });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, urlQuery]);

  // A stable string, so the search effect below re-runs when the filters change rather than
  // on every render that rebuilds the object.
  const filterQuery = useMemo(() => filterParams(filters).toString(), [filters]);

  useEffect(() => {
    const controller = new AbortController();
    const search = new URLSearchParams(filterQuery);
    if (page > 1) search.set("page", String(page));

    setLoading(true);
    fetch(`/api/quests/search?${search}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data: SearchResult) => {
        setResult(data);
        setLoading(false);
      })
      .catch((error) => {
        if (error.name !== "AbortError") setLoading(false);
      });

    return () => controller.abort();
  }, [filterQuery, page, refreshKey]);

  useEffect(() => {
    if (!showRegenerate) return;
    const controller = new AbortController();
    void fetchGenerationStatus(controller.signal).then(setStatus);
    return () => controller.abort();
  }, [showRegenerate]);

  /**
   * Adopt a rewritten line.
   *
   * Patched into the result in place rather than refetched: the search that produced this page
   * is unchanged, and a refetch would rebuild fifty rows to move one string. Every row sharing
   * the file is patched, because an override is keyed on the file and they all now say it.
   *
   * The file becomes stale here rather than waiting for the next fetch, because the claim is
   * already true: whatever audio exists was made from the old text.
   */
  const handleOverrideSaved = useCallback((file: string, text: string | null) => {
    setEditing(null);
    setResult((current) =>
      current
        ? {
            ...current,
            lines: current.lines.map((line) =>
              line.audioPath === file
                ? {
                    ...line,
                    override: text,
                    voiceable: isVoiceable(line, text ?? line.text),
                    stale: line.hasAudio,
                  }
                : line,
            ),
          }
        : current,
    );
  }, []);

  /**
   * Adopt an ignore decision without a reload.
   *
   * The row stays where it is rather than vanishing: a search is a snapshot, and having the
   * line disappear from under the person who just ignored it hides the chip that says what
   * they did. It is gone on the next search, which is when the filter is asked again.
   */
  const handleIgnoreSaved = useCallback((lineId: string, reason: string | null) => {
    setIgnoring(null);
    setResult((current) =>
      current
        ? {
            ...current,
            lines: current.lines.map((line) =>
              line.lineId === lineId ? { ...line, ignored: reason } : line,
            ),
          }
        : current,
    );
  }, []);

  /**
   * Adopt a restored take.
   *
   * The same bookkeeping a fresh generation does - the version bumps the audio URL so the
   * browser stops replaying what was there a moment ago - except the line is not marked
   * "regenerated", because it was not.
   */
  const handleRestored = useCallback(
    (file: string, version: number) => {
      setVersions((current) => ({ ...current, [file]: version }));
      refetch();
    },
    [refetch],
  );

  /**
   * Why this line's Regenerate control is unavailable, or null.
   *
   * Only three of the twenty voices exist today, so this is the usual state rather than an
   * edge case. Nothing is blocked while the status is still loading: guessing wrong towards
   * "disabled" would hide a control that works.
   */
  const blockedReason = useCallback(
    (line: ResultLine): string | null => {
      // `voiceable`, not the corpus's `generatable`: that flag was baked in before a stage
      // direction could be narrated or an override could strip a token, so it says no to 55
      // lines the server will happily generate. Reading it here disabled the button on
      // exactly the lines this feature exists for.
      // Before voiceability: an ignored line is a decision rather than a defect, and saying
      // "never voiced: invalid-chars" about one would name the wrong reason.
      if (line.ignored) {
        return `Ignored: ${line.ignored}`;
      }
      if (!line.voiceable) {
        return `Never voiced: ${line.skipReason}`;
      }
      // Before the voice checks: with no key the roster is empty, so every line would
      // otherwise be blocked for the wrong reason - "no voice named orc-male-shady" when
      // the truth is that nothing has been asked.
      if (status?.noApiKey) {
        return "No ElevenLabs key on your account — set one in your profile";
      }
      if (status && !status.voices.includes(line.voice)) {
        return `No ElevenLabs voice named "${line.voice}" yet — create it on /voices`;
      }
      // A narrated line needs both voices, and the server refuses it for the same reason.
      if (line.narration && status && !status.voices.includes(NARRATOR_VOICE)) {
        return `No ElevenLabs voice named "${NARRATOR_VOICE}" yet — create it on /voices`;
      }
      return null;
    },
    [status],
  );

  /**
   * Record a finished take.
   *
   * Every line resolving to this file now has audio, not just the one clicked: a gossip
   * file is shared by every NPC of that race and gender who says the same thing.
   */
  const applySuccess = useCallback(
    (file: string, version: number, lineId: string) => {
      // The version busts the audio cache at once; everything else the row shows -- that it
      // has audio, how many takes, whether it is stale -- comes back with the refetch.
      setVersions((current) => ({ ...current, [file]: version }));
      setLineStates((current) => ({ ...current, [lineId]: { phase: "done", version } }));
      refetch();
    },
    [refetch],
  );

  /**
   * Watch the queue.
   *
   * Polling rather than a stream: pm2 runs two workers and only one of them is draining, so
   * a socket held by the other would have to read Postgres anyway - and a poll survives a
   * sleeping tab, a dropped connection and nginx without any of them being special cases.
   *
   * Two seconds while there is work and fifteen while there is not, so an idle page is not
   * asking a database forty times a minute for the same empty answer.
   */
  useEffect(() => {
    if (!showRegenerate) return;

    let timer: NodeJS.Timeout;
    let cancelled = false;
    // The last snapshot's activity, kept outside state so a dropped poll has something to
    // fall back on: a null response means the network hiccuped, not that the batch finished,
    // and scheduling the next attempt at the idle pace would leave the panel stale for up to
    // fifteen seconds of a batch someone is actively watching.
    let active = false;
    const controller = new AbortController();

    async function poll() {
      const snapshot = await fetchQueue(cursor.current, controller.signal);
      if (cancelled) return;

      if (snapshot) {
        active = snapshot.active;
        cursor.current = snapshot.cursor;
        setQueue(snapshot);
        // Every line that landed since the last poll, adopted the same way a click's result
        // is - which is what makes another admin's work show up on this page.
        for (const job of snapshot.finished) {
          applySuccess(job.file, job.version, job.lineId);
        }
        if (snapshot.active) setDismissed(false);
      }

      timer = setTimeout(poll, active ? 2_000 : 15_000);
    }

    void poll();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [showRegenerate, applySuccess]);

  /**
   * Regenerate one line.
   *
   * On success the line is marked as having audio and its file's version is recorded. That
   * version becomes a query parameter on the audio URL: the path does not change when a file
   * is replaced, and /api/quests/audio answers with a weak ETag, so without it the browser would
   * happily replay the take that was just overwritten.
   */
  const regenerateLine = useCallback(async (line: ResultLine) => {
    setLineStates((current) => ({ ...current, [line.lineId]: { phase: "busy" } }));

    const response = await regenerate(line.lineId);

    if (!response.ok) {
      setLineStates((current) => ({
        ...current,
        [line.lineId]: { phase: "error", message: response.message },
      }));
      return;
    }

    applySuccess(response.file, response.version, line.lineId);
  }, [applySuccess]);

  /**
   * Clear every dirty file the current search matches, not just this page's.
   *
   * The search route answers `ids=1` with the dirty files of the whole match set, the same
   * question the zones explorer asks its own route -- so nothing is cleared that the server
   * would not have called dirty.
   */
  const clearAllDirty = useCallback(async () => {
    const params = new URLSearchParams(filterQuery);
    params.set("ids", "1");
    const response = await fetch(`/api/quests/search?${params}`).catch(() => null);
    if (!response?.ok) return;
    const { dirtyFiles } = (await response.json()) as { dirtyFiles?: string[] };
    clearDirty(dirtyFiles ?? []);
  }, [filterQuery, clearDirty]);

  /**
   * Ask to regenerate everything the current search matches.
   *
   * The whole match set, not the page on screen - which is why the jobs are fetched rather
   * than taken from `result`. It always stops for confirmation: this is the only guard
   * between one click and a large share of a month's budget, and the set behind it can be
   * the entire corpus.
   */
  const requestBatch = useCallback(async () => {
    const quoted = filterQuery;
    const jobs = await fetchBatchJobs(new URLSearchParams(quoted));
    if (!jobs || jobs.length === 0) return;

    // The same arithmetic the server would do, from the rate it reported. Falls back to
    // the list rate, which overstates - the right direction for a number meant to give
    // someone pause.
    const rate = status?.rate ?? { rate: LIST_RATE, samples: 0, modelId: null };
    setPendingBatch({
      label: `every line this search matches`,
      filters: quoted,
      jobs,
      estimate: estimateBatch(
        jobs.map((job) => ({ file: job.audioPath, characters: job.characters })),
        rate,
      ),
    });
  }, [filterQuery, status]);

  /**
   * Hand the confirmed batch to the server.
   *
   * The filters go, not the job list: the server re-derives the set with the same query the
   * estimate was built from, so what is queued is what was quoted, and a forty-thousand-line
   * batch is a small request. They come from `pendingBatch` rather than from the live search,
   * which may have moved on while the dialog was open.
   */
  const startBatch = useCallback(async () => {
    if (!pendingBatch) return;
    setPendingBatch(null);
    setDismissed(false);
    setQueueNote(null);

    const result = await queueBatch(
      { source: "quests", filters: new URLSearchParams(pendingBatch.filters) },
      pendingBatch.label,
    );
    if (!result) {
      // No reason offered because none was given: the route refused for a cause this
      // response does not carry, and inventing one would be a guess dressed as an answer.
      setQueueNote("Could not queue the batch.");
    } else if ("error" in result) {
      setQueueNote(result.error);
    } else if (result.skipped > 0) {
      setQueueNote(`${result.skipped.toLocaleString()} already queued`);
    }

    // Do not wait for the two-second tick to show that the button did something. This races
    // the poll effect's own fetch harmlessly: applySuccess is idempotent and the cursor only
    // advances, so whichever answer lands first, adopting it twice or out of order changes
    // nothing.
    const snapshot = await fetchQueue(cursor.current);
    if (snapshot) {
      cursor.current = snapshot.cursor;
      setQueue(snapshot);
    }
  }, [pendingBatch]);

  const play = useCallback((line: ResultLine) => {
    setCurrent(line);
    // The src changes with `current`, so play after React has committed it.
    queueMicrotask(() => void audio.current?.play().catch(() => {}));
  }, []);

  /**
   * Narrow to one NPC.
   *
   * The entity type goes with the id because the two id spaces overlap - creature 68 is a
   * Stormwind City Guard, gameobject 68 is a Wanted Poster - so the id alone would pull in a
   * stranger.
   */
  const narrowToNpc = useCallback(
    (line: ResultLine) => {
      setQuery(String(line.npcId));
      pending.current = write(pending.current, String(line.npcId));
      updateUrl({ q: String(line.npcId), filter: "npc", type: line.npcType });
    },
    [updateUrl],
  );

  const narrowToQuest = useCallback(
    (line: ResultLine) => {
      if (line.questId === null) return;
      const q = String(line.questId);
      setQuery(q);
      pending.current = write(pending.current, q);
      updateUrl({ q, filter: "quest", type: undefined });
    },
    [updateUrl],
  );

  // A flat, in-display-order list of what can actually be played, for j/k. This page only:
  // paging is a deliberate act, not something arrow keys should do behind your back.
  const playable = useMemo(
    () => (result?.lines ?? []).filter((line) => line.hasAudio),
    [result],
  );

  const step = useCallback(
    (delta: number) => {
      if (!playable.length) return;
      const at = current ? playable.findIndex((l) => l.key === current.key) : -1;
      const next = playable[Math.min(Math.max(at + delta, 0), playable.length - 1)];
      if (next) play(next);
    },
    [playable, current, play],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // The shadcn Select trigger is a <button role="combobox">, not a <select>, so
      // checking tagName alone would let space both toggle audio and open the dropdown.
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing =
        !!target &&
        (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) ||
          target.isContentEditable ||
          !!target.closest('[role="combobox"],[role="listbox"],[role="dialog"]'));

      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchInput.current?.focus();
        searchInput.current?.select();
        return;
      }
      if (typing) return;

      if (event.key === " ") {
        // Space stays a global play/pause even when a row control has focus. The
        // preventDefault is what keeps it from also activating that control, so buttons
        // inside a result row are reached with Enter.
        event.preventDefault();
        const el = audio.current;
        if (el?.src) void (el.paused ? el.play().catch(() => {}) : el.pause());
      } else if (event.key === "j") {
        step(1);
      } else if (event.key === "k") {
        step(-1);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [step]);

  useEffect(() => {
    if (!current) return;
    document
      .querySelector(`[data-line-key="${CSS.escape(current.key)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const pageCount = result ? Math.max(1, Math.ceil(result.total / result.limit)) : 1;
  // This page's marks, minus what has been cleared without a refetch since.
  const marked = new Set(
    (result?.lines ?? [])
      .filter((line) => line.dirty && !cleared.has(line.audioPath))
      .map((line) => line.audioPath),
  ).size;

  return (
    <>
      <SearchBar
        ref={searchInput}
        query={query}
        filters={filters}
        facets={facets}
        onQuery={setQuery}
        onFilters={updateFilters}
        onClearAll={clearAll}
        canTriage={showRegenerate}
      />

      {/* No dropdown to sit in: a line id arrives by link from /reports, so without this
          the list would be narrowed with nothing on the page saying so. */}
      {filters.line && (
        <div className="text-muted-foreground mt-3 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs">
          <span>
            Showing one line: <span className="font-mono">{filters.line}</span>
          </span>
          <Button size="xs" variant="ghost" onClick={() => updateFilters({ line: undefined })}>
            Show everything
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 pb-1">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          {result && `${plural(result.total, "line")} across ${plural(result.npcCount, "NPC")}`}
          {loading && result && <Refreshing />}
        </div>
        {/* This page's marks, which is what the row-level question was asked for. The
            corpus-wide count is what the "pronunciation moved" filter is for. */}
        {showRegenerate && marked > 0 && (
          <span className="flex items-center gap-1 text-sm text-amber-300">
            {marked} pronunciation on this page
            <Button size="xs" variant="ghost" onClick={() => void clearAllDirty()}>
              clear all matching
            </Button>
          </span>
        )}
        {showRegenerate && result && result.total > 0 && (
          <Button
            size="xs"
            variant="secondary"
            className="ml-auto"
            onClick={() => void requestBatch()}
          >
            Regenerate all {result.total.toLocaleString()}
          </Button>
        )}
      </div>

      <Pagination
        page={page}
        pageCount={pageCount}
        onPage={(next) => updateUrl({ page: next })}
      />

      {/* Fixed layout, because the point of the columns is that they line up down the page:
          left to auto sizing, one long quest title would widen its column for every row. The
          text column takes whatever the named columns leave. */}
      {loading && !result && <Loading />}

      {result && result.lines.length > 0 && (
        <table
          aria-busy={loading}
          className={`w-full table-fixed border-collapse text-sm transition-opacity ${loading ? "opacity-60" : ""}`}
        >
          <colgroup>
            <col className="w-52" />
            <col className="w-48" />
            <col className="w-32" />
            {/* The line text takes whatever the named columns leave, which is what anyone
                here to read came for. */}
            <col />
            {/* Audio: a state word, or the take selector. Both are short. */}
            <col className="w-28" />
            {/* Wide enough for what the cell actually holds, which the old w-20 was not:
                icon buttons are 32px, and a collaborator can have four side by side --
                report, edit, ignore, regenerate -- plus the report count. Anything narrower
                pushes them left over the line text. w-16 for everyone else, who has the
                report button and the count; never w-0, since that button is not gated. */}
            <col className={showRegenerate ? "w-40" : "w-16"} />
          </colgroup>
          <thead>
            <tr className="text-muted-foreground border-border border-b text-left text-xs">
              <th className="px-2 pb-1 font-medium">NPC / object</th>
              <th className="px-2 pb-1 font-medium">Quest</th>
              <th className="px-2 pb-1 font-medium">Race / gender / flavor</th>
              <th className="px-2 pb-1 font-medium">Line</th>
              <th className="px-2 pb-1 font-medium">Audio</th>
              <th className="sr-only">Actions</th>
            </tr>
          </thead>
          <tbody>
            {result.lines.map((line) => (
              <LineRow
                key={line.key}
                line={line}
                current={line.key === current?.key}
                canRegenerate={showRegenerate}
                canTriage={showRegenerate}
                state={lineStates[line.lineId]}
                blocked={blockedReason(line)}
                takes={line.take?.takes ?? 0}
                version={versions[line.audioPath] ?? line.take?.version ?? null}
                stale={line.stale}
                dirty={line.dirty && !cleared.has(line.audioPath)}
                onClearDirty={(l) => clearDirty([l.audioPath])}
                onPlay={play}
                onEditText={setEditing}
                onIgnore={canConfigure ? setIgnoring : null}
                onReport={setReporting}
                onRegenerate={regenerateLine}
                onRestored={handleRestored}
                onNarrowToNpc={narrowToNpc}
                onNarrowToQuest={narrowToQuest}
              />
            ))}
          </tbody>
        </table>
      )}

      {result && result.lines.length === 0 && (
        <div className="text-muted-foreground py-2 text-sm">No matches.</div>
      )}

      <Pagination
        page={page}
        pageCount={pageCount}
        onPage={(next) => updateUrl({ page: next })}
      />

      <p className="text-muted-foreground mt-6 flex flex-wrap items-center gap-1.5 text-xs">
        <Key>/</Key> search · <Key>space</Key> play/pause · <Key>j</Key> <Key>k</Key> next
        and previous line on this page
      </p>

      <OverrideDialog
        line={editing}
        onSaved={handleOverrideSaved}
        onCancel={() => setEditing(null)}
      />

      <IgnoreDialog
        line={ignoring}
        onSaved={handleIgnoreSaved}
        onCancel={() => setIgnoring(null)}
      />

      <ReportDialog
        subject={reporting && { source: "quests", line: reporting }}
        onClose={() => setReporting(null)}
      />

      <RegenerateDialog
        pending={pendingBatch}
        status={status}
        onConfirm={() => void startBatch()}
        onCancel={() => setPendingBatch(null)}
      />

      {/* Panel and player are stacked in one fixed container so the panel sits flush on top of
          the player, whatever height the player happens to be. */}
      <div className="fixed inset-x-0 bottom-0 z-40">
        <RegenerationPanel
          queue={dismissed ? null : queue}
          note={dismissed ? null : queueNote}
          onStop={() => void stopQueue()}
          onDismiss={() => {
            setDismissed(true);
            setQueueNote(null);
            // Also on the server, or the panel returns on the next navigation with the same
            // finished run. Only what the panel was showing is dismissed: `cursor` is the
            // highest terminal job it had seen, so anything that finishes after this click
            // still reports itself.
            if (cursor.current) void dismissQueue(cursor.current);
          }}
        />

        <Player
          ref={audio}
          line={current}
          version={current ? versions[current.audioPath] : undefined}
        />
      </div>
    </>
  );
}
