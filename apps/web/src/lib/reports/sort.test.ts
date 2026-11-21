import { describe, expect, it } from "vitest";

import type { Report } from "./reports";
import { queueCounts, sortQueue } from "./sort";

let nextId = 1;

function report(lineId: string | null, createdAt: string, extra: Partial<Report> = {}): Report {
  return {
    queue: "audio",
    id: nextId++,
    source: "quests",
    lineId,
    target: null,
    category: "pronunciation",
    body: "",
    status: "open",
    userId: null,
    name: null,
    email: null,
    createdAt,
    resolvedAt: null,
    resolvedBy: null,
    context: null,
    ...extra,
  };
}

const keys = (reports: Report[], skipped = new Set<number>()) =>
  sortQueue(reports, skipped).map((group) => group.reports[0].lineId);

describe("sortQueue", () => {
  it("puts the most reported line first, then the longest waiting", () => {
    const reports = [
      report("q:1:accept", "2026-10-03"),
      report("q:2:accept", "2026-10-02"),
      report("q:2:accept", "2026-10-04"),
      report("q:3:accept", "2026-10-01"),
    ];
    expect(keys(reports)).toEqual(["q:2:accept", "q:3:accept", "q:1:accept"]);
  });

  it("leaves out answered reports", () => {
    const reports = [report("q:1:accept", "2026-10-01", { status: "fixed" }), report("q:2:accept", "2026-10-02")];
    expect(keys(reports)).toEqual(["q:2:accept"]);
  });

  it("hides a line only while all its open reports are skipped", () => {
    const first = report("q:1:accept", "2026-10-01");
    const other = report("q:2:accept", "2026-10-02");
    expect(keys([first, other], new Set([first.id]))).toEqual(["q:2:accept"]);

    const newer = report("q:1:accept", "2026-10-05");
    expect(keys([first, newer, other], new Set([first.id]))).toEqual(["q:1:accept", "q:2:accept"]);
  });

  it("queues gossip with quests", () => {
    expect(keys([report("g:abc", "2026-10-01"), report("q:1:accept", "2026-10-02")])).toEqual([
      "g:abc",
      "q:1:accept",
    ]);
  });
});

describe("queueCounts", () => {
  it("counts lines, not reports", () => {
    const a = report("q:1:accept", "2026-10-01");
    const reports = [a, report("q:1:accept", "2026-10-02"), report("q:2:accept", "2026-10-02")];
    expect(queueCounts(reports, new Set())).toEqual({ left: 2, skipped: 0 });
    expect(queueCounts([a, reports[2]], new Set([a.id]))).toEqual({ left: 1, skipped: 1 });
  });
});
