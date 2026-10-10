import { describe, expect, it } from "vitest";

import { isVoiceSlot, slots } from "./slots";
import { loadRoster } from "./roster-store";

describe("slots", () => {
  it("lists the roster", async () => {
    const names = (await slots()).map((s) => s.name);
    expect(names).toContain("orc-male-shady");
    expect(names).toContain("narrator-male");
    // A name becomes a path segment: dash-joined lowercase words and digits, as migration 0071's
    // voice table checks. A genderless type's voice has no gender in its name.
    for (const name of names) expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("offers a voice the corpus does not speak yet, so it can be cloned first", async () => {
    // The corpus picks up a voice as contributions are accepted -- all four Skybourne sets
    // speak since the 2.1.0 packs -- so this names the one roster voice no line has reached.
    // Move it to another silent voice when this one starts speaking.
    const slot = (await slots()).find((s) => s.name === "bloodelf-male");
    expect(slot).toEqual({ name: "bloodelf-male", lineCount: 0, npcCount: 0 });
    // A race-gender with flavors is offered by its flavors, never bare.
    expect((await slots()).map((s) => s.name)).not.toContain("skybourneelf-female");
  });

  it("is exactly the roster's voices", async () => {
    const names = (await slots()).map((s) => s.name);
    expect([...names].sort()).toEqual([...(await loadRoster()).voiceNames].sort());
  });

  it("orders alphabetically", async () => {
    const names = (await slots()).map((s) => s.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("counts only generatable lines", async () => {
    // Progress text is never voiced, so a voice's line count must be below the raw total.
    const total = (await slots()).reduce((sum, s) => sum + s.lineCount, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(17792);
  });
});

describe("isVoiceSlot", () => {
  it("accepts every derived slot", async () => {
    for (const slot of (await slots())) expect(await isVoiceSlot(slot.name)).toBe(true);
  });

  it("refuses anything outside the set", async () => {
    expect(await isVoiceSlot("orc-mail")).toBe(false);
    expect(await isVoiceSlot("")).toBe(false);
  });

  // These are the reason the check is set membership rather than a regex: a slot name
  // becomes a path segment, so a traversal must fail on the same code path as a typo.
  it("refuses path traversal", async () => {
    expect(await isVoiceSlot("../audio")).toBe(false);
    expect(await isVoiceSlot("../../etc/passwd")).toBe(false);
    expect(await isVoiceSlot("/etc/passwd")).toBe(false);
    expect(await isVoiceSlot("orc-male/../..")).toBe(false);
    expect(await isVoiceSlot("orc-male%2f..")).toBe(false);
  });
});
