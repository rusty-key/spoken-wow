/**
 * The query string /contributions's filter dropdowns write to, and the Speaker dropdown's
 * one sentinel value.
 *
 * A free function, not inlined in ContributionTable's click handler, so the mapping -- combine
 * whichever dimension just changed with the other as it stands, the same rule ReportTable's own
 * `go` follows -- can be pinned by a test without rendering FilterChip or a page. Node-free, like
 * contributions.ts and npc.ts, whose types this one only composes: ContributionTable is a client
 * component and calls this directly on every dropdown change.
 */
import type { ClientFamily } from "./client";
import type { ContributionStatus } from "./contributions";
import { isEnvelopeSource, type EnvelopeSource } from "./envelope";
import type { Provenance } from "../npc/npc";
import type { Filter } from "../search";
import type { QuestSummary } from "./triage";

/**
 * "Everything a moderator still owes a decision" -- not a fifth provenance, a sentinel over the
 * four real ones. `client` (a guess nobody has looked at) and `none` (nothing known at all) are
 * exactly the two provenances `confirmed` can never be true for, which is the whole reason this
 * queue exists: the brief's own words for it are "tweak unconfirmed NPCs later".
 *
 * A single-select Speaker dropdown of the four provenances alone cannot express that union --
 * picking "Client guess" or "No race" narrows to one of the two, never both in one click -- so
 * dropping the old Confirmed/Unconfirmed axis entirely (both of which were themselves unions of
 * two provenances, not renamed single ones) would have quietly removed a real view rather than
 * a duplicate one. This sentinel restores the "unconfirmed" half of that view without bringing
 * back a second dropdown or the "confirmed" half: nobody triages the settled rows, so there is
 * no queue that ever wants "corpus or moderator" as one filter.
 *
 * Kept off `isProvenance`'s own union on purpose: a value it doesn't recognise must fall back to
 * "all" (page.tsx's own parsing already does this for any unrecognised string), not silently
 * mean "needs a decision" -- the two are handled by two separate checks in matchesSpeaker so a
 * typo in the query string can never masquerade as this filter.
 */
export const NEEDS_DECISION = "needs-decision" as const;

/**
 * "A quest row whose envelope never named an NPC at all" -- the one speaker state with no
 * provenance, because there is no npc_resolution row to have one. What the manual NPC form in
 * the triage table exists for. Zones and books never name an NPC, so they are never missing one.
 */
export const MISSING = "missing" as const;

export type SpeakerFilter = Provenance | "all" | typeof NEEDS_DECISION | typeof MISSING;

/** The Speaker dropdown's two sentinels, for page.tsx's parsing of the query string. */
export function isSpeakerSentinel(value: unknown): value is typeof NEEDS_DECISION | typeof MISSING {
  return value === NEEDS_DECISION || value === MISSING;
}

export type ClientFilter = ClientFamily | "all";

/**
 * An envelope source, or gossip: the quests rows tied to no quest, which the site shows as a
 * section of their own although the addon still files them as quests.
 */
export type SourceFilter = EnvelopeSource | "gossip" | "all";

export function isSourceFilter(value: unknown): value is SourceFilter {
  return isEnvelopeSource(value) || value === "gossip" || value === "all";
}

/** The section a row is listed under, as the Source column and dropdown name it. */
export function sectionOf(row: { source: EnvelopeSource }, quest: QuestSummary | null): EnvelopeSource | "gossip" {
  return quest === "gossip" ? "gossip" : row.source;
}

export function matchesSource(section: EnvelopeSource | "gossip", filter: SourceFilter): boolean {
  return filter === "all" || section === filter;
}

/**
 * The quest panel a quests row was read off, as the addon's `event` field names it (SpokenQuests'
 * EVENT_PATHS): the detail, progress or reward panel.
 */
export const QUEST_STAGES = ["accept", "progress", "complete"] as const;

