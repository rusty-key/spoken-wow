/**
 * That this route is gated at all is the point of testing it: its sibling POST is open to the
 * internet, and the two are one careless edit away from sharing an access rule.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";
import { asSystem } from "@/lib/teams/testing";

const { authorise } = vi.hoisted(() => ({ authorise: vi.fn() }));

vi.mock("@/lib/generation/authz", () => ({
  requireCapability: async (...args: unknown[]) => authorise(...args),
}));

/** resolvedBy has a foreign key, so resolving needs a user that exists. */
const RESOLVER = "test-report-resolve-route";

import { POST } from "./route";

function post(body: unknown): Request {
  return new Request("https://example.com/api/reports/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await asSystem.query(
    `insert into "user" ("id", "name", "email", "emailVerified")
     values ($1, 'Test Resolver', $2, false)
     on conflict ("id") do nothing`,
    [RESOLVER, `${RESOLVER}@example.invalid`],
  );
});

afterAll(async () => {
  await asSystem.query(`delete from "activity" where "actorId" = $1`, [RESOLVER]);
  await asSystem.query(`delete from "user" where "id" = $1`, [RESOLVER]);
  await closeDb();
});

describe("POST /api/reports/resolve", () => {
  it("returns the 403 a denied session carries", async () => {
    authorise.mockResolvedValueOnce({
      session: null,
      denied: Response.json({ error: "not allowed" }, { status: 403 }),
    });

    expect((await POST(post({ id: 1, status: "fixed" }))).status).toBe(403);
  });

  it("asks for edit in the report's own language", async () => {
    const { rows } = await asSystem.query<{ id: number }>(
      `insert into "report" ("source", "lang", "lineId", "target", "category", "body", "teamId")
       values ('quests', 'ptBR', 'q:1:accept', 'text', 'wrong_text', 'test', team_of_lang('ptBR')) returning "id"`,
    );
    try {
      authorise.mockResolvedValueOnce({
        session: null,
        denied: Response.json({ error: "not allowed" }, { status: 403 }),
      });
      expect((await POST(post({ id: rows[0].id, status: "fixed" }))).status).toBe(403);
      expect(authorise).toHaveBeenLastCalledWith("edit", "ptBR");
    } finally {
      await asSystem.query(`delete from "report" where "id" = $1`, [rows[0].id]);
    }
  });

  it("records the resolution in the activity log", async () => {
    const { rows } = await asSystem.query<{ id: number }>(
      `insert into "report" ("source", "lang", "lineId", "target", "category", "body", "teamId")
       values ('quests', 'ptBR', 'q:1:accept', 'text', 'wrong_text', 'test', team_of_lang('ptBR')) returning "id"`,
    );
    try {
      authorise.mockResolvedValueOnce({ session: { user: { id: RESOLVER } }, denied: null });
      expect((await POST(post({ id: rows[0].id, status: "fixed" }))).status).toBe(200);
      const { rows: logged } = await asSystem.query(
        `select "lang", "source", "lineId", "actorId", "detail" from "activity"
          where "kind" = 'report.resolved' and "subject" = $1`,
        [String(rows[0].id)],
      );
      expect(logged).toEqual([
        {
          lang: "ptBR",
          source: "quests",
          lineId: "q:1:accept",
          actorId: RESOLVER,
          detail: { status: "fixed", category: "wrong_text" },
        },
      ]);
    } finally {
      await asSystem.query(`delete from "report" where "id" = $1`, [rows[0].id]);
    }
  });

  it("rejects a status outside the closed set", async () => {
    authorise.mockResolvedValueOnce({ session: { user: { id: "u1" } }, denied: null });

    expect((await POST(post({ id: 1, status: "resolved" }))).status).toBe(400);
  });

  it("404s an id that does not exist", async () => {
    authorise.mockResolvedValueOnce({ session: { user: { id: "u1" } }, denied: null });

    expect((await POST(post({ id: 2147483000, status: "fixed" }))).status).toBe(404);
  });

  it("404s a malformed id without reaching the database", async () => {
    authorise.mockResolvedValueOnce({ session: { user: { id: "u1" } }, denied: null });

    expect((await POST(post({ id: "not-a-number", status: "fixed" }))).status).toBe(404);
  });
});
