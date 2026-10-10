"use client";

import { nameSubject, TranslateDialog, type TranslateSubject } from "@/components/TranslateDialog";
import { useLang } from "@/components/LangProvider";
import { BASE_LANG, withLang } from "@/lib/lang";
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
import { Contained, Wide } from "./Width";
import { Loading, Refreshing } from "@/components/Loading";
import { Button } from "@/components/ui/button";
import { audioStateFromParams } from "@/lib/audio-state";
import { useSession } from "@/lib/auth-client";
import RecordingDropZone from "@/components/RecordingDropZone";
import { RECORDED, type Recorded } from "@/lib/recordings/live";
import { BROADCAST_STATUSES } from "@/lib/broadcast/status";
import type { Facets } from "@/lib/facets";
import type { Kind } from "@/lib/line-fields";
import { NARRATOR_VOICE } from "@/lib/generation/narration";
import { PROVIDER_NAME } from "@/lib/generation/providers";
import {
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
import { useCan } from "@/components/useCan";
import { canConfigureGeneration } from "@/lib/permissions";
import { isVoiceable } from "@/lib/text-gate";
import { isModelVoice } from "@/lib/voices/voices";
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
  if (filters.state) params.set("state", filters.state);
  if (filters.race) params.set("race", filters.race);
  if (filters.gender) params.set("gender", filters.gender);
  if (filters.flavor) params.set("flavor", filters.flavor);
  if (filters.voice) params.set("voice", filters.voice);
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.source) params.set("source", filters.source);
  if (filters.npcType) params.set("type", filters.npcType);
  if (filters.includeProgress) params.set("progress", "1");
  if (filters.narration) params.set("narration", "1");
  if (filters.line) params.set("line", filters.line);
  if (filters.overridden) params.set("overridden", "1");
  if (filters.ignored) params.set("ignored", "1");
  if (filters.dirty) params.set("dirty", "1");
  if (filters.reports) params.set("fb", filters.reports);
  if (filters.generatedBefore) params.set("before", filters.generatedBefore);
  if (filters.generatedAfter) params.set("after", filters.generatedAfter);
  if (filters.model) params.set("model", filters.model);
  if (filters.author) params.set("author", filters.author);
  if (filters.recorded) params.set("rec", filters.recorded);
  if (filters.broadcast) params.set("bt", filters.broadcast);
  return params;
}

/**
 * How many rows each row's speaker cells span: adjacent rows of one line and speaker are its
 * player-gender wordings, and say the same thing in every column but the text.
 */
function speakerSpans(lines: ResultLine[]): number[] {
  // A $g line's two rows are <id>:m and <id>:f.
  const key = (line: ResultLine) =>
    `${line.playerGender ? line.lineId.replace(/:[mf]$/, "") : line.lineId}|${line.npcType}|${line.npcId}|${line.voice}`;
  const spans = lines.map(() => 1);
  for (let start = 0; start < lines.length; ) {
    let end = start + 1;
    while (end < lines.length && key(lines[end]) === key(lines[start])) spans[end++] = 0;
    spans[start] = end - start;
    start = end;
  }
  return spans;
}

