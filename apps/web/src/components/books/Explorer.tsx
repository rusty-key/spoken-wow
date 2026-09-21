"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import ApiKeyRequiredDialog from "@/components/ApiKeyRequiredDialog";
import Pagination from "@/components/Pagination";
import RegenerateDialog from "@/components/RegenerateDialog";
import RegenerationPanel from "@/components/RegenerationPanel";
import { BookList } from "@/components/books/BookList";
import ReportDialog from "@/components/ReportDialog";
import { PageTextDialog } from "@/components/books/PageTextDialog";
import type { RowState } from "@/components/books/PageRow";
import { Player } from "@/components/books/Player";
import { SearchBar } from "@/components/books/SearchBar";
import { Loading, Refreshing } from "@/components/Loading";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import type { BookFacet } from "@/lib/books/catalogue";
import { filterParams, filtersFromParams, PAGE_SIZE, type PageFilters } from "@/lib/books/filters";
import type { ResultLine, SearchResult } from "@/lib/books/search";
import { totals as estimateTotals, LIST_RATE, type Estimate } from "@/lib/generation/billing";
import {
  fetchGenerationStatus,
  fetchQueue,
  queueBatch,
  stopQueue,
  type GenerationStatusResponse,
  type QueueSnapshot,
} from "@/lib/generation/client";
import { useClearDirty } from "@/lib/generation/use-clear-dirty";
import { noApiKeyMessage } from "@/lib/no-api-key";
import * as permissions from "@/lib/permissions";
import * as echo from "@/lib/url-echo";

// Long enough to hold a whole typed word: the timer restarts on every keystroke, so this is
// the pause after the last one rather than a rate limit. Enter fires the search immediately.
const DEBOUNCE_MS = 500;

