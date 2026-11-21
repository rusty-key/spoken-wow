/**
 * How the Users page is ordered, as the `sort` and `dir` query parameters. Shared by the
 * server, which orders a global admin's pages, and the table, which orders a language
 * admin's list itself.
 */

export const USER_SORT_COLUMNS = ["name", "email", "joined", "languages"] as const;

export type UserSortColumn = (typeof USER_SORT_COLUMNS)[number];

export type UserSort = { column: UserSortColumn; direction: "asc" | "desc" };

/** Oldest first, as the list always was. */
export const DEFAULT_USER_SORT: UserSort = { column: "joined", direction: "asc" };

export function userSortOf(column: unknown, direction: unknown): UserSort {
  if (!USER_SORT_COLUMNS.includes(column as UserSortColumn)) return DEFAULT_USER_SORT;
  return { column: column as UserSortColumn, direction: direction === "desc" ? "desc" : "asc" };
}

/** A click on the column in force flips it; on another, sorts by that one ascending. */
export function nextUserSort(current: UserSort, column: UserSortColumn): UserSort {
  if (current.column !== column) return { column, direction: "asc" };
  return { column, direction: current.direction === "asc" ? "desc" : "asc" };
}

/** The Users page's query string: what is left out is the default (no search, first page). */
export function usersQuery({ q, sort, page }: { q: string; sort: UserSort; page?: number }): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (sort.column !== DEFAULT_USER_SORT.column || sort.direction !== DEFAULT_USER_SORT.direction) {
    params.set("sort", sort.column);
    params.set("dir", sort.direction);
  }
  if (page && page > 1) params.set("page", String(page));
  return `?${params}`;
}
