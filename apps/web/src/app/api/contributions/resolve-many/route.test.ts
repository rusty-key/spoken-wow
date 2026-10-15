/**
 * Changing many contributions' status in one request.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";

/** resolvedBy has a foreign key, so resolving needs a user that exists (contributions/store.test.ts). */
const RESOLVER = "test-contributions-resolve-many-route";

vi.mock("@/lib/generation/authz", () => ({
  requireCapability: async () => ({ session: { user: { id: RESOLVER } }, denied: null }),
  mayIgnoreIn: async () => false,
}));

import { RESOLVE_MANY_MAX } from "@/lib/contributions/contributions";

import { POST } from "./route";

/** A bucket no other run shares, so a concurrent run's cleanup can't race this one's rows. */
const ip = `test-${Math.random().toString(36).slice(2, 10)}`;
const dedup = `test-${Math.random().toString(36).slice(2, 10)}`;

beforeAll(async () => {
  await db().query(
    `insert into "user" ("id", "name", "email", "emailVerified")
     values ($1, 'Test Resolver', $2, false)
     on conflict ("id") do nothing`,
    [RESOLVER, `${RESOLVER}@example.invalid`],
  );
});

afterEach(async () => {
  await db().query(
    `delete from "activity" where "kind" = 'contribution.resolved'
        and "subject" in (select "id"::text from "contribution" where "ip" = $1)`,
    [ip],
  );
  await db().query(`delete from "contribution" where "ip" = $1`, [ip]);
});

afterAll(async () => {
  await db().query(`delete from "user" where "id" = $1`, [RESOLVER]);
  await closeDb();
});

function post(body: unknown): Request {
  return new Request("https://example.com/api/contributions/resolve-many", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/contributions/resolve-many", () => {
  it("resolves every row it is sent and answers each by id", async () => {
    // Books, not quests: the plain status flip (accept.test.ts covers quest lines in a batch).
    const { rows } = await db().query<{ id: number }>(
      `insert into "contribution" ("source", "key", "raw", "dedup", "text", "ip")
       values ('books', '1', 'raw', $2, 'Words.', $1), ('books', '2', 'raw', $3, 'More.', $1)
       returning "id"`,
      [ip, `${dedup}-a`, `${dedup}-b`],
    );
    const ids = rows.map((row) => row.id);
    const response = await POST(post({ ids: [...ids, 999_999_999], status: "rejected" }));
    expect(response.status).toBe(200);
    const { results } = await response.json();
    expect(results[ids[0]]).toEqual({ ok: true });
    expect(results[ids[1]]).toEqual({ ok: true });
    expect(results[999_999_999]).toEqual({ ok: false, error: "unknown contribution" });

    const { rows: statuses } = await db().query<{ status: string }>(
      `select "status" from "contribution" where "id" = any($1::int[])`,
      [ids],
    );
    expect(statuses.map((row) => row.status)).toEqual(["rejected", "rejected"]);
  });

  it("refuses a status it does not know", async () => {
    expect((await POST(post({ ids: [1], status: "maybe" }))).status).toBe(400);
  });

  it("refuses no ids, or more than one request takes", async () => {
    expect((await POST(post({ ids: [], status: "accepted" }))).status).toBe(400);
    const tooMany = Array.from({ length: RESOLVE_MANY_MAX + 1 }, (_, i) => i + 1);
    expect((await POST(post({ ids: tooMany, status: "accepted" }))).status).toBe(400);
  });
});
