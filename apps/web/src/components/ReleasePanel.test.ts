import { describe, expect, it } from "vitest";

import type { ReleaseView, RunView } from "@/lib/releases/sections";

import { outcomeText, ownRun, queuedRun } from "./ReleasePanel";

const run = (patch: Partial<RunView>): RunView => ({ section: "places", lang: "deDE", state: "done", own: true, ...patch });

describe("outcomeText", () => {
  it("tells a team its version waits for review, was not approved and why, or was delisted", () => {
    expect(outcomeText(run({ state: "awaiting_review", version: "1.0.1" }))).toBe("Waiting for a site owner to review it.");
    expect(outcomeText(run({ state: "rejected", reviewNote: "the takes clip" }))).toBe("Not approved: the takes clip");
    expect(outcomeText(run({ kind: "delist", state: "done" }))).toBe("Delisted by a site owner.");
    expect(outcomeText(run({ state: "approved", version: "1.0.1" }))).toBe("Approved by a site owner; being listed.");
  });

  it("does not say a pack was delisted when the delisting failed or was cancelled", () => {
    expect(outcomeText(run({ kind: "delist", state: "failed", error: "Cancelled" }))).toBe("A site owner's delisting did not go through.");
  });

  it("says what a release did", () => {
    expect(outcomeText(run({ version: "1.2.0" }))).toBe("Released 1.2.0.");
    expect(outcomeText(run({ state: "failed", error: "Cancelled" }))).toBe("Nothing was released: Cancelled");
  });
});

const view = (patch: Partial<ReleaseView>): ReleaseView => ({ active: null, recent: [], released: {}, onDroplet: true, pending: {}, ...patch });

describe("the team's own runs", () => {
  it("takes a site owner's queued delisting for neither the team's queued release nor one it may cancel", () => {
    const delist = run({ id: "d", kind: "delist", state: "queued" });
    expect(queuedRun(view({ recent: [delist] }), "deDE", "places")).toBeNull();
    const own = run({ id: "r", kind: "release", state: "queued" });
    expect(queuedRun(view({ recent: [delist, own] }), "deDE", "places")).toBe(own);
  });

  it("does not show a site owner's delisting as the team releasing", () => {
    expect(ownRun(view({ active: run({ kind: "delist", state: "running" }) }), "deDE")).toBeNull();
    const release = run({ kind: "release", state: "running" });
    expect(ownRun(view({ active: release }), "deDE")).toBe(release);
  });
});
