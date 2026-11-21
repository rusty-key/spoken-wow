import { npcKey, type CorpusLine } from "../corpus";

export type QuestZone = { uiMapID: number; name: string };

/**
 * A line is in each zone players met its speaker in (`sighted`, lib/quests/sightings.ts): a quest's
 * accept line where its giver stands, its complete line where its ender does. An item, which nobody
 * meets, is in none.
 */
export function zonesOf(
  line: Pick<CorpusLine, "npcType" | "npcId">,
  sighted?: ReadonlyMap<string, readonly number[]>,
): readonly number[] {
  return sighted?.get(npcKey(line)) ?? [];
}
