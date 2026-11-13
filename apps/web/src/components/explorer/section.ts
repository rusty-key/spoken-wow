// What the places explorer needs to know to show another section's lines.
//
// Places and bosses are one kind of screen: a line per place or boss, a text, a take. The
// explorer components take one of these rather than asking which section they are in, so a
// branch that only places needs is keyed on a field here, and a third section is a config.

import type { ReactNode } from "react";

import type { LineFilters as BossFilters } from "@/lib/bosses/filters";
import type { ResultLine as BossLine } from "@/lib/bosses/search";
import type { LineFilters as PlaceFilters } from "@/lib/places/filters";
import type { ResultLine as ZoneLine, SearchResult as ZoneResult } from "@/lib/places/search";

/**
 * A line of either section. The places-only fields are optional on a boss line, which never
 * carries them, so the components read them without asking which section a line came from.
 */
export type ExplorerLine = (ZoneLine | BossLine) &
  Partial<Pick<ZoneLine, "english" | "translated" | "nameMissing" | "zoneNameMissing" | "englishName">>;

/**
 * What either section's filters can hold. The search bar writes this shape, and offers only
 * the fields and kinds its section lists, so what it writes is always that section's own.
 * `kind` is places' alone.
 */
export type ExplorerFilters = Omit<PlaceFilters, "field"> & { field?: PlaceFilters["field"] | BossFilters["field"] };

/** Either search's answer: the two differ only in the lines they carry. */
export type ExplorerResult<L extends ExplorerLine> = Omit<ZoneResult, "lines"> & { lines: L[] };

export type ExplorerSection<L extends ExplorerLine = ExplorerLine, F extends ExplorerFilters = ExplorerFilters> = {
  source: "places" | "bosses";
  /** "/api/places" | "/api/bosses". */
  api: string;
  /** The edit route's name under `api`. */
  textApi: "lore" | "story";
  /** "Zone" | "Instance": the first column and the dropdown that narrows to one. */
  facetLabel: string;
  facets: { value: number; label: string }[];
  /** What the first column shows: the zone or instance the line belongs to. */
  chip(line: L): string | null;
  /**
   * Places stores a full text and a short one derived from it, so its route takes `full`;
   * bosses has one text, sent and returned as `text`.
   */
  shortText: boolean;
  /** The second and third column headings, and the search box's prompt. */
  labels: { name: string; text: string; search: string };
  /**
   * A line that speaks for its chip rather than for something in it: a zone's own line. Its
   * name column says so and the edit dialog is headed by the chip.
   */
  ownLine?(line: L): boolean;
  /**
   * The entity_name row the line's name is written to in the page's language, as /api/names
   * addresses it; absent where it cannot be.
   */
  nameOf?(line: L): { kind: string; entityId: string };
  /** A line under the name: what the section knows about the row beyond its name. */
  detail?(line: L): ReactNode;
  filters: {
    /** Where the free-text query can be matched, "any" first. */
    fields: readonly NonNullable<F["field"]>[];
    /** Places' zone/subzone filter; empty where the section has none. */
    kinds: readonly NonNullable<PlaceFilters["kind"]>[];
    fromParams(params: URLSearchParams): F;
    toParams(filters: F): URLSearchParams;
    activeCount(filters: F): number;
  };
};

/**
 * There is a take to play and a text it speaks. A boss with no story in the language can
 * still have a take, cut from a story since withdrawn, and offering it would play words the
 * page no longer shows.
 */
export function canPlay(line: ExplorerLine): boolean {
  return line.state !== "missing" && line.text !== null;
}
