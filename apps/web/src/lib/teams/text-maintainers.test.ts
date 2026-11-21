/** 0092's backfill: nobody who could edit text or act on a language's reports today loses it. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb } from "@/lib/db";
import { grantsOf } from "@/lib/grants/store";

import { asSystem, testUser } from "./testing";

let maintainer: Awaited<ReturnType<typeof testUser>>;
let lead: Awaited<ReturnType<typeof testUser>>;

beforeAll(async () => {
  maintainer = await testUser("test-text-maintainer");
  lead = await testUser("test-text-lead");
});

afterAll(async () => {
  for (const user of [maintainer, lead]) {
    await asSystem.query(`delete from "language_grant" where "userId" = $1`, [user.id]);
    await asSystem.query(`delete from "team_member" where "userId" = $1`, [user.id]);
    await user.cleanup();
  }
  await closeDb();
});

describe("grant_text_maintainers", () => {
  it("leaves an edit holder with text and edit, and a team admin with text and admin", async () => {
    await asSystem.query(
      `insert into "language_grant" ("userId", "lang", "capability") values ($1, 'deDE', 'edit')`,
      [maintainer.id],
    );
    await asSystem.query(
      `insert into "team_member" ("teamId", "userId", "lang", "capability")
       values (team_of_lang('deDE'), $1, 'deDE', 'admin')`,
      [lead.id],
    );

    await asSystem.query(`select grant_text_maintainers()`);

    expect(await grantsOf(maintainer.id)).toEqual([
      { lang: "deDE", capability: "edit" },
      { lang: "deDE", capability: "text" },
    ]);
    expect(await grantsOf(lead.id)).toEqual([
      { lang: "deDE", capability: "admin" },
      { lang: "deDE", capability: "text" },
    ]);
  });

  it("leaves language_grant holding only edit", async () => {
    const { rows } = await asSystem.query(`select 1 from "language_grant" where "capability" <> 'edit'`);
    expect(rows).toEqual([]);
    await expect(
      asSystem.query(
        `insert into "language_grant" ("userId", "lang", "capability") values ($1, 'deDE', 'regenerate')`,
        [maintainer.id],
      ),
    ).rejects.toThrow(/language_grant_capability_check/);
  });
});
