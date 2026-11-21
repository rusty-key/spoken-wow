import { describe, expect, it } from "vitest";

import { patchRows } from "./row-refresh";

type Row = { id: string; key: string; v: number };

const row = (id: string, key: string, v = 0): Row => ({ id, key, v });
const patch = (rows: Row[], fresh: Record<string, Row[]>) =>
  patchRows(rows, new Map(Object.entries(fresh)), (r) => r.id, (r) => r.key);

describe("patchRows", () => {
  it("swaps a refreshed row in where it sat and leaves the rest alone", () => {
    const rows = [row("a", "a1"), row("b", "b1"), row("c", "c1")];
    const out = patch(rows, { b: [row("b", "b1", 1)] });
    expect(out.map((r) => [r.key, r.v])).toEqual([
      ["a1", 0],
      ["b1", 1],
      ["c1", 0],
    ]);
    expect(out[0]).toBe(rows[0]);
  });

  it("leaves the rows alone when nothing came back", () => {
    const rows = [row("a", "a1"), row("b", "b1")];
    expect(patch(rows, {})).toBe(rows);
  });

  it("drops a speaker the line no longer has", () => {
    const rows = [row("a", "a1"), row("a", "a2"), row("b", "b1")];
    expect(patch(rows, { a: [row("a", "a2", 1)] }).map((r) => r.key)).toEqual(["a2", "b1"]);
  });

  it("puts a speaker the line has gained after its last row", () => {
    const rows = [row("a", "a1"), row("b", "b1"), row("a", "a2"), row("c", "c1")];
    const out = patch(rows, { a: [row("a", "a1"), row("a", "a2"), row("a", "a3")] });
    expect(out.map((r) => r.key)).toEqual(["a1", "b1", "a2", "a3", "c1"]);
  });
});
