/** Needs DATABASE_URL and migrations through 0124; the session is mocked. */
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import { BASE_LANG } from "@/lib/lang";
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
} from "@/lib/teams/testing";

const who = vi.hoisted(() => ({ id: "", role: "admin" }));
vi.mock("@/lib/session", () => ({
  currentSession: async () => ({ user: { id: who.id, role: who.role } }),
}));

import { GET } from "./route";

let user: Awaited<ReturnType<typeof testUser>>;
let team = "";
let lang: string;

beforeAll(async () => {
  user = await testUser("test-team-deletion");
  who.id = user.id;
});

beforeEach(async () => {
  who.role = "admin";
  team = await newTeamIn("deDE", false);
  lang = await uniqueLang();
  await asSystem.query(`insert into "team_language" ("teamId", "lang", "packName") values ($1, $2, 'slug')`, [team, lang]);
  await addMember(team, user.id, "deDE", "admin");
});

afterEach(async () => {
  await dropTeam(team);
  await dropLang(lang as never);
});

afterAll(async () => {
  await user.cleanup();
  await closeDb();
});

const get = (id = team) =>
  GET(new Request(`http://x/api/teams/${id}/deletion`), { params: Promise.resolve({ id }) });

describe("GET /api/teams/[id]/deletion", () => {
  it("counts what goes, the packs on the channel, and which language is left with no team", async () => {
    await asSystem.query(
      `insert into "take" ("source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes", "teamId")
       values ('quests', 'deDE', $1, 'g:deletion', 1, true, 'generated', 1, $2)`,
      [`gossip/${randomUUID()}.mp3`, team],
    );
    await asSystem.query(
      `insert into "report" ("source", "lang", "category", "body", "teamId") values ('quests', 'deDE', 'other', 'x', $1)`,
      [team],
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
    // Live: places in deDE. Delisted since: quests in deDE.
    await releaseRun(team, { section: "places" });
    await releaseRun(team, { at: "now() - interval '1 day'" });
    await releaseRun(team, { kind: "delist" });

    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: team,
      langs: [
        { lang: "deDE", alone: false },
        { lang, alone: true },
      ],
      members: [{ email: `${user.id}@example.invalid`, lang: "deDE", capability: "admin" }],
      pending: 1,
      reports: { moving: 0, closing: 1 },
      packs: [{ lang: "deDE", section: "places", version: "1.0.1" }],
      refusal: null,
    });
    expect(body.counts).toMatchObject({ take: 1, report: 1, regeneration_job: 1, regeneration_batch: 1, release_run: 3 });
  });

  it("counts a language as left with no team when its other team is being deleted too", async () => {
    const other = await newTeamIn(lang, false, "deletion-other");
    try {
      expect((await (await get()).json()).langs).toContainEqual({ lang, alone: false });
      await asSystem.query(`update "team" set "deletingAt" = now() where "id" = $1`, [other]);
      expect((await (await get()).json()).langs).toContainEqual({ lang, alone: true });
    } finally {
      await dropTeam(other);
    }
  });

  it("says a team with a release under way cannot be deleted now", async () => {
    await releaseRun(team, { state: "queued" });
    expect((await (await get()).json()).refusal).toMatch(/has a release under way/);
  });

  it("says English's team cannot be deleted", async () => {
    expect((await (await get(await plainTeam(BASE_LANG))).json()).refusal).toMatch(/English's team cannot be deleted/);
  });

  it("is for site owners only, and 404 for no such team", async () => {
    expect((await get(randomUUID())).status).toBe(404);
    who.role = "user";
    expect((await get()).status).toBe(403);
  });
});