export function Explorer({ books }: { books: BookFacet[] }) {
  const pathname = usePathname();
  const params = useSearchParams();

  // What this visitor may do. Read in the browser for UserMenu's reason: a session read in
  // the layout would put a database round trip in front of every page view. Every one of
  // these is checked again server-side; nothing here is an access control.
  const { data: session } = useSession();
  const canRegenerate = permissions.canRegenerate(session?.user.role);

  // FILTERS ARE REBUILT FROM THE URL EVERY RENDER rather than held in state, so the back
  // button is a working undo for a filter change and a link carries the exact view somebody
  // was looking at. Both other explorers make the same argument.
  const filters = useMemo<PageFilters>(() => filtersFromParams(params), [params]);
  const page = Math.max(1, Number(params.get("page")) || 1);

  const urlQuery = filters.q ?? "";
  const [query, setQuery] = useState(urlQuery);
  const pending = useRef<echo.Pending>([]);

  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<ResultLine | null>(null);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  // Anyone can open this one, signed in or not -- see ReportDialog.
  const [reportFor, setReportFor] = useState<ResultLine | null>(null);
  // The page whose text is being rewritten, and the rewrites made since the last search:
  // re-running it would reorder the table under the cursor, and with ?state=stale the page
  // just edited would vanish as it was saved.
  const [editFor, setEditFor] = useState<ResultLine | null>(null);
  const [rewritten, setRewritten] = useState<Record<string, string>>({});
  // Bumped per page after a regeneration, to bust the browser's audio cache: the filename
  // does not change, so without this the take that was replaced keeps playing.
  const [versions, setVersions] = useState<Record<string, number>>({});
  /**
   * The batch waiting to be confirmed, with the ids it was quoted for.
   *
   * The ids are a snapshot rather than the live filter: the dialog can sit open while the
   * search box keeps being typed into, and spending on a set nobody was shown is the
   * failure to avoid.
   */
  const [pendingBatch, setPendingBatch] = useState<{
    label: string;
    estimate: Estimate;
    lineIds: string[];
  } | null>(null);

  // The shared queue, which all three sections poll. A batch someone else started is
  // spending the same plan's credits, so it belongs on this screen too.
  const [queue, setQueue] = useState<QueueSnapshot | null>(null);
  const [queueNote, setQueueNote] = useState<string | null>(null);
  const cursor = useRef<string | null>(null);
  const [status, setStatus] = useState<GenerationStatusResponse | null>(null);
  // A refusal for want of a key, which is not a failure of the page and does not belong in
  // its row: the row would say "failed" for something the corpus had no part in.
  const [keyRequired, setKeyRequired] = useState<string | null>(null);

  const audio = useRef<HTMLAudioElement | null>(null);
  const searchInput = useRef<HTMLInputElement | null>(null);

  //----------------------------------------------------------------------------
  // URL
  //----------------------------------------------------------------------------

  // history.replaceState rather than router.replace: nothing on this screen needs the
  // server for a filter change -- the rows come from /api/books/search -- and Next
  // re-renders useSearchParams() from a native history call, so the URL still carries the
  // view without a round trip per keystroke.
  const replaceQuery = useCallback(
    (search: URLSearchParams) => {
      const next = search.toString();
      window.history.replaceState(null, "", next ? `${pathname}?${next}` : pathname);
    },
    [pathname],
  );

  const updateUrl = useCallback(
    (next: Record<string, string | number | undefined>) => {
      const merged = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(next)) {
        if (value === undefined || value === "" || value === 0) merged.delete(key);
        else merged.set(key, String(value));
      }
      // Any change other than paging returns to page 1: staying on page 7 of a result set
      // that just became three pages long shows nothing and looks like a bug.
      if (!("page" in next)) merged.delete("page");
      replaceQuery(merged);
    },
    [params, replaceQuery],
  );

  // Held in a ref so a filter change mid-word does not restart the keystroke timer.
  const updateUrlRef = useRef(updateUrl);
  updateUrlRef.current = updateUrl;

  const commitQuery = useCallback((value: string) => {
    pending.current = echo.write(pending.current, value);
    updateUrlRef.current({ q: value });
  }, []);

  // A debounce, not a throttle: every keystroke clears and restarts the timer.
  useEffect(() => {
    if (query === urlQuery) return;
    const timer = setTimeout(() => commitQuery(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [commitQuery, query, urlQuery]);

  const submitQuery = useCallback(() => {
    if (query !== urlQuery) commitQuery(query);
  }, [commitQuery, query, urlQuery]);

  // The URL catching up, or changing underneath us (back button, a pasted link).
  useEffect(() => {
    const { pending: rest, adopt } = echo.receive(pending.current, urlQuery);
    pending.current = rest;
    if (adopt) setQuery(urlQuery);
  }, [urlQuery]);

  const updateFilters = useCallback(
    (next: Partial<PageFilters>) => {
      replaceQuery(filterParams({ ...filters, ...next }));
    },
    [filters, replaceQuery],
  );

  //----------------------------------------------------------------------------
  // Fetch
  //----------------------------------------------------------------------------

  // A string, not the object: memoising on object identity would refetch every render.
  const filterQuery = useMemo(() => filterParams(filters).toString(), [filters]);

  // Held in refs so refetch() -- called from a poll and from a completed regeneration --
  // reads the current view without being rebuilt on every filter change, which would
  // restart the poll timer each time.
  // Held so a cleared row stays cleared without a refetch that would rebuild a hundred rows
  // to unset one boolean.
  const { cleared, clear: clearDirty } = useClearDirty("books");

  const filterQueryRef = useRef(filterQuery);
  filterQueryRef.current = filterQuery;
  const pageRef = useRef(page);
  pageRef.current = page;

  const [empty, setEmpty] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    const search = new URLSearchParams(filterQuery);
    if (page > 1) search.set("page", String(page));

    fetch(`/api/books/search?${search}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        // 503 with a code, not a crash: "nobody has run the import yet" is a deployment
        // state, and the route says so rather than leaving this to guess from a 500.
        if (response.status === 503 && data?.code === "corpus_empty") {
          setEmpty(data.error as string);
          setResult(null);
        } else {
          setEmpty(null);
          setResult(data as SearchResult);
        }
        setLoading(false);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setLoading(false);
      });

    return () => controller.abort();
  }, [filterQuery, page]);

  const refetch = useCallback(() => {
    const search = new URLSearchParams(filterQueryRef.current);
    if (pageRef.current > 1) search.set("page", String(pageRef.current));
    fetch(`/api/books/search?${search}`)
      .then((response) => response.json())
      .then((data: SearchResult) => setResult(data))
      .catch(() => {});
  }, []);

  //----------------------------------------------------------------------------
  // Regeneration
  //----------------------------------------------------------------------------

  // What the plan allows and what is left of it, for the confirmation dialog. Shared with
  // the other sections because it is one account and one budget.
  useEffect(() => {
    if (!canRegenerate) return;
    const controller = new AbortController();
    void fetchGenerationStatus(controller.signal).then(setStatus);
    return () => controller.abort();
  }, [canRegenerate]);

  /**
   * One page, awaited.
   *
   * Straight through without a quote: it is one click, it is cheap, and the archive makes
   * it reversible. Anything larger goes through the queue below.
   */
  const regenerateOne = useCallback(
    (line: ResultLine) => {
      setRowStates((state) => ({ ...state, [line.id]: { phase: "busy" } }));

      fetch("/api/books/regenerate", {
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
            setRowStates((state) => {
              const { [line.id]: _dropped, ...rest } = state;
              return rest;
            });
            return;
          }

          if (!response.ok || !data.ok || data.version === undefined) {
            setRowStates((state) => ({
              ...state,
              [line.id]: { phase: "error", message: data.error ?? "failed" },
            }));
            return;
          }

          setRowStates((state) => ({
            ...state,
            [line.id]: { phase: "done", version: data.version! },
          }));
          setVersions((state) => ({ ...state, [line.id]: data.version! }));
          refetch();
        })
        .catch((err: Error) => {
          setRowStates((state) => ({
            ...state,
            [line.id]: { phase: "error", message: String(err.message ?? err) },
          }));
        });
    },
    [refetch],
  );

  /**
   * Quote first, always.
   *
   * The ids cover every page the filter matches -- minus the ones nothing can voice, which
   * the route drops -- fetched at click time, and the estimate is computed from them here
   * rather than asked for.
   */
  /** Every dirty page the current filter matches, not just this screen's. */
  const clearAllDirty = useCallback(() => {
    fetch(`/api/books/search?${new URLSearchParams(filterQueryRef.current)}&ids=1`)
      .then((response) => response.json())
      .then(({ dirtyFiles }: { dirtyFiles?: string[] }) => clearDirty(dirtyFiles ?? []))
      .catch(() => {});
  }, [clearDirty]);

  const askToRegenerateAll = useCallback(() => {
    if (!result || result.total === 0) return;

    fetch(`/api/books/search?${new URLSearchParams(filterQueryRef.current)}&ids=1`)
      .then((response) => response.json())
      .then(({ ids, totalChars }: { ids: string[]; totalChars: number }) => {
        if (ids.length === 0) return;
        const rate = status?.rate ?? { rate: LIST_RATE, samples: 0, modelId: null };
        setPendingBatch({
          label: `all ${ids.length.toLocaleString()} voiceable pages`,
          // Pages and files are the same count: one page is one file. The quests side has
          // to tell them apart because many of its files are spoken by several NPCs.
          estimate: estimateTotals(
            { lines: ids.length, files: ids.length, characters: totalChars },
            rate,
          ),
          lineIds: ids,
        });
      })
      .catch(() => {});
  }, [result, status]);

  /** Hand the batch to the queue. The ids are the ones the estimate was built from. */
  const startBatch = useCallback(async () => {
    if (!pendingBatch) return;
    const { lineIds, label } = pendingBatch;
    setPendingBatch(null);
    setQueueNote(null);

    const queued = await queueBatch({ source: "books", lineIds }, label);

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
  }, [pendingBatch]);

  /**
   * The queue, polled.
   *
   * Two seconds while there is work and fifteen while there is not, so an idle page is not
   * asking the database forty times a minute for the same empty answer. The refetch is what
   * makes a batch's results appear as they land.
   */
  useEffect(() => {
    if (!canRegenerate) return;

    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    let active = false;
    const controller = new AbortController();

    async function poll() {
      const snapshot = await fetchQueue(cursor.current, controller.signal);
      if (cancelled) return;

      if (snapshot) {
        const wasActive = active;
        active = snapshot.active;
        cursor.current = snapshot.cursor;
        setQueue(snapshot);
        // Only when a run has just finished, rather than on every tick: refetching per poll
        // would reorder the table under somebody who is reading it.
        if (wasActive && !snapshot.active) refetch();
      }

      timer = setTimeout(poll, active ? 2_000 : 15_000);
    }

    void poll();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [canRegenerate, refetch]);

  //----------------------------------------------------------------------------
  // Playback
  //----------------------------------------------------------------------------

  const play = useCallback((line: ResultLine) => {
    setCurrent(line);
    // The <audio> src follows `current`, so play only once React has committed it. React
    // queues its own flush as a microtask when setCurrent is called, which is before this
    // one, so by the time this runs the element is pointing at the new clip.
    queueMicrotask(() => void audio.current?.play().catch(() => {}));
  }, []);

  //----------------------------------------------------------------------------
  // Render
  //----------------------------------------------------------------------------

  const pageCount = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;

  if (empty) {
    return (
      <p className="text-muted-foreground max-w-xl text-sm">
        {empty}
      </p>
    );
  }

  return (
    <>
      <SearchBar
        books={books}
        filters={filters}
        query={query}
        inputRef={searchInput}
        onQueryChange={setQuery}
        onQuerySubmit={submitQuery}
        onChange={updateFilters}
        onClearAll={() => replaceQuery(new URLSearchParams())}
        canTriage={canRegenerate}
      />

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

      <div className="text-muted-foreground mb-2 flex items-center gap-3 text-xs">
        {loading && result && <Refreshing />}
        <span>
          {result ? result.total.toLocaleString() : "…"} pages
          {result && ` · ${result.counts.missing.toLocaleString()} without audio`}
          {result && result.counts.stale > 0 && ` · ${result.counts.stale.toLocaleString()} outdated`}
          {result && result.dirty > 0 && ` · ${result.dirty.toLocaleString()} pronunciation`}
        </span>
        {/* Beside the counts, and only for someone who could act on it. */}
        {canRegenerate && result && result.dirty > 0 && (
          <Button size="sm" variant="ghost" onClick={clearAllDirty}>
            Clear {result.dirty.toLocaleString()} marks
          </Button>
        )}
        {canRegenerate && result && result.total > 0 && (
          <Button size="sm" variant="secondary" onClick={askToRegenerateAll}>
            Regenerate these
          </Button>
        )}
      </div>

      {loading && !result ? (
        <Loading label="Loading pages…" />
      ) : result && result.lines.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing matches these filters.</p>
      ) : (
        result && (
          <div aria-busy={loading} className={`transition-opacity ${loading ? "opacity-60" : ""}`}>
            <BookList
              // Cleared in this session laid over the fetched rows, the way the zones
              // explorer lays a rewrite over its own: the search said what was true when it
              // ran.
              lines={result.lines.map((line) => {
                let row = cleared.has(line.file) ? { ...line, dirty: false } : line;
                // A rewritten page is stale by definition -- its text no longer hashes to
                // what was spoken -- so the state moves with the text rather than waiting
                // for a refetch.
                if (line.id in rewritten) {
                  const text = rewritten[line.id];
                  row = {
                    ...row,
                    text,
                    chars: text.length,
                    state: row.state === "missing" ? "missing" : "stale",
                  };
                }
                return row;
              })}
              current={current}
              canRegenerate={canRegenerate}
              rowStates={rowStates}
              onPlay={play}
              onClearDirty={(line) => clearDirty([line.file])}
              onRegenerate={regenerateOne}
              onSelectBook={(line) => updateFilters({ bookId: line.bookId })}
              onReport={setReportFor}
              onEditText={setEditFor}
              onRestored={(line, version) => {
                // The player's cache buster, so the clip that was just put back is the one
                // that plays rather than the take it replaced -- the file name does not move.
                setVersions((state) => ({ ...state, [line.id]: version }));
                refetch();
              }}
            />
          </div>
        )
      )}

      <Pagination page={page} pageCount={pageCount} onPage={(next) => updateUrl({ page: next })} />

      <div className="fixed inset-x-0 bottom-0 z-20">
        <RegenerationPanel
          queue={queue}
          note={queueNote}
          onStop={() => void stopQueue()}
          onDismiss={() => setQueueNote(null)}
        />
        <Player
          line={current}
          version={current ? versions[current.id] : undefined}
          audioRef={audio}
        />
      </div>

      <PageTextDialog
        line={editFor}
        onClose={() => setEditFor(null)}
        onSaved={(line, text) => setRewritten((current) => ({ ...current, [line.id]: text }))}
      />

      <ReportDialog
        subject={reportFor && { source: "books", line: reportFor }}
        onClose={() => setReportFor(null)}
      />

      <RegenerateDialog
        pending={pendingBatch}
        status={status}
        onConfirm={() => void startBatch()}
        onCancel={() => setPendingBatch(null)}
      />
      <ApiKeyRequiredDialog message={keyRequired} onClose={() => setKeyRequired(null)} />
    </>
  );
}
