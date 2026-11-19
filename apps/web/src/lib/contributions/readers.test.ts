/**
 * readers.ts through intake, against a real Postgres.
 *
 * Needs DATABASE_URL and migrations applied. The quest lines are made by the test itself, under
 * quest ids far past any real one, and torn down after.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";

import type { Submission } from "./contributions";
import { intakeStates } from "./intake";
import { readerKey, readersOf } from "./readers";

const quest = 2_000_000_000 - Math.floor(Math.random() * 1_000_000);
const lineId = `q:${quest}:accept`;
const other = `q:${quest}:complete`;

async function line(id: string, text: string, version = 1, isCurrent = true) {
  await db().query(
    `insert into "quest_line"
       ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId", "fileName",
        "text", "originalText", "localeText")
     values ($1, 0, 'enUS', $2, $3, 'extracted', split_part($1, ':', 3), $4, $1, $5, $5, null)`,
    [id, version, isCurrent, quest, text],
  );
}

function copy(event: string, text: string, readerSex?: string): Submission {
  const meta: Record<string, string> = { quest: String(quest), event, title: "Test" };
  if (readerSex) meta.readerSex = readerSex;
  return { source: "quests", key: `${quest}:${event}`, locale: "enUS", build: "", text, meta, raw: "", dedup: "" };
}

async function readBy(id: string): Promise<string[]> {
  return (await readersOf([{ lineId: id, variant: 0, lang: "enUS" }])).get(readerKey("enUS", id, 0)) ?? [];
}

beforeAll(async () => {
  await line(lineId, "'Ey boss-mon, ya need help?");
  await line(other, "Old words.", 1, false);
  await line(other, "Good work.", 2);
});

afterAll(async () => {
  await db().query(`delete from "quest_line" where "lineId" = any($1::text[])`, [[lineId, other]]);
  await closeDb();
});

describe("intakeStates", () => {
  it("records the gender of each reader whose copy says what the line says", async () => {
    await intakeStates([copy("accept", "'Ey boss-mon, ya need help?", "2")]);
    expect(await readBy(lineId)).toEqual(["m"]);
  });

  it("records nothing for a copy that differs, or that says no gender", async () => {
    await intakeStates([copy("accept", "'Ey boss-lady, ya need help?", "3"), copy("accept", "'Ey boss-mon, ya need help?")]);
    expect(await readBy(lineId)).toEqual(["m"]);
  });

  it("gathers both genders, from one file or several, each once", async () => {
    await intakeStates([copy("complete", "Good work.", "3"), copy("complete", "Good work.", "2"), copy("complete", "Good work.", "3")]);
    await intakeStates([copy("complete", "Good work.", "2")]);
    expect(await readBy(other)).toEqual(["f", "m"]);
  });

  it("marks only the line's current version", async () => {
    const { rows } = await db().query<{ readerGenders: string[] }>(
      `select "readerGenders" from "quest_line" where "lineId" = $1 and not "isCurrent"`,
      [other],
    );
    expect(rows[0].readerGenders).toEqual([]);
  });
});
