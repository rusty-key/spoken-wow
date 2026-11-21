import zonesFile from "@quests-corpus/zones.json";

import { npcKey, type CorpusLine } from "../corpus";

export type QuestZone = { uiMapID: number; name: string };

/** pipelines/quests/corpus/zones.json, written by `make quests-zones`. */
export type ZonesFile = {
  zones: QuestZone[];
  quests: Record<string, number[]>;
  speakers: Record<string, number[]>;
};

const FILE = zonesFile as ZonesFile;

/** By name, and only the zones some quest or speaker is in, so no choice selects nothing. */
export const QUEST_ZONES: readonly QuestZone[] = FILE.zones;

/**
 * A quest's line is in the zones its quest log files it under, as the Compendium has them. Gossip,
 * and a quest filed under a class or a profession, is wherever its speaker stands: where the map
 * files place its spawns, and where players met it (`sighted`, lib/quests/sightings.ts), which
 * reaches the NPCs the dump never spawned.
 */
export function zonesOf(
  line: Pick<CorpusLine, "questId" | "npcType" | "npcId">,
  file: ZonesFile = FILE,
  sighted?: ReadonlyMap<string, readonly number[]>,
): number[] {
  const quest = line.questId !== null ? file.quests[line.questId] : undefined;
  if (quest) return quest;
  const key = npcKey(line);
  const placed = file.speakers[key] ?? [];
  const seen = sighted?.get(key);
  return seen ? [...new Set([...placed, ...seen])] : placed;
}
