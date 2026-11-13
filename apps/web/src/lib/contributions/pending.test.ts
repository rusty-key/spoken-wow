import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LineState } from "./known";
import type { Contribution } from "./store";

const { listContributions, lineStates } = vi.hoisted(() => ({
  listContributions: vi.fn(),
  lineStates: vi.fn(),
}));

vi.mock("./store", () => ({ listContributions }));
vi.mock("./known", async (original) => ({ ...(await original<typeof import("./known")>()), lineStates }));

import { listedWithPending, pendingCounts } from "./pending";

const ERA = "1.15.7/61582";
const RETAIL = "12.0.5/66102";

function row(id: number, source: Contribution["source"], status: Contribution["status"], build = ERA): Contribution {
  return { id, source, status, build, locale: "ptBR" } as Contribution;
}

const MISSING: LineState = { kind: "missing" };
const KNOWN: LineState = { kind: "known", lineId: "q:1:accept" };
const CHANGED: LineState = { kind: "changed", wordings: [], closest: 0 };

/** A state per row, told apart by id so the test sees whether each stays with its own row. */
const STATES: Record<number, LineState> = { 1: MISSING, 2: CHANGED, 3: KNOWN, 4: MISSING, 5: MISSING };

const NEW_ROWS = [
  row(1, "quests", "new"),
  row(2, "readables", "new"),
  row(3, "quests", "new"),
  row(4, "places", "new"),
  row(5, "quests", "new", RETAIL),
];

const COUNTS = {
  sections: { quests: 1, readables: 1, places: 1 },
  quests: { contributions: 1, corrections: 0 },
  readables: { contributions: 0, corrections: 1 },
};

beforeEach(() => {
  vi.clearAllMocks();
  lineStates.mockImplementation(async (rows: Contribution[]) => rows.map((one) => STATES[one.id]));
  listContributions.mockImplementation(async (status: string, _lang: string, _sort: unknown, source?: string) =>
    status === "new"
      ? NEW_ROWS.filter((one) => !source || one.source === source)
      : [row(6, "quests", "accepted")].filter((one) => !source || one.source === source),
  );
});

describe("listedWithPending", () => {
  it("reads the new tab and the counts from one list and one lineStates", async () => {
    const sort = { column: "filed", direction: "asc" } as const;

    const { listed, states, pending } = await listedWithPending("new", "ptBR", sort, "quests");

    expect(listContributions).toHaveBeenCalledTimes(1);
    expect(listContributions).toHaveBeenCalledWith("new", "ptBR", sort);
    expect(lineStates).toHaveBeenCalledTimes(1);
    expect(listed.map((one) => one.id)).toEqual([1, 3, 5]);
    expect(states).toEqual([MISSING, KNOWN, MISSING]);
    expect(pending).toEqual(COUNTS);
  });

  it("counts what pendingCounts counts", async () => {
    const { pending } = await listedWithPending("new", "ptBR", undefined, "places");

    expect(pending).toEqual(await pendingCounts("ptBR"));
  });

  it("lists another status apart from the new rows it counts", async () => {
    const { listed, pending } = await listedWithPending("accepted", "ptBR", undefined, "quests");

    expect(listed.map((one) => one.id)).toEqual([6]);
    expect(pending).toEqual(COUNTS);
  });
});