export default function Explorer({ facets, kind }: { facets: Facets; kind: Kind }) {
  const router = useRouter();
  const lang = useLang();
  const params = useSearchParams();
  const pathname = usePathname();
  const { data: session } = useSession();

  // Read once here and drilled down, rather than a hook per row: a page renders fifty
  // LineRows and the answer is the same for all of them.
  const may = useCan();
  const showRegenerate = may("regenerate");
  const canEdit = may("edit");
  // Ignoring hides a line from everyone and takes it out of the module, which is the reach
  // the generation settings have rather than the reach a rewrite has. Same gate as the API.
  const canConfigure = canConfigureGeneration(session?.user.role);
  const canIgnore = may("ignore");

  // The URL is the source of truth for a search, so a result is linkable and survives a
  // reload; `query` is the uncommitted keystroke state in front of it.
  const urlQuery = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);

  // Everything but the free-text query, which the input runs ahead of. Rebuilt from the URL
  // rather than held in state, so the back button is a working undo for a filter too.
  const filters = useMemo<LineFilters>(
    () => ({
      // From the page, not the URL: which explorer this is is where it lives, so a link
      // carries it in its path.
      kind,
      q: urlQuery,
      filter: (params.get("filter") as Filter) ?? "any",
      state: audioStateFromParams(params),
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
      dirty: params.get("dirty") === "1",
      reports: params.get("fb") === "open" ? "open" : undefined,
      generatedBefore: params.get("before") ?? undefined,
      generatedAfter: params.get("after") ?? undefined,
      model: params.get("model") ?? undefined,
      author: params.get("author") ?? undefined,
      recorded: RECORDED.find((value) => value === params.get("rec")),
      broadcast: BROADCAST_STATUSES.find((value) => value === params.get("bt")),
    }),
    [kind, params, urlQuery],
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
  // Another language's text or names, which are written as versions rather than as
  // English's overrides. See TranslateDialog.
  const [translating, setTranslating] = useState<TranslateSubject | null>(null);
  const editText = useCallback(
    (line: ResultLine) => {
      if (lang === BASE_LANG) {
        setEditing(line);
        return;
      }
      setTranslating({
        title: line.npcName,
        subtitle: line.lineId,
        english: line.english ? line.originalText : "There is no English line yet.",
        current: line.missing?.text ? null : line.text,
        endpoint: "/api/quests/lines/text",
        address: { lineId: line.lineId, variant: line.variant ?? 0 },
        field: "text",
        multiline: true,
      });
    },
    [lang],
  );
  const rename = useCallback((line: ResultLine, what: "npc" | "quest") => {
    setTranslating(
      what === "npc"
        ? nameSubject({
            kind: line.npcType,
            entityId: String(line.npcId),
            title: line.npcName,
            subtitle: `${line.npcType} ${line.npcId}`,
            english: line.english?.npcName ?? "",
            current: line.missing?.npcName ? null : line.npcName,
          })
        : nameSubject({
            kind: "quest",
            entityId: String(line.questId),
            title: line.questTitle ?? `quest ${line.questId}`,
            subtitle: `quest ${line.questId}`,
            english: line.english?.questTitle ?? "",
            current: line.missing?.questTitle ? null : line.questTitle,
          }),
    );
  }, []);
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
        // The two keys quests used before `state` are dropped whenever it is written, or an
        // old link's ?missing=1 would outlive the choice that replaced it.
        ...("state" in next ? { state: next.state, missing: undefined, outdated: undefined } : {}),
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
        ...("dirty" in next ? { dirty: next.dirty ? "1" : undefined } : {}),
        ...("reports" in next ? { fb: next.reports } : {}),
        ...("ignored" in next ? { ignored: next.ignored ? "1" : undefined } : {}),
        ...("generatedBefore" in next ? { before: next.generatedBefore } : {}),
        ...("generatedAfter" in next ? { after: next.generatedAfter } : {}),
        ...("model" in next ? { model: next.model } : {}),
        ...("author" in next ? { author: next.author } : {}),
        ...("recorded" in next ? { rec: next.recorded } : {}),
        ...("broadcast" in next ? { bt: next.broadcast } : {}),
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
    fetch(withLang(lang, `/api/quests/search?${search}`), { signal: controller.signal })
      .then((r) => r.json())
      .then((data: SearchResult) => {
        setResult(data);
        setLoading(false);
      })
      .catch((error) => {
        if (error.name !== "AbortError") setLoading(false);
      });

    return () => controller.abort();
  }, [filterQuery, page, refreshKey, lang]);

  useEffect(() => {
    if (!showRegenerate) return;
    const controller = new AbortController();
    void fetchGenerationStatus(controller.signal, lang).then(setStatus);
    return () => controller.abort();
  }, [showRegenerate, lang]);

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
        // Named from the voice: a translation's row carries its own skipReason, which knows
        // nothing of the model slot that is why it is refused (text-gate.ts).
        if (isModelVoice(line.voice)) return `No voice chosen for ${line.voice} yet`;
        return `Never voiced: ${line.skipReason}`;
      }
      // Before the voice checks: with no key the roster is empty, so every line would
      // otherwise be blocked for the wrong reason - "no voice named orc-male-shady" when
      // the truth is that nothing has been asked.
      if (!status) return null;
      // Named for the generator this collaborator has chosen, not always ElevenLabs: someone
      // on fish.audio with a key and references was otherwise told to go and set up a
      // provider they do not use.
      const provider = PROVIDER_NAME[status.provider];
      const missing = (voice: string) =>
        status.provider === "fish"
          ? `No fish.audio reference for "${voice}" in this language yet — cut one on /voices`
          : `No ElevenLabs voice named "${voice}" yet — create it on /voices`;
      if (status.noApiKey) {
        return `No ${provider} key on your account — set one in your profile`;
      }
      if (!status.voices.includes(line.voice)) {
        return missing(line.voice);
      }
      // A narrated line needs both voices, and the server refuses it for the same reason.
      if (line.narration && !status.voices.includes(NARRATOR_VOICE)) {
        return `Narrated line: ${missing(NARRATOR_VOICE)}`;
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
        // Only this section's, in this page's language: the queue carries all of them.
        for (const job of snapshot.finished) {
          if (job.source !== "quests" || job.lang !== lang) continue;
          applySuccess(job.file, job.version, job.lineId);
        }
      }

      timer = setTimeout(poll, active ? 2_000 : 15_000);
    }

    void poll();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [showRegenerate, applySuccess, lang]);

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

    const response = await regenerate(line.lineId, undefined, lang);

    if (!response.ok) {
      setLineStates((current) => ({
        ...current,
        [line.lineId]: { phase: "error", message: response.message },
      }));
      return;
    }

    applySuccess(response.file, response.version, line.lineId);
  }, [applySuccess, lang]);

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
    const response = await fetch(withLang(lang, `/api/quests/search?${params}`)).catch(() => null);
    if (!response?.ok) return;
    const { dirtyFiles } = (await response.json()) as { dirtyFiles?: string[] };
    clearDirty(dirtyFiles ?? []);
  }, [filterQuery, clearDirty, lang]);

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
    const jobs = await fetchBatchJobs(new URLSearchParams(quoted), undefined, lang);
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
  }, [filterQuery, status, lang]);

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
    setQueueNote(null);

    const result = await queueBatch(
      { source: "quests", filters: new URLSearchParams(pendingBatch.filters) },
      pendingBatch.label,
      lang,
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
  }, [pendingBatch, lang]);

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
  const groupSpans = speakerSpans(result?.lines ?? []);
  // This page's marks, minus what has been cleared without a refetch since.
  const marked = new Set(
    (result?.lines ?? [])
      .filter((line) => line.dirty && !cleared.has(line.audioPath))
      .map((line) => line.audioPath),
  ).size;

  // The search sends facets only to somebody working in the language; see MadeBy.tsx.
  const showMadeBy = result?.madeBy !== undefined;
  const showRecordings = result?.recordable === true;

  return (
    <>
      <Contained>
        <SearchBar
          ref={searchInput}
          query={query}
          filters={filters}
          facets={facets}
          onQuery={setQuery}
          onFilters={updateFilters}
          onClearAll={clearAll}
          canTriage={showRegenerate}
          madeBy={result?.madeBy}
          recordable={showRecordings}
          broadcastable={kind === "gossip"}
        />

        {showRecordings && <RecordingDropZone source="quests" onUploaded={refetch} />}

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
      </Contained>

      <Wide>
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
              {kind !== "gossip" && <col className="w-48" />}
              {kind === "gossip" && <col className="w-24" />}
              <col className="w-32" />
              {/* The line text takes whatever the named columns leave, which is what anyone
                  here to read came for. */}
              <col />
              {/* Audio: a state word, or the take selector. Both are short. */}
              <col className="w-28" />
              {/* Made by: "fish:2.1-pro-free" over a name. Only when the search sent it. */}
              {showMadeBy && <col className="w-36" />}
              {/* Voice actor: play, the version, upload; the credit under them. */}
              {showRecordings && <col className="w-32" />}
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
                {kind !== "gossip" && <th className="px-2 pb-1 font-medium">Quest</th>}
                {kind === "gossip" && <th className="px-2 pb-1 font-medium">Broadcast</th>}
                <th className="px-2 pb-1 font-medium">Race / gender / flavor</th>
                <th className="px-2 pb-1 font-medium">Line</th>
                <th className="px-2 pb-1 font-medium">Audio</th>
                {showMadeBy && <th className="px-2 pb-1 font-medium">Made by</th>}
                {showRecordings && <th className="px-2 pb-1 font-medium">Voice actor</th>}
                <th className="sr-only">Actions</th>
              </tr>
            </thead>
            <tbody>
              {result.lines.map((line, index) => (
                <LineRow
                  key={line.key}
                  line={line}
                  current={line.key === current?.key}
                  showMadeBy={showMadeBy}
                  showRecordings={showRecordings}
                  onRecordingChanged={refetch}
                  canRegenerate={showRegenerate}
                  canEdit={canEdit}
                  canTriage={canEdit}
                  state={lineStates[line.lineId]}
                  blocked={blockedReason(line)}
                  takes={line.take?.takes ?? 0}
                  version={versions[line.audioPath] ?? line.take?.version ?? null}
                  stale={line.stale}
                  dirty={line.dirty && !cleared.has(line.audioPath)}
                  onClearDirty={(l) => clearDirty([l.audioPath])}
                  onPlay={play}
                  onEditText={editText}
                  onRename={lang !== BASE_LANG && canEdit ? rename : null}
                  onIgnore={canIgnore ? setIgnoring : null}
                  onReport={setReporting}
                  onRegenerate={regenerateLine}
                  onRestored={handleRestored}
                  onNarrowToNpc={narrowToNpc}
                  showQuest={kind !== "gossip"}
                  showBroadcast={kind === "gossip"}
                  groupSpan={groupSpans[index]}
                  onNarrowToQuest={narrowToQuest}
                />
              ))}
            </tbody>
          </table>
        )}

        {result && result.lines.length === 0 && (
          <div className="text-muted-foreground py-2 text-sm">No matches.</div>
        )}
      </Wide>

      <Contained>
        <Pagination
          page={page}
          pageCount={pageCount}
          onPage={(next) => updateUrl({ page: next })}
        />

        <p className="text-muted-foreground mt-6 flex flex-wrap items-center gap-1.5 text-xs">
          <Key>/</Key> search · <Key>space</Key> play/pause · <Key>j</Key> <Key>k</Key> next
          and previous line on this page
        </p>
      </Contained>

      <OverrideDialog
        line={editing}
        onSaved={handleOverrideSaved}
        onCancel={() => setEditing(null)}
      />

      <TranslateDialog
        subject={translating}
        onClose={() => setTranslating(null)}
        // A name is on many rows and a line's text changes whether it can be voiced, so the
        // page is fetched again rather than patched.
        onSaved={() => refetch()}
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
          queue={queue}
          note={queueNote}
          onStop={() => void stopQueue()}
          onDismiss={() => setQueueNote(null)}
        />

        <Player
          ref={audio}
          line={current}
          version={current ? (versions[current.audioPath] ?? current.take?.version) : undefined}
        />
      </div>
    </>
  );
}
