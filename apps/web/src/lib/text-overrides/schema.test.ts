/** Needs DATABASE_URL and migrations through 0117 applied. */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, withTeam } from "@/lib/db";
import { forgetTeams } from "@/lib/teams/store";
import { asSystem, dropLang, dropTeam, newTeamIn, uniqueLang } from "@/lib/teams/testing";

let lang: string;
let a: string;
let b: string;
let c: string;

const insert = (team: string, source = "places", teamId: string = team) =>
  withTeam(team, (client) =>
    client.query(
      `insert into "text_override" ("teamId", "lang", "source", "lineId", "text") values ($1, $2, $3, 'line-1', 'hello')`,
      [teamId, lang, source],
    ),
  );

const read = (team: string) =>
  withTeam(team, async (client) => (await client.query(`select "text" from "text_override" where "lang" = $1`, [lang])).rows);

beforeEach(async () => {
  lang = await uniqueLang();
  a = await newTeamIn(lang, true);
  b = await newTeamIn(lang, false);
  c = (await asSystem.query<{ id: string }>(`select new_team($1, $1) as "id"`, [`test-text-${Math.random().toString(36).slice(2, 8)}`])).rows[0].id;
});

afterEach(async () => {
  for (const team of [a, b, c]) await dropTeam(team);
  await dropLang(lang as never);
  forgetTeams();
});

afterAll(closeDb);

describe("text_override", () => {
  it("is visible to its own team and not to another", async () => {
    await insert(a);
    expect(await read(a)).toEqual([{ text: "hello" }]);
    expect(await read(b)).toEqual([]);
  });

  it("refuses a row written for another team", async () => {
    await expect(insert(b, "places", a)).rejects.toThrow(/row-level security/);
  });

  it("refuses a source outside places, readables and bosses", async () => {
    await expect(insert(a, "quests")).rejects.toThrow(/check constraint/);
  });

  it("moves with its language", async () => {
    await insert(a);
    await asSystem.query(`select move_team_lang($1, $2)`, [lang, c]);
    const rows = await asSystem.query(`select "teamId" from "text_override" where "lang" = $1`, [lang]);
    expect(rows.rows).toEqual([{ teamId: c }]);
  });
});
