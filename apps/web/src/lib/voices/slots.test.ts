import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";

import { isVoiceSlot, slots } from "./slots";
import { loadRoster } from "./roster-store";

describe("slots", () => {
  it("lists the roster", async () => {
    const names = (await slots("enUS")).map((s) => s.name);
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
    await db().query(
      `insert into "voice" ("name", "race", "gender", "teamId")
       values ($1, $1, '', (select "teamId" from "team_language" where "lang" = 'enUS' and "privileged"))`,
      [type],
    );
    try {
      const slot = (await slots("enUS")).find((s) => s.name === type);
      expect(slot).toEqual({ name: type, lineCount: 0, npcCount: 0 });
    } finally {
      await db().query(`delete from "voice" where "name" = $1`, [type]);
      await db().query(`delete from "race" where "key" = $1`, [type]);
    }
    // A race-gender with flavors is offered by its flavors, never bare.
    expect((await slots("enUS")).map((s) => s.name)).not.toContain("skybourneelf-female");
  });

  it("is exactly the roster's voices", async () => {
    const names = (await slots("enUS")).map((s) => s.name);
    expect([...names].sort()).toEqual([...(await loadRoster("enUS")).voiceNames].sort());
  });

  it("orders alphabetically", async () => {
    const names = (await slots("enUS")).map((s) => s.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("counts only generatable lines", async () => {
    // Progress text is never voiced, so a voice's line count must be below the raw total.
    const total = (await slots("enUS")).reduce((sum, s) => sum + s.lineCount, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(17792);
  });
});

describe("isVoiceSlot", () => {
  it("accepts every derived slot", async () => {
    for (const slot of (await slots("enUS"))) expect(await isVoiceSlot(slot.name, "enUS")).toBe(true);
  });

  it("refuses anything outside the set", async () => {
    expect(await isVoiceSlot("orc-mail", "enUS")).toBe(false);
    expect(await isVoiceSlot("", "enUS")).toBe(false);
  });

  // These are the reason the check is set membership rather than a regex: a slot name
  // becomes a path segment, so a traversal must fail on the same code path as a typo.
  it("refuses path traversal", async () => {
    expect(await isVoiceSlot("../audio", "enUS")).toBe(false);
    expect(await isVoiceSlot("../../etc/passwd", "enUS")).toBe(false);
    expect(await isVoiceSlot("/etc/passwd", "enUS")).toBe(false);
    expect(await isVoiceSlot("orc-male/../..", "enUS")).toBe(false);
    expect(await isVoiceSlot("orc-male%2f..", "enUS")).toBe(false);
  });
});
