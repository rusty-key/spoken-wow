/**
 * class-words.ts, against a real Postgres.
 *
 * Needs DATABASE_URL and migrations applied. The quest line is made by the test itself, under a
 * quest id far past any real one, and torn down after.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb } from "@/lib/db";
import { asSystem } from "@/lib/teams/testing";

import { keepClassWords, markClassWord } from "./class-words";
import type { Submission } from "./contributions";
import { dedupOf } from "./submission";

const MARKER = "test-contributions-class-words";
const quest = 1_900_000_000 - Math.floor(Math.random() * 1_000_000);
const lineId = `q:${quest}:accept`;
const ip = `test-${Math.random().toString(36).slice(2, 10)}`;
const CORPUS = "There's a priest out in the mountains.$B$BBring him these candles, $c.";
const SENT = "There's a $c out in the mountains. Bring him these candles, $c, if you're going that way.";
const RESTORED = "There's a priest out in the mountains. Bring him these candles, $c, if you're going that way.";

function submission(text: string): Submission {
  const key = `${quest}:accept`;
  return {
    source: "quests",
    key,
    locale: "enUS",
    build: "1.15.7/0",
    text,
    meta: { quest: String(quest), event: "accept", title: "Test" },
    raw: "raw",
    dedup: dedupOf("quests", key, "enUS", text),
  };
}

async function waiting(text: string): Promise<number> {
  const { rows } = await asSystem.query<{ id: number }>(
    `insert into "contribution" ("source", "key", "locale", "raw", "dedup", "text", "ip", "meta")
     values ('quests', $1, 'enUS', 'raw', $2, $3, $4, $5::jsonb) returning "id"`,
    [
      `${quest}:accept`,
      `${ip}-${Math.random().toString(36).slice(2, 10)}`,
      text,
      ip,
      JSON.stringify({ quest: String(quest), event: "accept", title: "Test" }),
    ],
  );
  return rows[0].id;
}

beforeAll(async () => {
  await asSystem.query(
    `insert into "user" ("id", "name", "email", "emailVerified") values ($1, 'Test Marker', $2, false)
     on conflict ("id") do nothing`,
    [MARKER, `${MARKER}@example.invalid`],
  );
  await asSystem.query(
    `insert into "quest_line"
       ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "fileName",
        "text", "originalText", "localeText", "questId")
     values ($1, 0, 'enUS', 1, true, 'extracted', 'accept', $2, 'unused', $3, null, $4)`,
    [lineId, `${quest}-accept`, CORPUS, quest],
  );
});

afterAll(async () => {
  await asSystem.query(
    `delete from "activity" where "kind" = 'contribution.edited'
        and "subject" in (select "id"::text from "contribution" where "ip" = $1)`,
    [ip],
  );
  await asSystem.query(`delete from "contribution" where "ip" = $1`, [ip]);
  await asSystem.query(`delete from "quest_class_word" where "questId" = $1`, [quest]);
  await asSystem.query(`delete from "quest_line" where "lineId" = $1`, [lineId]);
  await asSystem.query(`delete from "user" where "id" = $1`, [MARKER]);
  await closeDb();
});

describe("class words", () => {
  it("leaves the slot on a quest nobody marked", async () => {
    const [kept] = await keepClassWords([submission(SENT)]);
    expect(kept.text).toBe(SENT);
  });

  it("marking puts the word back in waiting rows, and intake puts it back after", async () => {
    const id = await waiting(SENT);
    const outcome = await markClassWord(id, true, MARKER);
    expect(outcome).toEqual({ ok: true, questId: quest, texts: { [id]: RESTORED } });
    const { rows } = await asSystem.query<{ text: string }>(`select "text" from "contribution" where "id" = $1`, [id]);
    expect(rows[0].text).toBe(RESTORED);

    const [kept] = await keepClassWords([submission(SENT)]);
    expect(kept.text).toBe(RESTORED);
    expect(kept.dedup).toBe(submission(RESTORED).dedup);
  });

  it("unmarking stops the restoring", async () => {
    const id = await waiting(SENT);
    expect(await markClassWord(id, false, MARKER)).toEqual({ ok: true, questId: quest, texts: {} });
    const [kept] = await keepClassWords([submission(SENT)]);
    expect(kept.text).toBe(SENT);
  });
});
