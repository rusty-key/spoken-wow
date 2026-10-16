import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";

import { isVoiceSlot, slots } from "./slots";
import { loadRoster } from "./roster-store";
import { COMBAT_VOICES } from "@/lib/combat/catalogue";

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
    // A voice of its own: every roster voice speaks once contributions reach it.
    const type = "tsilentslot";
    await db().query(`insert into "race" ("key") values ($1)`, [type]);
    await db().query(`insert into "voice" ("name", "race", "gender") values ($1, $1, '')`, [type]);
    try {
      const slot = (await slots()).find((s) => s.name === type);
      expect(slot).toEqual({ name: type, lineCount: 0, npcCount: 0 });
    } finally {
      await db().query(`delete from "voice" where "name" = $1`, [type]);
      await db().query(`delete from "race" where "key" = $1`, [type]);
    }
    // A race-gender with flavors is offered by its flavors, never bare.
    expect((await slots()).map((s) => s.name)).not.toContain("skybourneelf-female");
  });

  it("includes the roster and all player combat voices", async () => {
    const names = (await slots()).map((s) => s.name);
    expect([...names].sort()).toEqual([...new Set([...(await loadRoster()).voiceNames, ...COMBAT_VOICES.map((voice) => voice.id)])].sort());
    expect((await slots()).find((slot) => slot.name === "nightelf-female-player")).toEqual({
      name: "nightelf-female-player", lineCount: 8, npcCount: 0,
    });
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
