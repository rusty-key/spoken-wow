/**
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import { asSystem, testUser } from "@/lib/teams/testing";

const { held, userId } = vi.hoisted(() => ({ held: { capability: "edit" }, userId: { id: "" } }));

vi.mock("@/lib/generation/authz", () => ({
  requireCapability: async (capability: string) =>
    capability === held.capability
      ? { session: { user: { id: userId.id } }, denied: null }
      : { session: null, denied: Response.json({ error: "not allowed" }, { status: 403 }) },
}));

import { POST } from "./route";

let user: Awaited<ReturnType<typeof testUser>>;

function post(body: unknown): Request {
  return new Request("https://example.com/api/reports/pass", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function filed(queue: string): Promise<number> {
  const { rows } = await asSystem.query<{ id: number }>(
    `insert into "report" ("source", "lang", "lineId", "target", "category", "body", "teamId", "queue", "ip")
     values ('quests', 'ptBR', 'q:1:accept', 'text', 'other', 'test', team_of_lang('ptBR'), $1, $2) returning "id"`,
    [queue, user.id],
  );
  return rows[0].id;
}

beforeAll(async () => {
  user = await testUser("test-report-pass");
  userId.id = user.id;
});

afterAll(async () => {
  await asSystem.query(`delete from "activity" where "actorId" = $1`, [user.id]);
  await asSystem.query(`delete from "report" where "ip" = $1`, [user.id]);
  await user.cleanup();
  await closeDb();
});

describe("POST /api/reports/pass", () => {
  it("lets a holder of the current queue move it, and logs it", async () => {
    const id = await filed("audio");
    held.capability = "edit";
    const response = await POST(post({ id, to: "text" }));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { report: { queue: string } }).report.queue).toBe("text");
    const { rows } = await asSystem.query(
      `select "detail", "actorId" from "activity" where "kind" = 'report.passed' and "subject" = $1`,
      [String(id)],
    );
    expect(rows).toEqual([{ detail: { to: "text" }, actorId: user.id }]);
  });

  it("answers 403 to somebody who holds only the queue it is going to", async () => {
    const id = await filed("audio");
    held.capability = "text";
    expect((await POST(post({ id, to: "text" }))).status).toBe(403);
    const { rows } = await asSystem.query(`select "queue" from "report" where "id" = $1`, [id]);
    expect(rows).toEqual([{ queue: "audio" }]);
  });

  it("refuses a queue that does not exist", async () => {
    const id = await filed("audio");
    held.capability = "edit";
    expect((await POST(post({ id, to: "elsewhere" }))).status).toBe(400);
  });

  it("answers 404 for an id that is not there", async () => {
    held.capability = "edit";
    expect((await POST(post({ id: 2 ** 40, to: "text" }))).status).toBe(404);
  });
});
