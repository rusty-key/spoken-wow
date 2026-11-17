/** Needs DATABASE_URL and migrations through 0113 applied. */
import { randomInt, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { asActor } from "@/lib/teams/acting";
import { forgetTeams } from "@/lib/teams/store";
import { asSystem, dropTeam, systemRows, testUser } from "@/lib/teams/testing";

import { viewersIn } from "@/lib/grants/store";

import {
  listReports, openReportCounts, reportById, reportPlace, reportsForLine, resetSkips, setQueue, setStatus,
  skippedIds, skipReports,
} from "./store";

const CAPITALS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

let lang: Lang;
let tag: string;
let teamA: string;
let teamB: string;
let m: Awaited<ReturnType<typeof testUser>>;
let t: Awaited<ReturnType<typeof testUser>>;
let a: Awaited<ReturnType<typeof testUser>>;
let textId: number;
let audioId: number;

async function newTeam(name: string, privileged: boolean): Promise<string> {
  const [row] = await systemRows<{ id: string }>(`select new_team($1, $1) as "id"`, [`${name}-${tag}`]);
  await asSystem.query(`insert into "team_language" ("teamId", "lang", "privileged") values ($1, $2, $3)`, [
    row.id, lang, privileged,
  ]);
  forgetTeams();
  return row.id;
}

async function file(category: string, queue: string, team = teamA): Promise<number> {
  const [row] = await systemRows<{ id: string }>(
    `insert into "report" ("source", "lang", "lineId", "category", "body", "queue", "teamId")
     values ('quests', $1, 'q:1:accept', $2, 'x', $3, $4) returning "id"::text as "id"`,
    [lang, category, queue, team],
  );
  return Number(row.id);
}

beforeEach(async () => {
  tag = randomUUID().slice(0, 8);
  lang = `xq${CAPITALS[randomInt(26)]}${CAPITALS[randomInt(26)]}` as Lang;
  m = await testUser("test-text-queue-m");
  t = await testUser("test-text-queue-t");
  a = await testUser("test-text-queue-a");
  teamA = await newTeam("tq-a", true);
  teamB = await newTeam("tq-b", false);
  await asSystem.query(
    `insert into "team_member" ("teamId", "userId", "lang", "capability") values ($1, $2, $3, 'regenerate')`,
    [teamB, m.id, lang],
  );
  await asSystem.query(
    `insert into "team_member" ("teamId", "userId", "lang", "capability") values ($1, $2, $3, 'regenerate')`,
    [teamA, a.id, lang],
  );
  for (const user of [m, t]) {
    await asSystem.query(`insert into "language_grant" ("userId", "lang", "capability") values ($1, $2, 'edit')`, [
      user.id, lang,
    ]);
  }
  textId = await file("wrong_text", "text");
  audioId = await file("pronunciation", "audio");
});

afterEach(async () => {
  await asSystem.query(`delete from "report_skip" where "reportId" = any($1::bigint[])`, [[textId, audioId]]);
  await asSystem.query(`delete from "report" where "lang" = $1`, [lang]);
  for (const team of [teamA, teamB]) {
    await asSystem.query(`delete from "activity" where "teamId" = $1`, [team]);
    await dropTeam(team);
  }
  await asSystem.query(`delete from "language_grant" where "lang" = $1`, [lang]);
  await m.cleanup();
  await t.cleanup();
  await a.cleanup();
  forgetTeams();
});

afterAll(closeDb);

describe("a text maintainer in a second team", () => {
  it("lists, counts and finds the language's text reports and none of the other team's audio ones", async () => {
    await asActor(m.id, async () => {
      const text = await listReports("all", "all", "all", 500, lang, ["text"]);
      expect(text.map((r) => Number(r.id))).toEqual([textId]);
      expect(await listReports("all", "all", "all", 500, lang, ["text", "audio"])).toHaveLength(1);
      const counts = await openReportCounts(lang, ["text", "audio"]);
      expect(counts.wrong_text).toBe(1);
      expect(counts.pronunciation).toBe(0);
      expect((await reportsForLine("quests", "q:1:accept", lang, ["text", "audio"])).map((r) => Number(r.id))).toEqual([textId]);
      expect((await reportById(textId, lang))?.id).toEqual(String(textId));
      expect(await reportById(audioId, lang)).toBeNull();
    });
  });

  it("resolves a text report as its own team and cannot touch the audio one", async () => {
    await asActor(m.id, async () => {
      expect((await setStatus(textId, "fixed", m.id, lang))?.status).toBe("fixed");
      expect(await setStatus(audioId, "fixed", m.id, lang)).toBeNull();
    });
    const [audio] = await systemRows(`select "status" from "report" where "id" = $1`, [audioId]);
    expect(audio.status).toBe("open");
    const acts = await systemRows(`select "teamId" from "activity" where "kind" = 'report.resolved' and "lang" = $1`, [lang]);
    expect(acts).toEqual([{ teamId: teamA }]);
  });

  it("passes a text report on as its own team and logs it there", async () => {
    await asActor(m.id, async () => {
      expect((await setQueue(textId, "audio", m.id, lang))?.queue).toBe("audio");
    });
    const acts = await systemRows(`select "teamId" from "activity" where "kind" = 'report.passed' and "lang" = $1`, [lang]);
    expect(acts).toEqual([{ teamId: teamA }]);
    expect((await reportPlace(textId))?.teamId).toBe(teamA);
  });
});

describe("skips by a text maintainer in a second team", () => {
  it("puts aside, lists and resets the language's text reports only", async () => {
    await asActor(m.id, async () => {
      expect(await skipReports(m.id, [textId, audioId], lang, ["text", "audio"])).toBe(1);
      expect([...(await skippedIds(m.id, lang))]).toEqual([textId]);
      expect(await resetSkips(m.id, "quests", lang)).toBe(1);
      expect((await skippedIds(m.id, lang)).size).toBe(0);
    });
  });
});

describe("a report passed between queues by the second team", () => {
  it("moves its own audio report to text and logs it under its team", async () => {
    const own = await file("pronunciation", "audio", teamB);
    await asActor(m.id, async () => {
      expect((await setQueue(own, "text", m.id, lang))?.queue).toBe("text");
    });
    const acts = await systemRows(`select "teamId" from "activity" where "kind" = 'report.passed' and "lang" = $1`, [lang]);
    expect(acts).toEqual([{ teamId: teamB }]);
  });
});

describe("who holds a grant, seen from the second team", () => {
  it("lists its own members and the text holders, not the other team's", async () => {
    const seen = await asActor(m.id, async () => [...(await viewersIn(lang)).keys()].sort());
    expect(seen).toEqual([m.id, t.id].sort());
    const privileged = [...(await viewersIn(lang)).keys()].sort();
    expect(privileged).toEqual([a.id, m.id, t.id].sort());
  });
});

describe("a text maintainer with no team", () => {
  it("sees the same list", async () => {
    await asActor(t.id, async () => {
      expect((await listReports("all", "all", "all", 500, lang, ["text"])).map((r) => Number(r.id))).toEqual([textId]);
      expect((await openReportCounts(lang, ["text"])).wrong_text).toBe(1);
    });
  });
});
