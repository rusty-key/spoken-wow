/**
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";

import type { Submission } from "./contributions";
import { hitFrom, installIdFrom, missingAudioRanking, recordMissingAudio } from "./missing-audio";

const quest = 2_000_000_000 - Math.floor(Math.random() * 1_000_000);
const lineA = `q:${quest}:accept`;
const lineB = `q:${quest}:complete`;
// A language the other suites leave alone, so the ranking holds only this file's rows.
const lang = "ptBR";
const installs = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];

afterEach(async () => {
  await db().query(`delete from "missing_audio_hit" where "installId" = any($1::uuid[])`, [installs]);
  await db().query(`delete from "quest_line" where "lineId" = any($1::text[])`, [[lineA, lineB]]);
});

afterAll(async () => {
  await closeDb();
});

function submission(meta: Record<string, string>): Submission {
  return { source: "quests", key: "k", locale: "enUS", build: "", text: "x", meta, raw: "", dedup: "" };
}

describe("installIdFrom", () => {
  it("takes a v4 UUID, lowercased, and nothing else", () => {
    expect(installIdFrom("3F2504E0-4F89-41D3-9A0C-0305E82C3301")).toBe("3f2504e0-4f89-41d3-9a0c-0305e82c3301");
    expect(installIdFrom("3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBeNull();
    expect(installIdFrom("x")).toBeNull();
    expect(installIdFrom(7)).toBeNull();
  });
});

describe("hitFrom", () => {
  it("needs a pack language the site serves, and keeps a well-formed version only", () => {
    expect(hitFrom(submission({ pack: "deDE", packVersion: "2.3.0" }), "q:1:accept")).toEqual({
      lineId: "q:1:accept",
      packLang: "deDE",
      packVersion: "2.3.0",
    });
    expect(hitFrom(submission({ pack: "xxXX" }), "q:1:accept")).toBeNull();
    expect(hitFrom(submission({ pack: "deDE", packVersion: "a b" }), "q:1:accept")?.packVersion).toBeNull();
  });
});

describe("missingAudioRanking", () => {
  it("ranks lines by installs and says which the site has voiced", async () => {
    await db().query(
      `insert into "quest_line"
         ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId", "fileName", "text", "originalText")
       values ($1, 0, 'enUS', 1, true, 'extracted', 'accept', $2, $1, 'Kill six.', 'Kill six.')`,
      [lineA, quest],
    );
    await recordMissingAudio(installs[0]!, [
      { lineId: lineA, packLang: lang, packVersion: "1.0.0" },
      { lineId: lineB, packLang: lang, packVersion: "1.0.0" },
      // The same line twice in one upload is one row.
      { lineId: lineA, packLang: lang, packVersion: "1.0.0" },
    ]);
    await recordMissingAudio(installs[1]!, [{ lineId: lineA, packLang: lang, packVersion: "none" }]);
    await recordMissingAudio(installs[2]!, [{ lineId: lineA, packLang: "deDE", packVersion: null }]);

    const rows = await missingAudioRanking(lang);
    expect(rows.map(({ lineId, installs, text, voiced }) => ({ lineId, installs, text, voiced }))).toEqual([
      { lineId: lineA, installs: 2, text: "Kill six.", voiced: false },
      { lineId: lineB, installs: 1, text: null, voiced: false },
    ]);
    expect([...rows[0]!.packVersions].sort()).toEqual(["1.0.0", "none"]);
  });

  it("leaves out a TBC line, which is nothing to do until the site voices TBC", async () => {
    // q:8326 is Sunstrider Isle: no Classic extract has it, so lib/quests/line-client.ts calls it TBC.
    const tbc = "q:8326:accept";
    await db().query(
      `insert into "quest_line"
         ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId", "fileName", "text", "originalText")
       values ($1, 0, 'enUS', 1, true, 'contributed', 'accept', 8326, $1, 'Welcome, magister.', 'Welcome, magister.'),
              ($2, 0, 'enUS', 1, true, 'extracted', 'accept', $3, $2, 'Kill six.', 'Kill six.')`,
      [tbc, lineA, quest],
    );
    // The catalogue lists a line through its speakers.
    await db().query(
      `insert into "quest_line_speaker" ("lineId", "variant", "lang", "ord", "npcType", "npcId", "npcName", "race", "gender", "voice")
       values ($1, 0, 'enUS', 1000000, 'creature', 15278, 'Magistrix Erona', 'bloodelf', 'female', 'bloodelf-female')`,
      [tbc],
    );
    try {
      await recordMissingAudio(installs[0]!, [
        { lineId: tbc, packLang: lang, packVersion: "1.0.0" },
        { lineId: lineA, packLang: lang, packVersion: "1.0.0" },
      ]);
      expect((await missingAudioRanking(lang)).map((row) => row.lineId)).toEqual([lineA]);
    } finally {
      await db().query(`delete from "quest_line_speaker" where "lineId" = $1`, [tbc]);
      await db().query(`delete from "quest_line" where "lineId" = $1`, [tbc]);
    }
  });

  it("ranks progress text like any other line", async () => {
    // q:179:progress comes from the seeded corpus, which already lists it through its speakers.
    await db().query(
      `insert into "quest_line"
         ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId", "fileName", "text", "originalText")
       values ($1, 0, 'enUS', 1, true, 'extracted', 'accept', $2, $1, 'Kill six.', 'Kill six.')`,
      [lineA, quest],
    );
    await recordMissingAudio(installs[0]!, [
      { lineId: "q:179:progress", packLang: lang, packVersion: "1.0.0" },
      { lineId: "q:179:progress", packLang: lang, packVersion: "1.0.0" },
      { lineId: lineA, packLang: lang, packVersion: "1.0.0" },
    ]);
    await recordMissingAudio(installs[1]!, [{ lineId: "q:179:progress", packLang: lang, packVersion: "1.0.0" }]);
    expect((await missingAudioRanking(lang)).map((row) => row.lineId)).toEqual(["q:179:progress", lineA]);
  });
});
