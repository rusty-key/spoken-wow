import { describe, expect, it } from "vitest";

import { withTextOverride } from "./rows";
import type { OverrideView } from "./types";

type Row = { id: string; state: "missing" | "stale" | "current"; override: OverrideView | null };

const rows: Row[] = [
  { id: "a", state: "current", override: null },
  { id: "b", state: "missing", override: null },
  { id: "c", state: "current", override: null },
];

describe("withTextOverride", () => {
  it("sets a current override on the one row and leaves the others as they were", () => {
    const out = withTextOverride(rows, "a", "Said otherwise.");
    expect(out[0]).toMatchObject({ id: "a", state: "stale", override: { text: "Said otherwise.", drifted: false } });
    expect(out[1]).toBe(rows[1]);
    expect(out[2]).toBe(rows[2]);
  });

  it("keeps a row with no take missing", () => {
    expect(withTextOverride(rows, "b", "Said otherwise.")[1].state).toBe("missing");
  });

  it("leaves the take's state on a Keep, which saves the words the take already speaks", () => {
    const kept: Row[] = [
      { id: "a", state: "current", override: { text: "Said.", drifted: true, updatedAt: "", updatedBy: null } },
    ];
    expect(withTextOverride(kept, "a", "Said.")[0]).toMatchObject({ state: "current", override: { drifted: false } });
  });

  it("clears the override on a removal, and the take reads stale until the server says otherwise", () => {
    const overridden = withTextOverride(rows, "c", "Said otherwise.");
    expect(withTextOverride(overridden, "c", null)[2]).toMatchObject({ override: null, state: "stale" });
  });
});
