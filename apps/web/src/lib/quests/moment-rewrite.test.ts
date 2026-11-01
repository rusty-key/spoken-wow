/**
 * moment-rewrite.ts, against a real Postgres, as the explorer's override dialog calls it.
 *
 * Needs DATABASE_URL and migrations applied. The quest line is made by the test itself, under a
 * quest id far past any real one, and torn down after with everything the split wrote.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";
import { asSystem } from "@/lib/teams/testing";

import { momentLines, rewriteMoment } from "./moment-rewrite";

const EDITOR = "test-quests-moment-rewrite";
const quest = 2_000_000_000 - Math.floor(Math.random() * 1_000_000);
const moment = `q:${quest}:accept`;
const lines = [moment, `${moment}:m`, `${moment}:f`];

beforeAll(async () => {
  await asSystem.query(
    `insert into "user" ("id", "name", "email", "emailVerified")
     values ($1, 'Test Editor', $2, false)
     on conflict ("id") do nothing`,
    [EDITOR, `${EDITOR}@example.invalid`],
  );
  await asSystem.query(
    `insert into "quest_line"
       ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "fileName",
        "text", "originalText", "localeText")
     values ($1, 0, 'enUS', 1, true, 'extracted', 'accept', $2, 'Well met, adventurer.', 'Well met, $n.', null)`,
    [moment, `${quest}-accept`],
  );
  await asSystem.query(
    `insert into "quest_line_speaker"
       ("lineId", "variant", "lang", "ord", "npcType", "npcId", "npcName", "race", "gender", "flavor", "voice")
     select $1, 0, 'enUS', greatest(coalesce(max("ord") + 1, 0), 1000000), 'creature', 2104, 'Test Speaker',
            'dwarf', 'male', null, 'dwarf-male'
       from "quest_line_speaker" where "lang" = 'enUS'`,
    [moment],
  );
});

afterAll(async () => {
  await asSystem.query(`delete from "activity" where "lineId" = any($1::text[])`, [lines]);
  await asSystem.query(`delete from "activity" where "kind" = 'override.set' and "subject" like $1`, [`%${quest}-accept.mp3`]);
  await asSystem.query(`delete from "quest_line_speaker" where "lineId" = any($1::text[])`, [lines]);
  await asSystem.query(`delete from "line_override" where "lineId" = any($1::text[])`, [lines]);
  await asSystem.query(`delete from "quest_line" where "lineId" = any($1::text[])`, [lines]);
  await asSystem.query(`delete from "user" where "id" = $1`, [EDITOR]);
  await closeDb();
});

describe("momentLines", () => {
  it("finds the moment from a voice's line id", async () => {
    const found = await momentLines("enUS", `${moment}~gnome-male`, 0);
    expect(found.map((row) => row.lineId)).toEqual([moment]);
  });
});

describe("rewriteMoment", () => {
  it("splits an extracted plain line into each reader's words, keeping what it prints", async () => {
    const outcome = await rewriteMoment("enUS", await momentLines("enUS", moment, 0), 0, {
      text: "Well met, $glad:lass;.",
      userId: EDITOR,
    });
    expect(outcome.split).toBe(true);

    const { rows } = await asSystem.query(
      `select "lineId", "fileName", "text", "originalText", "origin", "editedBy"
         from "quest_line" where "lineId" = any($1::text[]) and "lang" = 'enUS' and "isCurrent" order by "lineId"`,
      [lines],
    );
    const shared = { originalText: "Well met, $n.", origin: "edited", editedBy: EDITOR };
    expect(rows).toEqual([
      { lineId: `${moment}:f`, fileName: `f-${quest}-accept`, text: "Well met, lass.", ...shared },
      { lineId: `${moment}:m`, fileName: `m-${quest}-accept`, text: "Well met, lad.", ...shared },
    ]);

    const { rows: speakers } = await asSystem.query(
      `select "lineId" from "quest_line_speaker" where "lineId" = any($1::text[]) order by "lineId"`,
      [lines],
    );
    expect(speakers.map((row) => row.lineId)).toEqual([moment, `${moment}:f`, `${moment}:m`]);
  });

  it("in another language, splits a plain line through that language's own text", async () => {
    await asSystem.query(
      `insert into "quest_line"
         ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "fileName",
          "playerGender", "text", "originalText")
       select "lineId", 0, 'deDE', 1, true, 'extracted', 'accept', "fileName", "playerGender",
              'Seid gegrüßt, $n.', 'Well met, $n.'
         from "quest_line" where "lineId" = $1 and "lang" = 'enUS' and "version" = 1`,
      [moment],
    );
    const { files } = await rewriteMoment("deDE", await momentLines("deDE", moment, 0), 0, {
      text: "Seid gegrüßt, $n, $gmein Herr:meine Dame;.",
      userId: EDITOR,
    });
    expect(files.length).toBe(2);
    const { rows } = await asSystem.query(
      `select "lineId", "text" from "quest_line"
        where "lineId" = any($1::text[]) and "lang" = 'deDE' and "isCurrent" order by "lineId"`,
      [lines],
    );
    expect(rows.map((row) => row.lineId)).toEqual([`${moment}:f`, `${moment}:m`]);
  });

  it("then overrides each side in its reader's words", async () => {
    const outcome = await rewriteMoment("enUS", await momentLines("enUS", moment, 0), 0, {
      text: "Hail, $gbrother:sister;.",
      userId: EDITOR,
    });
    expect(outcome.split).toBe(false);

    const { rows } = await asSystem.query(
      `select "lineId", "text" from "line_override" where "lineId" = any($1::text[]) order by "lineId"`,
      [lines],
    );
    expect(rows).toEqual([
      { lineId: `${moment}:f`, text: "Hail, sister." },
      { lineId: `${moment}:m`, text: "Hail, brother." },
    ]);
  });
});
