// Filtering, as a pure function of the catalogue.
//
// Everything database-backed arrives in a SearchContext rather than being fetched here,
// which is the split lib/search.ts makes on the quests side and the reason this is
// testable with no database and no filesystem. 1353 rows filter in a linear chain per
// request; there is no index and at this size there does not need to be one.
//
// THE STATE DEFINITIONS ARE THE CLI's. `missing`, `stale` and `current` mean exactly what
// pipelines/places/tools/voice/generate.mjs's --missing and --stale select, because they
// are computed the same way: stale is take.textHash !== entry.hash, where entry.hash is
// sha1 of the SPOKEN text. If these two ever disagree, the explorer is lying about what
// needs regenerating.

import { isDirty } from "@/lib/generation/dirty";
import { recordedMatches, type LiveRecording } from "@/lib/recordings/live";
import { madeByFacets, madeByMatches, type MadeBy, type MadeByFacets } from "@/lib/takes/made-by";

import type { CatalogueEntry, SearchContext, Take } from "./catalogue";
import { PAGE_SIZE, SHORT_LINE, type LineFilters, type State } from "./filters";

export type ResultLine = {
  /** 'z:1411' | 's:1411:razor hill'. Unique by construction -- naming.mjs guarantees
   *  one file per line -- so unlike the quests side there is no positional row key. */
  id: string;
  kind: "zone" | "subzone";
  mapID: number;
  zoneName: string;
  /** The subzone's name, or the zone's own for a zone line. */
  name: string;
  text: string;
  spoken: string;
  chars: number;
  short: boolean;
  file: string;
  state: State;
  take: Take | null;
  /** How many reports on this line are still open. The count is public; the bodies are
   *  not -- see SearchContext.reports. */
  reportsOpen: number;
  /**
   * This take was cut before a pronunciation it speaks was changed, and nobody has said it
   * is fine since. Orthogonal to `state`: a take can be current and dirty at once, because
   * a lexicon edit moves no text. Cleared by hand only -- see lib/generation/dirty.ts.
   */
  dirty: boolean;
  /** The English prose this line would be translated from. Absent when reading English. */
  english?: string;
  /** False when this language has no text for the line yet, so `text` is the English
   *  standing in for it, shown and marked but never voiced. Absent when reading English,
   *  where the question is meaningless. */
  translated?: boolean;
  /** This language has no name for the place yet, so `name` is the English. */
  nameMissing?: boolean;
  /** Likewise for the zone the place is in, and `zoneName`. */
  zoneNameMissing?: boolean;
  /** The English name, for a translator. Absent when reading English. */
  englishName?: string;
  /** Who and what made the live take. Null with no take, or when the viewer may not know. */
  madeBy: MadeBy | null;
  /** The live voice-actor recording, or null. Absent for anybody who does not record here. */
  recording?: LiveRecording | null;
};

export type SearchResult = {
  lines: ResultLine[];
  /** Across every page, not just this one. */
  total: number;
  /** What the current filter selects, for the header and the regenerate quote. */
  totalChars: number;
  counts: Record<State, number>;
  /** How many of the matched lines are dirty. Not a fourth state; see ResultLine.dirty. */
  dirty: number;
  offset: number;
  limit: number;
  /** What the model and author chips offer. Absent when the context carried no `madeBy`. */
  madeBy?: MadeByFacets;
  /**
   * The viewer records in this language, so every row carries `recording` and the page draws
   * the voice actor column. The server's answer rather than a grant check in the browser,
   * for the reason components/MadeBy.tsx gives.
   */
  recordable?: true;
};

export function stateOf(entry: CatalogueEntry, take: Take | undefined): State {
  if (!take) return "missing";
  return take.textHash === entry.hash ? "current" : "stale";
}

