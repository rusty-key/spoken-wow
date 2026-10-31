"use client";

import { nameSubject, TranslateDialog, type TranslateSubject } from "@/components/TranslateDialog";
import { useCan } from "@/components/useCan";
import { useHistoryMode } from "@/components/useHistoryMode";
import { useLang } from "@/components/LangProvider";
import { BASE_LANG, withLang } from "@/lib/lang";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import ApiKeyRequiredDialog from "@/components/ApiKeyRequiredDialog";
import Key from "@/components/Key";
import Pagination from "@/components/Pagination";
import { Loading, Refreshing } from "@/components/Loading";
import { Button } from "@/components/ui/button";
import RegenerateDialog, { type PendingBatch } from "@/components/RegenerateDialog";
import RegenerationPanel from "@/components/RegenerationPanel";
import { LineRow, type RowState } from "@/components/places/LineRow";
import { LoreDialog } from "@/components/places/LoreDialog";
import { Player } from "@/components/places/Player";
import ReportDialog from "@/components/ReportDialog";
import { SearchBar } from "@/components/places/SearchBar";
import { Contained, Wide } from "@/components/Width";
import { totals as estimateTotals, LIST_RATE } from "@/lib/generation/billing";
import {
  fetchGenerationStatus,
  fetchQueue,
  queueBatch,
  stopQueue,
  type GenerationStatusResponse,
  type QueueSnapshot,
} from "@/lib/generation/client";
import { noApiKeyMessage } from "@/lib/no-api-key";
import RecordingDropZone from "@/components/RecordingDropZone";
import {
  canPlay,
  type ExplorerFilters,
  type ExplorerLine,
  type ExplorerResult,
  type ExplorerSection,
} from "@/components/explorer/section";
import { PAGE_SIZE } from "@/lib/places/filters";
import { useClearDirty } from "@/lib/generation/use-clear-dirty";
import { fetchRows, patchRows } from "@/lib/row-refresh";
import * as echo from "@/lib/url-echo";

// Long enough to hold a whole typed word: the timer restarts on every keystroke, so this
// is the pause after the last one, not a rate limit. Anyone who wants results before it
// elapses presses Enter, which fires the search immediately.
const DEBOUNCE_MS = 500;

type Batch = PendingBatch & { lineIds: string[] };

