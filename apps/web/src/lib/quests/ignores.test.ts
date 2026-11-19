/**
 * Against a real Postgres, like history.test.ts and for the same reason: what this module
 * promises - one row per line, a reason that cannot be blank, a memo that notices a delete -
 * is kept by the schema and by a stamp read from it, neither of which a mock would exercise.
 *
 * Needs DATABASE_URL and migrations applied:
 *   docker compose up -d postgres && deploy/bin/migrate.sh "$PWD/web"
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { asTeams } from "@/lib/teams/acting";
import { asSystem, dropLang, dropTeam, newTeamIn, ownTeam, systemRows, uniqueLang } from "@/lib/teams/testing";

import { clearIgnore, forgetIgnores, readIgnores, writeIgnore } from "./ignores";

/** An id no other run collides with, and one the corpus does not have: this table is free. */
const LINE = `q:999999:accept:test-${process.pid}`;

afterEach(async () => {
  await asSystem.query(`delete from "activity" where "subject" = $1 and "kind" like 'ignore.%'`, [LINE]);
  await asSystem.query(`delete from "line_ignore" where "lineId" = $1`, [LINE]);
  forgetIgnores();
});

afterAll(async () => {
  await closeDb();
});

describe("ignores", () => {
  it("records a decision with its reason", async () => {
    const written = await writeIgnore(LINE, "  war-effort tally  ", null);

    expect(written.reason).toBe("war-effort tally");
    expect((await readIgnores()).get(LINE)?.reason).toBe("war-effort tally");
  });

  it("refuses a reason that says nothing", async () => {
    await expect(writeIgnore(LINE, "   ", null)).rejects.toThrow(/reason/);
    expect((await readIgnores()).has(LINE)).toBe(false);
  });

  it("replaces the reason rather than adding a second row", async () => {
    await writeIgnore(LINE, "first", null);
    await writeIgnore(LINE, "second", null);

    const { rows } = await asSystem.query<{ n: string }>(
      `select count(*)::text as n from "line_ignore" where "lineId" = $1`,
      [LINE],
    );
    expect(rows[0].n).toBe("1");
    expect((await readIgnores()).get(LINE)?.reason).toBe("second");
  });

  it("stops hiding a line once the decision is withdrawn", async () => {
    await writeIgnore(LINE, "was broken", null);
    expect((await readIgnores()).has(LINE)).toBe(true);

    expect(await clearIgnore(LINE, null, null)).toBe(true);
    // The memo has to notice, which is why the stamp counts rows as well as timestamping
    // them: a delete leaves max(createdAt) exactly where it was.
    expect((await readIgnores()).has(LINE)).toBe(false);
  });

  it("reports nothing removed for a line that was not ignored", async () => {
    expect(await clearIgnore(LINE, null, null)).toBe(false);
  });
});

describe("an ignore's team", () => {
  const teamOfRow = async (lang: string | null) =>
    (await asSystem.query<{ teamId: string | null }>(
      `select "teamId" from "line_ignore" where "lineId" = $1 and "lang" is not distinct from $2`,
      [LINE, lang],
    )).rows;

  it("is none for an ignore in every language", async () => {
    await writeIgnore(LINE, "everywhere", null);
    expect(await teamOfRow(null)).toEqual([{ teamId: null }]);
  });

  it("is the language's for one language's ignore, which that language reads with the global ones", async () => {
    const german = await ownTeam("deDE");
    try {
      await writeIgnore(LINE, "german only", null, { lang: "deDE" });
      expect(await teamOfRow("deDE")).toEqual([{ teamId: german.team }]);
      expect((await readIgnores("deDE")).get(LINE)?.lang).toBe("deDE");
      expect((await readIgnores("enUS")).has(LINE)).toBe(false);
      expect(await clearIgnore(LINE, "deDE", null)).toBe(true);
    } finally {
      await asSystem.query(`delete from "line_ignore" where "lineId" = $1`, [LINE]);
      await asSystem.query(`delete from "activity" where "subject" = $1 and "kind" like 'ignore.%'`, [LINE]);
      await german.restore();
    }
  });
});

describe("a language's own ignore", () => {
  let lang: Lang;
  let first: string;
  let second: string;
  const as = <T>(team: string, work: () => Promise<T>) => asTeams(new Map([[lang, team]]), work);

  beforeEach(async () => {
    lang = await uniqueLang();
    first = await newTeamIn(lang, true, "ignore-first");
    second = await newTeamIn(lang, false, "ignore-second");
  });

  afterEach(async () => {
    await asSystem.query(`delete from "line_ignore" where "lineId" = $1`, [LINE]);
    await asSystem.query(`delete from "activity" where "lang" = $1`, [lang]);
    await dropTeam(first);
    await dropTeam(second);
    await dropLang(lang);
  });

  it("hides the line for every team of the language, and only there", async () => {
    await as(first, () => writeIgnore(LINE, "rejected", null, { lang, wholeLanguage: true }));
    expect(
      await systemRows(`select "lang", "teamId" from "line_ignore" where "lineId" = $1`, [LINE]),
    ).toEqual([{ lang, teamId: null }]);
    expect((await as(first, () => readIgnores(lang))).has(LINE)).toBe(true);
    expect((await as(second, () => readIgnores(lang))).has(LINE)).toBe(true);
    expect((await readIgnores("enUS")).has(LINE)).toBe(false);
  });

  it("stands beside a team's own ignore of the line and the every-language one", async () => {
    await writeIgnore(LINE, "everywhere", null);
    await as(first, () => writeIgnore(LINE, "the language's", null, { lang, wholeLanguage: true }));
    await as(first, () => writeIgnore(LINE, "the first team's", null, { lang }));
    expect(await systemRows(`select count(*)::int as "n" from "line_ignore" where "lineId" = $1`, [LINE])).toEqual([
      { n: 3 },
    ]);
  });

  it("leaves a team's own ignore to that team", async () => {
    await as(first, () => writeIgnore(LINE, "the first team's", null, { lang }));
    expect((await as(first, () => readIgnores(lang))).has(LINE)).toBe(true);
    expect((await as(second, () => readIgnores(lang))).has(LINE)).toBe(false);
  });

  it("is lifted by either team", async () => {
    await as(first, () => writeIgnore(LINE, "rejected", null, { lang, wholeLanguage: true }));
    expect(await as(second, () => clearIgnore(LINE, lang, null))).toBe(true);
    expect((await as(first, () => readIgnores(lang))).has(LINE)).toBe(false);
  });
});
