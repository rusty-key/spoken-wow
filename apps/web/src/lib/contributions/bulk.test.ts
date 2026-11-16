import { describe, expect, it } from "vitest";

import { bulkHold, bulkHoldSummary } from "./bulk";

const row = { status: "new", bucket: "ready", bulk: true, matchKind: undefined } as const;

describe("bulkHold", () => {
  it("holds nothing back from a ready row a bulk accept may take", () => {
    expect(bulkHold(row)).toBeNull();
    expect(bulkHold({ ...row, matchKind: "translation" })).toBeNull();
  });

  it("names why a row is left out", () => {
    expect(bulkHold({ ...row, status: "accepted" })).toBe("accepted");
    expect(bulkHold({ ...row, bucket: "blocked" })).toBe("speaker");
    expect(bulkHold({ ...row, bulk: false, matchKind: "ambiguous" })).toBe("ambiguous");
    expect(bulkHold({ ...row, bulk: false, matchKind: "known" })).toBe("known");
    expect(bulkHold({ ...row, bulk: false, matchKind: "correction" })).toBe("correction");
    expect(bulkHold({ ...row, bulk: false, matchKind: "new-book" })).toBe("new-book");
  });
});

describe("bulkHoldSummary", () => {
  it("says nothing when every row is taken", () => {
    expect(bulkHoldSummary([null, null])).toBeNull();
  });

  it("counts each reason", () => {
    expect(bulkHoldSummary(["speaker", null, "ambiguous", "speaker"])).toBe("Left out: 2 no speaker yet, 1 no page picked");
  });
});
