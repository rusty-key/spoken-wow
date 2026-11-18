/** Browser-safe: a saved or removed override laid over an explorer's fetched rows. */
import type { OverrideView } from "./types";

type Row = { id: string; state: "missing" | "stale" | "current"; override: OverrideView | null };

/**
 * `rows` with the line's override set to `text`, or cleared for null. A row with a take reads
 * stale either way, because the take spoke something other than what the line says now; the
 * server's answer, fetched after, can bring an old take back to current.
 */
export function withTextOverride<R extends Row>(rows: R[], lineId: string, text: string | null): R[] {
  return rows.map((row) =>
    row.id === lineId
      ? {
          ...row,
          override: text === null ? null : { text, drifted: false, updatedAt: new Date().toISOString(), updatedBy: null },
          state: row.state === "missing" ? "missing" : "stale",
        }
      : row,
  );
}