export type QuestStage = (typeof QUEST_STAGES)[number];

export function isQuestStage(value: unknown): value is QuestStage {
  return QUEST_STAGES.includes(value as QuestStage);
}

export type StageFilter = QuestStage | "all";

export function isStageFilter(value: unknown): value is StageFilter {
  return isQuestStage(value) || value === "all";
}

/**
 * Whether one row's Quest column satisfies the Stage dropdown. Any narrowed view drops every
 * row with no quest concept at all (zones, books), the same way a Speaker filter drops rows
 * with no NPC.
 */
export function matchesStage(quest: QuestSummary | null, filter: StageFilter): boolean {
  if (filter === "all") return true;
  if (quest === null || quest === "gossip") return false;
  return quest.stage === filter;
}

/**
 * The columns the table can be ordered by -- only the ones that are columns of the stored row,
 * so the database does the ordering before the page is cut. NPC, quest and client are worked
 * out per row after the query, and paging a list sorted on them would mean resolving every row
 * in the queue first.
 */
export const SORT_COLUMNS = ["filed", "source", "count"] as const;

export type SortColumn = (typeof SORT_COLUMNS)[number];

export type SortDirection = "asc" | "desc";

export type ContributionSort = { column: SortColumn; direction: SortDirection };

export function isSortColumn(value: unknown): value is SortColumn {
  return SORT_COLUMNS.includes(value as SortColumn);
}

export function isSortDirection(value: unknown): value is SortDirection {
  return value === "asc" || value === "desc";
}

/**
 * Most sent first: what triage works down, since a line many players pasted is one many
 * players are missing.
 */
export const DEFAULT_SORT: ContributionSort = { column: "count", direction: "desc" };

/**
 * The direction a column starts in when its header is first clicked: biggest and newest first
 * for the numbers and dates, alphabetical for the words.
 */
const FIRST_DIRECTION: Record<SortColumn, SortDirection> = {
  filed: "desc",
  source: "asc",
  count: "desc",
};

/** A header click: the column already sorted on flips, any other starts in its own direction. */
export function nextSort(current: ContributionSort, column: SortColumn): ContributionSort {
  if (current.column === column) return { column, direction: current.direction === "asc" ? "desc" : "asc" };
  return { column, direction: FIRST_DIRECTION[column] };
}

/** The `sort` and `dir` query parameters as a sort, falling back to DEFAULT_SORT. */
export function sortOf(column: unknown, direction: unknown): ContributionSort {
  if (!isSortColumn(column)) return DEFAULT_SORT;
  return { column, direction: isSortDirection(direction) ? direction : FIRST_DIRECTION[column] };
}

export type ContributionFilters = {
  status: ContributionStatus;
  provenance: SpeakerFilter;
  client: ClientFilter;
  source: SourceFilter;
  stage: StageFilter;
  sort: ContributionSort;
  /** Absent or blank searches nothing. */
  q?: string;
  /** Which field `q` is matched in; absent is "any". */
  searchIn?: Filter;
};

export type FilterChange = {
  status?: ContributionStatus;
  provenance?: SpeakerFilter;
  client?: ClientFilter;
  source?: SourceFilter;
  stage?: StageFilter;
  sort?: ContributionSort;
  q?: string;
  searchIn?: Filter;
};

/**
 * The next filter state after one dropdown changes, keeping the others where they stood.
 *
 * A key present in `next` always wins, even set to `undefined` -- FilterChip's own way of
 * saying "reset to any", which this maps back to "all". A key simply absent from `next` (the
 * dimensions that did not change) is the only case that falls back to `current`. `sort` and
 * `status` have no "all": unset, they go back to DEFAULT_SORT and the new rows' tab.
 */
