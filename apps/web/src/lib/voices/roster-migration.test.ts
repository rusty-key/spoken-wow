/**
 * Migration 0071: the roster as data, gameobjects and items as types, and every speaker's NPC
 * on file. Needs DATABASE_URL and migrations applied.
 */
import { afterAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";

const set = (race: string, gender: string, ...flavors: (string | null)[]) =>
  flavors.map((flavor): [string, string, string | null] => [race, gender, flavor]);

/** voices.ts ROSTER on the day migration 0071 replaced it, narrator-male aside. */
const ROSTER: [string, string, string | null][] = [
  ...set("bloodelf", "female", null), ...set("bloodelf", "male", null),
  ...set("dwarf", "female", "guard", "maternal", "young"), ...set("dwarf", "male", "grim", "guard", "standard"),
  ...set("gnome", "female", "happy", "nerdy", "standard"), ...set("gnome", "male", "standard", "young", "zany"),
  ...set("goblin", "female", "zany"), ...set("goblin", "male", "gruff", "guard", "zany"),
  ...set("human", "female", "official", "standard", "warrior"), ...set("human", "male", "official", "standard", "warrior"),
  ...set("nightelf", "female", "priestess", "sentinel", "standard"), ...set("nightelf", "male", "official", "standard", "warrior"),
  ...set("orc", "female", "shaman", "standard", "warrior"), ...set("orc", "male", "guard", "shady", "standard"),
  ...set("scourge", "female", "magic", "standard", "warrior"), ...set("scourge", "male", "dark", "standard", "warrior"),
  ...set("skybourneelf", "female", "3773", "3774"), ...set("skybourneelf", "male", "3776", "3775"),
  ...set("tauren", "female", "official", "shaman", "standard"), ...set("tauren", "male", "elder", "shaman", "warrior"),
  ...set("troll", "female", "laidback", "old", "standard"), ...set("troll", "male", "dark", "shaman", "standard"),
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
