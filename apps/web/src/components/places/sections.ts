import type { ExplorerSection, SectionWords } from "@/components/explorer/section";
import type { ZoneFacet } from "@/lib/places/catalogue";
import {
  FIELDS,
  filterParams,
  filtersFromParams,
  KINDS,
  type LineFilters,
} from "@/lib/places/filters";
import type { ResultLine } from "@/lib/places/search";

export type PlacesSection = ExplorerSection<ResultLine, LineFilters>;

/**
 * `zones` feeds the zone dropdown; the report table and sort queue, which have none, pass none.
 * `words` is the reader's: the section is built on the client, where the interface language is.
 */
export function placesSection(zones: ZoneFacet[] = [], words: SectionWords): PlacesSection {
  return {
    source: "places",
    api: "/api/places",
    textApi: "lore",
    facetLabel: words.facet,
    // The count rides in the label: it is what makes one zone worth picking over another.
    facets: zones.map((zone) => ({ value: zone.mapID, label: `${zone.name} (${zone.lines})` })),
    chip: (line) => line.zoneName,
    shortText: true,
    labels: { name: words.name, text: words.text, search: words.search },
    ownLineText: words.ownLine,
    ownLine: (line) => line.kind === "zone",
    // A place is named by its line's id.
    nameOf: (line) => ({ kind: line.kind, entityId: line.id }),
    filters: {
      fields: FIELDS,
      kinds: KINDS,
      fromParams: filtersFromParams,
      toParams: filterParams,
    },
  };
}
