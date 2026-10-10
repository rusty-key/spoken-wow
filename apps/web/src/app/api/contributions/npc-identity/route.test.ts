/**
 * Which NPC speaks a quest contribution whose envelope named none, answered by an admin.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";

/** Whether the mocked viewer is a global admin. */
let admin = false;
const resolved: unknown[] = [];

vi.mock("@/lib/admin-guard", () => ({
  requireAdminSession: async () =>
    admin
      ? { session: { user: { id: "test" } }, denied: null }
      : { session: null, denied: Response.json({ error: "not allowed" }, { status: 403 }) },
}));

// The corpus scan is resolve.ts's own business and tested there; this only needs to see it asked.
vi.mock("@/lib/npc/resolve", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/npc/resolve")>()),
  resolveNpc: async (observed: unknown) => {
    resolved.push(observed);
    return null;
  },
}));

// Mocked to assert the row's shape. A real insert would not fail the test -- recordActivity
// swallows its own errors outside a transaction -- but the session's "test" user does not
// exist, so it would only log a foreign-key error and leave nothing to check.
const { recordActivity } = vi.hoisted(() => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/activity/store", () => ({ recordActivity }));

import { POST } from "./route";

/** A bucket no other run shares, so a concurrent run's cleanup can't race this one's rows. */
const ip = `test-${Math.random().toString(36).slice(2, 10)}`;

afterEach(async () => {
  admin = false;
  resolved.length = 0;
  recordActivity.mockClear();
  await db().query(`delete from "contribution" where "ip" = $1`, [ip]);
});

afterAll(async () => {
  await closeDb();
});

async function contribution(meta: Record<string, string>, source = "quests"): Promise<number> {
  const { rows } = await db().query<{ id: number }>(
    `insert into "contribution" ("source", "key", "locale", "build", "meta", "raw", "dedup", "text", "ip")
     values ($4, 'q:1:accept', 'ptBR', '1.15.7/1', $2, 'raw', $3, 'Words.', $1) returning "id"`,
    [ip, JSON.stringify(meta), `${ip}-${Math.random()}`, source],
  );
  return rows[0].id;
}

function post(body: unknown): Request {
  return new Request("https://example.com/api/contributions/npc-identity", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/contributions/npc-identity", () => {
  it("records the NPC and resolves it", async () => {
    const id = await contribution({});
    admin = true;
    const response = await POST(post({ id, npcKind: "creature", npcId: 240, npcName: " Marshal Dughan " }));
    expect(response.status).toBe(200);
    const { rows } = await db().query(`select "npcKind", "npcId", "npcName" from "contribution" where "id" = $1`, [id]);
    expect(rows[0]).toEqual({ npcKind: "creature", npcId: 240, npcName: "Marshal Dughan" });
    expect(resolved).toEqual([expect.objectContaining({ npcKind: "creature", npcId: 240, npcName: "Marshal Dughan", build: "1.15.7/1" })]);
    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "contribution.edited", subject: String(id), actorId: "test" }),
    );
  });

  it("requires both the id and the name", async () => {
    const id = await contribution({});
    admin = true;
    expect((await POST(post({ id, npcKind: "creature", npcId: "240", npcName: "X" }))).status).toBe(400);
    expect((await POST(post({ id, npcKind: "creature", npcId: 240, npcName: "  " }))).status).toBe(400);
    expect((await POST(post({ id, npcKind: "creature", npcId: -1, npcName: "X" }))).status).toBe(400);
  });

  it("leaves an envelope's own NPC alone", async () => {
    const id = await contribution({ npc: "12345 X", kind: "creature" });
    admin = true;
    expect((await POST(post({ id, npcKind: "creature", npcId: 240, npcName: "Y" }))).status).toBe(409);
    expect(resolved).toEqual([]);
  });

  it("leaves a row that is not a quest's alone", async () => {
    const id = await contribution({}, "zones");
    admin = true;
    expect((await POST(post({ id, npcKind: "creature", npcId: 240, npcName: "Y" }))).status).toBe(409);
  });

  it("refuses anyone but an admin, whatever languages they edit", async () => {
    const id = await contribution({});
    expect((await POST(post({ id, npcKind: "creature", npcId: 240, npcName: "Y" }))).status).toBe(403);
  });
});
