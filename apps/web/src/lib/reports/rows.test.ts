/**
 * The regression this module exists for: the triage table used to copy the server's rows
 * into useState, so switching the filter re-rendered with new props and the old list. The
 * page looked frozen until a reload. Rows are derived from the server's list now, and the
 * only thing held locally is what this session resolved.
 */
import { describe, expect, it } from "vitest";

import { applyResolutions, groupByLine } from "./rows";
import type { Report } from "./reports";

function report(overrides: Partial<Report> = {}): Report {
  return {
    queue: "audio",
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

describe("applyResolutions", () => {
  it("hands back the server's rows, in the server's order", () => {
    const rows = [report({ id: 2 }), report({ id: 1 })];
    expect(applyResolutions(rows, {}).map((row) => row.id)).toEqual([2, 1]);
  });

  it("shows what this session resolved in place of the row it replaced", () => {
    const resolved = report({ status: "fixed", resolvedAt: "2026-09-02T00:00:00Z" });
    expect(applyResolutions([report()], { 1: resolved })[0]).toBe(resolved);
  });

  it("drops a resolution for a row the current filter does not show", () => {
    // Resolve one under "Open", then switch to "Fixed": the stale row must not reappear.
    expect(applyResolutions([report({ id: 5 })], { 1: report({ status: "fixed" }) })).toEqual([
      report({ id: 5 }),
    ]);
  });
});

describe("groupByLine", () => {
  it("puts every report about one line under it, in the server's order", () => {
    const groups = groupByLine([
      report({ id: 3 }),
      report({ id: 2, lineId: "q:10:complete", target: "quest/10/complete" }),
      report({ id: 1 }),
    ]);
    expect(groups.map((group) => group.reports.map((row) => row.id))).toEqual([[3, 1], [2]]);
  });

  it("keeps the same line id in two sections apart", () => {
    const groups = groupByLine([report({ id: 2, source: "places" }), report({ id: 1 })]);
    expect(groups).toHaveLength(2);
  });

  it("groups reports with no line id by the address they came in on", () => {
    const gossip = { lineId: null, target: "npc/5678" };
    const groups = groupByLine([report({ id: 2, ...gossip }), report({ id: 1, ...gossip })]);
    expect(groups.map((group) => group.reports.length)).toEqual([2]);
  });

  it("never groups a report that names neither a line nor an address", () => {
    const project = { lineId: null, target: null };
    const groups = groupByLine([report({ id: 2, ...project }), report({ id: 1, ...project })]);
    expect(groups).toHaveLength(2);
  });
});