export function Explorer<L extends ExplorerLine, F extends ExplorerFilters>({
  section,
}: {
  section: ExplorerSection<L, F>;
}) {
  const { source, api, nameOf } = section;
  const lang = useLang();
  const pathname = usePathname();
  const params = useSearchParams();

  // What this visitor may do, which is what the rest of this component draws from.
  //
  // Read here rather than passed down from a server component, for UserMenu's reason: a
  // session read in the layout would put a database round trip in front of every page
  // view. While it is still pending both are false, so the controls appear once rather
  // than appearing and being taken away.
  //
  // Every one of these is checked again in src/lib/authz.ts. Nothing below is an access
  // control; it decides what is worth drawing.
  //
  // In the page's language: a translator may write this language's lore without being able
  // to regenerate it, so editing and regenerating are asked separately. Triage goes with
  // editing -- reading a report and fixing the text it is about are one job.
  const may = useCan();
  const canRegenerate = may("regenerate");
  const canEdit = may("edit");
  const canTriage = canEdit;
  // A line's name in this language, written as its own version in entity_name, and the line
  // to refresh once it is saved: a boss is named by its id, not by its line's.
  const [naming, setNaming] = useState<{ subject: TranslateSubject; lineId: string } | null>(null);

  // FILTERS ARE REBUILT FROM THE URL EVERY RENDER rather than held in state, so the
  // back button is a working undo for a filter change and a link carries the exact
  // view someone was looking at. This is the single most useful thing the two explorers
  // have in common; the quests one makes the same argument.
  const { fromParams, toParams } = section.filters;
  const filters = useMemo<F>(() => fromParams(params), [fromParams, params]);

  const page = Math.max(1, Number(params.get("page")) || 1);

  const urlQuery = filters.q ?? "";
  const [query, setQuery] = useState(urlQuery);
  const pending = useRef<echo.Pending>([]);

  const [result, setResult] = useState<ExplorerResult<L> | null>(null);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<L | null>(null);
  const [editFor, setEditFor] = useState<L | null>(null);
  // Text rewritten since this page was fetched, overlaid on the fetched rows: re-running
  // the search would reorder the table under the cursor, and with ?state=stale the line
  // just edited would vanish as it was saved.
  const [rewritten, setRewritten] = useState<Record<string, string>>({});
  // Anyone can open this one, signed in or not -- see ReportDialog.
  const [reportFor, setReportFor] = useState<L | null>(null);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  // Bumped per line after a regeneration, to bust the browser's audio cache: the
  // filename does not change, so without this the old take keeps playing.
  const [versions, setVersions] = useState<Record<string, number>>({});
  /**
   * The batch waiting to be confirmed, with the ids it was quoted for.
   *
   * The ids are a snapshot rather than the live filter: the dialog can sit open while the
   * search box keeps being typed into, and spending on a set nobody was shown is the
   * failure to avoid.
   */
  const [pendingBatch, setPendingBatch] = useState<Batch | null>(null);
  // Which click the open dialog belongs to, so a set that lands after a cancel or a later
  // click is dropped rather than shown.
  const batchRequest = useRef(0);

  // The shared queue, which both sections poll. A batch someone else started is spending
  // the same plan's credits, so it belongs on this screen too.
  const [queue, setQueue] = useState<QueueSnapshot | null>(null);
  const [queueNote, setQueueNote] = useState<string | null>(null);
  const cursor = useRef<string | null>(null);
  const [status, setStatus] = useState<GenerationStatusResponse | null>(null);
  // A refusal for want of a key, which is not a failure of the line and does not belong
  // in its row: the row would say "failed" for something the corpus had no part in.
  const [keyRequired, setKeyRequired] = useState<string | null>(null);

  const audio = useRef<HTMLAudioElement | null>(null);
  const searchInput = useRef<HTMLInputElement | null>(null);

  //----------------------------------------------------------------------------
  // URL
  //----------------------------------------------------------------------------

  // The native history calls, not the router, and the current path rather than "/".
  //
  // Both halves of that were a page load per keystroke. The bare path is a redirect
  // route -- src/app/page.tsx sends it to /enUS -- so "/?q=..." cost a round trip, a
  // redirect and a re-render of the page's zoneFacets() on every debounce, and on
  // /deDE it threw the language away as well. router.replace() would still re-render
  // the server component for the query change alone.
  //
  // Nothing on this screen needs the server for a filter change: the rows come from
  // /api/search below, and Next re-renders useSearchParams() from a native history
  // call, so `filters` still rebuilds from the URL and the URL still carries the view.
  const historyMode = useHistoryMode();

  /** `typed` for the search box's own writes; see useHistoryMode. */
  const writeQuery = useCallback(
    (search: URLSearchParams, typed = false) => {
      const query = search.toString();
      const url = query ? `${pathname}?${query}` : pathname;
      if (historyMode(typed) === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [historyMode, pathname],
  );

  const updateUrl = useCallback(
    (next: Record<string, string | number | undefined>, typed = false) => {
      const merged = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(next)) {
        if (value === undefined || value === "" || value === 0) merged.delete(key);
        else merged.set(key, String(value));
      }
      // Any change other than paging returns to page 1: staying on page 7 of a result
      // set that just became three pages long shows nothing and looks like a bug.
      if (!("page" in next)) merged.delete("page");
      writeQuery(merged, typed);
    },
    [params, writeQuery],
  );

  // Held in a ref so a filter change mid-word does not restart the keystroke timer.
  const updateUrlRef = useRef(updateUrl);
  updateUrlRef.current = updateUrl;

  const commitQuery = useCallback((value: string) => {
    pending.current = echo.write(pending.current, value);
    updateUrlRef.current({ q: value }, true);
  }, []);

  // A debounce, not a throttle: the timer is cleared and restarted by every keystroke,
  // so a search runs DEBOUNCE_MS after typing stops rather than at a fixed cadence
  // through it.
  useEffect(() => {
    if (query === urlQuery) return;
    const timer = setTimeout(() => commitQuery(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [commitQuery, query, urlQuery]);

  // Enter skips the wait. The effect above then sees query === urlQuery and stands down.
  const submitQuery = useCallback(() => {
    if (query !== urlQuery) commitQuery(query);
  }, [commitQuery, query, urlQuery]);

  // The URL catching up, or changing underneath us (back button, a pasted link).
  useEffect(() => {
    const { pending: rest, adopt } = echo.receive(pending.current, urlQuery);
    pending.current = rest;
    if (adopt) setQuery(urlQuery);
  }, [urlQuery]);

  // The one place a search bar's write meets the section's own filter type. The bar offers
  // only the fields and kinds this section lists, so the merge is one of its filter sets.
  const merge = useCallback((next: Partial<ExplorerFilters>) => ({ ...filters, ...next }) as F, [filters]);

  const updateFilters = useCallback(
    (next: Partial<ExplorerFilters>) => writeQuery(toParams(merge(next))),
    [merge, toParams, writeQuery],
  );

  const filtersHref = useCallback(
    (next: Partial<ExplorerFilters>) => {
      const query = toParams(merge(next)).toString();
      return query ? `${pathname}?${query}` : pathname;
    },
    [merge, pathname, toParams],
  );

  //----------------------------------------------------------------------------
  // Fetch
  //----------------------------------------------------------------------------

  // A string, not the object: memoising on object identity would refetch every render.
  const filterQuery = useMemo(() => toParams(filters).toString(), [filters, toParams]);

  // Held in refs so the callbacks below read the current view without being
  // rebuilt on every filter change.
  const filterQueryRef = useRef(filterQuery);
  filterQueryRef.current = filterQuery;
  const pageRef = useRef(page);
  pageRef.current = page;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    const search = new URLSearchParams(filterQuery);
    if (page > 1) search.set("page", String(page));

    fetch(withLang(lang, `${api}/search?${search}`), { signal: controller.signal })
      .then((response) => response.json())
      .then((data: ExplorerResult<L>) => {
        setResult(data);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name !== "AbortError") setLoading(false);
      });

    return () => controller.abort();
  }, [api, filterQuery, page, lang]);

  //----------------------------------------------------------------------------
  // Pronunciation marks
  //----------------------------------------------------------------------------

  // Held rather than refetched, for the reason the rewrite overlay is: a search rebuild to
  // unset one boolean is wasteful.
  const { cleared, clear: clearDirty } = useClearDirty(source);

  // The fetched row, with any rewrite made since it was fetched laid over the top. A
  // rewritten line is stale by definition -- the text no longer hashes to what was spoken
  // -- so the state moves with the text rather than waiting for a refetch.
  /** Every dirty line the current filter matches, not just this page's. */
  const clearAllDirty = useCallback(() => {
    fetch(withLang(lang, `${api}/search?${new URLSearchParams(filterQueryRef.current)}&ids=1`))
      .then((response) => response.json())
      .then(({ dirtyFiles }: { dirtyFiles?: string[] }) => clearDirty(dirtyFiles ?? []))
      .catch(() => {});
  }, [api, clearDirty, lang]);

  const withEdits = useCallback(
    (line: L): L => {
      let out = line;
      if (line.id in rewritten) {
        const text = rewritten[line.id];
        out = {
          ...out,
          text,
          chars: text.length,
          state: out.state === "missing" ? "missing" : "stale",
          // A save is a translation, whatever the row said before it was fetched.
          ...(out.translated === false ? { translated: true } : {}),
        };
      }
      // Cleared in this session. The row keeps whatever the search said about everything
      // else: an acknowledgement is about the pronunciation mark and nothing more.
      if (cleared.has(out.file)) out = { ...out, dirty: false };
      return out;
    },
    [rewritten, cleared],
  );

  //----------------------------------------------------------------------------
  // Regeneration
  //----------------------------------------------------------------------------

  const refetch = useCallback(() => {
    const search = new URLSearchParams(filterQueryRef.current);
    if (pageRef.current > 1) search.set("page", String(pageRef.current));
    fetch(withLang(lang, `${api}/search?${search}`))
      .then((response) => response.json())
      .then((data: ExplorerResult<L>) => setResult(data))
      .catch(() => {});
  }, [api, lang]);

  /**
   * Fetch these rows again by id and swap them in where they sit, so a row the change moved
   * out of the filter stays until the filter is asked again. See lib/row-refresh.
   */
  const refreshRows = useCallback(
    async (ids: string[]) => {
      const fresh = await fetchRows<L>(
        (id) => withLang(lang, `${api}/search?${new URLSearchParams({ line: id })}`),
        ids,
      );
      setResult((current) =>
        current && { ...current, lines: patchRows(current.lines, fresh, (row) => row.id, (row) => row.id) },
      );
    },
    [api, lang],
  );

  // What the plan allows and what is left of it, for the confirmation dialog. Shared with
  // the quests section because it is one account and one budget.
  useEffect(() => {
    if (!canRegenerate) return;
    const controller = new AbortController();
    void fetchGenerationStatus(controller.signal, lang).then(setStatus);
    return () => controller.abort();
  }, [canRegenerate, lang]);

  /**
   * One line, awaited.
   *
   * Straight through without a quote: it is one click, it is cheap, and the archive makes
   * it reversible. Anything larger goes through the queue below.
   */
  const regenerateOne = useCallback(
    (line: L) => {
      setRowStates((current) => ({ ...current, [line.id]: { phase: "busy" } }));

      fetch(withLang(lang, `${api}/regenerate`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineId: line.id }),
      })
        .then(async (response) => {
          const data = (await response.json().catch(() => ({}))) as {
            ok?: boolean;
            version?: number;
            error?: string;
            code?: string;
          };

          // Nothing was attempted and nothing was billed, so the row goes back to how it
          // was rather than wearing an error for a piece of missing setup.
          const needsKey = noApiKeyMessage(response.status, data);
          if (needsKey) {
            setKeyRequired(needsKey);
            setRowStates((current) => {
              const { [line.id]: _dropped, ...rest } = current;
              return rest;
            });
            return;
          }

          if (!response.ok || !data.ok || data.version === undefined) {
            setRowStates((current) => ({
              ...current,
              [line.id]: { phase: "error", message: data.error ?? "failed" },
            }));
            return;
          }

          setRowStates((current) => ({
            ...current,
            [line.id]: { phase: "done", version: data.version! },
          }));
          setVersions((current) => ({ ...current, [line.id]: data.version! }));
          void refreshRows([line.id]);
        })
        .catch((err: Error) => {
          setRowStates((current) => ({
            ...current,
            [line.id]: { phase: "error", message: String(err.message ?? err) },
          }));
        });
    },
    [api, refreshRows, lang],
  );

  /**
   * Quote first, always.
   *
   * The ids cover every page the filter matches, fetched at click time, and the estimate is
   * computed from them here rather than asked for: the characters are already on screen,
   * and the rate is the plan's, which /api/generation/status already carries. The zones
   * site had a quote endpoint because its cost model lived in config.json; both sections
   * read one rate now, calibrated from what this account has actually been charged.
   */
  const askToRegenerateAll = useCallback(() => {
    if (!result || result.total === 0) return;
    const request = ++batchRequest.current;
    // Open on the click, with the button's count, and fill it in when the ids land.
    setPendingBatch({
      label: `all ${result.total.toLocaleString()} filtered lines`,
      estimate: null,
      lineIds: [],
    });
    const settle = (next: (open: Batch) => Batch) =>
      setPendingBatch((open) => (open && request === batchRequest.current ? next(open) : open));

    fetch(withLang(lang, `${api}/search?${new URLSearchParams(filterQueryRef.current)}&ids=1`))
      .then((response) => response.json())
      .then(({ ids, totalChars }: { ids: string[]; totalChars: number }) => {
        const rate = status?.rate ?? { rate: LIST_RATE, samples: 0, modelId: null };
        settle(() => ({
          label: `all ${ids.length.toLocaleString()} filtered lines`,
          // Lines and files are the same count here: naming.mjs gives every line a file of
          // its own. The quests side has to tell them apart because 1,076 of its files are
          // spoken by more than one NPC.
          estimate: estimateTotals(
            { lines: ids.length, files: ids.length, characters: totalChars },
            rate,
          ),
          lineIds: ids,
        }));
      })
      .catch(() => settle((open) => ({ ...open, failed: true })));
  }, [api, result, status, lang]);

  /**
   * Hand the batch to the queue.
   *
   * The ids are the ones the estimate was built from, so what is queued is what was
   * quoted. They come from `pendingBatch` rather than from the live search for the reason
   * the snapshot exists at all.
   */
  const startBatch = useCallback(async () => {
    if (!pendingBatch?.estimate) return;
    const { lineIds } = pendingBatch;
    setPendingBatch(null);
    setQueueNote(null);

    const queued = await queueBatch({ source, lineIds }, pendingBatch.label, lang);

    if (!queued) {
      // No reason offered because none was given: the route refused for a cause this
      // response does not carry, and inventing one would be a guess dressed as an answer.
      setQueueNote("Could not queue the batch.");
    } else if ("error" in queued) {
      setKeyRequired(queued.error);
    } else if (queued.skipped > 0) {
      setQueueNote(`${queued.skipped.toLocaleString()} already queued`);
    }

    const snapshot = await fetchQueue(cursor.current);
    if (snapshot) {
      cursor.current = snapshot.cursor;
      setQueue(snapshot);
    }
  }, [pendingBatch, lang, source]);

  /**
   * The queue, polled.
   *
   * Two seconds while there is work and fifteen while there is not, so an idle page is not
   * asking a database forty times a minute for the same empty answer. Every take that
   * landed since the last poll is adopted here, which is what makes another collaborator's
   * work show up on this page -- and what replaced the zones site's own poll, which could
   * only ever see a batch its own process was running.
   */
  useEffect(() => {
    if (!canRegenerate) return;

    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    // Kept outside state so a dropped poll has something to fall back on: a null response
    // means the network hiccuped, not that the batch finished, and dropping to the idle
    // pace would leave the panel stale for fifteen seconds of a batch someone is watching.
    let active = false;
    const controller = new AbortController();

    async function poll() {
      const snapshot = await fetchQueue(cursor.current, controller.signal);
      if (cancelled) return;

      if (snapshot) {
        active = snapshot.active;
        cursor.current = snapshot.cursor;
        setQueue(snapshot);

        // Only this section's finished jobs. The queue carries both, and a places page told
        // that a quests file is now at version 3 would look for a line it does not have.
        const mine = snapshot.finished.filter((job) => job.source === source && job.lang === lang);
        if (mine.length > 0) {
          setVersions((current) => {
            const next = { ...current };
            for (const job of mine) next[job.lineId] = job.version;
            return next;
          });
          void refreshRows(mine.map((job) => job.lineId));
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
  }, [canRegenerate, refreshRows, lang, source]);

  //----------------------------------------------------------------------------
  // Playback
  //----------------------------------------------------------------------------

  const play = useCallback((line: L) => {
    setCurrent(line);
    // The <audio> src follows `current`, so play only once React has committed it.
    queueMicrotask(() => void audio.current?.play().catch(() => {}));
  }, []);

  // This page only, deliberately: j at the bottom of page 3 loading page 4 and
  // starting playback is a surprise, and the pager is right there.
  const playable = useMemo(
    () => (result?.lines ?? []).filter(canPlay),
    [result],
  );

  const step = useCallback(
    (delta: number) => {
      if (playable.length === 0) return;
      const index = current ? playable.findIndex((line) => line.id === current.id) : -1;
      const next = Math.min(Math.max(index + delta, 0), playable.length - 1);
      play(playable[next]);
    },
    [current, play, playable],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      // Never steal a keystroke from something being typed into. With native form
      // controls, tagName plus isContentEditable covers it -- the reason
      // ../wow-voiceover also has to check closest('[role="combobox"]') is that its
      // shadcn Select trigger is a <button role="combobox">, which this app has none of.
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);

      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchInput.current?.focus();
        searchInput.current?.select();
        return;
      }
      if (typing) return;

      if (event.key === " ") {
        // preventDefault or the page also scrolls, and a focused row button also
        // activates.
        event.preventDefault();
        const el = audio.current;
        if (!el || !current) return;
        if (el.paused) void el.play().catch(() => {});
        else el.pause();
      } else if (event.key === "j") {
        event.preventDefault();
        step(1);
      } else if (event.key === "k") {
        event.preventDefault();
        step(-1);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, step]);

  // Keep the selected row visible when j/k walks off the bottom of the viewport.
  useEffect(() => {
    if (!current) return;
    document
      .querySelector(`[data-line-key="${CSS.escape(current.id)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [current]);

  //----------------------------------------------------------------------------
  // Render
  //----------------------------------------------------------------------------

  const pages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;
  // The search sends facets only to somebody working in the language; see MadeBy.tsx.
  const showMadeBy = result?.madeBy !== undefined;
  const showRecordings = result?.recordable === true;

  return (
    <div className="pb-24">
      <Contained>
        <SearchBar
          section={section}
          fields={section.filters.fields}
          kinds={section.filters.kinds}
          filters={filters}
          active={section.filters.activeCount(filters)}
          canTriage={canTriage}
          madeBy={result?.madeBy}
          recordable={showRecordings}
          query={query}
          inputRef={searchInput}
          onQueryChange={setQuery}
          onQuerySubmit={submitQuery}
          onChange={updateFilters}
          onClearAll={() => writeQuery(new URLSearchParams())}
        />

        {showRecordings && <RecordingDropZone source={source} onUploaded={refetch} />}

        {/* A line id has no dropdown to sit in - it arrives by link from /reports - so
            without this the list would be narrowed with nothing on the page saying so. */}
        {filters.line && (
          <div className="text-muted-foreground mt-3 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs">
            <span>
              Showing one line: <span className="font-mono">{filters.line}</span>
            </span>
            <Button size="sm" variant="ghost" onClick={() => updateFilters({ line: undefined })}>
              Show everything
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 pb-1">
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            {result && `${result.total.toLocaleString()} ${result.total === 1 ? "line" : "lines"}`}
            {loading && result && <Refreshing />}
          </div>
          {result && result.counts.missing > 0 && (
            <span className="text-destructive text-sm">{result.counts.missing} missing</span>
          )}
          {result && result.counts.stale > 0 && (
            <span className="text-sm text-amber-300">{result.counts.stale} outdated</span>
          )}
          {/* Its own count, beside the states rather than among them: a line can be current
              and carry this at once. The button only for someone who could act on it. */}
          {result && result.dirty > 0 && (
            <span className="flex items-center gap-1 text-sm text-amber-300">
              {result.dirty} pronunciation
              {canRegenerate && (
                <Button size="xs" variant="ghost" onClick={clearAllDirty}>
                  clear all
                </Button>
              )}
            </span>
          )}

          {canRegenerate && result && result.total > 0 && (
            <Button size="xs" variant="secondary" className="ml-auto" onClick={askToRegenerateAll}>
              Regenerate all {result.total.toLocaleString()}
            </Button>
          )}
        </div>

        {/* Above the table as well as below it: 43 pages of lore is a lot of scrolling to
            reach a control that is one line away at the top. */}
        <Pagination page={page} pageCount={pages} onPage={(next) => updateUrl({ page: next })} />
      </Contained>

      <Wide>
        {/* Fixed layout, because the point of the columns is that they line up down the
            page: left to auto sizing, one long subzone name would widen its column for
            every row. The lore column takes whatever the named ones leave. */}
        {loading && !result && <Loading />}

        <table
          aria-busy={loading}
          hidden={!result}
          className={`w-full table-fixed border-collapse text-sm transition-opacity ${loading ? "opacity-60" : ""}`}
        >
          <colgroup>
            <col className="w-40" />
            <col className="w-44" />
            <col />
            {/* Audio: the state word, or the take selector, both of which are short. */}
            <col className="w-28" />
            {/* Made by: "fish:2.1-pro-free" over a name. Only when the search sent it. */}
            {showMadeBy && <col className="w-36" />}
            {showRecordings && <col className="w-32" />}
            {/* Wide enough for what the cell actually holds: icon buttons are 32px and an
                editor can have three side by side - report, edit, regenerate - plus the
                report count. Anything narrower and the row overflows left over the prose.
                w-16 for everyone else, who has the report button and the count; never w-0,
                since that button is not gated. */}
            <col className={canRegenerate ? "w-40" : "w-16"} />
          </colgroup>
          <thead>
            <tr className="text-muted-foreground border-border border-b text-left text-xs">
              <th className="px-2 pb-1 font-medium">{section.facetLabel}</th>
              <th className="px-2 pb-1 font-medium">{section.labels.name}</th>
              <th className="px-2 pb-1 font-medium">{section.labels.text}</th>
              <th className="px-2 pb-1 font-medium">Audio</th>
              {showMadeBy && <th className="px-2 pb-1 font-medium">Made by</th>}
              {showRecordings && <th className="px-2 pb-1 font-medium">Voice actor</th>}
              <th className="sr-only">Actions</th>
            </tr>
          </thead>
          <tbody>
            {result?.lines.map((line) => (
              <LineRow
                key={line.id}
                section={section}
                line={withEdits(line)}
                current={line.id === current?.id}
                showMadeBy={showMadeBy}
                showRecordings={showRecordings}
                onRecordingChanged={(l) => void refreshRows([l.id])}
                canRegenerate={canRegenerate}
                canEdit={canEdit}
                canTriage={canTriage}
                onPlay={play}
                onNarrowToChip={(l) => updateFilters({ mapID: l.mapID })}
                chipHref={(l) => filtersHref({ mapID: l.mapID })}
                state={rowStates[line.id]}
                onClearDirty={(l) => clearDirty([l.file])}
                onRestored={(l, version) => {
                  // The player's cache buster: the file name does not move when a take is
                  // put back, so without this the browser replays the clip just replaced.
                  setVersions((current) => ({ ...current, [l.id]: version }));
                  void refreshRows([l.id]);
                }}
                onReport={setReportFor}
                onEditText={(l) => setEditFor(withEdits(l))}
                onRename={
                  lang !== BASE_LANG && canEdit && nameOf
                    ? (l) =>
                        setNaming({
                          lineId: l.id,
                          subject: nameSubject({
                            ...nameOf(l),
                            title: l.name,
                            subtitle: l.id,
                            english: l.englishName ?? l.name,
                            current: l.nameMissing ? null : l.name,
                          }),
                        })
                    : null
                }
                onRegenerate={regenerateOne}
              />
            ))}
          </tbody>
        </table>

        {result && result.total === 0 && !loading && (
          <p className="text-muted-foreground py-8 text-center">Nothing matches these filters.</p>
        )}
      </Wide>

      <Contained>
        <Pagination page={page} pageCount={pages} onPage={(next) => updateUrl({ page: next })} />

        <p className="text-muted-foreground mt-6 flex flex-wrap items-center gap-1.5 text-xs">
          <Key>/</Key> search · <Key>space</Key> play/pause · <Key>j</Key> <Key>k</Key> next and
          previous line on this page
        </p>
      </Contained>

      <LoreDialog
        section={section}
        line={editFor}
        onClose={() => setEditFor(null)}
        onSaved={(line, full) => setRewritten((current) => ({ ...current, [line.id]: full }))}
      />

      <TranslateDialog
        subject={naming?.subject ?? null}
        onClose={() => setNaming(null)}
        onSaved={() => {
          if (naming) void refreshRows([naming.lineId]);
        }}
      />

      <ReportDialog
        subject={reportFor && { source, line: reportFor }}
        onClose={() => setReportFor(null)}
      />

      <ApiKeyRequiredDialog message={keyRequired} onClose={() => setKeyRequired(null)} />

      <RegenerateDialog
        pending={pendingBatch}
        status={status}
        onConfirm={() => void startBatch()}
        onCancel={() => setPendingBatch(null)}
      />

      {/* One stack, so the panel sits flush on top of a player of any height. */}
      <div className="fixed inset-x-0 bottom-0 z-30">
        <RegenerationPanel
          queue={queue}
          note={queueNote}
          onStop={() => void stopQueue()}
          onDismiss={() => setQueueNote(null)}
        />
        <Player
          section={section}
          line={current}
          version={current ? (versions[current.id] ?? current.take?.version) : undefined}
          audioRef={audio}
        />
      </div>
    </div>
  );
}