export function nextContributionFilters(
  current: ContributionFilters,
  next: FilterChange,
): ContributionFilters {
  return {
    status: "status" in next ? (next.status ?? "new") : current.status,
    provenance: "provenance" in next ? (next.provenance ?? "all") : current.provenance,
    client: "client" in next ? (next.client ?? "all") : current.client,
    source: "source" in next ? (next.source ?? "all") : current.source,
    stage: "stage" in next ? (next.stage ?? "all") : current.stage,
    sort: "sort" in next ? (next.sort ?? DEFAULT_SORT) : current.sort,
    q: "q" in next ? next.q : current.q,
    searchIn: "searchIn" in next ? next.searchIn : current.searchIn,
  };
}

/** How many rows one page of /contributions shows. */
export const PAGE_SIZE = 100;

/** The `page` query parameter as a page number: 1 for anything that is not a positive integer. */
export function pageOf(value: unknown): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

/**
 * nextContributionFilters, turned into the href /contributions's own rows read back.
 *
 * `page` only when asked for: a filter change starts again from the first page, since the
 * page it was on may not exist in the new view. `sort` and `dir` likewise only when they
 * are not the default, so a link from before there was a choice still reads the same.
 */
export function contributionsHref(current: ContributionFilters, next: FilterChange, page = 1): string {
  const filters = nextContributionFilters(current, next);
  const params = new URLSearchParams({
    status: filters.status,
    provenance: filters.provenance,
    client: filters.client,
    source: filters.source,
    stage: filters.stage,
  });
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  if (filters.searchIn && filters.searchIn !== "any") params.set("filter", filters.searchIn);
  if (filters.sort.column !== DEFAULT_SORT.column || filters.sort.direction !== DEFAULT_SORT.direction) {
    params.set("sort", filters.sort.column);
    params.set("dir", filters.sort.direction);
  }
  if (page > 1) params.set("page", String(page));
  return `/contributions?${params}`;
}

/**
 * Whether one row's NPC provenance satisfies a Speaker dropdown selection -- the server-side
 * half of the filter, called from page.tsx's own row projection, not just the UI's idea of what
 * is selected.
 *
 * `undefined` (a row with no npc at all) matches MISSING when it is a quests row, and no other
 * real filter.
 */
export function matchesSpeaker(provenance: Provenance | undefined, filter: SpeakerFilter, source: EnvelopeSource): boolean {
  if (filter === "all") return true;
  if (filter === MISSING) return provenance === undefined && source === "quests";
  if (provenance === undefined) return false;
  if (filter === NEEDS_DECISION) return provenance === "client" || provenance === "none";
  return provenance === filter;
}

export function isSearchIn(value: unknown): value is Filter {
  return value === "any" || value === "npc" || value === "quest" || value === "text";
}

/**
 * A bare number is an NPC or quest id, never a substring, so "240" finds that NPC rather than
 * every line mentioning 240 gold. Words match the NPC's name, the quest's title or the text.
 */
export function matchesSearch(
  row: { text: string | null; npc: { npcId: number; npcName: string | null } | undefined; quest: QuestSummary | null },
  q: string,
  filter: Filter = "any",
): boolean {
  const query = q.trim();
  if (!query) return true;
  const needle = query.toLowerCase();
  const textHit = (row.text ?? "").toLowerCase().includes(needle);
  if (filter === "text") return textHit;

  const quest = row.quest === null || row.quest === "gossip" ? null : row.quest;
  const asNumber = /^\d+$/.test(query) ? Number(query) : null;
  if (asNumber !== null) {
    const npcHit = row.npc?.npcId === asNumber;
    const questHit = quest?.questId === asNumber;
    if (filter === "npc") return npcHit;
    if (filter === "quest") return questHit;
    return npcHit || questHit;
  }

  const npcHit = (row.npc?.npcName ?? "").toLowerCase().includes(needle);
  const questHit = (quest?.title ?? "").toLowerCase().includes(needle);
  if (filter === "npc") return npcHit;
  if (filter === "quest") return questHit;
  return npcHit || questHit || textHit;
}