export function decorate(entry: CatalogueEntry, context: SearchContext): ResultLine {
  const take = context.takes.get(entry.id);
  return {
    id: entry.id,
    kind: entry.kind,
    mapID: entry.mapID,
    zoneName: entry.zoneName,
    name: entry.name || entry.key || entry.zoneName,
    text: entry.full,
    spoken: entry.spoken,
    chars: entry.spoken.length,
    short: entry.spoken.length < SHORT_LINE,
    file: entry.file,
    state: stateOf(entry, take),
    take: take ?? null,
    reportsOpen: context.reports.get(entry.id) ?? 0,
    madeBy: context.madeBy?.get(entry.id) ?? null,
    ...(context.recordings && { recording: context.recordings.get(entry.file) ?? null }),
    ...(entry.english === undefined
      ? {}
      : {
          english: entry.english,
          translated: !entry.missing?.text,
          nameMissing: entry.missing?.name ?? false,
          zoneNameMissing: entry.missing?.zone ?? false,
          englishName: entry.englishName,
        }),
    // The spoken text, not the full one: the lexicon is applied to what is sent.
    dirty: take
      ? isDirty(
          { file: entry.file, text: entry.spoken, generatedAt: Date.parse(take.generatedAt) },
          context.dirt,
        )
      : false,
  };
}

function dayStart(day: string): number | null {
  const at = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(at) ? null : at;
}

function matchesQuery(line: ResultLine, needle: string, field: string): boolean {
  const q = needle.toLowerCase();
  switch (field) {
    case "name":
      return line.name.toLowerCase().includes(q);
    case "zone":
      return line.zoneName.toLowerCase().includes(q);
    case "text":
      return line.text.toLowerCase().includes(q);
    default:
      return (
        line.name.toLowerCase().includes(q) ||
        line.zoneName.toLowerCase().includes(q) ||
        line.text.toLowerCase().includes(q)
      );
  }
}

export function matching(lines: ResultLine[], filters: LineFilters = {}): ResultLine[] {
  let out = lines;

  if (filters.q) {
    const needle = filters.q.trim();
    if (needle) out = out.filter((l) => matchesQuery(l, needle, filters.field ?? "any"));
  }
  if (filters.kind) out = out.filter((l) => l.kind === filters.kind);
  if (filters.mapID !== undefined) out = out.filter((l) => l.mapID === filters.mapID);
  if (filters.state) out = out.filter((l) => l.state === filters.state);
  // Its own filter rather than a fourth state, because a current take can be dirty.
  if (filters.dirty) out = out.filter((l) => l.dirty);
  if (filters.short) out = out.filter((l) => l.short);

  // The triage worklist: what somebody has complained about and nobody has answered.
  if (filters.reports === "open") out = out.filter((l) => l.reportsOpen > 0);

  // An id the catalogue no longer carries matches nothing rather than everything: a report
  // about a line that has since been dropped must not read as "here it is".
  if (filters.line) out = out.filter((l) => l.id === filters.line);

  if (filters.model || filters.author) out = out.filter((l) => madeByMatches(l.madeBy ?? undefined, filters));
  if (filters.recorded) out = out.filter((l) => recordedMatches(l.recording, filters.recorded));

  if (filters.generatedAfter) {
    const at = dayStart(filters.generatedAfter);
    if (at !== null) out = out.filter((l) => l.take && Date.parse(l.take.generatedAt) >= at);
  }
  if (filters.generatedBefore) {
    const at = dayStart(filters.generatedBefore);
    // Exclusive of the named day's own generations: "before the 3rd" should not
    // include clips made at 09:00 on the 3rd.
    if (at !== null) out = out.filter((l) => l.take && Date.parse(l.take.generatedAt) < at);
  }

  return out;
}

// Deterministic and total, because paging a list whose order can shift drops and
// repeats rows between pages. Zone line first within a zone, then subzones by name.
function order(lines: ResultLine[]): ResultLine[] {
  return [...lines].sort(
    (a, b) =>
      a.zoneName.localeCompare(b.zoneName) ||
      Number(a.kind === "subzone") - Number(b.kind === "subzone") ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}

export function search(
  entries: CatalogueEntry[],
  context: SearchContext,
  filters: LineFilters = {},
  offset = 0,
  limit = PAGE_SIZE,
): SearchResult {
  const all = entries.map((entry) => decorate(entry, context));
  const matched = order(matching(all, filters));

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
