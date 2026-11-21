/**
 * Changing a contribution's status.
 *
 * A separate route rather than a second verb on /api/contributions, for the reason
 * api/reports/resolve/route.ts gives: that path is open to the whole internet and this one must
 * never be, and two verbs on one path with opposite access rules is what a later edit breaks.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";
import { asSystem } from "@/lib/teams/testing";

/** resolvedBy has a foreign key, so resolving needs a user that exists (contributions/store.test.ts). */
const RESOLVER = "test-contributions-resolve-route";

const held = vi.hoisted(() => ({ capability: "text" }));

vi.mock("@/lib/generation/authz", () => ({
  requireCapability: async (capability: string) =>
    capability === held.capability
      ? { session: { user: { id: RESOLVER } }, denied: null }
      : { session: null, denied: Response.json({ error: "not allowed" }, { status: 403 }) },
  mayIgnoreIn: async () => false,
}));

import { POST } from "./route";

/** A bucket no other run shares, so a concurrent run's cleanup can't race this one's rows. */
const ip = `test-${Math.random().toString(36).slice(2, 10)}`;
const dedup = `test-${Math.random().toString(36).slice(2, 10)}`;

beforeAll(async () => {
  await asSystem.query(
    `insert into "user" ("id", "name", "email", "emailVerified")
     values ($1, 'Test Resolver', $2, false)
     on conflict ("id") do nothing`,
    [RESOLVER, `${RESOLVER}@example.invalid`],
  );
});

afterEach(async () => {
  await asSystem.query(
    `delete from "activity" where "kind" = 'contribution.resolved'
        and "subject" in (select "id"::text from "contribution" where "ip" = $1)`,
    [ip],
  );
  await asSystem.query(`delete from "contribution" where "ip" = $1`, [ip]);
});

afterAll(async () => {
  await asSystem.query(`delete from "user" where "id" = $1`, [RESOLVER]);
  await closeDb();
});

