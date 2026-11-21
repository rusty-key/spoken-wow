/**
 * The sorting queue at /reports/sort: one section's open reports as lines to answer, one at
 * a time.
 *
 * Node-free, like query.ts: the queue is walked in the browser.
 */
import { groupByLine, type ReportGroup } from "./rows";
import type { Report } from "./reports";

/** A line is hidden while every open report on it is one this person skipped. */
function openLines(reports: Report[], skipped: ReadonlySet<number>): { group: ReportGroup; hidden: boolean }[] {
  return groupByLine(reports.filter((report) => report.status === "open")).map((group) => ({
    group,
    hidden: group.reports.every((report) => skipped.has(report.id)),
  }));
}

/**
 * Skipped lines left out, so a new report on one puts it back. The lines most people
 * complained about come first; between equals, the one whose reporter has waited longest.
 */
export function sortQueue(reports: Report[], skipped: ReadonlySet<number>): ReportGroup[] {
  return openLines(reports, skipped)
    .filter((line) => !line.hidden)
    .map(({ group }) => ({
      group,
      oldest: Math.min(...group.reports.map((report) => Date.parse(report.createdAt))),
    }))
    .sort((a, b) => b.group.reports.length - a.group.reports.length || a.oldest - b.oldest)
    .map(({ group }) => group);
}

/** What a section's tile on the picker says: lines left to sort, and lines put aside. */
export function queueCounts(
  reports: Report[],
  skipped: ReadonlySet<number>,
): { left: number; skipped: number } {
  const lines = openLines(reports, skipped);
  const hidden = lines.filter((line) => line.hidden).length;
  return { left: lines.length - hidden, skipped: hidden };
}
