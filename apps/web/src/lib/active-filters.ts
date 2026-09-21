/**
 * How many filters are narrowing the corpus.
 *
 * Its own module rather than a function in search.ts, because the search bar is a client
 * component and search.ts reaches the corpus, which reads from node:fs. Importing a value
 * from there pulls that whole graph into the browser bundle and the page stops building -
 * types are free to cross this line, runtime code is not. Same reason line-fields.ts exists.
 */
import type { LineFilters } from "./search";

/**
 * The free-text query counts. It narrows like the rest of them, so a "clear all" that left it
 * in force would answer a smaller corpus than the one it claims to have restored.
 *
 * `filter` does not count on its own: it says where the query is matched, so with no query
 * there is nothing for it to narrow. Clearing still resets it, because leaving "line text
 * only" behind would silently scope the next search someone types.
 */
export function activeFilterCount(filters: LineFilters): number {
  const query = filters.q?.trim();

  return [
    query,
    query && filters.filter && filters.filter !== "any" ? filters.filter : undefined,
    filters.missingOnly || undefined,
    filters.race,
    filters.gender,
    filters.flavor,
    filters.voice,
    filters.source,
    filters.npcType,
    filters.narration || undefined,
    filters.line,
    filters.overridden || undefined,
    filters.ignored || undefined,
    filters.outdated || undefined,
    filters.dirty || undefined,
    filters.reports,
    filters.generatedBefore,
    filters.generatedAfter,
  ].filter(Boolean).length;
}