function post(body: unknown): Request {
  return new Request("https://example.com/api/contributions/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/contributions/resolve", () => {
  it("answers 403 to a team's edit without text", async () => {
    held.capability = "edit";
    const response = await POST(post({ id: 1, status: "accepted" }));
    held.capability = "text";
    expect(response.status).toBe(403);
  });

  it("accepts a row", async () => {
    // Places: accepting a quests or readables row also writes it (lib/contributions/accept.ts),
    // which is its own test suite (accept.test.ts). This is just the plain status flip.
    const { rows } = await asSystem.query<{ id: number }>(
      `insert into "contribution" ("source", "key", "raw", "dedup", "text", "ip")
       values ('places', '123', 'raw', $2, 'Words.', $1) returning "id"`,
      [ip, `${dedup}-accept`],
    );
    const response = await POST(post({ id: rows[0].id, status: "accepted" }));
    expect(response.status).toBe(200);
    expect((await response.json()).contribution.status).toBe("accepted");
  });

  it("refuses a status it does not know", async () => {
    expect((await POST(post({ id: 1, status: "maybe" }))).status).toBe(400);
  });

  it("answers 404 for an id that is not there", async () => {
    expect((await POST(post({ id: 999_999_999, status: "accepted" }))).status).toBe(404);
  });

  it("refuses 409, with {error, kind}, to accept a quests row with no resolved speaker", async () => {
    // No npc_resolution row for this npc at all -- resolvedSpeaker (accept.ts) answers null,
    // which is the route's mapping of a ResolveRefusal this test exists to pin: needs-speaker
    // and one-way are both 409s carrying `kind`, not the bare 400/404 the other refusals get.
    // Far outside anything the corpus or a real submission could produce -- no npc_resolution
    // row is written for it, but the id itself must still never collide with real data.
    const npcId = 970_000_000 + Math.floor(Math.random() * 20_000_000);
    const { rows } = await asSystem.query<{ id: number }>(
      `insert into "contribution" ("source", "key", "raw", "dedup", "text", "ip", "meta")
       values ('quests', $4, 'raw', $2, 'Words.', $1, $3::jsonb) returning "id"`,
      [ip, `${dedup}-needs-speaker`, JSON.stringify({ kind: "creature", npc: `${npcId} Nobody` }), `npc:${npcId}`],
    );
    const response = await POST(post({ id: rows[0].id, status: "accepted" }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.kind).toBe("needs-speaker");
    expect(typeof body.error).toBe("string");

    const { rows: after } = await asSystem.query(`select "status" from "contribution" where "id" = $1`, [rows[0].id]);
    expect(after[0].status).toBe("new");
  });

  it("accepts a row with the reviewer's edit of its text", async () => {
    const { rows } = await asSystem.query<{ id: number }>(
      `insert into "contribution" ("source", "key", "raw", "dedup", "text", "ip")
       values ('places', '124', 'raw', $2, 'Hallo, Digawen.', $1) returning "id"`,
      [ip, `${dedup}-edit`],
    );
    const response = await POST(post({ id: rows[0].id, status: "accepted", text: "Hallo, $N." }));
    expect(response.status).toBe(200);
    const { rows: after } = await asSystem.query(`select "status", "text" from "contribution" where "id" = $1`, [rows[0].id]);
    expect(after[0]).toEqual({ status: "accepted", text: "Hallo, $N." });
  });

  it("puts the sent text back when an accept with an edit is refused", async () => {
    const npcId = 970_000_000 + Math.floor(Math.random() * 20_000_000);
    const { rows } = await asSystem.query<{ id: number }>(
      `insert into "contribution" ("source", "key", "raw", "dedup", "text", "ip", "meta")
       values ('quests', $4, 'raw', $2, 'Hallo, Digawen.', $1, $3::jsonb) returning "id"`,
      [ip, `${dedup}-edit-refused`, JSON.stringify({ kind: "creature", npc: `${npcId} Nobody` }), `npc:${npcId}`],
    );
    const response = await POST(post({ id: rows[0].id, status: "accepted", text: "Hallo, $N." }));
    expect(response.status).toBe(409);
    const { rows: after } = await asSystem.query(`select "status", "text" from "contribution" where "id" = $1`, [rows[0].id]);
    expect(after[0]).toEqual({ status: "new", text: "Hallo, Digawen." });
  });

  it("refuses an edit to a row someone decided meanwhile, keeping its text", async () => {
    const { rows } = await asSystem.query<{ id: number }>(
      `insert into "contribution" ("source", "key", "raw", "dedup", "text", "ip", "status")
       values ('places', '127', 'raw', $2, 'Words.', $1, 'rejected') returning "id"`,
      [ip, `${dedup}-decided`],
    );
    const response = await POST(post({ id: rows[0].id, status: "accepted", text: "Other words." }));
    expect(response.status).toBe(409);
    expect((await response.json()).kind).toBe("changed");
    const { rows: after } = await asSystem.query(`select "status", "text" from "contribution" where "id" = $1`, [rows[0].id]);
    expect(after[0]).toEqual({ status: "rejected", text: "Words." });
  });

  it("refuses an empty edit without touching the row", async () => {
    const { rows } = await asSystem.query<{ id: number }>(
      `insert into "contribution" ("source", "key", "raw", "dedup", "text", "ip")
       values ('places', '125', 'raw', $2, 'Words.', $1) returning "id"`,
      [ip, `${dedup}-empty`],
    );
    expect((await POST(post({ id: rows[0].id, status: "accepted", text: "   " }))).status).toBe(400);
    const { rows: after } = await asSystem.query(`select "status", "text" from "contribution" where "id" = $1`, [rows[0].id]);
    expect(after[0]).toEqual({ status: "new", text: "Words." });
  });

  it("records a reject's reason, and drops it when the row is reopened", async () => {
    const { rows } = await asSystem.query<{ id: number }>(
      `insert into "contribution" ("source", "key", "raw", "dedup", "text", "ip")
       values ('places', '126', 'raw', $2, 'Words', $1) returning "id"`,
      [ip, `${dedup}-reason`],
    );
    const id = rows[0].id;
    expect((await POST(post({ id, status: "rejected", reason: "  Cut off  " }))).status).toBe(200);
    const reasonOf = async () =>
      (await asSystem.query(`select "rejectReason" from "contribution" where "id" = $1`, [id])).rows[0].rejectReason;
    expect(await reasonOf()).toBe("Cut off");
    expect((await POST(post({ id, status: "new" }))).status).toBe(200);
    expect(await reasonOf()).toBeNull();
    // A reason sent with anything but a reject is not recorded.
    expect((await POST(post({ id, status: "accepted", reason: "Cut off" }))).status).toBe(200);
    expect(await reasonOf()).toBeNull();
  });
});
