/**
 * Stop is the one queue control that throws work away, so what it may reach is the point:
 * a translator's Stop must halt their language and nobody else's, and a site owner's every
 * team's.
 *
 * The second half needs DATABASE_URL and migrations applied. Its jobs are inserted pending and
 * cancelled after each test; no worker runs and nothing generates.
 */
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authorise, cancelPending } = vi.hoisted(() => ({
  authorise: vi.fn(),
  cancelPending: vi.fn(),
}));

vi.mock("@/lib/generation/authz", () => ({
  requireAnyRegenerate: async () => authorise(),
}));
vi.mock("@/lib/generation/boot", () => ({ ensureQueueRunning: () => {} }));
vi.mock("@/lib/generation/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/generation/queue")>();
  cancelPending.mockImplementation(actual.cancelPending);
  return { ...actual, cancelPending };
});

import { closeDb } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { asActor } from "@/lib/teams/acting";
import { forgetTeams, type TeamId } from "@/lib/teams/store";
import { addMember, asSystem, dropLang, dropTeam, newTeamIn, systemRows, testUser, uniqueLang } from "@/lib/teams/testing";

import { POST } from "./route";

function post(body: unknown): NextRequest {
  return new NextRequest("https://example.com/api/regenerate/queue/stop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterAll(closeDb);

describe("POST /api/regenerate/queue/stop", () => {
  it("returns the 403 a denied session carries", async () => {
    authorise.mockResolvedValueOnce({
      session: null,
      langs: null,
      denied: Response.json({ error: "not allowed" }, { status: 403 }),
    });

    expect((await POST(post({}))).status).toBe(403);
    expect(cancelPending).not.toHaveBeenCalled();
  });

  it("cancels only the languages the caller regenerates in", async () => {
    cancelPending.mockResolvedValueOnce(3);
    authorise.mockResolvedValueOnce({
      session: { user: { id: "u1", name: "Ana" } },
      langs: ["ptBR"],
      denied: null,
    });

    const response = await POST(post({ batchId: "b1" }));

    expect(await response.json()).toEqual({ cancelled: 3 });
    expect(cancelPending).toHaveBeenCalledWith("Stopped by Ana", {
      batchId: "b1",
      langs: ["ptBR"],
      by: "u1",
      everyTeam: false,
    });
  });
});

describe("POST /api/regenerate/queue/stop in a language with a second team", () => {
  let lang: Lang;
  let a: TeamId;
  let b: TeamId;
  let batchA: string;
  let batchB: string;
  let owner: Awaited<ReturnType<typeof testUser>>;
  let member: Awaited<ReturnType<typeof testUser>>;

  async function pendingJob(team: TeamId): Promise<string> {
    const tag = Math.random().toString(36).slice(2, 10);
    const [batch] = await systemRows<{ id: string }>(
      `insert into "regeneration_batch" ("label", "lang", "teamId") values ($1, $2, $3) returning "id"`,
      [`test-stop-${tag}`, lang, team],
    );
    await asSystem.query(
      `insert into "regeneration_job" ("batchId", "lineId", "file", "npcName", "preview", "characters", "lang", "teamId")
       values ($1, $2, $3, '', '', 1, $4, $5)`,
      [batch.id, `g:${tag}`, `test-stop/${tag}.mp3`, lang, team],
    );
    return batch.id;
  }

  const states = async () =>
    Object.fromEntries(
      (
        await systemRows<{ batchId: string; state: string }>(
          `select "batchId", "state" from "regeneration_job" where "batchId" = any($1::uuid[])`,
          [[batchA, batchB]],
        )
      ).map((row) => [row.batchId === batchA ? "a" : "b", row.state]),
    );

  const stoppedBecause = async (batch: string) =>
    (await systemRows<{ stoppedBecause: string | null }>(
      `select "stoppedBecause" from "regeneration_batch" where "id" = $1`,
      [batch],
    ))[0].stoppedBecause;

  const as = (user: { id: string }, role: string | null) =>
    authorise.mockResolvedValueOnce({ session: { user: { id: user.id, name: "Stopper", role } }, langs: [lang], denied: null });

  beforeEach(async () => {
    lang = await uniqueLang();
    a = await newTeamIn(lang, true, "test-stop-a");
    b = await newTeamIn(lang, false, "test-stop-b");
    owner = await testUser("test-stop-owner");
    member = await testUser("test-stop-member");
    await addMember(a, member.id, lang, "regenerate");
    batchA = await pendingJob(a);
    batchB = await pendingJob(b);
  });

  afterEach(async () => {
    await asSystem.query(
      `update "regeneration_job" set "state" = 'cancelled', "finishedAt" = now()
        where "batchId" = any($1::uuid[]) and "state" = 'pending'`,
      [[batchA, batchB]],
    );
    // Cascades to the jobs.
    await asSystem.query(`delete from "regeneration_batch" where "id" = any($1::uuid[])`, [[batchA, batchB]]);
    await asSystem.query(`delete from "activity" where "teamId" = any($1::uuid[])`, [[a, b]]);
    for (const team of [b, a]) await dropTeam(team);
    await dropLang(lang);
    await owner.cleanup();
    await member.cleanup();
    forgetTeams();
  });

  it("cancels every team's pending work for a site owner", async () => {
    as(owner, "admin");
    expect(await (await POST(post({}))).json()).toEqual({ cancelled: 2 });
    expect(await states()).toEqual({ a: "cancelled", b: "cancelled" });
    expect(await stoppedBecause(batchB)).toBe("Stopped by Stopper");
  });

  it("cancels only a second team's batch named by id, though the site owner acts as the privileged team", async () => {
    as(owner, "admin");
    expect(await (await POST(post({ batchId: batchB }))).json()).toEqual({ cancelled: 1 });
    expect(await states()).toEqual({ a: "pending", b: "cancelled" });
    expect(await stoppedBecause(batchB)).toBe("Stopped by Stopper");
    expect(await stoppedBecause(batchA)).toBeNull();
  });

  it("cancels only a member's own team's work", async () => {
    as(member, null);
    expect(await asActor(member.id, async () => (await POST(post({}))).json())).toEqual({ cancelled: 1 });
    expect(await states()).toEqual({ a: "cancelled", b: "pending" });
    expect(await stoppedBecause(batchB)).toBeNull();
  });
});
