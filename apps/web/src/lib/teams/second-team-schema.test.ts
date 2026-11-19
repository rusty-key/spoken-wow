/** Needs DATABASE_URL and migrations through 0113 applied. */
import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";

import { forgetTeams } from "./store";
import { addMember, asSystem, dropTeam, newTeamIn, randomLang, systemRows, testUser } from "./testing";

let lang: string;
let tag: string;
let teamA: string;
let teamB: string;
let extra: string[];
let user: Awaited<ReturnType<typeof testUser>>;

const GRANT = `insert into "team_member" ("teamId", "userId", "lang", "capability") values ($1, $2, $3, $4)`;

beforeEach(async () => {
  tag = randomUUID().slice(0, 8);
  lang = randomLang();
  user = await testUser("test-second");
  extra = [];
  teamA = await newTeamIn(lang, true, "second-a");
  teamB = await newTeamIn(lang, false, "second-b");
});

afterEach(async () => {
  for (const team of [teamA, teamB, ...extra]) {
    await asSystem.query(`delete from "generation_setting_locale" where "teamId" = $1`, [team]);
    await asSystem.query(`delete from "pronunciation_lexicon_locale" where "teamId" = $1`, [team]);
    await dropTeam(team);
  }
  await user.cleanup();
  forgetTeams();
});

afterAll(closeDb);

describe("one team per person per language", () => {
  it("refuses one person in two teams of a language at commit", async () => {
    const client = await db().connect();
    try {
      await client.query("begin");
      await client.query(GRANT, [teamA, user.id, lang, "regenerate"]);
      await client.query(GRANT, [teamB, user.id, lang, "regenerate"]);
      await expect(client.query("commit")).rejects.toMatchObject({ code: "23P01" });
    } finally {
      await client.query("rollback").catch(() => {});
      client.release();
    }
    expect(await systemRows(`select 1 from "team_member" where "userId" = $1`, [user.id])).toHaveLength(0);
  });

  it("lets one team hold several capabilities of a person", async () => {
    const client = await db().connect();
    try {
      await client.query("begin");
      await client.query(GRANT, [teamA, user.id, lang, "regenerate"]);
      await client.query(GRANT, [teamA, user.id, lang, "configure"]);
      await client.query("commit");
    } finally {
      client.release();
    }
    expect(await systemRows(`select 1 from "team_member" where "userId" = $1`, [user.id])).toHaveLength(2);
  });

  it("lets exactly one of two concurrent commits into two teams win", async () => {
    const clients: PoolClient[] = [await db().connect(), await db().connect()];
    try {
      const teams = [teamA, teamB];
      for (const [i, client] of clients.entries()) {
        await client.query("begin");
        await client.query(GRANT, [teams[i], user.id, lang, "regenerate"]);
      }
      const results = await Promise.allSettled(clients.map((client) => client.query("commit")));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(failed.reason).toMatchObject({ code: "23P01" });
    } finally {
      for (const client of clients) {
        await client.query("rollback").catch(() => {});
        client.release();
      }
    }
    const rows = await systemRows(`select distinct "teamId" from "team_member" where "userId" = $1`, [user.id]);
    expect(rows).toHaveLength(1);
  });

  it("lets move_team_lang move a member to a new team", async () => {
    await addMember(teamA, user.id, lang, "regenerate");
    const [c] = await systemRows<{ id: string }>(`select new_team($1, $1) as "id"`, [`second-c-${tag}`]);
    extra.push(c.id);
    await asSystem.query(`select move_team_lang($1, $2)`, [lang, c.id]);
    const rows = await systemRows<{ teamId: string }>(`select "teamId" from "team_member" where "userId" = $1`, [user.id]);
    expect(rows).toEqual([{ teamId: c.id }]);
  });
});

describe("copy_team_settings", () => {
  it("copies roster, locale model and lexicon entries, and leaves the sync columns empty", async () => {
    await asSystem.query(`insert into "voice" ("teamId", "name", "race", "gender") values ($1, 'v-one', 'human', '')`, [teamA]);
    await asSystem.query(
      `insert into "voice_assignment" ("teamId", "race", "gender", "flavor", "voice") values ($1, 'human', null, null, 'v-one')`,
      [teamA],
    );
    await asSystem.query(
      `insert into "generation_setting_locale" ("teamId", "lang", "modelId", "voiceSettings", "seedStrategy")
       values ($1, $2, 'eleven_v3', '{}', 'none')`,
      [teamA, lang],
    );
    await asSystem.query(
      `insert into "pronunciation_lexicon_locale" ("teamId", "lang", "entries", "dictionaryId", "versionId", "syncedDigest", "syncedAt")
       values ($1, $2, '[{"from":"a","to":"b"}]', 'd1', 'v1', 'x', now())`,
      [teamA, lang],
    );
    await asSystem.query(`select copy_team_settings($1, $2, $3)`, [teamA, teamB, lang]);

    expect(await systemRows(`select "name", "race" from "voice" where "teamId" = $1`, [teamB])).toEqual([
      { name: "v-one", race: "human" },
    ]);
    expect(await systemRows(`select "voice" from "voice_assignment" where "teamId" = $1`, [teamB])).toEqual([
      { voice: "v-one" },
    ]);
    expect(await systemRows(`select "modelId" from "generation_setting_locale" where "teamId" = $1 and "lang" = $2`, [teamB, lang])).toEqual([
      { modelId: "eleven_v3" },
    ]);
    expect(
      await systemRows(
        `select "entries", "dictionaryId", "versionId", "syncedDigest", "syncedAt"
           from "pronunciation_lexicon_locale" where "teamId" = $1 and "lang" = $2`,
        [teamB, lang],
      ),
    ).toEqual([
      { entries: [{ from: "a", to: "b" }], dictionaryId: null, versionId: null, syncedDigest: null, syncedAt: null },
    ]);
  });
});

describe("invite.joinTeamId", () => {
  it("names the plain team when an invite is written with none, as a previous release writes it", async () => {
    const [row] = await systemRows<{ joinTeamId: string | null }>(
      `insert into "invite" ("email", "lang", "capabilities", "tokenHash", "invitedBy", "expiresAt")
       values ($1, $2, array['text'], $3, $4, now() + interval '1 day') returning "joinTeamId"`,
      [`${tag}@example.invalid`, lang, `hash-${tag}`, user.id],
    );
    expect(row.joinTeamId).toBe(teamA);
  });

  it("refuses an invite with no team in a language with no plain team", async () => {
    await expect(
      asSystem.query(
        `insert into "invite" ("email", "lang", "capabilities", "tokenHash", "invitedBy", "expiresAt")
         values ($1, 'qbQB', array['text'], $2, $3, now() + interval '1 day')`,
        [`none-${tag}@example.invalid`, `hash-none-${tag}`, user.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
