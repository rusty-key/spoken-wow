"use client";

/**
 * The triage list for pasted envelopes.
 *
 * A table for the same reason ReportTable is one: triage is a scan down a column, and the
 * submitted text -- which can run to a full quest's worth of dialogue -- is clamped to two
 * lines until opened, so a long paste does not push every row after it off the screen.
 *
 * Never renders `ip` or `email`, which exist only for abuse response. Who sent a row -- the
 * names senders chose to show -- is fetched only when its count is pressed, never carried on
 * every row. `body` -- the optional
 * complaint -- is different: it's the one field a player filled in specifically to be read,
 * so it is rendered below, deliberately included in the Row this component accepts.
 *
 * `initial` is typed as `ContributionRow`, not the full `Contribution`, and page.tsx must
 * project down to it before passing rows here: this is a "use client" component, so whatever
 * shape its props carry crosses into the RSC flight payload and is readable in devtools
 * regardless of what this file goes on to render. `ip`, `name`, `email` and `raw` have no
 * reason to make that crossing at all.
 */
import { useLang } from "@/components/LangProvider";
import { localeHref, type Lang } from "@/lib/lang";
import { ChevronDownIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { memo, useCallback, useMemo, useState } from "react";

import ClientSelect from "@/components/ClientSelect";
import { SEARCH_IN_OPTIONS, STAGE_CHIP_OPTIONS, STAGE_LABELS } from "@/components/contribution-chips";
import FilterChip from "@/components/FilterChip";
import MultiFilterChip from "@/components/MultiFilterChip";
import SortHeader from "@/components/SortHeader";
import SpeakerCell, { ProvenanceBadge, type SpeakerAnswer } from "@/components/SpeakerCell";
import { ACCEPT_TONE, LiteButton, LiteCheckbox, REJECT_TONE } from "@/components/LiteControls";
import { Refreshing } from "@/components/Loading";
import SendersButton from "@/components/SendersButton";
import StatusTabs, { BucketTabs } from "@/components/StatusTabs";
import { usePendingPush } from "@/components/usePendingPush";
import { useLocalDates } from "@/components/useLocalDates";
import { useSearchBox } from "@/components/useSearchBox";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  RESOLVE_MANY_MAX,
  type ContributionStatus,
  type ResolveManyResult,
} from "@/lib/contributions/contributions";
import type { ClientSummary } from "@/lib/contributions/client";
import { flavorOptionsFor, summaryFromResolution } from "@/lib/contributions/speaker";
import { Roster, type RosterData } from "@/lib/voices/roster";
import {
  bucketOf,
  contributionsHref,
  namesSpeaker,
  nextSort,
  type Bucket,
  type Section,
  type ClientFilter,
  type ContributionSort,
  type FilterChange,
  type SortColumn,
  type StageFilter,
} from "@/lib/contributions/query";
import type { Contribution } from "@/lib/contributions/store";
import { textHints } from "@/lib/contributions/text-hints";
// Both are computed server-side (npcSummaryFrom reads the roster store) -- `import
// type` erases the whole thing at compile time, so none of that follows the type in here. The
// same split existing.ts's `existing` prop already draws.
import type { BookSummary, NpcConflictOption, NpcSummary, QuestSummary } from "@/lib/contributions/triage";
// From npc.ts, not npc/store.ts: store.ts imports @/lib/db, and pulling NPC_ROW_KINDS
// (values, not just types) out of it would drag Postgres's own node built-ins into this bundle.
import { NPC_ROW_KINDS, type NpcKind, type NpcRowKind } from "@/lib/npc/npc";
import type { NpcResolution } from "@/lib/npc/store";
import type { Filter } from "@/lib/search";
import { cn, endsSelection } from "@/lib/utils";
import { wowheadEntityUrl, wowheadForeverUrl, wowheadQuestUrl } from "@/lib/wowhead";

export type { NpcSummary };

/** The fields this table reads. page.tsx projects full Contribution rows down to this shape. */
export type ContributionRow = Pick<
  Contribution,
  "id" | "source" | "key" | "locale" | "count" | "text" | "status" | "createdAt" | "body"
> & {
  /** The game client the text came from, classified from the envelope's `build`. */
  client: ClientSummary;
  /** The voice packs' language when it is not the client's (triage.ts packHeard), else null. */
  pack: string | null;
  /** Null when the envelope never named an NPC at all -- places and readables, or a quest keyed on quest+event. */
  npc: NpcSummary | null;
  /** Null when the source has no quest concept at all. See lib/contributions/triage.ts. */
  quest: QuestSummary | null;
  /** A readables row: what the client showed, and what the matcher or a moderator decided it is. */
  book: BookSummary | null;
  /** A places or readables row's place as the client named it: zone and subzone, or book and page. */
  place: string | null;
  /**
   * Whether this contribution's line is already in the explorer (accept.ts's lineIsInExplorer).
   * Only meaningful for an accepted quests row -- it is what decides whether "Add to explorer"
   * is offered: a row accepted before this feature existed has none yet.
   */
  hasLine: boolean;
  /** A quest moment that already has this row's NPC as a speaker, in any language: accepted with no speaker answer. */
  hasSpeaker: boolean;
};

/** A book a row can be placed in. */
export type BookChoice = { bookId: string; title: string; pages: number };

/** The datalist the match form's book field offers, rendered once for the whole table. */
const READABLES_LIST = "contribution-readables";
const NEW_BOOK = "New book";

/**
 * What the book field may say -> the book it names, or null for a new book. A title more than
 * one book has carries its book's id.
 */
type BookLabels = ReadonlyMap<string, BookChoice | null>;

