import { describe, expect, it } from "vitest";

import { durationRatio, evidenceTable } from "./evidence";

// The manual trial on tauren-female-shaman v2: higher, smaller (F1 up) and slower than the reference.
const TAUREN = {
  reference: { f0Hz: 129, f1Hz: 481, h1h2Db: 9.1, durationSec: 7 },
  live: { f0Hz: 141, f1Hz: 520, durationSec: 4.4 },
  sample: { f0Hz: 167, f1Hz: 636, durationSec: 4.88 },
  label: "v2",
};

describe("evidenceTable", () => {
  it("puts the reference, the live take and the version side by side, with the duration ratio for the same text", () => {
    const table = evidenceTable(TAUREN);
    expect(table).toContain("| measure | reference (game) | live take | v2 |");
    expect(table).toContain("| F0, mean pitch (Hz) | 129 | 141 | 167 |");
    expect(table).toContain("| F1 (Hz) | 481 | 520 | 636 |");
    // Measured on one clip only: the others say so rather than vanish.
    expect(table).toContain("| H1-H2 (dB; high = breathy) | 9.1 | - | - |");
    expect(table).not.toContain("HNR");
    expect(table).toContain("v2 / live take: 1.11 (above 1 is slower)");
  });

  it("says nothing when nothing was measured", () => {
    expect(evidenceTable({ reference: null, live: null, sample: null, label: "v1" })).toBe("");
  });
});

describe("durationRatio", () => {
  it("needs both takes of the line", () => {
    expect(durationRatio({ live: { durationSec: 4 }, sample: { durationSec: 5 } })).toBe(1.25);
    expect(durationRatio({ live: null, sample: { durationSec: 5 } })).toBeNull();
  });
});
