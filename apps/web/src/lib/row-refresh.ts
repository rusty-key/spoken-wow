/**
 * Fresh copies of the rows an action touched, laid into the page where they already sit.
 *
 * Shared by the three explorers. Re-running the page's search after a regeneration, a
 * restore or a speaker change rebuilt the whole table, and a row the action moved out of the
 * filter - a missing line that now has audio, a dirty one just re-rolled - vanished from under
 * the person who acted on it. A page is a snapshot until its filters or its page change; only
 * the rows that changed move, and they stay put.
 */

/**
 * Each id's rows, asked for one id at a time (every search route takes `line=`). An id whose
 * request failed or came back empty is left out, so its rows keep what they showed.
 */
export async function fetchRows<T>(url: (id: string) => string, ids: Iterable<string>): Promise<Map<string, T[]>> {
  const fresh = new Map<string, T[]>();
  await Promise.all(
    [...new Set(ids)].map(async (id) => {
      const response = await fetch(url(id)).catch(() => null);
      const body = response?.ok ? ((await response.json().catch(() => null)) as { lines?: T[] } | null) : null;
      if (body?.lines?.length) fresh.set(id, body.lines);
    }),
  );
  return fresh;
}

/**
 * `rows` with every refreshed id's rows swapped for their fresh copies, in place. A row the
 * line no longer has (a speaker taken off) goes; one it has gained (a speaker added) follows
 * the line's last row.
 */
export function patchRows<T>(
  rows: T[],
  fresh: Map<string, T[]>,
  idOf: (row: T) => string,
  keyOf: (row: T) => string,
): T[] {
  if (!fresh.size) return rows;
  const last = new Map<string, number>();
  const known = new Set<string>();
  rows.forEach((row, index) => {
    last.set(idOf(row), index);
    known.add(keyOf(row));
  });

  return rows.flatMap((row, index) => {
    const id = idOf(row);
    const lines = fresh.get(id);
    if (!lines) return [row];
    const same = lines.filter((line) => keyOf(line) === keyOf(row));
    const added = last.get(id) === index ? lines.filter((line) => !known.has(keyOf(line))) : [];
    return [...same, ...added];
  });
}
