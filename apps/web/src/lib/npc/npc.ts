/**
 * What an NPC kind and a provenance are, free of node imports -- as
 * lib/contributions/contributions.ts is for a contribution's own enums, and for the same
 * reason: ContributionTable.tsx is a client component and needs PROVENANCES to render
 * /contributions's provenance filter (finding 5), but store.ts imports `@/lib/db`, and pulling
 * a *value* (not just a type) out of a module that imports `pg` drags Postgres's own node
 * built-ins (fs, net, tls, dns) into the client bundle and fails the build. store.ts re-exports
 * everything here so every existing import site keeps working unchanged.
 */

// A tuple, not a bare union, for the same reason PROVENANCES below is one: "creature" or
// "gameobject" used to be spelled out separately in observedFrom's kind ternary, the npc
// route's KINDS set and this type, and npc id 0 diverging twice on this branch (once in each
// copy) is exactly the failure mode a single enumerable source of truth prevents.
export const NPC_KINDS = ["creature", "gameobject"] as const;
export type NpcKind = (typeof NPC_KINDS)[number];

// What an npc row can be: an item starts quests too, and has a type an admin answers for (it is
// read by a voice like anyone). Never what a client's envelope names, so NPC_KINDS stays apart.
export const NPC_ROW_KINDS = [...NPC_KINDS, "item"] as const;
export type NpcRowKind = (typeof NPC_ROW_KINDS)[number];

// The ceiling of the `integer` columns an NPC id lands in (migrations 0030 and 0048). Past it
// Postgres refuses the insert, so every path that takes an id from outside checks it first.
export const INT32_MAX = 2147483647;

// A tuple, not a bare type alias, so the union is enumerable at runtime -- the rank test in
// store.ts walks PROVENANCES rather than listing the four values by hand, which is what makes
// a fifth value added here without a matching rank in provenanceRank fail loudly instead of
// silently sorting as the lowest rank. Follows lib/contributions/contributions.ts's STATUSES
// pattern.
export const PROVENANCES = ["corpus", "display", "client", "moderator", "none"] as const;
export type Provenance = (typeof PROVENANCES)[number];

/** Matches lib/contributions/contributions.ts's isStatus, for /contributions's provenance filter. */
export function isProvenance(value: unknown): value is Provenance {
  return typeof value === "string" && (PROVENANCES as readonly string[]).includes(value);
}
