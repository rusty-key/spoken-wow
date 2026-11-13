// Filtering the boss catalogue, as a pure function of it and a SearchContext.
//
// The states mean what they mean for places: stale is a take whose hash is not the entry's.
// A boss with no story in the language has no hash, so with a take it is stale and without one
// it is missing; either way there is nothing to voice until somebody writes it.

import { isDirty } from "@/lib/generation/dirty";
import { recordedMatches, type LiveRecording } from "@/lib/recordings/live";
import { madeByFacets, madeByMatches, type MadeBy, type MadeByFacets } from "@/lib/takes/made-by";

import type { BossEntry, SearchContext, Take } from "./catalogue";
import { PAGE_SIZE, SHORT_LINE, type LineFilters, type State } from "./filters";

export type ResultLine = {
  /** boss:{map}:{key}. */
  id: string;
  bossId: number;
  /** The instance's map id. */
  mapID: number;
  instanceName: string;
  kind: "dungeon" | "world";
  encounterIds: number[];
  creatureId: number | null;
  name: string;
  /** This language's story, or null when it has none. Never another language's. */
  text: string | null;
  spoken: string | null;
  /** False when the language has no story, so there is nothing to play or regenerate. */
  written: boolean;
  chars: number;
  short: boolean;
  file: string;
  state: State;
  take: Take | null;
  reportsOpen: number;
  /** A take cut before a pronunciation it speaks changed; see lib/generation/dirty.ts. */
  dirty: boolean;
  madeBy: MadeBy | null;
  recording?: LiveRecording | null;
  /** The language has no name of its own for the boss, so `name` is the English. Absent in English. */
  nameMissing?: boolean;
  /** The English name, for a translator. Absent in English. */
  englishName?: string;
};

export type SearchResult = {
  lines: ResultLine[];
  total: number;
  totalChars: number;
  counts: Record<State, number>;
  dirty: number;
  offset: number;
  limit: number;
  madeBy?: MadeByFacets;
  recordable?: true;
};

export function stateOf(entry: Pick<BossEntry, "hash">, take: Take | undefined): State {
  if (!take) return "missing";
  return entry.hash !== null && take.textHash === entry.hash ? "current" : "stale";
}

export function decorate(entry: BossEntry, context: SearchContext): ResultLine {
  const take = context.takes.get(entry.id);
  const chars = entry.spoken?.length ?? 0;
  return {
    id: entry.id,
    bossId: entry.bossId,
    mapID: entry.map,
    instanceName: entry.instanceName,
    kind: entry.kind,
    encounterIds: entry.encounterIds,
    creatureId: entry.creatureId,
    name: entry.name,
    text: entry.text,
    spoken: entry.spoken,
    written: entry.text !== null,
    chars,
    short: entry.spoken !== null && chars < SHORT_LINE,
    file: entry.file,
    state: stateOf(entry, take),
    take: take ?? null,
    reportsOpen: context.reports.get(entry.id) ?? 0,
    madeBy: context.madeBy?.get(entry.id) ?? null,
    ...(context.recordings && { recording: context.recordings.get(entry.file) ?? null }),
    ...(entry.nameMissing !== undefined && { nameMissing: entry.nameMissing, englishName: entry.englishName }),
    dirty:
      take && entry.spoken !== null
        ? isDirty({ file: entry.file, text: entry.spoken, generatedAt: Date.parse(take.generatedAt) }, context.dirt)
        : false,
  };
}

function dayStart(day: string): number | null {
  const at = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(at) ? null : at;
}

function matchesQuery(line: ResultLine, needle: string, field: string): boolean {
  const q = needle.toLowerCase();
  const name = line.name.toLowerCase().includes(q);
  const instance = line.instanceName.toLowerCase().includes(q);
  const text = line.text?.toLowerCase().includes(q) ?? false;
  switch (field) {
    case "name":
      return name;
    case "instance":
      return instance;
    case "text":
      return text;
    default:
      return name || instance || text;
  }
}

export function matching(lines: ResultLine[], filters: LineFilters = {}): ResultLine[] {
  let out = lines;

  if (filters.q) {
    const needle = filters.q.trim();
    if (needle) out = out.filter((l) => matchesQuery(l, needle, filters.field ?? "any"));
  }
  if (filters.mapID !== undefined) out = out.filter((l) => l.mapID === filters.mapID);
  if (filters.state) out = out.filter((l) => l.state === filters.state);
  if (filters.dirty) out = out.filter((l) => l.dirty);
  if (filters.short) out = out.filter((l) => l.short);
  if (filters.reports === "open") out = out.filter((l) => l.reportsOpen > 0);
  // An id the catalogue no longer carries matches nothing, so a report on a dropped boss does
  // not read as "here it is".
  if (filters.line) out = out.filter((l) => l.id === filters.line);
  if (filters.model || filters.author) out = out.filter((l) => madeByMatches(l.madeBy ?? undefined, filters));
  if (filters.recorded) out = out.filter((l) => recordedMatches(l.recording, filters.recorded));

  if (filters.generatedAfter) {
    const at = dayStart(filters.generatedAfter);
    if (at !== null) out = out.filter((l) => l.take && Date.parse(l.take.generatedAt) >= at);
  }
  if (filters.generatedBefore) {
    const at = dayStart(filters.generatedBefore);
    if (at !== null) out = out.filter((l) => l.take && Date.parse(l.take.generatedAt) < at);
  }

  return out;
}

/** In catalogue order, instance position then boss position, which is already total. */
export function search(
  entries: BossEntry[],
  context: SearchContext,
  filters: LineFilters = {},
  offset = 0,
  limit = PAGE_SIZE,
): SearchResult {
  const matched = matching(
    entries.map((entry) => decorate(entry, context)),
    filters,
  );

  const counts: Record<State, number> = { missing: 0, stale: 0, current: 0 };
  let totalChars = 0;
  let dirty = 0;
  for (const line of matched) {
    counts[line.state]++;
    if (line.dirty) dirty++;
    totalChars += line.chars;
  }

  return {
    lines: matched.slice(offset, offset + limit),
    total: matched.length,
    totalChars,
    counts,
    dirty,
    offset,
    limit,
    ...(context.madeBy && { madeBy: madeByFacets(context.madeBy.values()) }),
    ...(context.recordings && { recordable: true as const }),
  };
}
