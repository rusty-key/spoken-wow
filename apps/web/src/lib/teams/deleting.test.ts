/** Needs DATABASE_URL and migrations through 0124 applied. */
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { ALL_TEAMS, closeDb, withTeam } from "@/lib/db";
import { createBatch } from "@/lib/generation/queue";
import { grantsOf } from "@/lib/grants/store";
import { startRun } from "@/lib/releases/store";

import { asTeam } from "./acting";
import { deletingRefusal, TEAM_DELETING } from "./deleting";
import { forgetTeams } from "./store";
import { addMember, asSystem, dropTeam, newTeamIn, systemRows, testUser } from "./testing";

let team: string;
let user: Awaited<ReturnType<typeof testUser>>;

beforeEach(async () => {
  user = await testUser("test-deleting");
  team = await newTeamIn("deDE", false);
  await addMember(team, user.id, "deDE", "admin");
  await asSystem.query(`insert into "language_grant" ("userId", "lang", "capability") values ($1, 'deDE', 'edit')`, [user.id]);
  await asSystem.query(`update "team" set "deletingAt" = now() where "id" = $1`, [team]);
});

afterEach(async () => {
  await dropTeam(team);
  await user.cleanup();
  forgetTeams();
});

afterAll(closeDb);

const refused = { code: TEAM_DELETING, message: expect.stringContaining("is being deleted") };

describe("a team being deleted", () => {
  it("refuses a release pressed while the deletion starts, once the deletion commits", async () => {
    await asSystem.query(`update "team" set "deletingAt" = null where "id" = $1`, [team]);
    let press: Promise<unknown> = Promise.resolve();
    await withTeam(ALL_TEAMS, async (client) => {
      // As startDeletion holds it.
      await client.query(`select 1 from "team" where "id" = $1 for update`, [team]);
      await client.query(`update "team" set "deletingAt" = now() where "id" = $1`, [team]);
      press = withTeam(team, (other) =>
        other.query(
          `insert into "release_run" ("kind", "teamId", "section", "lang", "state") values ('release', $1, 'quests', 'deDE', 'failed')`,
          [team],
        ),
      ).catch((error) => error);
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(await press).toMatchObject(refused);
  });

  it("gets no take, recording, generation job, member or language", async () => {
    await expect(
      asSystem.query(
        `insert into "take" ("source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes", "teamId")
         values ('quests', 'deDE', $1, 'g:deleting', 1, true, 'generated', 1, $2)`,
        [`gossip/${randomUUID()}.mp3`, team],
      ),
    ).rejects.toMatchObject(refused);
    await expect(
      asSystem.query(`insert into "regeneration_batch" ("label", "lang", "teamId") values ('x', 'deDE', $1)`, [team]),
    ).rejects.toMatchObject(refused);
    const other = await testUser("test-deleting-other");
    try {
      await expect(addMember(team, other.id, "deDE", "edit")).rejects.toMatchObject(refused);
    } finally {
      await other.cleanup();
    }
    await expect(
      asSystem.query(`insert into "team_language" ("teamId", "lang", "packName") values ($1, 'frFR', 'slug')`, [team]),
    ).rejects.toMatchObject(refused);
  });

  it("gets no release, but a delisting goes in", async () => {
    await expect(
      asSystem.query(`insert into "release_run" ("kind", "teamId", "section", "lang", "state") values ('release', $1, 'quests', 'deDE', 'failed')`, [team]),
    ).rejects.toMatchObject(refused);
    await asSystem.query(
      `insert into "release_run" ("kind", "teamId", "section", "lang", "state") values ('delist', $1, 'quests', 'deDE', 'failed')`,
      [team],
    );
    expect(await systemRows(`select 1 from "release_run" where "teamId" = $1`, [team])).toHaveLength(1);
  });

  it("refuses a press of Release and a queued batch with words fit to show", async () => {
    const press = await asTeam("deDE", team, () => startRun("quests", "deDE", user.id)).catch((error) => error);
    expect(deletingRefusal(press)).toMatch(/^test-.+ is being deleted; it can make nothing more\.$/);
    const batch = await asTeam("deDE", team, () => createBatch("x", user.id, "quests", "deDE")).catch((error) => error);
    expect(deletingRefusal(batch)).not.toBeNull();
    expect(deletingRefusal(new Error("other"))).toBeNull();
  });

  it("leaves its members no capability in its language but `text`, which is the language's", async () => {
    expect(await grantsOf(user.id)).toEqual([{ lang: "deDE", capability: "text" }]);
    await asSystem.query(`update "team" set "deletingAt" = null where "id" = $1`, [team]);
    expect(await grantsOf(user.id)).toEqual([
      { lang: "deDE", capability: "admin" },
      { lang: "deDE", capability: "text" },
    ]);
  });
});
