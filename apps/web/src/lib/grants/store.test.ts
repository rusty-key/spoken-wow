/**
 * Grants against a real Postgres, for the activity rows they leave: a removed grant deletes
 * its own row, so the log is the only trace it ever existed.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";
import { asSystem } from "@/lib/teams/testing";

import { addGrants, grantsOf, listGrants, removeGrant } from "./store";

const GRANTEE = `test-grantee-${Math.random().toString(36).slice(2, 10)}`;
const GRANTER = `test-granter-${Math.random().toString(36).slice(2, 10)}`;

beforeAll(async () => {
  for (const id of [GRANTEE, GRANTER]) {
    await asSystem.query(
      `insert into "user" ("id", "name", "email", "emailVerified") values ($1, $1, $2, false)`,
      [id, `${id}@example.invalid`],
    );
  }
});

afterAll(async () => {
  await asSystem.query(`delete from "activity" where "subject" = $1`, [GRANTEE]);
  await asSystem.query(`delete from "language_grant" where "userId" = $1`, [GRANTEE]);
  await asSystem.query(`delete from "team_member" where "userId" = $1`, [GRANTEE]);
  await asSystem.query(`delete from "user" where "id" = any($1::text[])`, [[GRANTEE, GRANTER]]);
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
    await expect(addGrants(GRANTEE, "esES", ["edit", "nonsense" as never], GRANTER)).rejects.toThrow();
    const { rows } = await asSystem.query(
      `select 1 from "language_grant" where "userId" = $1 and "lang" = 'esES'`,
      [GRANTEE],
    );
    expect(rows).toEqual([]);
  });
});

describe("two tables", () => {
  it("keeps an edit grant and a team capability apart", async () => {
    await addGrants(GRANTEE, "deDE", ["edit", "regenerate"], GRANTER);
    const count = async (table: string) =>
      (
        await asSystem.query(
          `select 1 from "${table}" where "userId" = $1 and "lang" = 'deDE'`,
          [GRANTEE],
        )
      ).rows.length;
    expect(await count("language_grant")).toBe(1);
    expect(await count("team_member")).toBe(1);
    const here = async () => (await grantsOf(GRANTEE)).filter((g) => g.lang === "deDE");
    expect(await here()).toEqual([
      { lang: "deDE", capability: "edit" },
      { lang: "deDE", capability: "regenerate" },
    ]);
    await removeGrant(GRANTEE, "deDE", "regenerate", GRANTER);
    expect(await here()).toEqual([{ lang: "deDE", capability: "edit" }]);
  });

  it("ignores audio grants left in language_grant", async () => {
    await asSystem.query(
      `insert into "language_grant" ("userId", "lang", "capability") values ($1, 'itIT', 'configure')`,
      [GRANTEE],
    );
    expect((await grantsOf(GRANTEE)).filter((g) => g.lang === "itIT")).toEqual([]);
    expect((await listGrants(["itIT"])).filter((g) => g.userId === GRANTEE)).toEqual([]);
  });

  it("lists a capability held in both tables once", async () => {
    await asSystem.query(
      `insert into "language_grant" ("userId", "lang", "capability") values ($1, 'ruRU', 'record')`,
      [GRANTEE],
    );
    await addGrants(GRANTEE, "ruRU", ["record"], GRANTER);
    const rows = (await listGrants(["ruRU"])).filter((g) => g.userId === GRANTEE);
    expect(rows.map((g) => g.capability)).toEqual(["record"]);
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
    await addGrants(GRANTEE, "ptBR", ["edit"], GRANTER);
    await removeGrant(GRANTEE, "ptBR", "edit", GRANTER);
    await removeGrant(GRANTEE, "ptBR", "edit", GRANTER);

    expect((await logged("grant.removed")).filter((row) => row.lang === "ptBR")).toEqual([
      { lang: "ptBR", actorId: GRANTER, detail: { capability: "edit" } },
    ]);
  });
});
