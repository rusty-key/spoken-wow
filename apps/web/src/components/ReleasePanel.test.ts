import { describe, expect, it } from "vitest";

import type { RunView } from "@/lib/releases/sections";

import { outcomeText } from "./ReleasePanel";

const run = (patch: Partial<RunView>): RunView => ({ section: "places", lang: "deDE", state: "done", own: true, ...patch });

describe("outcomeText", () => {
  it("tells a team its version waits for review, was not approved and why, or was delisted", () => {
    expect(outcomeText(run({ state: "awaiting_review", version: "1.0.1" }))).toBe("Waiting for a site owner to review it.");
    expect(outcomeText(run({ state: "rejected", reviewNote: "the takes clip" }))).toBe("Not approved: the takes clip");
    expect(outcomeText(run({ kind: "delist", state: "done" }))).toBe("Delisted by a site owner.");
  });

  it("says what a release did", () => {
    expect(outcomeText(run({ version: "1.2.0" }))).toBe("Released 1.2.0.");
    expect(outcomeText(run({ state: "failed", error: "Cancelled" }))).toBe("Nothing was released: Cancelled");
  });
});