function bookLabels(books: readonly BookChoice[]): BookLabels {
  const titles = new Map<string, number>([[NEW_BOOK, 1]]);
  for (const book of books) titles.set(book.title, (titles.get(book.title) ?? 0) + 1);
  const labels = new Map<string, BookChoice | null>([[NEW_BOOK, null]]);
  for (const book of books) labels.set(titles.get(book.title)! > 1 ? `${book.title} · #${book.bookId}` : book.title, book);
  return labels;
}

/** What a moderator says a readables row is, as api/contributions/page takes it; null clears it. */
type MatchAnswer = { bookId: string; pageNumber: number } | { newBook: true } | null;

const STATUS_LABELS: Record<ContributionStatus, string> = {
  new: "New",
  accepted: "Accepted",
  rejected: "Rejected",
};




export default function ContributionTable({
  initial,
  matching,
  page,
  pages,
  status,
  bucket,
  bucketCounts,
  client,
  source,
  stage,
  sort,
  q,
  searchIn,
  existing,
  books,
  roster: rosterData,
  canAnswerNpc,
}: {
  /** This page's rows. */
  initial: ContributionRow[];
  /** Every row the filters match, on any page -- what "Accept all" acts on. */
  matching: { id: number; status: ContributionStatus; bulk: boolean }[];
  page: number;
  pages: number;
  status: ContributionStatus;
  /** Which half of the New tab is shown; the other tabs are not split. */
  bucket: Bucket;
  bucketCounts: Record<Bucket, number>;
  client: ClientFilter;
  /** The section shown: its rows only, and only the columns and filters that apply to it. */
  source: Section;
  stage: StageFilter;
  sort: ContributionSort;
  q: string;
  searchIn: Filter;
  /** id -> corpus text, present only where the row's key resolves to something on file. */
  existing: Record<number, string>;
  /** The books a row can be placed in. Empty when no row here needs it. */
  books: BookChoice[];
  /** facets().roster -- what lets the speaker selects narrow to whatever type was just chosen, without a round trip. */
  roster: RosterData;
  /** Whether the viewer may set an NPC's race, gender and flavor; if not, they are shown only. */
  canAnswerNpc: boolean;
}) {
  const { pending, push } = usePendingPush();
  const router = useRouter();
  const lang = useLang();
  const roster = useMemo(() => new Roster(rosterData), [rosterData]);
  const labels = useMemo(() => bookLabels(books), [books]);

  /**
   * What this session resolved, overlaid on the server's rows -- the same shape ReportTable
   * uses and for the same reason: the status tabs above are a navigation, so seeding state
   * from `initial` once would leave a resolved row sitting in a queue it no longer belongs to
   * until the next reload.
   */
  const [resolved, setResolved] = useState<Record<number, Contribution["status"]>>({});
  const [busy, setBusy] = useState<number | null>(null);
  /** Same overlay idea as `resolved`, for "Add to explorer" succeeding on an already-accepted row. */
  const [lineCreated, setLineCreated] = useState<Set<number>>(new Set());
  /** A refused resolve, in the words the route already gives -- cleared by the next attempt. */
  const [refusals, setRefusals] = useState<Record<number, string>>({});

  /**
   * The npc column, overlaid on the server's rows for the same reason `resolved` is: the
   * override writes through to the NPC, not this contribution, so nothing here navigates away
   * on save and a reload would be the only other way to see it land.
   *
   * Keyed by NPC (overrideKey), not by contribution, for the same reason the write goes to the
   * NPC: one answer settles every row that NPC speaks, and the page should show that at once.
   * A kind-less row has no NPC key yet, so its own answer is kept under its contribution id.
   */
  const [npcOverrides, setNpcOverrides] = useState<Record<string, NpcSummary>>({});
  const [npcBusy, setNpcBusy] = useState<number | null>(null);

  const overrideNpc = useCallback(
    async (
      contributionId: number,
      npc: NpcSummary,
      // Partial on purpose -- a key left out entirely (not sent as "") tells the route to keep
      // whatever is already on the row, which is what lets the "client" state save just a
      // flavor and the "nothing known" state save just a race and gender. See the route's own
      // orExisting for the other half of this. `npcKind` is only ever in here for a kind-less
      // row (npc.npcKind === null): the moderator's own select is the only source for it then,
      // since there is no existing row (or envelope) to fall back on the way race/gender/flavor
      // can.
      answer: SpeakerAnswer,
    ) => {
      setNpcBusy(contributionId);
      const response = await fetch(`/api/contributions/npc?lang=${lang}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // A kind-less row's moderator-chosen kind wins over the row's own null. `??` rather than
        // spreading `answer` over the default: SpeakerCell sends `npcKind: undefined` for a row
        // that already has a kind, and a spread would overwrite that kind with undefined, which
        // JSON then drops -- the route answered every such save "unknown kind".
        body: JSON.stringify({ ...answer, npcId: npc.npcId, npcKind: answer.npcKind ?? npc.npcKind }),
      }).catch(() => null);
      setNpcBusy(null);

      if (!response?.ok) return;
      const { resolution } = (await response.json()) as { resolution: NpcResolution };
      // A kind-less row's moderator just said which kind it is: record that on the contribution
      // too, so a later answer for the other kind under the same id can never turn this row
      // into a conflict.
      if (npc.npcKind === null && answer.npcKind) {
        await recordKind(contributionId, answer.npcKind);
      }
      // A saved answer is always "settled" (provenance "moderator" is always confirmed --
      // migration 0031), so nothing here ever renders the flavor select again to need
      // flavorOptions -- computed anyway so the type stays honest rather than lying with `[]`.
      const summary = summaryFromResolution(resolution, roster);
      setNpcOverrides((current) => ({
        ...current,
        [contributionKey(contributionId)]: summary,
        [overrideKey(resolution.npcKind, resolution.npcId)]: summary,
      }));
    },
    [roster, lang],
  );

  /**
   * A conflict settled: the moderator picked which of the answers on file this contribution's
   * NPC is. Recorded on the contribution (api/contributions/kind), then shown as that answer.
   */
  const pickConflict = useCallback(
    async (contributionId: number, npc: NpcSummary, option: NpcConflictOption) => {
      setNpcBusy(contributionId);
      // Conflicts are between a creature and a gameobject: getResolutionsById reads no items.
      const ok = await recordKind(contributionId, option.npcKind as NpcKind);
      setNpcBusy(null);
      if (!ok) {
        setRefusals(withRefusal(contributionId));
        return;
      }
      setNpcOverrides((current) => ({
        ...current,
        [contributionKey(contributionId)]: {
          ...npc,
          npcKind: option.npcKind,
          race: option.race,
          gender: option.gender,
          flavor: option.flavor,
          provenance: option.provenance,
          confirmed: option.provenance === "corpus" || option.provenance === "display" || option.provenance === "moderator",
          doubtful: option.doubtful,
          flavorOptions: flavorOptionsFor(option.race, option.gender, roster),
          conflict: [],
        },
      }));
    },
    [roster],
  );

  /**
   * A quest row whose envelope named no NPC, given one by hand (api/contributions/npc-identity).
   * Shown under the contribution's own key, with resolveNpc's answer for it. When resolving
   * failed the answer is still recorded, and a refresh is what resolves it (page.tsx's npcFor).
   * The error, when there is one, is the route's own words.
   */
  const nameNpc = useCallback(
    async (contributionId: number, answer: { npcKind: NpcRowKind; npcId: number; npcName: string }) => {
      setNpcBusy(contributionId);
      const response = await fetch("/api/contributions/npc-identity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: contributionId, ...answer }),
      }).catch(() => null);
      setNpcBusy(null);

      const body = (await response?.json().catch(() => null)) as
        | { resolution?: NpcResolution | null; error?: unknown }
        | null;
      if (!response?.ok) {
        setRefusals(withRefusal(contributionId, body?.error));
        return;
      }
      setRefusals(withoutRefusal(contributionId));
      if (!body?.resolution) {
        router.refresh();
        return;
      }
      const summary = summaryFromResolution(body.resolution, roster);
      setNpcOverrides((current) => ({ ...current, [contributionKey(contributionId)]: summary }));
    },
    [roster, router],
  );

  /**
   * A readables row placed by hand (api/contributions/page), or cleared with null. The error, when
   * there is one, is the route's own words; the page re-reads the row's match on success.
   */
  const matchPage = useCallback(
    async (contributionId: number, answer: MatchAnswer) => {
      setNpcBusy(contributionId);
      const response = await fetch("/api/contributions/page", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: contributionId, ...(answer ?? { clear: true }) }),
      }).catch(() => null);
      setNpcBusy(null);

      const body = (await response?.json().catch(() => null)) as { error?: unknown } | null;
      if (!response?.ok) {
        setRefusals(withRefusal(contributionId, body?.error));
        return;
      }
      setRefusals(withoutRefusal(contributionId));
      router.refresh();
    },
    [router],
  );

  /** A row's status change landed: shown at once, without waiting for a reload. */
  const landed = useCallback((id: number, next: ContributionStatus) => {
    setRefusals(withoutRefusal(id));
    setResolved((current) => ({ ...current, [id]: next }));
    // "Add to explorer" is the same POST as Accept, re-sent for a row already accepted -- this
    // is what hides the button once it has worked, without waiting for a reload.
    if (next === "accepted") setLineCreated((current) => new Set(current).add(id));
  }, []);

  /** One row's status change, from its own buttons. True when it landed. */
  const send = useCallback(async (id: number, next: ContributionStatus): Promise<boolean> => {
    // What the row was shown to match, so the accept refuses it if that has changed since.
    const bookMatch = next === "accepted" ? initial.find((row) => row.id === id)?.book?.match : undefined;
    const response = await fetch("/api/contributions/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, status: next, bookMatch }),
    }).catch(() => null);

    if (!response?.ok) {
      // The route already gives a plain-words reason for needs-speaker and one-way (accept.ts);
      // anything else (bad status, unknown row) degrades the same way this always has.
      const body = await response?.json().catch(() => null);
      setRefusals(withRefusal(id, body?.error));
      return false;
    }
    landed(id, next);
    return true;
  }, [initial, landed]);

  const resolve = useCallback(
    async (id: number, next: ContributionStatus) => {
      setBusy(id);
      await send(id, next);
      setBusy(null);
    },
    [send],
  );

  /** Rows ticked for "Accept selected" / "Reject selected". */
  const [selected, setSelected] = useState<Set<number>>(new Set());
  /** A bulk run in flight, for its progress line and to hold every other button still meanwhile. */
  const [bulk, setBulk] = useState<{ next: ContributionStatus; done: number; total: number } | null>(null);
  /** What the last bulk run came to, until the next one starts. */
  const [bulkOutcome, setBulkOutcome] = useState<string | null>(null);
  /** "Accept all shown" asks twice: accepting writes quest lines, and a quests row can't be reopened after. */
  const [confirmAll, setConfirmAll] = useState(false);

  /**
   * The rows sent to api/contributions/resolve-many, a chunk per request, resolved side by side
   * on the server (accept.ts's resolveContributions). A row that is refused keeps its refusal
   * under it, exactly as if its own button had been pressed, and the rest carry on.
   */
  const resolveMany = useCallback(
    async (ids: number[], next: ContributionStatus) => {
      setBulkOutcome(null);
      setBulk({ next, done: 0, total: ids.length });
      const refused: number[] = [];
      for (let start = 0; start < ids.length; start += RESOLVE_MANY_MAX) {
        const chunk = ids.slice(start, start + RESOLVE_MANY_MAX);
        const response = await fetch("/api/contributions/resolve-many", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids: chunk, status: next }),
        }).catch(() => null);
        const body = (await response?.json().catch(() => null)) as
          | { results?: Record<number, ResolveManyResult>; error?: unknown }
          | null;
        for (const id of chunk) {
          const result = response?.ok ? body?.results?.[id] : undefined;
          if (result?.ok) {
            landed(id, next);
          } else {
            refused.push(id);
            setRefusals(withRefusal(id, result ? result.error : body?.error));
          }
        }
        setBulk({ next, done: Math.min(start + chunk.length, ids.length), total: ids.length });
      }
      setBulk(null);
      // The refused rows stay ticked, so fixing their speakers and pressing the same button again
      // is the whole retry.
      setSelected(new Set(refused));
      // Rows that left this view leave gaps on this page; the server fills them from the next.
      router.refresh();
      setBulkOutcome(
        `${STATUS_LABELS[next]}: ${ids.length - refused.length} of ${ids.length}` +
          (refused.length > 0 ? ` -- ${refused.length} refused and left selected.` : "."),
      );
    },
    [landed, router],
  );

  const rows = initial.filter((row) => (resolved[row.id] ?? row.status) === status);

  /** The row's NPC with this session's answers over the server's. */
  const npcOf = (row: ContributionRow): NpcSummary | null => {
    const override =
      (row.npc?.npcKind ? npcOverrides[overrideKey(row.npc.npcKind, row.npc.npcId)] : undefined) ??
      npcOverrides[contributionKey(row.id)];
    // An override is the shared resolution, named in English; the row keeps the name its own
    // envelope gave, in its own locale.
    return override ? { ...override, npcName: row.npc?.npcName ?? override.npcName } : row.npc;
  };

  // Only rows still on screen count: a selected row a bulk reject just moved out of this view
  // must not be accepted by the next click on a button that no longer shows it.
  const selectedRows = rows.filter((row) => selected.has(row.id));
  /** The ids among `from` a bulk change to `next` would actually change. */
  const changeable = (from: ContributionRow[], next: ContributionStatus) =>
    from.filter((row) => (resolved[row.id] ?? row.status) !== next).map((row) => row.id);
  // Every matching row, not just this page's: "Accept all" is for the whole filtered queue.
  const shownToAccept = matching
    .filter((row) => row.bulk && (resolved[row.id] ?? row.status) !== "accepted")
    .map((row) => row.id);
  // A row with no speaker would only come back refused, nor would a readables row the matcher can't
  // place: that one is accepted on its own.
  const notBulk = new Set(matching.filter((row) => !row.bulk).map((row) => row.id));
  const selectedToAccept = changeable(
    selectedRows.filter((row) => bucketOf(row, npcOf(row), roster) === "ready" && !notBulk.has(row.id)),
    "accepted",
  );
  const selectedToReject = changeable(selectedRows, "rejected");
  const allTicked = rows.length > 0 && selectedRows.length === rows.length;

  // Stable, like every callback a row is handed: a row redraws only when its own props change.
  const toggle = useCallback(
    (id: number, on: boolean) =>
      setSelected((current) => {
        const next = new Set(current);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      }),
    [],
  );

  /**
   * Move one dropdown and keep the other, then push it -- a soft navigation, not a state
   * change, so the filter still lives in the URL and survives a refresh. Follows
   * ReportTable.tsx's own `go`; the mapping itself is contributionsHref, pulled out to
   * lib/contributions/query.ts so it can be tested without rendering FilterChip or this table.
   */
  const filters = { status, bucket, client, source, stage, sort, q, searchIn };
  function go(next: FilterChange, toPage = 1) {
    push(localeHref(lang, contributionsHref(filters, next, toPage)));
  }

  const [query, setQuery] = useSearchBox(q, (next) => go({ q: next }));

  return (
    <>
      <StatusTabs
        active={status}
        onGo={push}
        hrefFor={(next) =>
          localeHref(lang, contributionsHref(filters, { status: next }))
        }
      />
      {status === "new" && namesSpeaker(source) ? (
        <BucketTabs
          active={bucket}
          counts={bucketCounts}
          onGo={push}
          hrefFor={(next) => localeHref(lang, contributionsHref(filters, { bucket: next }))}
        />
      ) : null}
      <nav className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={query}
          placeholder={
            source === "quests" ? "NPC, quest, or what they sent…" : "What they sent…"
          }
          aria-label="Search"
          className="h-8 min-w-0 basis-64"
          onChange={(event) => setQuery(event.target.value)}
        />
        {namesSpeaker(source) ? (
          <FilterChip
            label="search in"
            value={searchIn === "any" ? undefined : searchIn}
            options={SEARCH_IN_OPTIONS}
            onChange={(next) => go({ searchIn: (next ?? "any") as Filter })}
          />
        ) : null}
        {source === "quests" ? (
          <MultiFilterChip
            label="stage"
            values={stage}
            options={STAGE_CHIP_OPTIONS}
            onChange={(next) => go({ stage: next as StageFilter | undefined })}
          />
        ) : null}
        {pending && <Refreshing />}
        <ClientSelect value={client} onChange={(next) => go({ client: next })} />
      </nav>

      {rows.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          {bulk ? (
            <span className="text-muted-foreground">
              {STATUS_LABELS[bulk.next]}: {bulk.done} of {bulk.total}…
            </span>
          ) : (
            <>
              {confirmAll ? (
                <>
                  <span>
                    Accept all {shownToAccept.length} matching{pages > 1 ? `, on every page` : ""}? A quests
                    line can&apos;t be reopened after.
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className={ACCEPT_TONE}
                    onClick={() => {
                      setConfirmAll(false);
                      void resolveMany(shownToAccept, "accepted");
                    }}
                  >
                    Accept {shownToAccept.length}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmAll(false)}>
                    Cancel
                  </Button>
                </>
              ) : status === "new" && bucket === "ready" ? (
                // Only where every row has a speaker: elsewhere it is a run of refusals.
                <Button
                  size="sm"
                  variant="outline"
                  className={ACCEPT_TONE}
                  disabled={shownToAccept.length === 0}
                  onClick={() => setConfirmAll(true)}
                >
                  Accept all matching ({shownToAccept.length})
                </Button>
              ) : null}
              {selectedRows.length > 0 ? (
                <>
                  <span className="text-muted-foreground ml-2">{selectedRows.length} selected</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className={ACCEPT_TONE}
                    disabled={selectedToAccept.length === 0}
                    onClick={() => void resolveMany(selectedToAccept, "accepted")}
                  >
                    Accept selected ({selectedToAccept.length})
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className={REJECT_TONE}
                    disabled={selectedToReject.length === 0}
                    onClick={() => void resolveMany(selectedToReject, "rejected")}
                  >
                    Reject selected ({selectedToReject.length})
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                    Clear
                  </Button>
                </>
              ) : null}
              {bulkOutcome ? <span className="text-muted-foreground ml-2">{bulkOutcome}</span> : null}
            </>
          )}
          <Pager page={page} pages={pages} total={matching.length} onGo={(to) => go({}, to)} />
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing here.</p>
      ) : (
        <table
          aria-busy={pending}
          className={cn("w-full border-separate border-spacing-0 text-sm transition-opacity", pending && "opacity-60")}
        >
          <thead className="text-muted-foreground text-left text-xs">
            <tr>
              <th className="border-b py-2 pr-2 font-normal">
                <Checkbox
                  aria-label="Select every row shown"
                  checked={allTicked ? true : selectedRows.length > 0 ? "indeterminate" : false}
                  disabled={bulk !== null}
                  onCheckedChange={(on) => setSelected(on === true ? new Set(rows.map((row) => row.id)) : new Set())}
                />
              </th>
              <SortHeader column="filed" sort={sort} onSort={(column) => go({ sort: nextSort(sort, column) })}>
                Filed
              </SortHeader>
              {source === "quests" ? (
                <>
                  <th className="border-b py-2 pr-3 font-normal">NPC</th>
                  <th className="border-b py-2 pr-3 font-normal">Quest</th>
                </>
              ) : (
                <th className="border-b py-2 pr-3 font-normal">{source === "readables" ? "Book" : "Place"}</th>
              )}
              <th className="border-b py-2 pr-3 font-normal">Client</th>
              <SortHeader column="count" sort={sort} onSort={(column) => go({ sort: nextSort(sort, column) })}>
                Count
              </SortHeader>
              <th className="border-b py-2 pr-3 font-normal">What they sent</th>
              <th className="border-b py-2 font-normal" />
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => {
              const npc = npcOf(row);
              const now = bucketOf(row, npc, roster);
              return (
                <ContributionTableRow
                  key={row.id}
                  row={row}
                  books={labels}
                  current={resolved[row.id] ?? row.status}
                  npc={npc}
                  bucket={now}
                  moved={status === "new" && now !== bucket}
                  found={existing[row.id]}
                  selected={selected.has(row.id)}
                  busy={busy === row.id}
                  npcBusy={npcBusy === row.id}
                  locked={bulk !== null}
                  refusal={refusals[row.id]}
                  lineCreated={lineCreated.has(row.id)}
                  canAnswerNpc={canAnswerNpc}
                  roster={roster}
                  lang={lang}
                  onToggle={toggle}
                  onResolve={resolve}
                  onOverrideNpc={overrideNpc}
                  onPickConflict={pickConflict}
                  onNameNpc={nameNpc}
                  onMatchPage={matchPage}
                />
              );
            })}
          </tbody>
        </table>
      )}
      <datalist id={READABLES_LIST}>
        {[...labels].map(([label, choice]) => (
          <option key={label} value={label}>
            {choice ? (choice.pages === 1 ? "1 page" : `${choice.pages} pages`) : null}
          </option>
        ))}
      </datalist>
      {rows.length > 0 && pages > 1 ? (
        <div className="mt-3 flex text-xs">
          <Pager page={page} pages={pages} total={matching.length} onGo={(to) => go({}, to)} />
        </div>
      ) : null}
    </>
  );
}

/**
 * One row of the table, redrawn only when its own props change -- which is why the table hands
 * it plain values (`selected`, `busy`) rather than the sets and ids they come from, and stable
 * callbacks. Drawn inline, one tick of one checkbox redrew every row on the page.
 */
const ContributionTableRow = memo(function ContributionTableRow({
  row,
  books,
  current,
  npc,
  bucket,
  moved,
  found,
  selected,
  busy,
  npcBusy,
  locked,
  refusal,
  lineCreated,
  canAnswerNpc,
  roster,
  lang,
  onToggle,
  onResolve,
  onOverrideNpc,
  onPickConflict,
  onNameNpc,
  onMatchPage,
}: {
  row: ContributionRow;
  books: BookLabels;
  /** The row's status, with this session's own changes over the server's. */
  current: ContributionStatus;
  npc: NpcSummary | null;
  /** Where the row stands now: an answer saved here may have moved it. Only ready rows offer Accept. */
  bucket: Bucket;
  /** On the New tab, the row now belongs to the other half. */
  moved: boolean;
  /** The text already on file for the row: a places key's line, or the matched readables page in the row's own language. */
  found: string | undefined;
  selected: boolean;
  /** This row's own resolve is in flight. */
  busy: boolean;
  /** This row's NPC answer is in flight. */
  npcBusy: boolean;
  /** A bulk run is in flight: every row's buttons hold still. */
  locked: boolean;
  refusal: string | undefined;
  /** "Add to explorer" worked on this row this session. */
  lineCreated: boolean;
  canAnswerNpc: boolean;
  roster: Roster;
  lang: Lang;
  onToggle: (id: number, on: boolean) => void;
  onResolve: (id: number, next: ContributionStatus) => Promise<void>;
  onOverrideNpc: (id: number, npc: NpcSummary, answer: SpeakerAnswer) => Promise<void>;
  onPickConflict: (id: number, npc: NpcSummary, option: NpcConflictOption) => Promise<void>;
  onNameNpc: (id: number, answer: { npcKind: NpcRowKind; npcId: number; npcName: string }) => Promise<void>;
  onMatchPage: (id: number, answer: MatchAnswer) => Promise<void>;
}) {
  const when = useLocalDates();
  // A written page is one-way (accept.ts), so its match is no longer the moderator's to move.
  const pageWritten = current === "accepted" && (row.hasLine || lineCreated);
  const book = row.book;
  // An ambiguous row needs a page picked, and a known one is already in the corpus.
  const acceptHold =
    book?.match.kind === "ambiguous" ? "Pick the page first" : book?.match.kind === "known" ? "Already in the corpus" : null;
  const [expanded, setExpanded] = useState(false);
  const hints = useMemo(() => (row.text ? textHints(row.text, row.locale) : []), [row.text, row.locale]);
  return (
    // Top-aligned, not middle: the NPC/Speaker cell below can grow to a whole form's
      // height (race/gender/flavor selects), and centring every other
      // cell against that made the short ones float to mid-row instead of sitting on
      // a scannable line.
      <tr
        // Anchor, not just a key: an accepted quests row's line carries a link back
        // here (LineRow.tsx's "contributed" badge), and this is what it jumps to.
        id={`contribution-${row.id}`}
        onClick={(event) => {
          // A click on one of the row's controls is that control's, and one ending a drag over
          // the text is somebody copying it: neither should fold the row out from under them.
          if ((event.target as HTMLElement).closest("button, a, input, select, textarea, label, form")) return;
          if (endsSelection()) return;
          setExpanded((open) => !open);
        }}
        className="align-top [&>td]:border-b [&>td]:py-2 [&>td]:leading-5"
      >
        <td className="pr-2">
          <LiteCheckbox
            aria-label={`Select contribution ${row.id}`}
            checked={selected}
            disabled={locked}
            onChange={(event) => onToggle(row.id, event.target.checked)}
          />
        </td>

        <td className="text-muted-foreground pr-3 text-xs whitespace-nowrap">
          {when(row.createdAt)}
        </td>

        {/* NPC and Speaker, merged: who the NPC is and who voices their lines are the
            same question, and showing them as two columns meant scanning across the
            row to connect an id in one cell with a form three cells later. Name/id/
            links stay on their own line; the voice -- settled text for a corpus NPC,
            the override form for one that isn't -- sits right beneath it. */}
        {row.source === "quests" ? (
          <td className="max-w-[20rem] pr-3 text-xs">
            {npc ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1 whitespace-nowrap">
                  <a
                    href={localeHref(lang, `/quests?q=${npc.npcId}&filter=npc`)}
                    className="truncate hover:underline"
                    title={npc.npcName ?? undefined}
                  >
                    {npc.npcName ?? "unnamed"}{" "}
                    <span className="text-muted-foreground">#{npc.npcId}</span>
                  </a>
                  <a
                    href={
                      // The corpus's own exact answer means it has this NPC on the branch
                      // the corpus is built from; anything else -- including a post-vanilla
                      // NPC like 205729 -- is only ever on the client's own branch. See
                      // wowhead.ts for why two branches exist rather than one.
                      //
                      // A kind-less row (npc.npcKind === null) has no real kind to link
                      // with yet -- "creature" is a convenience guess for this link only,
                      // never stored, and every quest/gossip npc field this table has ever
                      // seen has in fact named one.
                      npc.provenance === "corpus"
                        ? wowheadEntityUrl(npc.npcKind ?? "creature", npc.npcId)
                        : wowheadForeverUrl(npc.npcKind ?? "creature", npc.npcId)
                    }
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground shrink-0 hover:underline"
                  >
                    wh↗
                  </a>
                </div>
                {npc.conflict.length > 0 ? (
                  canAnswerNpc ? (
                    <NpcConflict
                      npc={npc}
                      busy={npcBusy}
                      onPick={(option) => void onPickConflict(row.id, npc, option)}
                    />
                  ) : (
                    <span className="text-muted-foreground">NPC unclear</span>
                  )
                ) : (
                  <SpeakerCell
                    npc={npc}
                    roster={roster}
                    readOnly={!canAnswerNpc}
                    busy={npcBusy}
                    onSave={(answer) => void onOverrideNpc(row.id, npc, answer)}
                  />
                )}
              </div>
            ) : canAnswerNpc ? (
              // No NPC named at all: an admin can say who speaks it.
              <MissingNpcForm busy={npcBusy} onSave={(answer) => void onNameNpc(row.id, answer)} />
            ) : (
              <span className="text-muted-foreground">Missing NPC</span>
            )}
          </td>
        ) : null}

        <td className="max-w-[14rem] pr-3 text-xs whitespace-nowrap">
          {book ? (
            <MatchCell
              book={book}
              books={books}
              busy={npcBusy}
              locked={pageWritten || locked}
              onSave={(answer) => void onMatchPage(row.id, answer)}
            />
          ) : row.quest === null ? (
            <span title={row.key}>{row.place ?? row.key}</span>
          ) : row.quest === "gossip" ? (
            STAGE_LABELS.gossip
          ) : (
            <>
              <span className="truncate">{row.quest.title}</span>{" "}
              <a
                href={wowheadQuestUrl(row.quest.questId)}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:underline"
              >
                #{row.quest.questId}
              </a>
              {row.quest.stage ? (
                <div className="text-muted-foreground">{STAGE_LABELS[row.quest.stage]}</div>
              ) : null}
            </>
          )}
        </td>

        {/* Which game, then the locale and the exact build underneath: the version is
            in the label, and the build number is what tells a beta's builds apart. */}
        <td className="pr-3 text-xs whitespace-nowrap">
          <div>{row.client.label}</div>
          <div className="text-muted-foreground">
            {row.locale}
            {row.client.buildNumber ? ` · ${row.client.buildNumber}` : null}
          </div>
          {row.pack ? (
            <div className="text-muted-foreground" title="The language of the voice packs the player was hearing">
              heard in {row.pack}
            </div>
          ) : null}
        </td>

        <td className="pr-3 text-xs whitespace-nowrap"><SendersButton id={row.id} count={row.count} /></td>

        <td className="max-w-md pr-3">
          {/* Above the clamped text: a line that will never be voiced is what a moderator
              must see before accepting, not after expanding every row. */}
          {hints.map((hint) => (
            <p key={hint} className="text-destructive text-xs">
              {hint}
            </p>
          ))}
          <div className="flex items-start gap-1">
            <p className={cn("min-w-0 flex-1 whitespace-pre-wrap", !expanded && "line-clamp-2")}>
              {row.text ?? <span className="text-muted-foreground">(no text sent)</span>}
            </p>
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={expanded ? "Collapse this text" : "Show the whole text"}
              title={expanded ? "Collapse" : "Show the whole text"}
              onClick={() => setExpanded((open) => !open)}
              className="text-muted-foreground hover:text-foreground mt-px shrink-0 cursor-pointer rounded-sm p-0.5"
            >
              <ChevronDownIcon className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
            </button>
          </div>
          {!expanded && (found !== undefined || row.body) ? (
            <p className="text-muted-foreground text-xs">
              {[found !== undefined && "corpus already has this key", row.body && "note attached"]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          {expanded && row.body ? (
            // The optional complaint: the one field a player filled in to be read.
            <div className="mt-2 rounded border p-2">
              <p className="text-muted-foreground text-xs font-medium">What they said was wrong:</p>
              <p className="mt-1 whitespace-pre-wrap">{row.body}</p>
            </div>
          ) : null}
          {expanded && found !== undefined ? (
            // A "missing" key the corpus already answers to is a corpus bug, not an absent
            // line -- shown beside the submitted text so that reading is a glance.
            <div className="bg-muted/40 mt-2 rounded p-2">
              <p className="text-muted-foreground text-xs font-medium">Already on file:</p>
              <p className="mt-1 whitespace-pre-wrap">{found}</p>
            </div>
          ) : null}
        </td>

        <td>
          <div className="flex items-center justify-end gap-1">
            {current !== "accepted" && bucket === "ready" ? (
              <LiteButton
                variant="accept"
                disabled={busy || locked || acceptHold !== null}
                title={acceptHold ?? undefined}
                onClick={() => void onResolve(row.id, "accepted")}
              >
                Accept
              </LiteButton>
            ) : (row.source === "quests" || book) && !(row.hasLine || lineCreated) ? (
              // A quests row accepted before this feature existed (or reopened and
              // re-accepted since) has no line in the quest tables yet -- Accept itself is
              // hidden once `current` is already "accepted", so this is the only way
              // back to the same POST, still gated by resolveContribution's own rules
              // (needs-speaker, collision, one-way).
              <LiteButton
                variant="accept"
                disabled={busy || locked || acceptHold !== null}
                title={acceptHold ?? undefined}
                onClick={() => void onResolve(row.id, "accepted")}
              >
                Add to explorer
              </LiteButton>
            ) : null}
            {current !== "rejected" ? (
              <LiteButton
                variant="reject"
                disabled={busy || locked}
                onClick={() => void onResolve(row.id, "rejected")}
              >
                Reject
              </LiteButton>
            ) : null}
            {current !== "new" ? (
              <LiteButton
                variant="ghost"
                disabled={busy || locked}
                onClick={() => void onResolve(row.id, "new")}
              >
                Reopen
              </LiteButton>
            ) : null}
          </div>
          {moved ? (
            <p className="text-muted-foreground mt-1 text-right text-xs">
              {bucket === "ready" ? "Ready now" : "Needs a speaker now"}
            </p>
          ) : null}
          {refusal ? (
            // Plain words, straight from resolveContribution's own refusal message --
            // silence here used to be the whole failure mode ("Degrade per row on a
            // failed resolve"), and a moderator staring at a button that visibly did
            // nothing has no way to tell "try again" from "fix something first".
            <p className="text-destructive mt-1 text-right text-xs">{refusal}</p>
          ) : null}
        </td>
      </tr>
  );
});

/** Which page of the matching rows this is, and the way to the next and previous ones. */
function Pager({
  page,
  pages,
  total,
  onGo,
}: {
  page: number;
  pages: number;
  total: number;
  onGo: (page: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <span className="text-muted-foreground ml-auto flex items-center gap-1">
      <LiteButton variant="ghost" className="h-6 px-2 text-xs" disabled={page <= 1} onClick={() => onGo(page - 1)}>
        ← Prev
      </LiteButton>
      Page {page} of {pages} · {total} rows
      <LiteButton variant="ghost" className="h-6 px-2 text-xs" disabled={page >= pages} onClick={() => onGo(page + 1)}>
        Next →
      </LiteButton>
    </span>
  );
}

type Refusals = Record<number, string>;

/** A row's refusal, in the route's own words where it gave some. A setRefusals updater. */
function withRefusal(id: number, error?: unknown): (current: Refusals) => Refusals {
  const message = typeof error === "string" ? error : "That didn't go through -- try again.";
  return (current) => ({ ...current, [id]: message });
}

/** A row's refusal cleared by the next attempt succeeding. A setRefusals updater. */
function withoutRefusal(id: number): (current: Refusals) => Refusals {
  return (current) => {
    if (!(id in current)) return current;
    const { [id]: _dropped, ...rest } = current;
    return rest;
  };
}

/** Record a kind-less contribution's NPC kind (api/contributions/kind). True when it landed. */
async function recordKind(contributionId: number, npcKind: NpcKind): Promise<boolean> {
  const response = await fetch("/api/contributions/kind", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: contributionId, npcKind }),
  }).catch(() => null);
  return Boolean(response?.ok);
}

/**
 * The NPC column of a quest row that names no NPC: kind, id and name, the last two required --
 * an id with no name, or a name with no id, is not an answer (migration 0048's check).
 */
function MissingNpcForm({
  busy,
  onSave,
}: {
  busy: boolean;
  onSave: (answer: { npcKind: NpcRowKind; npcId: number; npcName: string }) => void;
}) {
  const [npcKind, setNpcKind] = useState<NpcRowKind>("creature");
  const [npcId, setNpcId] = useState("");
  const [npcName, setNpcName] = useState("");
  const valid = /^\d+$/.test(npcId.trim()) && npcName.trim() !== "";

  return (
    <form
      className="flex flex-wrap items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onSave({ npcKind, npcId: Number(npcId.trim()), npcName });
      }}
    >
      <select
        value={npcKind}
        onChange={(event) => setNpcKind(event.target.value as NpcRowKind)}
        className="h-7 rounded border bg-transparent text-xs"
      >
        {NPC_ROW_KINDS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <input
        required
        inputMode="numeric"
        pattern="\d+"
        placeholder="id"
        value={npcId}
        onChange={(event) => setNpcId(event.target.value)}
        className="h-7 w-20 rounded border bg-transparent px-1.5 text-xs"
      />
      <input
        required
        placeholder="name"
        value={npcName}
        onChange={(event) => setNpcName(event.target.value)}
        className="h-7 w-32 rounded border bg-transparent px-1.5 text-xs"
      />
      <LiteButton type="submit" variant="outline" className="h-7 px-2 text-xs" disabled={busy || !valid}>
        Add
      </LiteButton>
    </form>
  );
}

/**
 * A readables row's match: what the matcher (or a moderator) decided it is, linked where it names a
 * page, and the controls to say otherwise -- a book from the table's list and a page number, or
 * a new book. Clear drops a moderator's answer and lets the matcher decide again.
 */
function MatchCell({
  book,
  books,
  busy,
  locked,
  onSave,
}: {
  book: BookSummary;
  books: BookLabels;
  busy: boolean;
  locked: boolean;
  onSave: (answer: MatchAnswer) => void;
}) {
  const [choice, setChoice] = useState("");
  const [pageNumber, setPageNumber] = useState(String(book.number ?? 1));
  const picked = books.get(choice.trim());
  const isNew = picked === null;
  const valid = picked !== undefined && (isNew || (/^\d+$/.test(pageNumber.trim()) && Number(pageNumber.trim()) > 0));
  const shown = book.title ? `${book.title}${book.number ? ` p.${book.number}` : ""}` : null;
  const moderated = "via" in book.match && book.match.via === "moderator";

  return (
    <div className="flex flex-col gap-1">
      {shown ? (
        <span className="text-muted-foreground truncate" title={shown}>
          {shown}
        </span>
      ) : null}
      {book.href ? (
        <a href={book.href} className="truncate hover:underline" title={book.label}>
          {book.label}
        </a>
      ) : (
        <span className="truncate" title={book.label}>
          {book.label}
        </span>
      )}
      {locked ? null : (
        <form
          className="flex flex-wrap items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            onSave(picked ? { bookId: picked.bookId, pageNumber: Number(pageNumber.trim()) } : { newBook: true });
          }}
        >
          <input
            required
            list={READABLES_LIST}
            aria-label="Book"
            placeholder="Book"
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
            className="h-7 w-40 rounded border bg-transparent px-1.5 text-xs"
          />
          <input
            required={!isNew}
            disabled={isNew}
            inputMode="numeric"
            pattern="\d+"
            aria-label="page"
            value={pageNumber}
            onChange={(event) => setPageNumber(event.target.value)}
            className="h-7 w-10 rounded border bg-transparent px-1.5 text-xs"
          />
          <LiteButton type="submit" variant="outline" className="h-7 px-2 text-xs" disabled={busy || !valid}>
            Match
          </LiteButton>
          {moderated ? (
            <LiteButton variant="ghost" className="h-7 px-1.5 text-xs" disabled={busy} onClick={() => onSave(null)}>
              Clear
            </LiteButton>
          ) : null}
        </form>
      )}
    </div>
  );
}

/**
 * A kind-less row whose id has disagreeing answers on file -- one as a creature, another as a
 * gameobject. Each is shown with where it came from; the moderator picks the one this
 * contribution meant, and nothing is used until they do (triage.ts's idOnlyResolution).
 */
function NpcConflict({
  npc,
  busy,
  onPick,
}: {
  npc: NpcSummary;
  busy: boolean;
  onPick: (option: NpcConflictOption) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-destructive">Conflicting answers for #{npc.npcId} -- which is it?</p>
      {npc.conflict.map((option) => (
        <div key={option.npcKind} className="flex items-center gap-2">
          <span>
            {option.npcKind}: {[option.race, option.gender, option.flavor].filter(Boolean).join("-") || "no race"}
          </span>
          <ProvenanceBadge provenance={option.provenance} />
          <LiteButton
            variant="outline"
            className="h-6 px-2 text-xs"
            disabled={busy}
            onClick={() => onPick(option)}
          >
            This one
          </LiteButton>
        </div>
      ))}
    </div>
  );
}

/** npcOverrides' key for an NPC's own answer, shared by every row that NPC speaks. */
function overrideKey(npcKind: NpcRowKind, npcId: number): string {
  return `npc:${npcKind}:${npcId}`;
}

/** npcOverrides' key for one contribution's own answer, for a row with no NPC key yet. */
function contributionKey(contributionId: number): string {
  return `contribution:${contributionId}`;
}
