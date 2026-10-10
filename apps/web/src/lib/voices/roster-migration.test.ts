/**
 * Migration 0071: the roster as data, gameobjects and items as types, and every speaker's NPC
 * on file. Needs DATABASE_URL and migrations applied.
 */
import { afterAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";

/** voices.ts ROSTER on the day migration 0071 replaced it, narrator-male aside. */
const ROSTER: [string, string, string | null][] = [
  ["bloodelf", "female", null], ["bloodelf", "male", null],
  ...(["guard", "maternal", "young"].map((f) => ["dwarf", "female", f]) as [string, string, string][]),
  ...(["grim", "guard", "standard"].map((f) => ["dwarf", "male", f]) as [string, string, string][]),
  ...(["happy", "nerdy", "standard"].map((f) => ["gnome", "female", f]) as [string, string, string][]),
  ...(["standard", "young", "zany"].map((f) => ["gnome", "male", f]) as [string, string, string][]),
  ["goblin", "female", "zany"],
  ...(["gruff", "guard", "zany"].map((f) => ["goblin", "male", f]) as [string, string, string][]),
  ...(["official", "standard", "warrior"].map((f) => ["human", "female", f]) as [string, string, string][]),
  ...(["official", "standard", "warrior"].map((f) => ["human", "male", f]) as [string, string, string][]),
  ...(["priestess", "sentinel", "standard"].map((f) => ["nightelf", "female", f]) as [string, string, string][]),
  ...(["official", "standard", "warrior"].map((f) => ["nightelf", "male", f]) as [string, string, string][]),
  ...(["shaman", "standard", "warrior"].map((f) => ["orc", "female", f]) as [string, string, string][]),
  ...(["guard", "shady", "standard"].map((f) => ["orc", "male", f]) as [string, string, string][]),
  ...(["magic", "standard", "warrior"].map((f) => ["scourge", "female", f]) as [string, string, string][]),
  ...(["dark", "standard", "warrior"].map((f) => ["scourge", "male", f]) as [string, string, string][]),
  ["skybourneelf", "female", "3773"], ["skybourneelf", "female", "3774"],
  ["skybourneelf", "male", "3776"], ["skybourneelf", "male", "3775"],
  ...(["official", "shaman", "standard"].map((f) => ["tauren", "female", f]) as [string, string, string][]),
  ...(["elder", "shaman", "warrior"].map((f) => ["tauren", "male", f]) as [string, string, string][]),
  ...(["laidback", "old", "standard"].map((f) => ["troll", "female", f]) as [string, string, string][]),
  ...(["dark", "shaman", "standard"].map((f) => ["troll", "male", f]) as [string, string, string][]),
];

afterAll(closeDb);

const voiceFor = async (race: string, gender: string | null, flavor: string | null) =>
  (await db().query<{ v: string | null }>(`select voice_for($1, $2, $3) as v`, [race, gender, flavor])).rows[0].v;

describe("migration 0071", () => {
  it("seeds every ROSTER voice, each read by the combination of the same name", async () => {
    expect(ROSTER).toHaveLength(58);
    for (const [race, gender, flavor] of ROSTER) {
      expect(await voiceFor(race, gender, flavor)).toBe([race, gender, flavor].filter(Boolean).join("-"));
    }
  });

  it("keeps narrator a voice and not a type", async () => {
    const { rows } = await db().query(`select 1 from "race" where "key" = 'narrator'`);
    expect(rows).toHaveLength(0);
    const { rows: voices } = await db().query(`select "race", "gender" from "voice" where "name" = 'narrator-male'`);
    expect(voices).toEqual([{ race: "narrator", gender: "male" }]);
  });

  it("reads gameobject, item and creature with the narrator", async () => {
    for (const race of ["gameobject", "item", "creature"]) {
      expect(await voiceFor(race, null, null)).toBe("narrator-male");
    }
  });

  it("falls back from a flavor to its race-gender, then to the race", async () => {
    expect(await voiceFor("bloodelf", "female", null)).toBe("bloodelf-female");
    expect(await voiceFor("gameobject", null, "anything")).toBe("narrator-male");
    expect(await voiceFor("orc", "male", "nosuch")).toBeNull();
  });

  it("answers a model slot with itself", async () => {
    expect(await voiceFor("model-29", "male", null)).toBe("model-29");
  });

  it("leaves no NPC on narrator, and no generic type with a gender", async () => {
    const { rows } = await db().query(
      `select count(*)::int as n from "npc"
        where "race" = 'narrator' or ("race" in ('gameobject', 'item', 'creature') and "gender" is not null)`,
    );
    expect(rows[0].n).toBe(0);
  });

  it("gives every speaker's NPC an answer", async () => {
    const { rows } = await db().query(
      `select count(*)::int as n from "quest_line_speaker" s
        where s."race" is not null and s."race" <> ''
          and not exists (select 1 from "npc" n
                           where n."npcKind" = s."npcType" and n."npcId" = s."npcId"
                             and n."provenance" <> 'none')`,
    );
    expect(rows[0].n).toBe(0);
  });
});
