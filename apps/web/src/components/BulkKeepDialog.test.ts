import { describe, expect, it } from "vitest";

import { bulkKeepIds, type BulkKeepRow } from "./BulkKeepDialog";

const rows: BulkKeepRow[] = [
  { id: 1, count: 10, verdict: "clean" },
  { id: 2, count: 11, verdict: "drop" },
  { id: 3, count: 40, verdict: "fix" },
  { id: 4, count: 2, verdict: "clean" },
];

describe("bulkKeepIds", () => {
  it("keeps lines sent by more than the threshold, in any group", () => {
    expect(bulkKeepIds(rows, "confident", 10)).toEqual([2, 3]);
    expect(bulkKeepIds(rows, "confident", 1)).toEqual([1, 2, 3, 4]);
  });

  it("keeps only the lines that pass every check", () => {
    expect(bulkKeepIds(rows, "clean", 10)).toEqual([1, 4]);
  });
});
