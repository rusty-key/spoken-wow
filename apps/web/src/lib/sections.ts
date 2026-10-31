/**
 * The sections of the site, declared once.
 *
 * Quests, places and readables share one take table, one queue, one report inbox and one take
 * layer, and every one of those needs to name a section. This used to be declared three
 * times -- by the queue, by the client-side generation types and by the reports module --
 * agreeing only by convention, and the take routes validated their input with the reports
 * feature's guard. Adding a section now means adding it here, and the type errors show
 * every place that has to decide what it does about it.
 *
 * Browser-safe on purpose: no server imports, so client components can use it directly.
 *
 * Not to be confused with `Source` in lib/line-fields.ts, which is a quest EVENT kind --
 * accept, progress, complete, gossip -- and nothing to do with sections.
 */
export const SOURCES = ["quests", "places", "readables", "bosses"] as const;

export type Source = (typeof SOURCES)[number];

export function isSource(value: unknown): value is Source {
  return typeof value === "string" && (SOURCES as readonly string[]).includes(value);
}
