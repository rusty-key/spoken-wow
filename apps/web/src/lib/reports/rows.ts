/**
 * What the triage table renders, given what the server sent and what this session did.
 *
 * A function rather than component state, because state was the bug: the table copied the
 * server's list into useState, and a filter link - which is a navigation, not a click
 * handler - re-rendered it with new props and the same stale copy. The list only caught up
 * on a reload. Deriving means the server's list always wins, and a resolution is an overlay
 * on top of it rather than a second source of truth.
 */
import type { Report } from "./reports";

export function applyResolutions(
  rows: Report[],
  resolved: Record<number, Report>,
): Report[] {
  return rows.map((row) => resolved[row.id] ?? row);
}

/** Every report about one line, newest first, under the key the table tracks it by. */
export type ReportGroup = { key: string; reports: Report[] };

/**
 * The triage list, one entry per line rather than per report.
 *
 * Three people reporting one line is the most useful signal the table carries (see
 * migration 0021), and as three rows scattered by date it read as three problems to answer
 * three times. Grouped, it is one line to listen to once, with its reports under it.
 *
 * Keyed on the line where the report resolved one, and on the raw address where it did
 * not - a gossip NPC reported twice before anyone picked a take is still one NPC. A report
 * about the project has neither and stands alone. Groups keep the order of their newest
 * report, which is the server's order, so the queue still reads newest first.
 */
export function groupByLine(rows: Report[]): ReportGroup[] {
  const groups = new Map<string, ReportGroup>();

  for (const row of rows) {
    const key = row.lineId
      ? `${row.source}:line:${row.lineId}`
      : row.target
        ? `${row.source}:target:${row.target}`
        : `report:${row.id}`;
    const group = groups.get(key);
    if (group) group.reports.push(row);
    else groups.set(key, { key, reports: [row] });
  }

  return [...groups.values()];
}
