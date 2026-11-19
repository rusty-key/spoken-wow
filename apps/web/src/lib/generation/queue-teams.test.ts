/**
 * The queue panel in a language with a second team: each team sees only its own finished lines
 * and pauses, while a single-team language's rows pass as they always have.
 *
 * Needs DATABASE_URL and migrations applied. Jobs are inserted as done; nothing is queued or
 * generated. Only the session, the cookie jar and the worker's wake-up are mocked.
 */
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  session: null as { user: { id: string; name: string; role: string | null } } | null,
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (name === "spoken_team" && mocks.cookie !== undefined ? { name, value: mocks.cookie } : undefined),
  }),
}));
vi.mock("@/lib/session", () => ({ currentSession: async () => mocks.session }));
vi.mock("@/lib/generation/boot", () => ({ ensureQueueRunning: () => {} }));
vi.mock("@/lib/teams/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/teams/store")>();
  return { ...actual, secondTeamLangs: vi.fn(actual.secondTeamLangs), freshOwners: vi.fn(actual.freshOwners) };
});
vi.mock("./queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./queue")>();
  return { ...actual, snapshot: vi.fn(actual.snapshot) };
});

import { GET } from "@/app/api/regenerate/queue/route";
import { closeDb } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { forgetTeams, freshOwners, secondTeamLangs, type TeamId } from "@/lib/teams/store";
import { asSystem, dropLang, dropTeam, newTeamIn, systemRows, testUser, uniqueLang } from "@/lib/teams/testing";

import { snapshot, type QueueSnapshot } from "./queue";

let lang: Lang;
let single: Lang;
let a: TeamId;
let b: TeamId;
let s: TeamId;
let owner: Awaited<ReturnType<typeof testUser>>;
/** Who paused each team, so a pause in the panel says whose it is. */
let pausers: Record<"a" | "b", Awaited<ReturnType<typeof testUser>>>;
const ids: Record<string, string> = {};
let tag: string;
let batches: string[];
/** Just before the first job here, so older done jobs on the database never fill the page. */
let since: string;

async function doneJob(team: TeamId, jobLang: Lang, name: string): Promise<void> {
  const [batch] = await systemRows<{ id: string }>(
    `insert into "regeneration_batch" ("label", "lang", "teamId") values ($1, $2, $3) returning "id"`,
    [`test-${tag}-${name}`, jobLang, team],
  );
  batches.push(batch.id);
  const [job] = await systemRows<{ id: string }>(
    `insert into "regeneration_job"
       ("batchId", "lineId", "file", "npcName", "preview", "characters", "state", "version", "lang", "teamId")
     values ($1, $2, $3, '', '', 1, 'done', 1, $4, $5) returning "id"::text`,
    [batch.id, `g:${tag}-${name}`, `${tag}/${name}.mp3`, jobLang, team],
  );
  ids[name] = job.id;
  since ??= String(BigInt(job.id) - 1n);
}

const finishedOf = (seen: QueueSnapshot) =>
  seen.finished.filter((job) => job.lineId.startsWith(`g:${tag}-`)).map((job) => job.lineId);
const pausedOf = (seen: QueueSnapshot) =>
  seen.paused.filter((pause) => pause.lang === lang || pause.lang === single).map((pause) => pause.by).sort();

beforeEach(async () => {
  forgetTeams();
  tag = Math.random().toString(36).slice(2, 10);
  batches = [];
  since = undefined as unknown as string;
  lang = await uniqueLang();
  single = await uniqueLang();
  a = await newTeamIn(lang, true, "test-queue-a");
  b = await newTeamIn(lang, false, "test-queue-b");
  s = await newTeamIn(single, true, "test-queue-s");
  owner = await testUser("test-queue-owner");
  await asSystem.query(`update "user" set "role" = 'admin' where "id" = $1`, [owner.id]);
  await doneJob(a, lang, "a");
  await doneJob(b, lang, "b");
  await doneJob(s, single, "s");
  pausers = { a: await testUser("test-queue-pauser-a"), b: await testUser("test-queue-pauser-b") };
  for (const [team, pauser] of [[a, pausers.a], [b, pausers.b]] as const) {
    await asSystem.query(`insert into "regeneration_pause" ("lang", "teamId", "pausedBy") values ($1, $2, $3)`, [
      lang, team, pauser.id,
    ]);
  }
  mocks.cookie = undefined;
  mocks.session = { user: { id: owner.id, name: "Owner", role: "admin" } };
});

afterEach(async () => {
  vi.mocked(secondTeamLangs).mockClear();
  vi.mocked(freshOwners).mockClear();
  vi.mocked(snapshot).mockClear();
  // Cascades to the jobs.
  await asSystem.query(`delete from "regeneration_batch" where "id" = any($1::uuid[])`, [batches]);
  await asSystem.query(`delete from "regeneration_pause" where "teamId" = any($1::uuid[])`, [[a, b, s]]);
  await owner.cleanup();
  await pausers.a.cleanup();
  await pausers.b.cleanup();
  for (const team of [b, a, s]) await dropTeam(team);
  await dropLang(lang);
  await dropLang(single);
  forgetTeams();
});

