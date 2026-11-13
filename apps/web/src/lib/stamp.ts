/**
 * What a versioned table's rows are, as one comparable value, for memos that are validated
 * rather than invalidated (see lib/readables/catalogue.ts for why: two pm2 workers).
 *
 * Three terms because there are three ways such a table moves: an edit inserts a version, so
 * the highest id moves; an import can delete, so the count moves; a restore moves the live
 * flag between rows that already exist, which only the sum of live ids notices.
 *
 * A SQL fragment rather than a query, so a stamp over several tables -- another language is
 * read over English's rows and entity_name as well as its own -- is one round trip.
 */
export function versionStamp(table: string, where: string): string {
  return `(select coalesce(max("id"), 0) || ':' || count(*) || ':'
                  || coalesce(sum("id") filter (where "isCurrent"), 0)
             from "${table}" where ${where})`;
}

/** entity_name for one language's names of the given kinds. `$1` is the language. */
export function nameStamp(kinds: readonly string[]): string {
  return versionStamp(
    "entity_name",
    `"lang" = $1 and "kind" in (${kinds.map((kind) => `'${kind}'`).join(", ")})`,
  );
}

/**
 * book_page, which is not versioned: its count, its newest row, and a hash of every page's
 * place, so a page moved between books or made an alias moves the stamp as well as one added.
 */
export function bookPageStamp(): string {
  return `(select count(*) || ':' || coalesce(max("createdAt")::text, '') || ':' ||
                  coalesce(sum(hashtext("lineId" || '|' || coalesce("pageTextId"::text, '') || '|' ||
                                        "bookId" || '|' || "pageNumber" || '|' ||
                                        coalesce("aliasOf", '') || '|' || coalesce("ownerKind", '') || '|' ||
                                        coalesce("ownerIds"::text, '') || '|' ||
                                        coalesce("material"::text, ''))), 0)
             from "book_page")`;
}
