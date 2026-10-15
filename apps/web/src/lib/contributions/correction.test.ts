/**
 * correction.ts, against a real Postgres.
 *
 * Needs DATABASE_URL and migrations applied. The quest lines are made by the test itself, under
 * a quest id far past any real one, and torn down after with everything accepting wrote.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";

import { acceptCorrection, correctionNote } from "./correction";
import { lineStates } from "./known";

const ACCEPTER = "test-contributions-correction";
const quest = 2_000_000_000 - Math.floor(Math.random() * 1_000_000);
const lineId = `q:${quest}:accept`;
const file = `quests/${quest}-accept.mp3`;
const ip = `test-${Math.random().toString(36).slice(2, 10)}`;
// A plain line the site wrote, a moment already split by player gender, and an extracted plain line.
const contributedQuest = quest - 1;
const splitQuest = quest - 2;
const extractedQuest = quest - 3;
const quests = [quest, contributedQuest, splitQuest, extractedQuest];
const moments = quests.map((q) => `q:${q}:accept`);
const linesOf = (q: number) => [`q:${q}:accept`, `q:${q}:accept:m`, `q:${q}:accept:f`];

async function contribution(locale: string, text: string, event = "accept", questId = quest): Promise<number> {
  const { rows } = await db().query<{ id: number }>(
    `insert into "contribution" ("source", "key", "locale", "raw", "dedup", "text", "ip", "meta")
     values ('quests', $1, $2, 'raw', $3, $4, $5, $6::jsonb) returning "id"`,
    [
      `${questId}:${event}`,
      locale,
      `${ip}-${Math.random().toString(36).slice(2, 10)}`,
      text,
      ip,
      JSON.stringify({ quest: String(questId), event, title: "Test" }),
    ],
  );
  return rows[0].id;
}

beforeAll(async () => {
  await db().query(
    `insert into "user" ("id", "name", "email", "emailVerified")
     values ($1, 'Test Accepter', $2, false)
     on conflict ("id") do nothing`,
    [ACCEPTER, `${ACCEPTER}@example.invalid`],
  );
  await db().query(
    `insert into "quest_line"
       ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "fileName",
        "text", "originalText", "localeText")
     values ($1, 0, 'enUS', 1, true, 'extracted', 'accept', $2, 'Hello, adventurer.', 'Hello, $n.', null),
            ($1, 0, 'deDE', 1, true, 'extracted', 'accept', $2, 'Hallo, $N.', 'Hello, $n.', 'Hallo, $N.')`,
    [lineId, `${quest}-accept`],
  );
  await db().query(
    `insert into "quest_line"
       ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "fileName",
        "text", "originalText", "localeText")
     values ($1, 0, 'enUS', 1, true, 'contributed', 'accept', $2, 'Well met, lass.', 'Well met, lass.', null),
            ($3, 0, 'enUS', 1, true, 'extracted', 'accept', $4, 'Well met, lass.', 'Well met, lass.', null)`,
    [moments[1], `${contributedQuest}-accept`, moments[3], `${extractedQuest}-accept`],
  );
  await db().query(
    `insert into "quest_line"
       ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "playerGender", "fileName",
        "text", "originalText", "localeText")
     values ($1 || ':m', 0, 'enUS', 1, true, 'extracted', 'accept', 'm', 'm-' || $2, 'Hail, lad.', 'Hail, $glad:lass;.', null),
            ($1 || ':f', 0, 'enUS', 1, true, 'extracted', 'accept', 'f', 'f-' || $2, 'Hail, lass.', 'Hail, $glad:lass;.', null)`,
    [moments[2], `${splitQuest}-accept`],
  );
  await db().query(
    `insert into "quest_line_speaker"
       ("lineId", "variant", "lang", "ord", "npcType", "npcId", "npcName", "race", "gender", "flavor", "voice")
     select $1, 0, 'enUS', greatest(coalesce(max("ord") + 1, 0), 1000000), 'creature', 2104, 'Test Speaker',
            'dwarf', 'male', null, 'dwarf-male'
       from "quest_line_speaker" where "lang" = 'enUS'`,
    [moments[1]],
  );
});

afterAll(async () => {
  await db().query(
    `delete from "activity" where "lineId" = $1
        or ("kind" = 'contribution.resolved'
            and "subject" in (select "id"::text from "contribution" where "ip" = $2))`,
    [lineId, ip],
  );
  const lines = quests.flatMap(linesOf);
  await db().query(`delete from "activity" where "lineId" = any($1::text[])`, [lines]);
  await db().query(`delete from "activity" where "kind" = 'override.set' and "subject" like any($1::text[])`, [
    quests.map((q) => `%${q}-accept.mp3`),
  ]);
  await db().query(`delete from "quest_line_speaker" where "lineId" = any($1::text[])`, [lines]);
  await db().query(`delete from "contribution" where "ip" = $1`, [ip]);
  await db().query(`delete from "line_override" where "lineId" = any($1::text[])`, [lines]);
  await db().query(`delete from "quest_line" where "lineId" = any($1::text[])`, [lines]);
  await db().query(`delete from "user" where "id" = $1`, [ACCEPTER]);
  await closeDb();
});

describe("acceptCorrection", () => {
  it("writes an English correction as the line's spoken override and accepts it", async () => {
    const id = await contribution("enUS", "Greetings, $N.");
    const outcome = await acceptCorrection(id, ACCEPTER);
    expect(outcome.ok && outcome.contribution.status).toBe("accepted");

    const { rows } = await db().query(`select "lineId", "text" from "line_override" where "file" = $1`, [file]);
    expect(rows).toEqual([{ lineId, text: "Greetings, Adventurer." }]);

    const { rows: logged } = await db().query(
      `select "detail" from "activity" where "kind" = 'override.set' and "subject" = $1`,
      [file],
    );
    expect(logged[0].detail.contribution).toBe(id);

    // The printed text is untouched, so the row is still a correction.
    const [state] = await lineStates([{ source: "quests", locale: "enUS", text: "Greetings, $N.", meta: { quest: String(quest), event: "accept" } }]);
    expect(state.kind).toBe("changed");
  });

  it("writes a translation's correction as a new version, noted as one", async () => {
    const id = await contribution("deDE", "Guten Tag, $N.");
    const outcome = await acceptCorrection(id, ACCEPTER);
    expect(outcome.ok && outcome.contribution.status).toBe("accepted");

    const { rows } = await db().query(
      `select "version", "text", "localeText", "note" from "quest_line"
        where "lineId" = $1 and "lang" = 'deDE' and "isCurrent"`,
      [lineId],
    );
    expect(rows).toEqual([{ version: 2, text: "Guten Tag, $N.", localeText: "Hallo, $N.", note: correctionNote(id) }]);
  });

  it("splits a plain line the site wrote when the correction branches on $g", async () => {
    const id = await contribution("enUS", "Well met, $glad:lass;.", "accept", contributedQuest);
    const outcome = await acceptCorrection(id, ACCEPTER);
    expect(outcome.ok && outcome.contribution.status).toBe("accepted");

    const { rows } = await db().query(
      `select "lineId", "playerGender", "fileName", "text", "originalText", "origin", "generatable"
         from "quest_line" where "lineId" = any($1::text[]) and "lang" = 'enUS' and "isCurrent" order by "lineId"`,
      [linesOf(contributedQuest)],
    );
    const shared = { text: "Well met, $glad:lass;.", originalText: "Well met, $glad:lass;.", origin: "contributed", generatable: true };
    expect(rows).toEqual([
      { lineId: `${moments[1]}:f`, playerGender: "f", fileName: `f-${contributedQuest}-accept`, ...shared },
      { lineId: `${moments[1]}:m`, playerGender: "m", fileName: `m-${contributedQuest}-accept`, ...shared },
    ]);

    // The export joins speakers by line id, so each side carries its own.
    const { rows: speakers } = await db().query(
      `select "lineId", "npcId", "contributionId" from "quest_line_speaker" where "lineId" = any($1::text[]) order by "lineId"`,
      [linesOf(contributedQuest)],
    );
    expect(speakers).toEqual([
      { lineId: moments[1], npcId: 2104, contributionId: null },
      { lineId: `${moments[1]}:f`, npcId: 2104, contributionId: null },
      { lineId: `${moments[1]}:m`, npcId: 2104, contributionId: null },
    ]);

    const [state] = await lineStates([
      { source: "quests", locale: "enUS", text: "Well met, $glad:lass;.", meta: { quest: String(contributedQuest), event: "accept" } },
    ]);
    expect(state.kind).toBe("known");
  });

  it("overrides each side of a split moment in its reader's words", async () => {
    const id = await contribution("enUS", "Hail and well met, $glad:lass;.", "accept", splitQuest);
    const outcome = await acceptCorrection(id, ACCEPTER);
    expect(outcome.ok && outcome.contribution.status).toBe("accepted");

    const { rows } = await db().query(
      `select "lineId", "text" from "line_override" where "lineId" = any($1::text[]) order by "lineId"`,
      [linesOf(splitQuest)],
    );
    expect(rows).toEqual([
      { lineId: `${moments[2]}:f`, text: "Hail and well met, lass." },
      { lineId: `${moments[2]}:m`, text: "Hail and well met, lad." },
    ]);
  });

  it("refuses a correction without $g for a split moment, which is one reader's words", async () => {
    const id = await contribution("enUS", "Hail and well met, lad.", "accept", splitQuest);
    const outcome = await acceptCorrection(id, ACCEPTER);
    expect(!outcome.ok && outcome.reason).toBe("malformed");
  });

  it("refuses to split an extracted line, which the next import would bring back", async () => {
    const id = await contribution("enUS", "Well met, $glad:lass;.", "accept", extractedQuest);
    const outcome = await acceptCorrection(id, ACCEPTER);
    expect(!outcome.ok && outcome.reason).toBe("malformed");
    const { rows } = await db().query(
      `select "lineId" from "quest_line" where "lineId" = any($1::text[]) and "isCurrent"`,
      [linesOf(extractedQuest)],
    );
    expect(rows).toEqual([{ lineId: moments[3] }]);
  });

  it("refuses a contribution the corpus does not differ from", async () => {
    const id = await contribution("enUS", "Hello, $N.");
    const outcome = await acceptCorrection(id, ACCEPTER);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.reason).toBe("not-a-correction");
    const { rows } = await db().query(`select "status" from "contribution" where "id" = $1`, [id]);
    expect(rows[0].status).toBe("new");
  });

  it("answers not-found for an id that is not there", async () => {
    expect(await acceptCorrection(999_999_999, ACCEPTER)).toEqual({ ok: false, reason: "not-found" });
  });
});
