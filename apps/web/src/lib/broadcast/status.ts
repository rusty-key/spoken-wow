/**
 * How sure we are which BroadcastText ids a gossip line speaks, for the explorer's filter.
 *
 * Its own module, free of the database, because the search bar is a client component.
 */
export const BROADCAST_STATUSES = ["extract", "text", "none"] as const;
export type BroadcastStatus = (typeof BROADCAST_STATUSES)[number];

export const BROADCAST_OPTIONS = [
  { value: "extract", label: "from game data" },
  { value: "text", label: "by text only" },
  { value: "none", label: "no id" },
] as const satisfies readonly { value: BroadcastStatus; label: string }[];
