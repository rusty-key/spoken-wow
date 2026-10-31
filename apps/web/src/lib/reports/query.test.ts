import { describe, expect, it } from "vitest";

import { isSection, matchesReportSearch, reportsHref, sortedGroups, type ReportFilters } from "./query";
import type { Report } from "./reports";

function report(overrides: Partial<Report> = {}): Report {
  return {
    id: 1,
    source: "quests",
    lineId: "q:374:accept",
    target: "quest/374/accept",
    category: "pronunciation",
    body: "said it wrong",
    status: "open",
    userId: null,
    name: null,
    email: null,
    createdAt: "2026-09-01T00:00:00Z",
    resolvedAt: null,
    resolvedBy: null,
    context: null,
    ...overrides,
  };
}

describe("matchesReportSearch", () => {
  it("matches the body, the line and the sender, ignoring case", () => {
    const row = report({ name: "Thrall", email: "t@horde.example" });
    expect(matchesReportSearch(row, "SAID")).toBe(true);
    expect(matchesReportSearch(row, "374")).toBe(true);
    expect(matchesReportSearch(row, "thrall")).toBe(true);
    expect(matchesReportSearch(row, "jaina")).toBe(false);
  });

  it("matches everything on a blank search", () => {
    expect(matchesReportSearch(report(), "  ")).toBe(true);
  });
});

describe("sortedGroups", () => {
  const rows = [
    report({ id: 1, createdAt: "2026-09-01T00:00:00Z" }),
    report({ id: 2, lineId: "q:9:accept", createdAt: "2026-09-02T00:00:00Z" }),
    report({ id: 3, createdAt: "2026-09-03T00:00:00Z" }),
  ];

  it("puts a line where its newest report falls, newest first", () => {
    expect(sortedGroups(rows, "desc").map((group) => group.reports.map((row) => row.id))).toEqual([[3, 1], [2]]);
  });

  it("puts a line where its oldest report falls, oldest first", () => {
    expect(sortedGroups(rows, "asc").map((group) => group.reports.map((row) => row.id))).toEqual([[1, 3], [2]]);
  });
});

describe("reportsHref", () => {
  const current: ReportFilters = { section: "quests", view: "open", category: "all", q: "", dir: "desc" };

  it("leaves the defaults out", () => {
    expect(reportsHref(current, {})).toBe("/reports/quests");
  });

  it("keeps the other filters and drops the page on a change", () => {
    const filtered = { ...current, q: "thrall", dir: "asc" as const };
    expect(reportsHref(filtered, { section: "readables" })).toBe("/reports/readables?q=thrall&dir=asc");
    expect(reportsHref(filtered, {}, 3)).toBe("/reports/quests?q=thrall&dir=asc&page=3");
  });
});

describe("isSection", () => {
  it("has a tab for bosses, which takes reports but no contributions", () => {
    expect(isSection("bosses")).toBe(true);
    expect(isSection("gossip")).toBe(false);
  });
});
