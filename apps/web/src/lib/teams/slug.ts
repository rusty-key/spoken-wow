/** The same shape the "team"."slug" check enforces. Its own module, not admin.ts: the browser reads it too. */
const SLUG = /^[a-z][a-z0-9-]{1,40}$/;

/** Whether `value` is shaped like a team's slug. */
export function isSlug(value: string): boolean {
  return SLUG.test(value);
}
