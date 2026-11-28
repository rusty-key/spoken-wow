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
import { useUiText } from "@/components/UiTextProvider";
import { fill } from "@/lib/site-text/format";
import { langName, localeHref, type Lang } from "@/lib/lang";
import { CheckIcon, ChevronDownIcon, CircleAlertIcon, ClockIcon, SearchIcon, WrenchIcon, XIcon, EyeIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from "react";

import BulkKeepDialog from "@/components/BulkKeepDialog";
import ClientSelect from "@/components/ClientSelect";
import { SEARCH_IN_OPTIONS, STAGE_CHIP_OPTIONS, STAGE_LABELS } from "@/components/contribution-chips";
import FilterChip, { type ChipOption } from "@/components/FilterChip";
import MultiFilterChip from "@/components/MultiFilterChip";
import SpeakerCell, { ProvenanceBadge, type SpeakerAnswer } from "@/components/SpeakerCell";
import { LiteButton } from "@/components/LiteControls";
import { Refreshing } from "@/components/Loading";
import SendersButton from "@/components/SendersButton";
import DropReasons from "@/components/backstage/DropReasons";
import Panel, { type PanelTone } from "@/components/backstage/Panel";
import { Chips, Tabs } from "@/components/backstage/Tabs";
import TokenText from "@/components/backstage/TokenText";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usePendingPush } from "@/components/usePendingPush";
import { useLocalDates } from "@/components/useLocalDates";
import { useSearchBox } from "@/components/useSearchBox";
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
  type Bucket,
  type WaitingKind,
  type WaitingReason,
  type Section,
  type ClientFilter,
  type ContributionSort,
  type FilterChange,
  type StageFilter,
  type Show,
} from "@/lib/contributions/query";
import type { Contribution } from "@/lib/contributions/store";
import type { LineCheck, Verdict } from "@/lib/contributions/checks";
import { lineDropReasons } from "@/lib/contributions/reasons";
import type { BookSummary, NpcConflictOption, NpcSummary, QuestSummary } from "@/lib/contributions/triage";
// From npc.ts, not npc/store.ts: store.ts imports @/lib/db, and pulling NPC_ROW_KINDS
// (values, not just types) out of it would drag Postgres's own node built-ins into this bundle.
import { NPC_ROW_KINDS, type NpcKind, type NpcRowKind } from "@/lib/npc/npc";
import type { NpcResolution } from "@/lib/npc/store";
import type { Filter } from "@/lib/search";
import { cn } from "@/lib/utils";
import { wowheadEntityUrl, wowheadQuestUrl } from "@/lib/wowhead";

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
  /** The English line this one translates, or null where none was found (and for English rows). */
  english: string | null;
  /** What the review checks found, against `english` (lib/contributions/checks.ts). */
  check: LineCheck;
  /** Why the row waits on an admin, on the waiting tab; null everywhere else. */
  waiting: WaitingReason | null;
  /** Why a reviewer rejected it, where they said. */
  rejectReason: string | null;
};

/** The waiting tab's breakdown, one entry per reason (page.tsx summariseWaiting). */
export type WaitingSummary = { kind: WaitingKind; title: string; fix: string; count: number; oldest: string; example: string | null }[];

/** The To review groups, in the order the page lists them (page.tsx sorts the queue the same way). */
const GROUPS: { verdict: Verdict; tone: PanelTone }[] = [
  { verdict: "clean", tone: "good" },
  { verdict: "fix", tone: "fix" },
  { verdict: "look", tone: "info" },
  { verdict: "drop", tone: "drop" },
];

const GROUP_ICONS: Record<Verdict, ReactNode> = {
  clean: <CheckIcon />,
  fix: <WrenchIcon />,
  look: <EyeIcon />,
  drop: <XIcon />,
};

/** The orders the database can sort by (query.ts SORT_COLUMNS), as one choice each. */
const SORT_OPTIONS = [
  { value: "count:desc", key: "mostSent" },
  { value: "filed:desc", key: "newest" },
  { value: "filed:asc", key: "oldest" },
  { value: "count:asc", key: "fewestSent" },
] as const;

/** What a resolve may carry beside the status: the reviewer's edit on an accept, a reason on a reject. */
type ResolveExtra = { text?: string; reason?: string };

/** A book a row can be placed in. */
export type BookChoice = { bookId: string; title: string; pages: number };

/** The datalist the match form's book field offers, rendered once for the whole table. */
const READABLES_LIST = "contribution-readables";
/**
 * What the book field may say -> the book it names, or null for a new book. A title more than
 * one book has carries its book's id.
 */
type BookLabels = ReadonlyMap<string, BookChoice | null>;

function bookLabels(books: readonly BookChoice[], newBook: string): BookLabels {
  const titles = new Map<string, number>([[newBook, 1]]);
  for (const book of books) titles.set(book.title, (titles.get(book.title) ?? 0) + 1);
  const labels = new Map<string, BookChoice | null>([[newBook, null]]);
  for (const book of books) labels.set(titles.get(book.title)! > 1 ? `${book.title} · #${book.bookId}` : book.title, book);
  return labels;
}

/** What a moderator says a readables row is, as api/contributions/page takes it; null clears it. */
type MatchAnswer = { lineId: string } | { bookId: string; pageNumber: number } | { newBook: true } | null;

const STATUS_KEYS: Record<ContributionStatus, "statusNew" | "statusAccepted" | "statusRejected"> = {
  new: "statusNew",
  accepted: "statusAccepted",
  rejected: "statusRejected",
};




