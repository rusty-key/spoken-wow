import { describe, expect, it } from "vitest";

import { confidentIds, parseThreshold, type BulkKeepRow } from "./BulkKeepDialog";

const rows: BulkKeepRow[] = [
  { id: 1, count: 10 },
  { id: 2, count: 11 },
  { id: 3, count: 40 },
  { id: 4, count: 2 },
];

describe("confidentIds", () => {
  it("keeps lines sent by more than the threshold, not by exactly it", () => {
    expect(confidentIds(rows, 10)).toEqual([2, 3]);
    expect(confidentIds(rows, 1)).toEqual([1, 2, 3, 4]);
  });
});

describe("parseThreshold", () => {
  it("selects nothing while the box is empty, zero or not a whole number", () => {
    for (const typed of ["", " ", "0", "-3", "2.5", "1e1"]) expect(parseThreshold(typed), typed).toBeNull();
  });

  it("reads a whole number of at least 1", () => {
    expect(parseThreshold("1")).toBe(1);
    expect(parseThreshold("10")).toBe(10);
  });
});
