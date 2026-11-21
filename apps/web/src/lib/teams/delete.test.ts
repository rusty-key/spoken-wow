/**
 * Deleting a team, with the release jobs mocked: a delisting's job is launched and settled here.
 * Needs DATABASE_URL and migrations through 0124 applied. Touches release_run, which only one
 * file at a time does (vitest.config).
 */
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/releases/sync", () => ({ syncActive: async () => null }));

import { closeDb } from "@/lib/db";
import { BASE_LANG, type Lang } from "@/lib/lang";
import { startNext } from "@/lib/releases/launch";
import { activeRun, updateRun, type ReleaseRun } from "@/lib/releases/store";

import { listTeams, TeamError } from "./admin";
import { DELETED, deletionPreview, retryDeletion, startDeletion } from "./delete";
import { forgetTeams } from "./store";
import {
  addMember,
  asSystem,
  dropLang,
  dropTeam,
  newTeamIn,
  plainTeam,
  releaseRun,
  systemRows,
  testUser,
  uniqueLang,
} from "./testing";

let user: Awaited<ReturnType<typeof testUser>>;
let actor: Awaited<ReturnType<typeof testUser>>;
let team: string;
let slug: string;
let lang: Lang;
let launched: ReleaseRun[];
const launch = async (run: ReleaseRun) => {
  launched.push(run);
};
const releaseEnv = process.env.SPOKEN_RELEASE_ENV;

beforeAll(() => {
  // The site that signs the channel, which alone can delist.
  process.env.SPOKEN_RELEASE_ENV = "/nonexistent/release.env";
});

beforeEach(async () => {
  launched = [];
  user = await testUser("test-delete-member");
  actor = await testUser("test-delete-actor");
  team = await newTeamIn("deDE", false, "del");
  [{ slug }] = await systemRows<{ slug: string }>(`select "slug" from "team" where "id" = $1`, [team]);
  lang = await uniqueLang();
  await asSystem.query(`update "language" set "enabled" = true where "code" = $1`, [lang]);
  await asSystem.query(`insert into "team_language" ("teamId", "lang", "packName") values ($1, $2, 'slug')`, [team, lang]);
  await asSystem.query(`select copy_team_roster((select "id" from "team" where "slug" = 'english'), $1)`, [team]);
  forgetTeams();
});

afterEach(async () => {
  await asSystem.query(`delete from "release_run" where "teamId" = $1`, [team]);
  await asSystem.query(`delete from "report" where "lang" = $1 or "body" = $2`, [lang, `delete-${team}`]);
  await asSystem.query(`delete from "activity" where "actorId" = $1 or "lang" = $2`, [actor.id, lang]);
  await asSystem.query(`delete from "language_grant" where "userId" = $1`, [user.id]);
  if ((await systemRows(`select 1 from "team" where "id" = $1`, [team])).length) await dropTeam(team);
  await dropLang(lang);
  await user.cleanup();
  await actor.cleanup();
  forgetTeams();
});

afterAll(async () => {
  process.env.SPOKEN_RELEASE_ENV = releaseEnv;
  await closeDb();
});

const exists = async () => (await systemRows(`select 1 from "team" where "id" = $1`, [team])).length > 0;

/** A release of the team players have, from before the deletion. */
const released = (lang: string, section: string, state = "done") =>
  releaseRun(team, { lang, section, state, at: "now() - interval '1 hour'" });

/** Settles the active run as its job would have, and starts the next queued one. */
async function settleActive(state: "done" | "failed", error?: string): Promise<ReleaseRun> {
  const run = await activeRun();
  if (!run) throw new Error("no active run");
  await updateRun(run.id, { state, ...(error ? { error } : {}) });
  await startNext(launch);
  return run;
}

/** Every table with a "teamId" column, from the schema itself. */
async function teamTables(): Promise<string[]> {
  const rows = await systemRows<{ table: string }>(
    `select c."table_name" as "table" from "information_schema"."columns" c
       join "information_schema"."tables" t on t."table_schema" = c."table_schema" and t."table_name" = c."table_name"
      where c."table_schema" = 'public' and c."column_name" = 'teamId' and t."table_type" = 'BASE TABLE'
      order by 1`,
  );
  return rows.map((row) => row.table);
}