afterAll(closeDb);

describe("snapshot with teams", () => {
  it("lists only the named team's finished lines and pauses in its language", async () => {
    const seen = await snapshot(since, { teams: new Map([[lang, b]]) });
    expect(finishedOf(seen)).toEqual([`g:${tag}-b`, `g:${tag}-s`]);
    expect(pausedOf(seen)).toEqual([pausers.b.id]);
  });

  it("lists every team's without", async () => {
    const seen = await snapshot(since);
    expect(finishedOf(seen)).toEqual([`g:${tag}-a`, `g:${tag}-b`, `g:${tag}-s`]);
    expect(pausedOf(seen)).toEqual([pausers.a.id, pausers.b.id].sort());
  });

  it("keeps a single-team language's rows whatever another language is narrowed to", async () => {
    const seen = await snapshot(since, { teams: new Map([[lang, a]]) });
    expect(finishedOf(seen)).toEqual([`g:${tag}-a`, `g:${tag}-s`]);
  });

  it("lists a narrowed language's finished lines from the panel's window when its team never dismissed", async () => {
    await doneJob(a, lang, "old");
    await asSystem.query(`update "regeneration_job" set "queuedAt" = now() - interval '2 days' where "id" = $1`, [ids.old]);
    expect(finishedOf(await snapshot(since, { teams: new Map([[lang, a]]) }))).toEqual([`g:${tag}-a`, `g:${tag}-s`]);
  });

  it("lists a narrowed language's line queued before the window that finished inside it", async () => {
    await doneJob(a, lang, "held");
    await asSystem.query(
      `update "regeneration_job" set "queuedAt" = now() - interval '2 days', "finishedAt" = now() where "id" = $1`,
      [ids.held],
    );
    expect(finishedOf(await snapshot(since, { teams: new Map([[lang, a]]) }))).toEqual([
      `g:${tag}-a`, `g:${tag}-s`, `g:${tag}-held`,
    ]);
  });

  it("moves the cursor past a narrowed line the global mark already passed, so it comes once", async () => {
    await asSystem.query(`insert into "queue_dismissal" ("teamId", "throughJobId") values ($1, $2)`, [b, ids.s]);
    try {
      const first = await snapshot(since, { teams: new Map([[lang, a]]) });
      expect(finishedOf(first)).toEqual([`g:${tag}-a`]);
      expect(finishedOf(await snapshot(first.cursor, { teams: new Map([[lang, a]]) }))).toEqual([]);
    } finally {
      await asSystem.query(`delete from "queue_dismissal" where "teamId" = $1`, [b]);
    }
  });

  it("says something is paused when the only pause is another team's", async () => {
    await asSystem.query(`delete from "regeneration_pause" where "teamId" = $1`, [a]);
    const seen = await snapshot(since, { teams: new Map([[lang, a]]) });
    expect(pausedOf(seen)).toEqual([]);
    expect(seen.pausedAnywhere).toBe(true);
  });

  it("hides a narrowed language's finished lines only behind their own team's dismissal", async () => {
    // Briefly the latest mark of all, which the panel cuts every other language at.
    await asSystem.query(`insert into "queue_dismissal" ("teamId", "throughJobId") values ($1, $2)`, [b, ids.b]);
    try {
      expect(finishedOf(await snapshot(since, { teams: new Map([[lang, a]]) }))).toEqual([`g:${tag}-a`, `g:${tag}-s`]);
      expect(finishedOf(await snapshot(since, { teams: new Map([[lang, b]]) }))).toEqual([`g:${tag}-s`]);
    } finally {
      await asSystem.query(`delete from "queue_dismissal" where "teamId" = $1`, [b]);
    }
  });
});

describe("GET /api/regenerate/queue", () => {
  const get = () => GET(new NextRequest(`https://example.com/api/regenerate/queue?since=${since}`));

  it("narrows a site owner's panel to the team the acting cookie picks", async () => {
    const [{ slug }] = await systemRows<{ slug: string }>(`select "slug" from "team" where "id" = $1`, [b]);
    mocks.cookie = encodeURIComponent(JSON.stringify({ [lang]: slug }));
    const seen = (await (await get()).json()) as QueueSnapshot;
    expect(finishedOf(seen)).toEqual([`g:${tag}-b`, `g:${tag}-s`]);
    expect(pausedOf(seen)).toEqual([pausers.b.id]);
  });

  it("narrows a site owner with no choice to the privileged team", async () => {
    const seen = (await (await get()).json()) as QueueSnapshot;
    expect(finishedOf(seen)).toEqual([`g:${tag}-a`, `g:${tag}-s`]);
  });

  it("passes no teams and reads no owners when no language has a second team", async () => {
    vi.mocked(secondTeamLangs).mockResolvedValueOnce(new Set());
    const seen = (await (await get()).json()) as QueueSnapshot;
    expect(freshOwners).not.toHaveBeenCalled();
    expect(vi.mocked(snapshot).mock.calls[0][1]).not.toHaveProperty("teams");
    expect(finishedOf(seen)).toEqual([`g:${tag}-a`, `g:${tag}-b`, `g:${tag}-s`]);
  });
});
