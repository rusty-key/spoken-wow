/**
 * The closed sets a corpus line's source and entity type are drawn from.
 *
 * A module of their own, free of node imports, because the filter bar offers them as
 * dropdown options and a client component cannot reach into lib/search.ts or lib/corpus.ts
 * for them - those read the corpus off disk, and importing them would drag node:fs into the
 * browser bundle. Same reasoning as the note atop lib/generation/client.ts.
 *
 * Unlike race and voice (lib/facets.ts) these are not derived from the corpus: they are
 * decided by the extractor, and a value outside them means the corpus is malformed rather
 * than that the game has something new in it.
 */
/** "followup" is what an NPC says in chat after a quest is accepted or turned in. */
export const SOURCES = ["accept", "progress", "complete", "gossip", "followup"] as const;
export const NPC_TYPES = ["creature", "gameobject", "item"] as const;

export type Source = (typeof SOURCES)[number];
export type NpcType = (typeof NPC_TYPES)[number];

/**
 * What the source filter shows for each value. The first four are words a reader already
 * knows and label themselves; "followup" is a frozen identifier (it names the corpus rows
 * and the followup/ folder) and reads as a typo in a dropdown, so it gets the spelling a
 * person would write. The URL keeps carrying the value, never the label.
 */
export const SOURCE_LABELS: Record<Source, string> = {
  accept: "accept",
  progress: "progress",
  complete: "complete",
  gossip: "gossip",
  followup: "follow-up",
};

/**
 * The two explorers the quests corpus is shown in. Gossip is an NPC talking with no quest
 * behind it, and is being split from quests entirely; every other source hangs off a quest.
 */
export const KINDS = ["quests", "gossip"] as const;

export type Kind = (typeof KINDS)[number];

export function kindOf(source: Source): Kind {
  return source === "gossip" ? "gossip" : "quests";
}