export default function ContributionTable({
  initial,
  matching,
  page,
  pages,
  status,
  bucket,
  bucketCounts,
  waitingSummary,
  client,
  build,
  builds,
  source,
  stage,
  sort,
  q,
  searchIn,
  existing,
  books,
  roster: rosterData,
  canAnswerNpc,
  corrections,
  show,
  shownCounts,
}: {
  /** This page's rows. */
  initial: ContributionRow[];
  /** Every row the filters match, on any page, with its group -- what "Keep all" and "Drop all" act on. */
  matching: { id: number; status: ContributionStatus; bulk: boolean; verdict: Verdict; count: number }[];
  page: number;
  pages: number;
  status: ContributionStatus;
  /** Which half of the New tab is shown; the other tabs are not split. */
  bucket: Bucket;
  bucketCounts: Record<Bucket, number>;
  /** Why the waiting rows wait, counted; empty off the waiting tab. */
  waitingSummary: WaitingSummary;
  client: ClientFilter;
  build: string | undefined;
  /** The builds the rows in view came from. */
  builds: ChipOption[];
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
  /** The section's corrections, as a group of their own under this view's lines. */
  corrections?: ReactNode;
  /** New lines, corrections or both; the lines and corrections handed in are already narrowed to it. */
  show: Show;
  /** How many lines and corrections this tab holds, for the switch; null where a section has no corrections. */
  shownCounts: { lines: number; corrections: number } | null;
}) {
  const { pending, push } = usePendingPush();
  const when = useLocalDates();
  const router = useRouter();
  const t = useUiText();
  const lang = useLang();
  const roster = useMemo(() => new Roster(rosterData), [rosterData]);
  const labels = useMemo(
    () => bookLabels(books, t.contributions.newBookChoice),
    [books, t.contributions.newBookChoice],
  );

  /**
   * What this session resolved, overlaid on the server's rows -- the same shape ReportTable
   * uses and for the same reason: the status tabs above are a navigation, so seeding state
   * from `initial` once would leave a resolved row sitting in a queue it no longer belongs to
   * until the next reload.
   */
  const [resolved, setResolved] = useState<Record<number, Contribution["status"]>>({});
  /** Rows with a resolve in flight: each stays locked until its own request answers. */
  const [busy, setBusy] = useState<ReadonlySet<number>>(new Set());
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
      // The waiting reasons and their counts are the server's: read them again.
      router.refresh();
    },
    [roster, lang, router],
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
        setRefusals(withRefusal(contributionId, t.contributions.failed));
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
      router.refresh();
    },
    [roster, router],
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
        setRefusals(withRefusal(contributionId, t.contributions.failed, body?.error));
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
        setRefusals(withRefusal(contributionId, t.contributions.failed, body?.error));
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
  const send = useCallback(async (id: number, next: ContributionStatus, extra: ResolveExtra = {}): Promise<boolean> => {
    // What the row was shown to match, so the accept refuses it if that has changed since.
    const bookMatch = next === "accepted" ? initial.find((row) => row.id === id)?.book?.match : undefined;
    const response = await fetch("/api/contributions/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, status: next, bookMatch, ...extra }),
    }).catch(() => null);

    if (!response?.ok) {
      // The route already gives a plain-words reason for needs-speaker and one-way (accept.ts);
      // anything else (bad status, unknown row) degrades the same way this always has.
      const body = await response?.json().catch(() => null);
      setRefusals(withRefusal(id, t.contributions.failed, body?.error));
      return false;
    }
    landed(id, next);
    if (extra.text !== undefined) setEdited((current) => ({ ...current, [id]: extra.text! }));
    if (extra.reason !== undefined) setReasons((current) => ({ ...current, [id]: extra.reason! }));
    return true;
  }, [initial, landed]);

  /** The reviewer's own edits and reasons this session, shown on the row without a reload. */
  const [edited, setEdited] = useState<Record<number, string>>({});
  const [reasons, setReasons] = useState<Record<number, string>>({});

  /** A row's resolve, held to one request at a time per row. True when it landed. */
  const inFlight = useRef(new Set<number>());
  const resolve = useCallback(
    async (id: number, next: ContributionStatus, extra?: ResolveExtra): Promise<boolean> => {
      if (inFlight.current.has(id)) return false;
      inFlight.current.add(id);
      setBusy(new Set(inFlight.current));
      try {
        return await send(id, next, extra);
      } finally {
        inFlight.current.delete(id);
        setBusy(new Set(inFlight.current));
      }
    },
    [send],
  );

  /** A bulk run in flight, for its progress line and to hold every other button still meanwhile. */
  const [bulk, setBulk] = useState<{ next: ContributionStatus; done: number; total: number } | null>(null);
  /** What the last bulk run came to, until the next one starts. */
  const [bulkOutcome, setBulkOutcome] = useState<{ summary: string; refused: { id: number; message: string }[] } | null>(null);
  /**
   * "Keep all" asks twice: keeping writes quest lines, and a written quests row can't be reopened
   * after. The confirm holds the rows it was opened for, so a change of view doesn't change them.
   */
  const [confirmAll, setConfirmAll] = useState<number[] | null>(null);

  /**
   * The rows sent to api/contributions/resolve-many, a chunk per request, resolved side by side
   * on the server (accept.ts's resolveContributions). A row that is refused keeps its refusal
   * under it, exactly as if its own button had been pressed, and the rest carry on.
   */
  const resolveMany = useCallback(
    async (ids: number[], next: ContributionStatus, reason?: string) => {
      setBulkOutcome(null);
      setBulk({ next, done: 0, total: ids.length });
      const refused: { id: number; message: string }[] = [];
      for (let start = 0; start < ids.length; start += RESOLVE_MANY_MAX) {
        const chunk = ids.slice(start, start + RESOLVE_MANY_MAX);
        const response = await fetch("/api/contributions/resolve-many", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids: chunk, status: next, reason }),
        }).catch(() => null);
        const body = (await response?.json().catch(() => null)) as
          | { results?: Record<number, ResolveManyResult>; error?: unknown }
          | null;
        for (const id of chunk) {
          const result = response?.ok ? body?.results?.[id] : undefined;
          if (result?.ok) {
            landed(id, next);
            // The bulk reason replaces one this session gave the row before.
            setReasons(({ [id]: _old, ...rest }) => (reason && next === "rejected" ? { ...rest, [id]: reason } : rest));
          } else {
            const message =
              typeof (result ? result.error : body?.error) === "string"
                ? String(result ? result.error : body?.error)
                : t.contributions.failed;
            refused.push({ id, message });
            setRefusals(withRefusal(id, t.contributions.failed, message));
          }
        }
        setBulk({ next, done: Math.min(start + chunk.length, ids.length), total: ids.length });
      }
      setBulk(null);
      // Rows that left this view leave gaps on this page; the server fills them from the next.
      router.refresh();
      setBulkOutcome({
        summary:
          fill(t.contributions.bulkSummary, {
            status: t.contributions[STATUS_KEYS[next]],
            kept: ids.length - refused.length,
            all: ids.length,
          }) +
          (refused.length > 0 ? fill(t.contributions.bulkRefused, { n: refused.length }) : "."),
        refused,
      });
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

  // Every matching row, not just this page's: "Keep all" is for the whole group, on every page. A
  // readables row the matcher can't place is accepted on its own, never in bulk.
  const stillNew = (row: { id: number; status: ContributionStatus }) => (resolved[row.id] ?? row.status) === "new";
  const cleanToKeep = matching.filter((row) => row.bulk && row.verdict === "clean" && stillNew(row)).map((row) => row.id);
  const dropToReject = matching.filter((row) => row.verdict === "drop" && stillNew(row)).map((row) => row.id);
  const [confirmDrop, setConfirmDrop] = useState<number[] | null>(null);
  // A row decided from its own buttons while a confirm is open, or with its own request still in
  // flight, leaves it: the confirm must not send a rejected row back as accepted, or the other way
  // round. A row reopened since is waiting again and stays.
  const undecided = (ids: number[] | null) =>
    ids?.filter((id) => (resolved[id] ?? "new") === "new" && !busy.has(id)) ?? null;
  const [keepConfident, setKeepConfident] = useState(false);
  const [keepMenu, setKeepMenu] = useState(false);
  const bulkKeepable = matching.filter((row) => row.bulk && stillNew(row) && !busy.has(row.id));
  const keepConfirmed = undecided(confirmAll);
  const keepAllShown = cleanToKeep.length > 1 && rows.some((row) => row.check.verdict === "clean");
  const dropConfirmed = undecided(confirmDrop);
  const [showFilters, setShowFilters] = useState(Boolean(build || stage.length > 0 || searchIn !== "any"));

  /**
   * Move one dropdown and keep the other, then push it -- a soft navigation, not a state
   * change, so the filter still lives in the URL and survives a refresh. Follows
   * ReportTable.tsx's own `go`; the mapping itself is contributionsHref, pulled out to
   * lib/contributions/query.ts so it can be tested without rendering FilterChip or this table.
   */
  const filters = { status, bucket, client, build, source, stage, sort, q, searchIn, show };
  const waitingTab = status === "new" && bucket === "blocked";
  function go(next: FilterChange, toPage = 1) {
    push(localeHref(lang, contributionsHref(filters, next, toPage)));
  }

  const [query, setQuery] = useSearchBox(q, (next) => go({ q: next }));

  return (
    <>
      <div className="mb-5">
        <Tabs
          label={t.contributions.status}
          onGo={push}
          active={status === "new" ? (bucket === "blocked" ? "waiting" : "review") : status}
          tabs={[
            {
              value: "review",
              label: t.contributions.toReview,
              href: localeHref(lang, contributionsHref(filters, { status: "new", bucket: "ready" })),
              count: status === "new" ? bucketCounts.ready : undefined,
            },
            // Readables and places name no speaker, so nothing of theirs waits on an admin; nor
            // does a correction.
            ...(namesSpeaker(source) && show !== "corrections"
              ? [
                  {
                    value: "waiting",
                    label: t.contributions.waitingOnAdmin,
                    href: localeHref(lang, contributionsHref(filters, { status: "new", bucket: "blocked" })),
                    count: status === "new" ? bucketCounts.blocked : undefined,
                  },
                ]
              : []),
            { value: "accepted", label: t.contributions.accepted, href: localeHref(lang, contributionsHref(filters, { status: "accepted" })) },
            { value: "rejected", label: t.contributions.rejected, href: localeHref(lang, contributionsHref(filters, { status: "rejected" })) },
          ]}
        />
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <label className="bs-search min-w-0 flex-[1_1_280px] sm:max-w-md">
          <SearchIcon className="size-4 shrink-0" aria-hidden />
          <input
            type="search"
            value={query}
            placeholder={source === "quests" ? t.contributions.searchQuests : t.contributions.searchAny}
            aria-label={t.contributions.search}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {shownCounts && !waitingTab ? (
          <Chips
            label={t.contributions.show}
            onGo={push}
            active={show}
            tabs={[
              { value: "all", label: t.contributions.showAll, href: localeHref(lang, contributionsHref(filters, { show: "all" })) },
              {
                value: "lines",
                label: t.contributions.newLines,
                href: localeHref(lang, contributionsHref(filters, { show: "lines" })),
                count: shownCounts.lines,
              },
              {
                value: "corrections",
                label: t.contributions.corrections,
                href: localeHref(lang, contributionsHref(filters, { show: "corrections" })),
                count: shownCounts.corrections,
              },
            ]}
          />
        ) : null}
        <button
          type="button"
          className="bs-btn bs-btn-text"
          aria-expanded={showFilters}
          onClick={() => setShowFilters((open) => !open)}
        >
          {t.contributions.moreFilters} <ChevronDownIcon className={cn("size-3.5 transition-transform", showFilters && "rotate-180")} aria-hidden />
        </button>
        {show === "corrections" ? null : (
          <label className="bs-search h-[34px] w-auto pr-2">
            <span className="text-sm">{status === "new" && bucket === "ready" ? t.contributions.withinGroups : t.contributions.orderPrefix}</span>
            <select
              aria-label={t.contributions.order}
              value={`${sort.column}:${sort.direction}`}
              onChange={(event) => {
                const [column, direction] = event.target.value.split(":") as [ContributionSort["column"], ContributionSort["direction"]];
                go({ sort: { column, direction } });
              }}
              className="bg-transparent text-sm text-foreground outline-none"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value} className="bg-popover">
                  {t.contributions.sorts[option.key]}
                </option>
              ))}
            </select>
          </label>
        )}
        {pending && <Refreshing />}
        {bulk ? (
          <span className="text-muted-foreground text-sm">
            {fill(t.contributions.bulkProgress, {
              status: t.contributions[STATUS_KEYS[bulk.next]],
              done: bulk.done,
              total: bulk.total,
            })}
          </span>
        ) : bulkOutcome ? (
          <span className="text-muted-foreground text-sm">{bulkOutcome.summary}</span>
        ) : null}
        {show === "corrections" ? null : <Pager page={page} pages={pages} total={matching.length} onGo={(to) => go({}, to)} />}
      </div>
      {bulkOutcome && bulkOutcome.refused.length > 0 && !bulk ? (
        <ul className="bs-aside mb-5 flex flex-col gap-1">
          {bulkOutcome.refused.slice(0, 10).map(({ id, message }) => (
            <li key={id}>
              <a href={`#contribution-${id}`} className="underline underline-offset-[3px]">
                #{id}
              </a>{" "}
              <span className="text-muted-foreground">{message}</span>
            </li>
          ))}
          {bulkOutcome.refused.length > 10 ? <li className="text-muted-foreground">{fill(t.contributions.andMore, { n: bulkOutcome.refused.length - 10 })}</li> : null}
        </ul>
      ) : null}
      {showFilters ? (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          {namesSpeaker(source) ? (
            <FilterChip
              label={t.contributions.searchIn}
              value={searchIn === "any" ? undefined : searchIn}
              options={SEARCH_IN_OPTIONS}
              onChange={(next) => go({ searchIn: (next ?? "any") as Filter })}
            />
          ) : null}
          {source === "quests" ? (
            <MultiFilterChip
              label={t.contributions.stage}
              values={stage}
              options={STAGE_CHIP_OPTIONS}
              onChange={(next) => go({ stage: next as StageFilter | undefined })}
            />
          ) : null}
          <FilterChip label={t.contributions.build} value={build} options={builds} onChange={(next) => go({ build: next })} />
          {/* The build goes with it: a build belongs to one client, so it would match nothing. */}
          <ClientSelect value={client} onChange={(next) => go({ client: next, build: undefined })} />
        </div>
      ) : null}

      <div aria-busy={pending} className={cn("flex flex-col gap-5 transition-opacity", pending && "opacity-60")}>
        {status === "new" && bucket === "blocked" ? (
          <Panel
            quiet
            tone="neutral"
            icon={<ClockIcon />}
            title={t.contributions.waitingOnAdmin}
            count={bucketCounts.blocked}
            description={
              canAnswerNpc
                ? t.contributions.waitingOnAdminDescriptionMine
                : t.contributions.waitingOnAdminDescriptionOther
            }
          >
            {waitingSummary.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="bs-table min-w-[640px]">
                  <thead>
                    <tr>
                      <th>{t.contributions.whyItWaits}</th>
                      <th>{t.contributions.whatAdminDoes}</th>
                      <th>{t.contributions.example}</th>
                      <th className="bs-num">{t.contributions.lines}</th>
                      <th className="bs-num">{t.contributions.waitingSince}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {waitingSummary.map((entry) => (
                      <tr key={entry.kind}>
                        <td>{entry.title}</td>
                        <td className="text-muted-foreground">{entry.fix}</td>
                        <td className="text-muted-foreground">{entry.example ?? ""}</td>
                        <td className="bs-num">{entry.count}</td>
                        <td className="bs-num text-muted-foreground">{when(entry.oldest)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {rows.map((row) => renderRow(row))}
          </Panel>
        ) : rows.length === 0 && corrections ? null : rows.length === 0 ? (
          <Panel
            tone="good"
            icon={<CheckIcon />}
            title={status === "new" ? t.contributions.nothingLeft : t.contributions.nothingHere}
            description={status === "new" ? t.contributions.newLinesArrive : t.contributions.linesYouDecide}
          />
        ) : status === "new" && bucket === "ready" ? (
          <>
            {/* Keep confident reaches past Looks right, so it can't depend on Keep all being shown. */}
            {!keepAllShown && bulkKeepable.length > 0 ? (
              <div className="flex justify-end">
                <button type="button" className="bs-btn" disabled={bulk !== null} onClick={() => setKeepConfident(true)}>
                  {t.contributions.bulkKeep.confident}
                </button>
              </div>
            ) : null}
            {GROUPS.map((group) => {
              const members = rows.filter((row) => row.check.verdict === group.verdict);
              if (members.length === 0) return null;
              const action =
                group.verdict === "clean" && cleanToKeep.length > 1 ? (
                  keepConfirmed ? (
                    <>
                      <span className="text-sm">
                        {fill(t.contributions.keepAllCount, { n: keepConfirmed.length })}
                        {pages > 1 ? t.contributions.keepAllEvery : ""}
                        {t.contributions.keepAllWarning}
                      </span>
                      <button
                        type="button"
                        className="bs-btn bs-btn-primary"
                        disabled={bulk !== null || keepConfirmed.length === 0}
                        onClick={() => {
                          setConfirmAll(null);
                          void resolveMany(keepConfirmed, "accepted");
                        }}
                      >
                        {fill(t.contributions.keepCount, { n: keepConfirmed.length })}
                      </button>
                      <button type="button" className="bs-btn bs-btn-text" onClick={() => setConfirmAll(null)}>
                        {t.contributions.cancel}
                      </button>
                    </>
                  ) : (
                    <span className="bs-split">
                      <button type="button" className="bs-btn bs-btn-primary" disabled={bulk !== null} onClick={() => setConfirmAll(cleanToKeep)}>
                        {fill(t.contributions.keepAllCount, { n: cleanToKeep.length })}
                      </button>
                      <Popover open={keepMenu} onOpenChange={setKeepMenu}>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="bs-btn bs-btn-primary"
                            disabled={bulk !== null}
                            aria-label={t.contributions.bulkKeep.more}
                          >
                            <ChevronDownIcon className="size-4" aria-hidden />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="bs-menu flex w-auto flex-col p-1">
                          <button
                            type="button"
                            className="bs-btn bs-btn-text"
                            onClick={() => {
                              setKeepMenu(false);
                              setKeepConfident(true);
                            }}
                          >
                            {t.contributions.bulkKeep.confident}
                          </button>
                        </PopoverContent>
                      </Popover>
                    </span>
                  )
                ) : group.verdict === "drop" && dropToReject.length > 1 ? (
                  dropConfirmed ? (
                    <>
                      <span className="text-sm">
                        {fill(t.contributions.dropAllCount, { n: dropConfirmed.length })}
                        {pages > 1 ? t.contributions.keepAllEvery : ""}
                        {t.contributions.dropAllWarning}
                      </span>
                      <button
                        type="button"
                        className="bs-btn bs-btn-danger"
                        disabled={bulk !== null || dropConfirmed.length === 0}
                        onClick={() => {
                          setConfirmDrop(null);
                          void resolveMany(dropConfirmed, "rejected", t.contributions.failedChecks);
                        }}
                      >
                        {fill(t.contributions.dropCount, { n: dropConfirmed.length })}
                      </button>
                      <button type="button" className="bs-btn bs-btn-text" onClick={() => setConfirmDrop(null)}>
                        {t.contributions.cancel}
                      </button>
                    </>
                  ) : (
                    <button type="button" className="bs-btn bs-btn-danger" disabled={bulk !== null} onClick={() => setConfirmDrop(dropToReject)}>
                      {fill(t.contributions.dropAllCount, { n: dropToReject.length })}
                    </button>
                  )
                ) : null;
              return (
                <Panel
                  key={group.verdict}
                  id={`group-${group.verdict}`}
                  tone={group.tone}
                  icon={GROUP_ICONS[group.verdict]}
                  title={t.contributions.groups[group.verdict].title}
                  count={members.length}
                  description={t.contributions.groups[group.verdict].description}
                  action={action}
                >
                  {members.map((row) => renderRow(row))}
                </Panel>
              );
            })}
          </>
        ) : (
          <Panel
            tone={status === "rejected" ? "drop" : status === "accepted" ? "good" : "neutral"}
            icon={status === "rejected" ? <XIcon /> : status === "accepted" ? <CheckIcon /> : <ClockIcon />}
            title={
              status === "rejected"
                ? t.contributions.statusRejected
                : status === "accepted"
                  ? t.contributions.statusAccepted
                  : t.contributions.linesWaitingOnAdmin
            }
            count={matching.length}
          >
            {rows.map((row) => renderRow(row))}
          </Panel>
        )}
      </div>

      {keepConfident ? (
        <BulkKeepDialog
          rows={bulkKeepable}
          everyPage={pages > 1}
          onClose={() => setKeepConfident(false)}
          onConfirm={(ids) => {
            setKeepConfident(false);
            void resolveMany(ids, "accepted");
          }}
        />
      ) : null}
      <datalist id={READABLES_LIST}>
        {[...labels].map(([label, choice]) => (
          <option key={label} value={label}>
            {choice
              ? choice.pages === 1
                ? t.contributions.onePage
                : fill(t.contributions.pagesCount, { n: choice.pages })
              : null}
          </option>
        ))}
      </datalist>
      {rows.length > 0 && pages > 1 ? (
        <div className="mt-4 flex text-sm">
          <Pager page={page} pages={pages} total={matching.length} onGo={(to) => go({}, to)} />
        </div>
      ) : null}
      {corrections && !waitingTab ? <div className={rows.length > 0 ? "mt-8" : undefined}>{corrections}</div> : null}
    </>
  );

  function renderRow(row: ContributionRow) {
    const npc = npcOf(row);
    const now = bucketOf(row, npc, roster);
    return (
      <ReviewRow
        key={row.id}
        row={row}
        books={labels}
        current={resolved[row.id] ?? row.status}
        npc={npc}
        bucket={now}
        moved={status === "new" && now !== bucket}
        found={existing[row.id]}
        busy={busy.has(row.id)}
        npcBusy={npcBusy === row.id}
        locked={bulk !== null}
        refusal={refusals[row.id]}
        lineCreated={lineCreated.has(row.id)}
        editedText={edited[row.id]}
        reason={reasons[row.id] ?? row.rejectReason}
        canAnswerNpc={canAnswerNpc}
        roster={roster}
        lang={lang}
        onResolve={resolve}
        onOverrideNpc={overrideNpc}
        onPickConflict={pickConflict}
        onNameNpc={nameNpc}
        onMatchPage={matchPage}
      />
    );
  }
}

/**
 * One line to review: who says it and where, the English line beside what was sent, what the
 * checks found, and the reviewer's answer.
 */
const ReviewRow = memo(function ReviewRow({
  row,
  books,
  current,
  npc,
  bucket,
  moved,
  found,
  busy,
  npcBusy,
  locked,
  refusal,
  lineCreated,
  editedText,
  reason,
  canAnswerNpc,
  roster,
  lang,
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
  /** Where the row stands now: an answer saved here may have moved it. Only ready rows can be kept. */
  bucket: Bucket;
  /** On a new-lines tab, the row now belongs to the other one. */
  moved: boolean;
  /** The text already on file for the row: a places key's line, or the matched readables page in the row's language. */
  found: string | undefined;
  busy: boolean;
  npcBusy: boolean;
  /** A bulk run is in flight: every row's buttons hold still. */
  locked: boolean;
  refusal: string | undefined;
  /** "Add to explorer" worked on this row this session. */
  lineCreated: boolean;
  /** The text this session kept it with, where the reviewer edited it. */
  editedText: string | undefined;
  /** Why it was rejected, this session's or the stored one. */
  reason: string | null;
  canAnswerNpc: boolean;
  roster: Roster;
  lang: Lang;
  onResolve: (id: number, next: ContributionStatus, extra?: ResolveExtra) => Promise<boolean>;
  onOverrideNpc: (id: number, npc: NpcSummary, answer: SpeakerAnswer) => Promise<void>;
  onPickConflict: (id: number, npc: NpcSummary, option: NpcConflictOption) => Promise<void>;
  onNameNpc: (id: number, answer: { npcKind: NpcRowKind; npcId: number; npcName: string }) => Promise<void>;
  onMatchPage: (id: number, answer: MatchAnswer) => Promise<void>;
}) {
  const when = useLocalDates();
  // A written page is one-way (accept.ts), so its match is no longer the moderator's to move.
  const t = useUiText();
  const pageWritten = current === "accepted" && (row.hasLine || lineCreated);
  const book = row.book;
  // An ambiguous row needs a page picked, and a known one is already in the corpus.
  const acceptHold =
    book?.match.kind === "ambiguous"
      ? t.contributions.pickPageFirst
      : book?.match.kind === "known"
        ? t.contributions.alreadyInCorpus
        : null;
  const { check } = row;
  const sent = editedText ?? row.text ?? "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [dropping, setDropping] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const hold = busy || locked;
  const keepable = current !== "accepted" && bucket === "ready" && acceptHold === null;

  const startEdit = () => {
    setDraft(check.fix?.text ?? sent);
    setEditing(true);
    setDropping(false);
  };
  // The picker and the draft close only once the request lands, so a refusal keeps the reviewer's work.
  const drop = async (why: string) => {
    if (await onResolve(row.id, "rejected", { reason: why })) setDropping(false);
  };

  const button = (label: string, className: string, onClick: () => void, disabled = false, title?: string) => (
    <button type="button" className={cn("bs-btn", className)} disabled={hold || disabled} title={title} onClick={onClick}>
      {label}
    </button>
  );

  let actions: ReactNode;
  if (editing) {
    actions = (
      <>
        {button(
          t.contributions.keepMyVersion,
          "bs-btn-primary",
          () => {
            void onResolve(row.id, "accepted", { text: draft }).then((ok) => ok && setEditing(false));
          },
          !keepable || !draft.trim(),
          acceptHold ?? undefined,
        )}
        {button(t.contributions.cancel, "bs-btn-text", () => setEditing(false))}
      </>
    );
  } else if (current === "new") {
    const keep = (label: string, className: string, extra?: ResolveExtra) =>
      button(label, className, () => void onResolve(row.id, "accepted", extra), !keepable, acceptHold ?? (bucket !== "ready" ? t.contributions.waitsOnAdmin : undefined));
    const dropAsked = button(t.contributions.dropEllipsis, "bs-btn-text", () => {
      setDropping((open) => !open);
      setEditing(false);
    });
    actions =
      bucket !== "ready" ? (
        dropAsked
      ) : check.verdict === "fix" ? (
        <>
          {check.fix
            ? keep(t.contributions.keepWithFix, "bs-btn-primary", { text: check.fix.text })
            : button(t.contributions.editText, "bs-btn-primary", startEdit)}
          {check.fix
            ? button(t.contributions.editText, "bs-btn-text", startEdit)
            : keep(t.contributions.keepAsSent, "bs-btn-text")}
          {dropAsked}
        </>
      ) : check.verdict === "drop" ? (
        <>
          {button(
            t.contributions.drop,
            "bs-btn-danger",
            () =>
              void drop(
                check.findings.find((finding) => finding.tone === "drop")?.message ??
                  t.contributions.failedChecks,
              ),
          )}
          {button(t.contributions.editTextAndKeep, "bs-btn-text", startEdit, !keepable)}
        </>
      ) : (
        <>
          {keep(t.contributions.keep, "")}
          {button(t.contributions.editText, "bs-btn-text", startEdit, !keepable)}
          {dropAsked}
        </>
      );
  } else {
    actions = (
      <>
        {current === "accepted" && (row.source === "quests" || book) && !(row.hasLine || lineCreated)
          ? // Accepted before lines were written on accept, or reopened since: the same POST again.
            button(
              t.contributions.addToExplorer,
              "bs-btn-primary",
              () => void onResolve(row.id, "accepted"),
              acceptHold !== null,
              acceptHold ?? undefined,
            )
          : null}
        {current === "accepted"
          ? button(t.contributions.dropEllipsis, "bs-btn-text", () => setDropping((open) => !open))
          : null}
        {button(t.contributions.reopen, "bs-btn-text", () => void onResolve(row.id, "new"))}
      </>
    );
  }

  return (
    // Anchor: an accepted quests row's line links back here (LineRow.tsx's "contributed" badge).
    <div id={`contribution-${row.id}`} className="bs-review-row" data-moved={moved ? "" : undefined}>
      <div className="bs-who">
        {row.source === "quests" ? (
          npc ? (
            <div className="flex flex-col gap-1">
              <div className="flex min-w-0 items-baseline gap-1">
                <a
                  href={localeHref(lang, `/quests?q=${npc.npcId}&filter=npc&client=all`)}
                  className="bs-who-name truncate hover:underline"
                  title={npc.npcName ?? undefined}
                >
                  {npc.npcName ?? "unnamed"}
                </a>
                <a
                  href={wowheadEntityUrl(lang, npc.npcKind ?? "creature", npc.npcId)}
                  target="_blank"
                  rel="noreferrer"
                  className="bs-who-sub shrink-0 text-xs hover:underline"
                >
                  #{npc.npcId} wh↗
                </a>
              </div>
              <QuestLine row={row} />
              {npc.conflict.length > 0 ? (
                canAnswerNpc ? (
                  <NpcConflict npc={npc} busy={npcBusy} onPick={(option) => void onPickConflict(row.id, npc, option)} />
                ) : (
                  <span className="bs-who-sub">{t.contributions.npcUnclear}</span>
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
          ) : (
            <div className="flex flex-col gap-1">
              <QuestLine row={row} />
              {canAnswerNpc ? (
                <MissingNpcForm busy={npcBusy} onSave={(answer) => void onNameNpc(row.id, answer)} />
              ) : (
                <span className="bs-who-sub">{t.contributions.noNpcNamed}</span>
              )}
            </div>
          )
        ) : book ? (
          <MatchCell
            book={book}
            books={books}
            busy={npcBusy}
            locked={pageWritten || locked}
            onSave={(answer) => void onMatchPage(row.id, answer)}
          />
        ) : (
          <span className="bs-who-name" title={row.key}>
            {row.place ?? row.key}
          </span>
        )}
      </div>

      <div className="min-w-0">
        <p className="bs-label">{t.contributions.english}</p>
        {row.english ? (
          <p className="bs-text bs-text-en">
            <TokenText text={row.english} />
          </p>
        ) : (
          <p className="bs-text text-muted-foreground">{row.locale.startsWith("en") ? t.contributions.englishLine : t.contributions.noEnglishLine}</p>
        )}
      </div>

      <div className="min-w-0">
        <p className="bs-label">{current === "new" && check.fix && !editing
                ? t.contributions.sentWithFix
                : editedText
                  ? t.contributions.keptAsEdited
                  : t.contributions.sentWord}</p>
        {editing ? (
          <textarea
            className="bs-textarea"
            rows={Math.min(8, Math.max(3, Math.ceil(draft.length / 60)))}
            value={draft}
            lang={row.locale.slice(0, 2)}
            aria-label={t.contributions.editBeforeKeeping}
            onChange={(event) => setDraft(event.target.value)}
          />
        ) : (
          <p className="bs-text" lang={row.locale.slice(0, 2)}>
            {sent ? (
              <TokenText text={sent} removed={current === "new" && !editedText ? check.fix?.removed : undefined} added={current === "new" && !editedText ? check.fix?.added : undefined} />
            ) : (
              <span className="text-muted-foreground">{t.contributions.noTextSent}</span>
            )}
          </p>
        )}
        <ul className="bs-findings">
          {row.waiting && current === "new" && bucket !== "ready" ? (
            <li className="bs-finding bs-finding-info">
              <ClockIcon className="size-3.5" aria-hidden />
              <span>
                {row.waiting.why} <span className="text-muted-foreground">{row.waiting.fix}</span>
              </span>
            </li>
          ) : current === "rejected" ? (
            <li className="bs-finding bs-finding-drop">
              <XIcon className="size-3.5" aria-hidden />
              <span>
                {reason
                  ? fill(t.contributions.rejectedWith, { reason })
                  : t.contributions.rejectedNoReasonGiven}
              </span>
            </li>
          ) : check.findings.length === 0 ? (
            <li className="bs-finding bs-finding-ok">
              <CheckIcon className="size-3.5" aria-hidden />
              <span>{t.contributions.passesChecks}</span>
            </li>
          ) : (
            check.findings.map((finding) => (
              <li key={finding.message} className={cn("bs-finding", `bs-finding-${finding.tone}`)}>
                <CircleAlertIcon className="size-3.5" aria-hidden />
                <span>{finding.message}</span>
              </li>
            ))
          )}
        </ul>
      </div>

      <div className="bs-actions">
        {actions}
        {moved ? <p className="bs-refusal text-muted-foreground">{bucket === "ready" ? t.contributions.readyNow : t.contributions.waitsNow}</p> : null}
        {refusal ? <p className="bs-refusal">{refusal}</p> : null}
      </div>

      <div className="bs-meta">
        <span>
          {row.client.label} · {row.locale}
          {row.client.buildNumber ? ` · ${row.client.buildNumber}` : null}
        </span>
        {row.pack ? <span title={t.contributions.heardInHint}>{fill(t.contributions.heardIn, { pack: row.pack })}</span> : null}
        <span className="inline-flex items-center gap-1">
          {t.contributions.sentBy} <SendersButton id={row.id} count={row.count} />
        </span>
        <span>{fill(t.contributions.filed, { when: when(row.createdAt) })}</span>
        {row.body ? (
          <button type="button" aria-expanded={showNote} onClick={() => setShowNote((open) => !open)}>
            {showNote ? t.contributions.hideNote : t.contributions.playerNote}
          </button>
        ) : null}
        {found !== undefined ? <span>{t.contributions.alreadyHaveText}</span> : null}
      </div>
      {showNote && row.body ? (
        <div className="bs-aside">
          <p className="bs-label">{t.contributions.playerSaidWrong}</p>
          <p className="bs-text">{row.body}</p>
        </div>
      ) : null}
      {found !== undefined && current === "new" ? (
        <div className="bs-aside">
          <p className="bs-label">{t.contributions.alreadyOnFile}</p>
          <p className="bs-text">{found}</p>
        </div>
      ) : null}

      {dropping ? (
        <DropReasons reasons={lineDropReasons(langName(lang))} disabled={hold} onPick={(why) => void drop(why)} onCancel={() => setDropping(false)} />
      ) : null}
    </div>
  );
});

/** Which quest and panel a quests row was read off, or that it is gossip. */
function QuestLine({ row }: { row: ContributionRow }) {
  const lang = useLang();
  if (row.quest === null) return null;
  if (row.quest === "gossip") return <span className="bs-who-sub">{STAGE_LABELS.gossip}</span>;
  return (
    <span className="bs-who-sub">
      {row.quest.title}{" "}
      <a href={wowheadQuestUrl(lang, row.quest.questId)} target="_blank" rel="noreferrer" className="hover:underline">
        #{row.quest.questId}
      </a>
      {row.quest.stage ? ` · ${STAGE_LABELS[row.quest.stage]}` : null}
    </span>
  );
}

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
  const t = useUiText();
  if (pages <= 1) return null;
  return (
    <span className="text-muted-foreground ml-auto flex items-center gap-1">
      <LiteButton variant="ghost" className="h-6 px-2 text-xs" disabled={page <= 1} onClick={() => onGo(page - 1)}>
        {t.contributions.prev}
      </LiteButton>
      {fill(t.contributions.pageOfRows, { page, pages, rows: total })}
      <LiteButton variant="ghost" className="h-6 px-2 text-xs" disabled={page >= pages} onClick={() => onGo(page + 1)}>
        {t.contributions.nextArrow}
      </LiteButton>
    </span>
  );
}

type Refusals = Record<number, string>;

/** A row's refusal, in the route's own words where it gave some. A setRefusals updater. */
function withRefusal(
  id: number,
  fallback: string,
  error?: unknown,
): (current: Refusals) => Refusals {
  const message = typeof error === "string" ? error : fallback;
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
  const t = useUiText();
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
        placeholder={t.contributions.id}
        value={npcId}
        onChange={(event) => setNpcId(event.target.value)}
        className="h-7 w-20 rounded border bg-transparent px-1.5 text-xs"
      />
      <input
        required
        placeholder={t.contributions.name}
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
  const t = useUiText();
  const lang = useLang();
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
      {book.candidates.length > 0 ? (
        <ul className="flex max-h-56 max-w-[14rem] flex-col gap-2 overflow-y-auto whitespace-normal">
          {book.candidates.map((candidate) => (
            <li key={candidate.key} className="border-l pl-2">
              <div className="flex flex-wrap items-baseline gap-x-1">
                {candidate.href ? (
                  <a href={candidate.href} className="hover:underline">
                    {candidate.label}
                  </a>
                ) : (
                  <span>{candidate.label}</span>
                )}
                <span className="text-muted-foreground">#{candidate.bookId}</span>
                {candidate.owner ? (
                  <a
                    href={wowheadEntityUrl(lang, candidate.owner.kind === "object" ? "gameobject" : "item", candidate.owner.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:underline"
                  >
                    {candidate.owner.kind} {candidate.owner.id} wh↗
                  </a>
                ) : null}
              </div>
              {candidate.excerpt ? <p className="text-muted-foreground line-clamp-2">{candidate.excerpt}</p> : null}
              {locked ? null : (
                <LiteButton
                  variant="outline"
                  className="mt-0.5 h-6 px-2 text-xs"
                  disabled={busy}
                  onClick={() => onSave(candidate.answer)}
                >
                  {t.contributions.thisOne}
                </LiteButton>
              )}
            </li>
          ))}
        </ul>
      ) : null}
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
            aria-label={t.contributions.book}
            placeholder={t.contributions.book}
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
            className="h-7 w-40 rounded border bg-transparent px-1.5 text-xs"
          />
          <input
            required={!isNew}
            disabled={isNew}
            inputMode="numeric"
            pattern="\d+"
            aria-label={t.contributions.page}
            value={pageNumber}
            onChange={(event) => setPageNumber(event.target.value)}
            className="h-7 w-10 rounded border bg-transparent px-1.5 text-xs"
          />
          <LiteButton type="submit" variant="outline" className="h-7 px-2 text-xs" disabled={busy || !valid}>
            {t.contributions.matchBook}
          </LiteButton>
          {book.match.kind !== "new-book" ? (
            <LiteButton
              variant="ghost"
              className="h-7 px-1.5 text-xs"
              disabled={busy}
              title={t.contributions.newBook}
              onClick={() => onSave({ newBook: true })}
            >
              {t.contributions.newBookShort}
            </LiteButton>
          ) : null}
          {moderated ? (
            <LiteButton variant="ghost" className="h-7 px-1.5 text-xs" disabled={busy} onClick={() => onSave(null)}>
              {t.contributions.clearPick}
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
  const t = useUiText();
  return (
    <div className="flex flex-col gap-1">
      <p className="text-destructive">
        {fill(t.contributions.conflictingAnswers, { id: npc.npcId })}
      </p>
      {npc.conflict.map((option) => (
        <div key={option.npcKind} className="flex items-center gap-2">
          <span>
            {option.npcKind}:{" "}
            {[option.race, option.gender, option.flavor].filter(Boolean).join("-") ||
              t.contributions.noRace}
          </span>
          <ProvenanceBadge provenance={option.provenance} />
          <LiteButton
            variant="outline"
            className="h-6 px-2 text-xs"
            disabled={busy}
            onClick={() => onPick(option)}
          >
            {t.contributions.thisOne}
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
