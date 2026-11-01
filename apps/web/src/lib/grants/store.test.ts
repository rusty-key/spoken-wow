/**
 * Grants against a real Postgres, for the activity rows they leave: a removed grant deletes
 * its own row, so the log is the only trace it ever existed, and for the two tables they span.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";
import { asSystem, testUser } from "@/lib/teams/testing";

import { addGrants, grantsOf, listGrants, removeGrant } from "./store";

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
});
