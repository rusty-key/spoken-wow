/**
 * The query string /reports/[section] reads, and the rules that turn the stored reports into
 * one page of it: what a search matches, the order and the page.
 *
 * Node-free, like reports.ts: ReportTable is a client component and builds its links here.
 */
import type { Source } from "@/lib/sections";

import { groupByLine, type ReportGroup } from "./rows";
import { STATUSES, type Category, type Report, type Status } from "./reports";

/**
 * The inbox's tabs. Not the contributions sections: a boss can be reported but not contributed
 * to, and a report filed under a source with no tab could never be read.
 */
export const SECTIONS = ["quests", "readables", "places", "bosses"] as const satisfies readonly Source[];

export type Section = (typeof SECTIONS)[number];

export function isSection(value: unknown): value is Section {
  return SECTIONS.includes(value as Section);
}

export type StatusView = Status | "all";

export const STATUS_VIEWS: readonly StatusView[] = [...STATUSES, "all"];

export function isStatusView(value: unknown): value is StatusView {
  return STATUS_VIEWS.includes(value as StatusView);
}

/** Case-blind substring over everything a triager can read on the row, address included. */
export function matchesReportSearch(report: Report, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [report.body, report.lineId, report.target, report.name, report.email].some((field) =>
    (field ?? "").toLowerCase().includes(needle),
  );
}

export type SortDirection = "asc" | "desc";

/**
 * Lines in the order of their reports' dates, each line's reports kept together under it.
 *
 * Grouping after sorting puts a line where its newest report falls when newest come first,
 * and where its oldest falls when oldest do: the one a triager working that end of the queue
 * reaches first.
 */
export function sortedGroups(reports: Report[], direction: SortDirection): ReportGroup[] {
  const sign = direction === "asc" ? 1 : -1;
  const sorted = [...reports].sort(
    (a, b) => sign * (Date.parse(a.createdAt) - Date.parse(b.createdAt)) || sign * (a.id - b.id),
  );
  return groupByLine(sorted);
}

/** Lines per page. A page never splits a line's reports, so it is counted in lines. */
export const PAGE_SIZE = 50;

export function pageOf(value: unknown): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export type ReportFilters = {
  section: Section;
  view: StatusView;
  category: Category | "all";
  q: string;
  dir: SortDirection;
};

/**
 * The href for `current` with `next` applied. A change starts from the first page, since the
 * page it was on may not exist in the new view. Defaults stay out of the query, so the plain
 * /reports/quests is the open queue, newest first.
 */
export function reportsHref(current: ReportFilters, next: Partial<ReportFilters>, page = 1): string {
  const filters = { ...current, ...next };
  const params = new URLSearchParams();
  if (filters.view !== "open") params.set("view", filters.view);
  if (filters.category !== "all") params.set("category", filters.category);
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.dir !== "desc") params.set("dir", filters.dir);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/reports/${filters.section}${query ? `?${query}` : ""}`;
}
