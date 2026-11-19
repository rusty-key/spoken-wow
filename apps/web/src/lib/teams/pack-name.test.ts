/**
 * Needs DATABASE_URL and migrations through 0123.
 *
 * A team's pack name in a language is stored when it joins: plain (`_<lang>`) for a team whose
 * slug is the code while no team of the language has plain packs, else slugged.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { Lang } from "@/lib/lang";

import { asSystem, dropLang, dropTeam, systemRows, uniqueLang } from "./testing";

let teams: string[] = [];
let langs: Lang[] = [];

async function team(slug: string): Promise<string> {
  const [row] = await systemRows<{ id: string }>(`select new_team($1, $1) as "id"`, [slug]);
  teams.push(row.id);
  return row.id;
}

async function lang(): Promise<Lang> {
  const code = await uniqueLang();
  langs.push(code);
  return code;
}

/** Joins `teamId` to `code` with any further `columns`; returns what the row got. */
async function join(teamId: string, code: string, columns: Record<string, unknown> = {}) {
  const names = ["teamId", "lang", ...Object.keys(columns)];
  const [row] = await systemRows<{ packName: string; privileged: boolean }>(
    `insert into "team_language" (${names.map((name) => `"${name}"`).join(", ")})
     values (${names.map((_, i) => `$${i + 1}`).join(", ")})
     returning "packName", "privileged"`,
    [teamId, code, ...Object.values(columns)],
  );
  expect(row.privileged).toBe(row.packName === "plain");
  return row;
}

const suffix = () => Math.random().toString(36).slice(2, 8);

afterEach(async () => {
  for (const id of teams) await dropTeam(id);
  for (const code of langs) await dropLang(code);
  teams = [];
  langs = [];
});

describe("team_language.packName", () => {
  it("is plain for every team privileged before it, and slug for the rest", async () => {
    const rows = await systemRows<{ lang: string; packName: string; privileged: boolean }>(
      `select "lang", "packName", "privileged" from "team_language"`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.packName).toBe(row.privileged ? "plain" : "slug");
    const english = await systemRows<{ packName: string }>(
      `select tl."packName" from "team_language" tl join "team" t on t."id" = tl."teamId"
        where t."slug" = 'english' and tl."lang" = 'enUS'`,
    );
    expect(english).toEqual([{ packName: "plain" }]);
  });

  it("is plain for a team slugged as the code that joins a language with no team", async () => {
    const code = await lang();
    expect((await join(await team(code.toLowerCase()), code)).packName).toBe("plain");
    const [{ team: plain }] = await systemRows<{ team: string }>(`select team_of_lang($1) as "team"`, [code]);
    expect(plain).toBe(teams[0]);
  });

  it("is slug for a team with another slug, even in a language with no team", async () => {
    const code = await lang();
    expect((await join(await team(`german-${suffix()}`), code)).packName).toBe("slug");
  });

  it("is slug for a team slugged as the code that joins beside a plain team", async () => {
    const code = await lang();
    await join(await team(`german-${suffix()}`), code, { packName: "plain" });
    expect((await join(await team(code.toLowerCase()), code)).packName).toBe("slug");
  });

  it("is plain for a previous release's insert of a privileged team", async () => {
    const code = await lang();
    expect((await join(await team(`old-${suffix()}`), code, { privileged: true })).packName).toBe("plain");
    expect((await join(await team(`second-${suffix()}`), code, { privileged: false })).packName).toBe("slug");
  });

  it("refuses a second plain team in a language", async () => {
    const code = await lang();
    await join(await team(code.toLowerCase()), code);
    await expect(join(await team(`other-${suffix()}`), code, { packName: "plain" })).rejects.toMatchObject({
      code: "23505",
    });
  });

  it("never changes once set", async () => {
    const code = await lang();
    const id = await team(code.toLowerCase());
    await join(id, code);
    await expect(
      asSystem.query(`update "team_language" set "packName" = 'slug' where "teamId" = $1`, [id]),
    ).rejects.toThrow(/never changes/);
  });
});
