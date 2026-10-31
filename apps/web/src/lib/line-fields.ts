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
/**
 * "followup" is what an NPC says in chat after a quest is accepted or turned in; "chatter" is
 * what an NPC says in chat with no quest behind it.
 */
export const SOURCES = ["accept", "progress", "complete", "gossip", "followup", "chatter"] as const;
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
  chatter: "NPC chat",
};

/**
 * The source filter off a query string: `source=accept,gossip`, comma-separated so a link made
 * when it took one value still reads. Unknown values are dropped, and none left is no filter.
 */
export function sourcesFromParam(value: string | null): Source[] | undefined {
  const sources = listParam(value, SOURCES);
  return sources.length ? sources : undefined;
}

/** A comma-separated query parameter, kept to `allowed` and in its order; anything else is dropped. */
export function listParam<T extends string>(value: unknown, allowed: readonly T[]): T[] {
  const picked = typeof value === "string" ? value.split(",") : [];
  return allowed.filter((option) => picked.includes(option));
}
