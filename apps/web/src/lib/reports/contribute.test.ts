/**
 * contribute.ts, against a real Postgres.
 *
 * Needs DATABASE_URL and migrations applied. The quest line is made by the test itself, under a
 * quest id far past any real one, and torn down after with everything accepting wrote.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";
import { asSystem } from "@/lib/teams/testing";

import { contributeReport, reportContribution, reportSubmission } from "./contribute";
import type { Report } from "./reports";

const ACCEPTER = "test-reports-contribute";
const quest = 2_000_000_000 - Math.floor(Math.random() * 1_000_000);
const lineId = `q:${quest}:complete`;
const file = `quests/${quest}-complete.mp3`;

/** What the addon sent with the report: no npc, so storing it resolves nobody. */
const fields = {
  addon: "SpokenQuests/3.5.0",
  build: "1.15.7/70450",
  locale: "enUS",
  quest: String(quest),
  event: "complete",
  title: "Return to Test",
};

async function report(text: string | null, source: Report["source"] = "quests"): Promise<Report> {
  const { rows } = await asSystem.query<Report>(
    `insert into "report" ("source", "lang", "lineId", "target", "category", "body", "context", "teamId")
     values ($1, 'enUS', $2, $2, 'wrong_text', 'This is the correct completion text.', $3::jsonb,
             team_of_lang('enUS'))
     returning "id", "source", "lineId", "target", "category", "body", "status", "userId", "name",
               "email", "createdAt"::text, null as "resolvedAt", "resolvedBy", "context"`,
    [source, lineId, JSON.stringify({ fields, text })],
  );
  return rows[0];
}

beforeAll(async () => {
  await asSystem.query(
    `insert into "user" ("id", "name", "email", "emailVerified")
     values ($1, 'Test Accepter', $2, false)
     on conflict ("id") do nothing`,
    [ACCEPTER, `${ACCEPTER}@example.invalid`],
  );
  await asSystem.query(
    `insert into "quest_line"
       ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId", "fileName",
        "text", "originalText", "localeText")
     values ($1, 0, 'enUS', 1, true, 'extracted', 'complete', $3, $2, 'Hello, adventurer.', 'Hello, $n.', null)`,
    [lineId, `${quest}-complete`, quest],
  );
});

afterAll(async () => {
  await asSystem.query(
    `delete from "activity"
      where "lineId" = $1
         or ("kind" = 'override.set' and "subject" = $2)
         or ("kind" = 'contribution.resolved'
             and "subject" in (select "id"::text from "contribution" where "key" like $3))
         or ("kind" = 'report.resolved' and "subject" in (select "id"::text from "report" where "lineId" = $1))`,
    [lineId, file, `${quest}:%`],
  );
  await asSystem.query(`delete from "contribution" where "key" like $1`, [`${quest}:%`]);
  await asSystem.query(`delete from "report" where "lineId" = $1`, [lineId]);
  await asSystem.query(`delete from "line_override" where "lineId" = $1`, [lineId]);
  await asSystem.query(`delete from "quest_line" where "lineId" = $1`, [lineId]);
  await asSystem.query(`delete from "user" where "id" = $1`, [ACCEPTER]);
  await closeDb();
});

describe("reportSubmission", () => {
  it("refuses a report whose addon sent no text", async () => {
    expect(typeof reportSubmission(await report(null))).toBe("string");
  });

  it("refuses a places report, whose addon has no text to send", async () => {
    expect(typeof reportSubmission({ ...(await report("Hello.")), source: "places" })).toBe("string");
  });

  it("keys the text on the quest and moment the addon named", async () => {
    const submission = reportSubmission(await report("Greetings, $N."));
    expect(typeof submission !== "string" && [submission.key, submission.locale]).toEqual([
      `${quest}:complete`,
      "enUS",
    ]);
  });
});

describe("reportContribution", () => {
  it("shows other text for a moment the corpus has as a correction, stored nowhere yet", async () => {
    const submission = reportSubmission(await report("Well met, $N."));
    if (typeof submission === "string") throw new Error(submission);
    expect(await reportContribution(submission)).toEqual({
      locale: "enUS",
      text: "Well met, $N.",
      state: { kind: "changed", wordings: [{ lineId, variant: 0, before: "Hello, adventurer." }], closest: 0 },
      stored: null,
    });
  });

  it("shows a moment the corpus lacks as a contribution", async () => {
    const filed = await report("Hello.");
    const submission = reportSubmission({
      ...filed,
      context: { fields: { ...fields, event: "accept" }, text: "Hello." },
    });
    if (typeof submission === "string") throw new Error(submission);
    expect((await reportContribution(submission)).state).toEqual({ kind: "missing" });
  });

  it("compares on the original, whatever a team's override says", async () => {
    await asSystem.query(
      `insert into "line_override" ("file", "lineId", "text", "teamId")
       values ($1, $2, 'Goodbye, friend.', team_of_lang('enUS'))`,
      [file, lineId],
    );
    try {
      const unchanged = reportSubmission(await report("Hello, $n."));
      if (typeof unchanged === "string") throw new Error(unchanged);
      expect((await reportContribution(unchanged)).state.kind).toBe("known");

      const overridden = reportSubmission(await report("Goodbye, friend."));
      if (typeof overridden === "string") throw new Error(overridden);
      expect((await reportContribution(overridden)).state.kind).toBe("changed");
    } finally {
      await asSystem.query(`delete from "line_override" where "file" = $1`, [file]);
    }
  });

  it("shows text the corpus already has as known", async () => {
    const submission = reportSubmission(await report("Hello, $n."));
    if (typeof submission === "string") throw new Error(submission);
    expect((await reportContribution(submission)).state).toEqual({ kind: "known", lineId: expect.any(String) });
  });
});

describe("contributeReport", () => {
  it("writes the text as the line's correction and answers the report Fixed", async () => {
    const filed = await report("Greetings, $N.");
    const submission = reportSubmission(filed);
    if (typeof submission === "string") throw new Error(submission);

    const outcome = await contributeReport(filed, "enUS", submission, ACCEPTER);
    expect(outcome.ok && [outcome.report.status, outcome.contribution.status]).toEqual(["fixed", "accepted"]);
    expect(outcome.ok && outcome.contribution.body).toBe(filed.body);

    const { rows } = await asSystem.query(
      `select "text" from "quest_line" where "lineId" = $1 and "lang" = 'enUS' and "isCurrent"`,
      [lineId],
    );
    expect(rows).toEqual([{ text: "Greetings, Adventurer." }]);
  });

  it("refuses text the line already speaks, and stores nothing", async () => {
    // The correction above is what the line speaks now.
    const filed = await report("Greetings, $N.");
    const submission = reportSubmission(filed);
    if (typeof submission === "string") throw new Error(submission);

    // Stored once already, by the accept above: refusing must not count it again.
    const count = async () =>
      (await asSystem.query(`select "count" from "contribution" where "dedup" = $1`, [submission.dedup])).rows[0]?.count;
    const before = await count();
    const outcome = await contributeReport(filed, "enUS", submission, ACCEPTER);
    expect(outcome.ok).toBe(false);
    expect(await count()).toBe(before);
  });
});