describe("deleting a team", () => {
  it("covers every table with a team's rows: deleted, moved (report) or cascading from the team", async () => {
    // A new table with "teamId" would refuse the delete (23503) until it is listed in DELETED.
    expect(await teamTables()).toEqual([...DELETED, "report", "team_language", "team_member"].sort());
  });

  it("delists its packs first, then deletes its rows, moves its text reports, closes its voice reports, and switches off a language left with no team", async () => {
    await addMember(team, user.id, "deDE", "admin");
    await addMember(team, user.id, lang, "record");
    await asSystem.query(`insert into "language_grant" ("userId", "lang", "capability") values ($1, 'deDE', 'edit')`, [user.id]);
    await asSystem.query(
      `insert into "take" ("source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes", "teamId")
       values ('quests', 'deDE', $1, 'g:delete', 1, true, 'generated', 1, $2)`,
      [`gossip/${randomUUID()}.mp3`, team],
    );
    const [backend] = await systemRows<{ id: string }>(
      `insert into "storage_backend" ("teamId", "label", "provider", "endpoint", "bucket", "accessKeyId", "secretSealed")
       values ($1, 'Ours', 'r2', 'https://example.invalid', 'our-bucket', 'key', 'sealed') returning "id"`,
      [team],
    );
    await asSystem.query(
      `insert into "archive_object" ("prefix", "sha256", "backendId", "teamId") values ('takes', $1, $2, $3)`,
      [randomUUID().replace(/-/g, "").repeat(2), backend.id, team],
    );
    const [batch] = await systemRows<{ id: string }>(
      `insert into "regeneration_batch" ("label", "lang", "teamId") values ('x', 'deDE', $1) returning "id"`,
      [team],
    );
    await asSystem.query(
      `insert into "regeneration_job" ("batchId", "lineId", "file", "npcName", "preview", "characters", "lang", "teamId")
       values ($1, 'g:x', 'x.mp3', '', '', 1, 'deDE', $2)`,
      [batch.id, team],
    );
    // Text reports in a language with another team and in one without; an open voice report and a
    // fixed one.
    for (const [reportLang, queue, status] of [
      ["deDE", "text", "open"], [lang, "text", "open"], ["deDE", "audio", "open"], ["deDE", "audio", "fixed"],
    ]) {
      await asSystem.query(
        `insert into "report" ("source", "lang", "category", "body", "teamId", "queue", "status")
         values ('quests', $1, 'other', $2, $3, $4, $5)`,
        [reportLang, `delete-${team}`, team, queue, status],
      );
    }
    await released("deDE", "quests");
    await released(lang, "places");
    const [{ enabled: deEnabled }] = await systemRows<{ enabled: boolean }>(`select "enabled" from "language" where "code" = 'deDE'`);

    expect(await startDeletion(team, actor.id, slug, launch)).toBe("deleting");

    // Pending generation is cancelled at once, and nothing is deleted while a delisting is to run.
    expect(await systemRows(`select 1 from "regeneration_job" where "teamId" = $1 and "state" = 'pending'`, [team])).toHaveLength(0);
    expect(launched.map((run) => [run.kind, run.lang, run.section])).toEqual([["delist", "deDE", "quests"]]);
    expect((await listTeams(team))[0].deleting).toEqual({ delisted: 0, delists: 2, error: null });
    await settleActive("done");
    expect(await exists()).toBe(true);
    expect(launched.map((run) => [run.kind, run.lang, run.section])).toEqual([
      ["delist", "deDE", "quests"],
      ["delist", lang, "places"],
    ]);
    await settleActive("done");

    expect(await exists()).toBe(false);
    for (const table of await teamTables()) {
      expect(await systemRows(`select 1 from "${table}" where "teamId" = $1`, [team]), table).toHaveLength(0);
    }
    // Text reports move; voice reports are about takes that went with the team, so they close.
    const reports = await systemRows<{ lang: string; teamId: string | null; queue: string; status: string; resolvedBy: string | null }>(
      `select "lang", "teamId", "queue", "status", "resolvedBy" from "report" where "body" = $1
        order by "queue" = 'text' desc, "lang" = 'deDE' desc, "status"`,
      [`delete-${team}`],
    );
    expect(reports).toEqual([
      { lang: "deDE", teamId: await plainTeam("deDE"), queue: "text", status: "open", resolvedBy: null },
      { lang, teamId: null, queue: "text", status: "open", resolvedBy: null },
      { lang: "deDE", teamId: null, queue: "audio", status: "fixed", resolvedBy: null },
      { lang: "deDE", teamId: null, queue: "audio", status: "not_an_issue", resolvedBy: actor.id },
    ]);
    // Its audio capabilities went with it; `text` is the language's.
    expect(await systemRows(`select 1 from "team_member" where "userId" = $1`, [user.id])).toHaveLength(0);
    expect(await systemRows(`select 1 from "language_grant" where "userId" = $1`, [user.id])).toHaveLength(1);
    // deDE keeps its other team, and its switch.
    const enabled = async (code: string) =>
      (await systemRows<{ enabled: boolean }>(`select "enabled" from "language" where "code" = $1`, [code]))[0].enabled;
    expect(await enabled(lang)).toBe(false);
    expect(await enabled("deDE")).toBe(deEnabled);
    const log = await systemRows<{ kind: string; lang: string | null; detail: Record<string, unknown> }>(
      `select "kind", "lang", "detail" from "activity" where "actorId" = $1 order by "id"`,
      [actor.id],
    );
    expect(log).toEqual([
      {
        kind: "team.deleted",
        lang: null,
        detail: expect.objectContaining({
          slug,
          langs: ["deDE", lang],
          members: [
            { email: `${user.id}@example.invalid`, lang: "deDE", capability: "admin" },
            { email: `${user.id}@example.invalid`, lang, capability: "record" },
          ],
          counts: expect.objectContaining({ take: 1, archive_object: 1, storage_backend: 1, report: 4, release_run: 4 }),
          closedReports: 1,
        }),
      },
      { kind: "language.toggled", lang, detail: { enabled: false } },
    ]);
  });

  it("stops on a failed delisting with its reason, deleting nothing, and a Retry starts it again", async () => {
    await released("deDE", "quests");
    await startDeletion(team, actor.id, slug, launch);
    await settleActive("failed", "the index would not write");

    expect(await exists()).toBe(true);
    expect((await listTeams(team))[0].deleting).toEqual({
      delisted: 0,
      delists: 1,
      error: "Taking quests in deDE off the channel failed: the index would not write",
    });
    await expect(startDeletion(team, actor.id, slug, launch)).rejects.toMatchObject({ status: 409 });

    expect(await retryDeletion(team, actor.id, launch)).toBe("deleting");
    expect((await listTeams(team))[0].deleting).toEqual({ delisted: 0, delists: 1, error: null });
    await settleActive("done");
    expect(await exists()).toBe(false);
  });

  it("delists every section of a language where its packs are plain, which may predate the site's releases", async () => {
    const plainLang = await uniqueLang();
    try {
      await asSystem.query(`insert into "team_language" ("teamId", "lang", "packName") values ($1, $2, 'plain')`, [team, plainLang]);
      await startDeletion(team, actor.id, slug, launch);
      const runs = await systemRows<{ lang: string; section: string }>(
        `select "lang", "section" from "release_run" where "teamId" = $1 and "kind" = 'delist' order by "section"`,
        [team],
      );
      expect(runs).toEqual(["bosses", "places", "quests", "readables"].map((section) => ({ lang: plainLang, section })));
      for (let i = 0; i < 4; i++) await settleActive("done");
      expect(await exists()).toBe(false);
    } finally {
      await dropLang(plainLang);
    }
  });

  it("previews every section it would delist where its packs are plain, with no version where no release says", async () => {
    const plainLang = await uniqueLang();
    try {
      await asSystem.query(`insert into "team_language" ("teamId", "lang", "packName") values ($1, $2, 'plain')`, [team, plainLang]);
      expect((await deletionPreview(team)).packs).toEqual(
        ["bosses", "places", "quests", "readables"].map((section) => ({ lang: plainLang, section, version: null })),
      );
    } finally {
      await asSystem.query(`delete from "team_language" where "lang" = $1`, [plainLang]);
      await dropLang(plainLang);
    }
  });

  it("switches off a language whose last two teams are deleted at once", async () => {
    const other = await newTeamIn(lang, false, "del-other");
    const [{ slug: otherSlug }] = await systemRows<{ slug: string }>(`select "slug" from "team" where "id" = $1`, [other]);
    try {
      expect(
        await Promise.all([startDeletion(team, actor.id, slug, launch), startDeletion(other, actor.id, otherSlug, launch)]),
      ).toEqual(["deleted", "deleted"]);
      expect(await systemRows(`select "enabled" from "language" where "code" = $1`, [lang])).toEqual([{ enabled: false }]);
    } finally {
      if ((await systemRows(`select 1 from "team" where "id" = $1`, [other])).length) await dropTeam(other);
    }
  });

  it("deletes a team with no pack on the channel at once", async () => {
    expect(await startDeletion(team, actor.id, slug, launch)).toBe("deleted");
    expect(await exists()).toBe(false);
    expect(launched).toEqual([]);
  });

  it("refuses a wrong slug, a release under way and English's team, deleting nothing", async () => {
    await expect(startDeletion(team, actor.id, "wrong", launch)).rejects.toSatisfy(
      (error) => error instanceof TeamError && error.status === 400 && error.message.includes(slug),
    );
    await released("deDE", "quests", "queued");
    await expect(startDeletion(team, actor.id, slug, launch)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("release under way"),
    });
    const english = await plainTeam(BASE_LANG);
    await expect(startDeletion(english, actor.id, "english", launch)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("English's team cannot be deleted"),
    });
    expect(await exists()).toBe(true);
    expect(await systemRows(`select 1 from "team" where "deletingAt" is not null and "id" in ($1, $2)`, [team, english])).toHaveLength(0);
  });

  it("refuses off the site that signs the channel when it has packs there", async () => {
    await released("deDE", "quests");
    process.env.SPOKEN_RELEASE_ENV = "";
    try {
      await expect(startDeletion(team, actor.id, slug, launch)).rejects.toMatchObject({ status: 409 });
    } finally {
      process.env.SPOKEN_RELEASE_ENV = "/nonexistent/release.env";
    }
    expect(await systemRows(`select 1 from "team" where "id" = $1 and "deletingAt" is null`, [team])).toHaveLength(1);
  });

  it("answers 404 for no such team", async () => {
    await expect(startDeletion(randomUUID(), actor.id, "x", launch)).rejects.toMatchObject({ status: 404 });
  });
});
