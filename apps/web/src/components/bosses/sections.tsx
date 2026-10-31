import type { ExplorerSection } from "@/components/explorer/section";
import WowheadLink from "@/components/WowheadLink";
import type { InstanceFacet } from "@/lib/bosses/catalogue";
import { activeFilterCount, FIELDS, filterParams, filtersFromParams, type LineFilters } from "@/lib/bosses/filters";
import type { ResultLine } from "@/lib/bosses/search";
import { wowheadEntityUrl } from "@/lib/wowhead";

export type BossesSection = ExplorerSection<ResultLine, LineFilters>;

/**
 * `instances` feeds the instance dropdown. Its count is the bosses with a story in the page's
 * language out of all of them, so an instance waiting to be written reads as such.
 */
export function bossesSection(instances: InstanceFacet[] = []): BossesSection {
  return {
    source: "bosses",
    api: "/api/bosses",
    textApi: "story",
    facetLabel: "Instance",
    facets: instances.map((instance) => ({
      value: instance.map,
      label: `${instance.name} (${instance.written}/${instance.count})`,
    })),
    chip: (line) => line.instanceName,
    shortText: false,
    labels: { name: "Boss", text: "Story", search: "Search stories, bosses, instances…" },
    // Names live in entity_name under the boss id, which the line id does not carry.
    nameOf: (line) => ({ kind: "boss", entityId: String(line.bossId) }),
    detail: (line) => (
      <>
        map {line.mapID}
        {line.encounterIds.length > 0 &&
          ` · encounter${line.encounterIds.length > 1 ? "s" : ""} ${line.encounterIds.join(", ")}`}
        {line.creatureId !== null && (
          <>
            {" "}
            · npc {line.creatureId} <WowheadLink href={wowheadEntityUrl("creature", line.creatureId)} />
          </>
        )}
      </>
    ),
    filters: {
      fields: FIELDS,
      kinds: [],
      fromParams: filtersFromParams,
      toParams: filterParams,
      activeCount: activeFilterCount,
    },
  };
}
