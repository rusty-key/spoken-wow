/**
 * Grants against a real Postgres, for the activity rows they leave: a removed grant deletes
 * its own row, so the log is the only trace it ever existed, and for the two tables they span.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { randomInt, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { forgetLanguages, loadLanguages } from "@/lib/languages/catalogue";
import { forgetTeams } from "@/lib/teams/store";
import { asSystem, dropTeam, systemRows, testUser } from "@/lib/teams/testing";

import { addGrants, grantsOf, listGrants, listTeamGrants, OtherTeamError, removeGrant } from "./store";

let grantee: Awaited<ReturnType<typeof testUser>>;
let granter: Awaited<ReturnType<typeof testUser>>;
let GRANTEE: string;
let GRANTER: string;

beforeAll(async () => {
  grantee = await testUser("test-grantee");
  granter = await testUser("test-granter");
  GRANTEE = grantee.id;
  GRANTER = granter.id;
});

afterAll(async () => {
  await asSystem.query(`delete from "activity" where "subject" = $1`, [GRANTEE]);
  await asSystem.query(`delete from "language_grant" where "userId" = $1`, [GRANTEE]);
  await asSystem.query(`delete from "team_member" where "userId" = $1`, [GRANTEE]);
  await grantee.cleanup();
  await granter.cleanup();
  await closeDb();
});

async function logged(kind: string) {
  const { rows } = await asSystem.query(
    `select "lang", "actorId", "detail" from "activity" where "subject" = $1 and "kind" = $2`,
    [GRANTEE, kind],
  );
  return rows;
}

describe("addGrants", () => {
  it("grants several at once and logs only the ones that are new", async () => {
    await addGrants(GRANTEE, "frFR", ["edit"], GRANTER);
    await addGrants(GRANTEE, "frFR", ["edit", "regenerate", "record"], GRANTER);

    expect((await grantsOf(GRANTEE)).filter((g) => g.lang === "frFR").map((g) => g.capability)).toEqual([
      "edit",
      "record",
      "regenerate",
    ]);
    expect((await logged("grant.added")).filter((row) => row.lang === "frFR")).toHaveLength(3);
  });

  it("grants none when one is refused by the table", async () => {
    await expect(addGrants(GRANTEE, "esES", ["text", "nonsense" as never], GRANTER)).rejects.toThrow();
    const { rows } = await asSystem.query(
      `select 1 from "language_grant" where "userId" = $1 and "lang" = 'esES'`,
      [GRANTEE],
    );
    expect(rows).toEqual([]);
  });
});

describe("two tables", () => {
  const here = async () => (await grantsOf(GRANTEE)).filter((g) => g.lang === "deDE");
  const rows = async (table: string) =>
    (
      await asSystem.query(`select "capability" from "${table}" where "userId" = $1 and "lang" = 'deDE'`, [GRANTEE])
    ).rows;

  it("stores text as language_grant's edit and the team's edit in team_member", async () => {
    await addGrants(GRANTEE, "deDE", ["text", "edit"], GRANTER);
    expect(await rows("language_grant")).toEqual([{ capability: "edit" }]);
    expect(await rows("team_member")).toEqual([{ capability: "edit" }]);
    expect(await here()).toEqual([
      { lang: "deDE", capability: "edit" },
      { lang: "deDE", capability: "text" },
    ]);
    expect((await listGrants(["deDE"])).filter((g) => g.userId === GRANTEE).map((g) => g.capability)).toEqual([
      "edit",
      "text",
    ]);
  });

  it("takes text away without touching the team's edit, and the other way round", async () => {
    await removeGrant(GRANTEE, "deDE", "text", GRANTER);
    expect(await here()).toEqual([{ lang: "deDE", capability: "edit" }]);
    await addGrants(GRANTEE, "deDE", ["text"], GRANTER);
    await removeGrant(GRANTEE, "deDE", "edit", GRANTER);
    expect(await here()).toEqual([{ lang: "deDE", capability: "text" }]);
    await removeGrant(GRANTEE, "deDE", "text", GRANTER);
    expect(await here()).toEqual([]);
  });
});

describe("removeGrant", () => {
  it("revokes an audio grant filed under a team that does not own the language, as grantsOf reads it", async () => {
    const { rows } = await asSystem.query<{ id: string }>(
      `select "id" from "team" where "id" is distinct from team_of_lang('esMX') order by "slug" limit 1`,
    );
    await asSystem.query(
      `insert into "team_member" ("teamId", "userId", "lang", "capability") values ($1, $2, 'esMX', 'configure')`,
      [rows[0].id, GRANTEE],
    );
    expect((await grantsOf(GRANTEE)).filter((g) => g.lang === "esMX")).toEqual([
      { lang: "esMX", capability: "configure" },
    ]);

    await removeGrant(GRANTEE, "esMX", "configure", GRANTER);

    expect((await grantsOf(GRANTEE)).filter((g) => g.lang === "esMX")).toEqual([]);
    expect((await logged("grant.removed")).filter((row) => row.lang === "esMX")).toHaveLength(1);
  });

  it("records who removed which grant, once, and nothing for a grant that was not there", async () => {
    await addGrants(GRANTEE, "ptBR", ["text"], GRANTER);
    await removeGrant(GRANTEE, "ptBR", "text", GRANTER);
    await removeGrant(GRANTEE, "ptBR", "text", GRANTER);

    expect((await logged("grant.removed")).filter((row) => row.lang === "ptBR")).toEqual([
      { lang: "ptBR", actorId: GRANTER, detail: { capability: "text" } },
    ]);
  });

  it("grants nothing when the step that runs first throws", async () => {
    await expect(
      addGrants(GRANTEE, "frFR", ["ignore"], GRANTER, {
        within: async () => {
          throw new Error("no");
        },
      }),
    ).rejects.toThrow("no");
    expect((await grantsOf(GRANTEE)).filter((g) => g.capability === "ignore")).toEqual([]);
  });
});

describe("a second team", () => {
  const CAPITALS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const MEMBER = `insert into "team_member" ("teamId", "userId", "lang", "capability") values ($1, $2, $3, $4)`;
  let lang: Lang;
  let teamA: string;
  let teamB: string;
  let w: Awaited<ReturnType<typeof testUser>>;
  let v: Awaited<ReturnType<typeof testUser>>;
  let fresh: Awaited<ReturnType<typeof testUser>>;

  async function newTeam(name: string, privileged: boolean): Promise<string> {
    const [row] = await systemRows<{ id: string }>(`select new_team($1, $1) as "id"`, [`${name}-${randomUUID().slice(0, 8)}`]);
    await asSystem.query(`insert into "team_language" ("teamId", "lang", "privileged") values ($1, $2, $3)`, [
      row.id, lang, privileged,
    ]);
    forgetTeams();
    return row.id;
  }

  beforeEach(async () => {
    // A code no language has yet, so afterEach never deletes a row it did not make.
    for (;;) {
      const code = `xq${CAPITALS[randomInt(26)]}${CAPITALS[randomInt(26)]}`;
      const made = await asSystem.query(
        `insert into "language" ("code", "name", "native", "bcp47", "provider", "client", "enabled", "textByTeam")
         values ($1, 'Xq', 'Xq', 'xq-XQ', 'xq', false, false, false) on conflict do nothing`,
        [code],
      );
      if (made.rowCount) {
        lang = code as Lang;
        break;
      }
    }
    forgetLanguages();
    await loadLanguages();
    w = await testUser("test-grants-w");
    v = await testUser("test-grants-v");
    fresh = await testUser("test-grants-fresh");
    teamA = await newTeam("grants-a", true);
    teamB = await newTeam("grants-b", false);
    await asSystem.query(MEMBER, [teamB, w.id, lang, "admin"]);
    await asSystem.query(MEMBER, [teamA, v.id, lang, "regenerate"]);
  });

  afterEach(async () => {
    for (const team of [teamA, teamB]) {
      await asSystem.query(`delete from "activity" where "teamId" = $1`, [team]);
      await dropTeam(team);
    }
    await asSystem.query(`delete from "activity" where "lang" = $1`, [lang]);
    await asSystem.query(`delete from "language_grant" where "lang" = $1`, [lang]);
    await asSystem.query(`delete from "language" where "code" = $1`, [lang]);
    forgetLanguages();
    forgetTeams();
    for (const user of [w, v, fresh]) await user.cleanup();
  });

  it("grants into the granter's team, and logs it there", async () => {
    await addGrants(fresh.id, lang, ["regenerate"], w.id);
    expect(await systemRows(`select "teamId" from "team_member" where "userId" = $1`, [fresh.id])).toEqual([
      { teamId: teamB },
    ]);
    expect(
      await systemRows(`select "teamId" from "activity" where "kind" = 'grant.added' and "subject" = $1`, [fresh.id]),
    ).toEqual([{ teamId: teamB }]);
  });

  it("refuses somebody who works on the language in the other team", async () => {
    await expect(addGrants(v.id, lang, ["record"], w.id)).rejects.toBeInstanceOf(OtherTeamError);
    await expect(addGrants(v.id, lang, ["record"], w.id)).rejects.toThrow(
      "That person already works on Xq in another team; one person works in one team per language.",
    );
    expect(await systemRows(`select 1 from "team_member" where "userId" = $1 and "teamId" = $2`, [v.id, teamB])).toEqual(
      [],
    );
  });

  it("lists only the team's own rows, and no text, for the team alone", async () => {
    await addGrants(fresh.id, lang, ["regenerate"], w.id);
    await asSystem.query(
      `insert into "language_grant" ("userId", "lang", "capability") values ($1, $2, 'edit')`,
      [v.id, lang],
    );
    const rows = await listTeamGrants(new Map([[lang, teamB]]), []);
    expect(new Set(rows.map((row) => row.userId))).toEqual(new Set([w.id, fresh.id]));
    expect(rows.some((row) => row.capability === "text")).toBe(false);
    expect(rows.every((row) => row.teamSlug?.startsWith("grants-b-"))).toBe(true);
    const all = await listGrants([lang]);
    expect(all.find((row) => row.capability === "text")).toMatchObject({ userId: v.id, teamSlug: null });
  });

  it("answers a conflict at commit as OtherTeamError", async () => {
    await expect(
      addGrants(fresh.id, lang, ["record"], w.id, {
        within: async () => {
          throw Object.assign(new Error("exclusion"), { code: "23P01" });
        },
      }),
    ).rejects.toBeInstanceOf(OtherTeamError);
  });

  it("files a removal under the team the row was in", async () => {
    await removeGrant(w.id, lang, "admin", fresh.id);
    expect(await systemRows(`select 1 from "team_member" where "userId" = $1`, [w.id])).toEqual([]);
    expect(
      await systemRows(`select "teamId" from "activity" where "kind" = 'grant.removed' and "subject" = $1`, [w.id]),
    ).toEqual([{ teamId: teamB }]);
  });

  it("removes only the named team's row", async () => {
    await removeGrant(v.id, lang, "regenerate", w.id, teamB);
    expect(await systemRows(`select "teamId" from "team_member" where "userId" = $1`, [v.id])).toEqual([
      { teamId: teamA },
    ]);
  });

  it("marks a grant in the second team as not privileged", async () => {
    expect((await grantsOf(w.id)).filter((grant) => grant.lang === lang)).toEqual([
      { lang, capability: "admin", privileged: false },
    ]);
    expect((await grantsOf(v.id)).filter((grant) => grant.lang === lang)).toEqual([{ lang, capability: "regenerate" }]);
  });
});
