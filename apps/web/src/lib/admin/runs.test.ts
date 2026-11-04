import { describe, expect, it } from "vitest";

import type { ActivityRow } from "@/lib/activity/store";

import { runsOf } from "./runs";

let id = 0;
function row(actorId: string, kind: ActivityRow["kind"], at: string, source: ActivityRow["source"] = "quests"): ActivityRow {
  return {
    id: String(++id),
    at,
    lang: "deDE",
    kind,
    source,
    subject: null,
    lineId: null,
    detail: {},
    actorId,
    actorName: actorId,
    subjectName: null,
  };
}

/** `n` rows a few seconds apart, newest first, ending at `end`. */
function burst(actorId: string, n: number, end: string): ActivityRow[] {
  return Array.from({ length: n }, (_, i) =>
    row(actorId, "take.generated", new Date(Date.parse(end) - i * 400).toISOString()),
  );
}

describe("runsOf", () => {
  it("folds 1,400 takes cut in a row into one run, and keeps what came before it", () => {
    const rows = [
      ...burst("laurenz", 1400, "2026-11-04T10:04:00Z"),
      row("ranfred", "release.finished", "2026-11-04T09:25:00Z", "places"),
    ];
    const runs = runsOf(rows, 6);
    expect(runs.map((r) => [r.row.actorId, r.count])).toEqual([
      ["laurenz", 1400],
      ["ranfred", 1],
    ]);
    expect(runs[0].from).toBe(rows[1399].at);
  });

  it("marks every run that may go on past the rows read, not only the last one", () => {
    const rows = [
      row("ranfred", "take.generated", "2026-11-04T10:04:00Z"),
      row("laurenz", "take.generated", "2026-11-04T10:03:00Z"),
      row("ranfred", "take.generated", "2026-11-04T10:02:00Z"),
      row("laurenz", "take.generated", "2026-11-04T10:01:00Z"),
    ];
    expect(runsOf(rows, 6, { more: true }).map((r) => r.atLeast)).toEqual([true, true]);
    expect(runsOf(rows, 6).map((r) => r.atLeast ?? false)).toEqual([false, false]);
  });

  it("keeps accepted and rejected contributions apart", () => {
    const accepted = { ...row("ranfred", "contribution.resolved", "2026-11-04T10:04:00Z"), detail: { status: "accepted" } };
    const rejected = { ...row("ranfred", "contribution.resolved", "2026-11-04T10:03:00Z"), detail: { status: "rejected" } };
    expect(runsOf([accepted, rejected], 6)).toHaveLength(2);
  });

  it("starts a new run after a pause, or for another person, kind or section", () => {
    const runs = runsOf(
      [
        row("laurenz", "take.generated", "2026-11-04T12:00:00Z"),
        row("laurenz", "take.generated", "2026-11-04T11:59:00Z"),
        row("laurenz", "take.generated", "2026-11-04T10:00:00Z"),
        row("laurenz", "take.generated", "2026-11-04T09:59:00Z", "places"),
        row("dosenblech", "take.generated", "2026-11-04T09:58:00Z", "places"),
      ],
      6,
    );
    expect(runs.map((r) => r.count)).toEqual([2, 1, 1, 1]);
  });

  it("stops at the limit", () => {
    const rows = ["a", "b", "c", "d"].map((who, i) => row(who, "take.generated", `2026-11-04T1${i}:00:00Z`));
    expect(runsOf(rows, 2)).toHaveLength(2);
  });

  it("keeps a person's run whole when somebody else's rows fall between", () => {
    const rows = [
      row("ranfred", "take.generated", "2026-11-04T10:04:00Z"),
      row("laurenz", "take.generated", "2026-11-04T10:03:30Z"),
      row("ranfred", "take.generated", "2026-11-04T10:03:00Z"),
      row("laurenz", "take.generated", "2026-11-04T10:02:30Z"),
      row("ranfred", "take.generated", "2026-11-04T10:02:00Z"),
    ];
    expect(runsOf(rows, 6).map((r) => [r.row.actorId, r.count])).toEqual([
      ["ranfred", 3],
      ["laurenz", 2],
    ]);
  });

  it("never folds acts that differ in what they were, such as grants", () => {
    const rows = [
      row("ranfred", "grant.added", "2026-11-04T10:04:00Z", null),
      row("ranfred", "grant.added", "2026-11-04T10:03:00Z", null),
    ];
    expect(runsOf(rows, 6).map((r) => r.count)).toEqual([1, 1]);
  });
});
