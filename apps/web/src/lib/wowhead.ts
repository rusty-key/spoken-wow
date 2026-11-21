/**
 * Links out to Wowhead's Forever database.
 *
 * `/forever/` is the branch the addon's clients run on. The bare `/quest=` path is retail, where
 * a vanilla quest may have been changed out of recognition or removed, and `/classic/` has never
 * heard of post-vanilla content such as NPC 205729, a quest-giver the corpus has no line for. Both
 * would mislead on exactly the lines worth looking up: the ones that look wrong here.
 *
 * `npcType` is the corpus's own word for which id space an entity lives in, and Wowhead
 * spells two of the three differently. Mapped in one place rather than at each call site,
 * because creature 68 is a Stormwind City Guard and gameobject 68 is a Wanted Poster - a
 * wrong segment silently opens the wrong page rather than a missing one.
 *
 * No node imports: the row renders in the browser.
 */
import type { NpcType } from "./line-fields";

const SEGMENT: Record<NpcType, string> = {
  creature: "npc",
  gameobject: "object",
  item: "item",
};

export function wowheadQuestUrl(questId: number): string {
  return `https://www.wowhead.com/forever/quest=${questId}`;
}

export function wowheadEntityUrl(npcType: NpcType, npcId: number): string {
  return `https://www.wowhead.com/forever/${SEGMENT[npcType]}=${npcId}`;
}
