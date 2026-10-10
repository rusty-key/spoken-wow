/** Client-safe: the zone list is the explorers' filter options. */
import { ZONE_REGIONS, zoneAt } from "@tools/lib/zone-at.mjs";

import { npcKey } from "../corpus";
import type { NpcType } from "../line-fields";

export type Spawn = { npcType: string; npcId: number; map: number; x: number; y: number };

export type QuestZone = { uiMapID: number; name: string };

export const QUEST_ZONES: QuestZone[] = (ZONE_REGIONS as QuestZone[])
  .map(({ uiMapID, name }) => ({ uiMapID, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

/**
 * npcKey -> the zones its spawns stand in, in uiMapID order. A speaker with no spawn in any
 * zone (an item, an unspawned object) has no entry.
 */
export function zonesBySpeaker(spawns: Iterable<Spawn>): Map<string, number[]> {
  const sets = new Map<string, Set<number>>();
  for (const spawn of spawns) {
    const zone = zoneAt(spawn.map, spawn.x, spawn.y);
    if (zone === undefined) continue;
    const key = npcKey({ npcType: spawn.npcType as NpcType, npcId: spawn.npcId });
    const set = sets.get(key) ?? new Set<number>();
    set.add(zone);
    sets.set(key, set);
  }
  return new Map([...sets].map(([key, set]) => [key, [...set].sort((a, b) => a - b)]));
}
