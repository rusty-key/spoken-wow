/**
 * Grants against a real Postgres, for the activity rows they leave: a removed grant deletes
 * its own row, so the log is the only trace it ever existed.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";
import { asSystem } from "@/lib/teams/testing";

import { addGrants, removeGrant } from "./store";

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

    const { rows } = await asSystem.query(
      `select "capability" from "language_grant" where "userId" = $1 and "lang" = 'frFR' order by 1`,
      [GRANTEE],
    );
    expect(rows.map((row) => row.capability)).toEqual(["edit", "record", "regenerate"]);
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

describe("removeGrant", () => {
  it("records who removed which grant, once, and nothing for a grant that was not there", async () => {
    await addGrants(GRANTEE, "ptBR", ["edit"], GRANTER);
    await removeGrant(GRANTEE, "ptBR", "edit", GRANTER);
    await removeGrant(GRANTEE, "ptBR", "edit", GRANTER);

    expect(await logged("grant.removed")).toEqual([
      { lang: "ptBR", actorId: GRANTER, detail: { capability: "edit" } },
    ]);
  });
});
