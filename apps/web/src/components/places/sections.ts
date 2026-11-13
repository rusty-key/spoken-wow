import type { ExplorerSection } from "@/components/explorer/section";
import type { ZoneFacet } from "@/lib/places/catalogue";
import {
  activeFilterCount,
  FIELDS,
  filterParams,
  filtersFromParams,
  KINDS,
  type LineFilters,
} from "@/lib/places/filters";
import type { ResultLine } from "@/lib/places/search";

export type PlacesSection = ExplorerSection<ResultLine, LineFilters>;

/** `zones` feeds the zone dropdown; the report table and sort queue, which have none, pass none. */
export function placesSection(zones: ZoneFacet[] = []): PlacesSection {
  return {
    source: "places",
    api: "/api/places",
    textApi: "lore",
    facetLabel: "Zone",
    // The count rides in the label: it is what makes one zone worth picking over another.
    facets: zones.map((zone) => ({ value: zone.mapID, label: `${zone.name} (${zone.lines})` })),
    chip: (line) => line.zoneName,
    shortText: true,
    labels: { name: "Subzone", text: "Lore", search: "Search lore, names, zones…" },
    ownLine: (line) => line.kind === "zone",
    // A place is named by its line's id.
    nameOf: (line) => ({ kind: line.kind, entityId: line.id }),
    filters: {
      fields: FIELDS,
      kinds: KINDS,
      fromParams: filtersFromParams,
      toParams: filterParams,
      activeCount: activeFilterCount,
    },
  };
}
