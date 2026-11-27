/** The same shape the "team"."slug" check enforces. Its own module, not admin.ts: the browser reads it too. */
const SLUG = /^[a-z][a-z0-9-]{1,40}$/;

/** Whether `value` is shaped like a team's slug. */
export function isSlug(value: string): boolean {
  return SLUG.test(value);
}

/**
 * English's first team. Every new team starts from its roster and a language nobody voices yet reads
 * its settings, so it cannot be deleted; English's other teams can.
 */
export const BASE_TEAM_SLUG = "english";
