/**
 * Listing and undoing batches over HTTP, with real tokens and only grants mocked.
 *
 * Needs DATABASE_URL, migrations applied and the corpus imported.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import { keepLanguage } from "@/lib/quests/keep-language";
import { asSystem } from "@/lib/teams/testing";

vi.mock("@/lib/grants/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/grants/store")>()),
  viewerOf: async (session: { user: { role?: string | null } }) => ({
    role: session.user.role,
    grants: ["koKR", "zhTW"].map((lang) => ({ lang, capability: "text" })),
  }),
}));

import { PATCH } from "@/app/api/v1/[section]/route";
import { createFixtures, LANG, type Fixtures } from "@/lib/text-api/testing";
import { createToken, revokeToken } from "@/lib/tokens/store";

import { POST } from "./[batchId]/restore/route";
import { GET } from "./route";

let f: Fixtures;
let other: Fixtures;

const token = (userId: string, access: "read" | "write" = "write", lang: "koKR" | "zhTW" = LANG as "koKR") =>
  createToken({ userId, lang, access, label: "agent", expiresAt: new Date(Date.now() + 86_400_000) });

beforeEach(async () => {
  f = await createFixtures();
  other = await createFixtures();
  return async () => {
    await f.remove();
    await other.remove();
  };
});

keepLanguage(LANG);

afterAll(async () => {
  await closeDb();
});

const authed = (auth: string, method = "GET", body?: unknown) => ({
  method,
  headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

async function runBatch(auth: string, items: unknown[]): Promise<string> {
  const response = await PATCH(new Request("https://example.com/api/v1/places", authed(auth, "PATCH", { items })), {
    params: Promise.resolve({ section: "places" }),
  });
  return ((await response.json()) as { batchId: string }).batchId;
}

const restore = (auth: string, batchId: string) =>
  POST(new Request(`https://example.com/api/v1/batches/${batchId}/restore`, authed(auth, "POST")), {
    params: Promise.resolve({ batchId }),
  });

const list = (auth: string) => GET(new Request("https://example.com/api/v1/batches", authed(auth)));

describe("GET /api/v1/batches", () => {
  it("401 with no token", async () => {
    expect((await GET(new Request("https://example.com/api/v1/batches"))).status).toBe(401);
  });

  it("lists only the caller's, in the token's language", async () => {
    const mine = await token(f.user);
    const batchId = await runBatch(mine.token, [{ id: f.zone, text: "내 것." }]);
    await runBatch((await token(other.user)).token, [{ id: other.zone, text: "남의 것." }]);

    const body = (await (await list(mine.token)).json()) as { batches: { id: string }[] };
    expect(body.batches.map((b) => b.id)).toEqual([batchId]);

    const zhTW = await token(f.user, "read", "zhTW");
    const none = (await (await list(zhTW.token)).json()) as { batches: unknown[] };
    expect(none.batches).toEqual([]);
  });

  it("still lists a run that failed on every item", async () => {
    const mine = await token(f.user);
    const batchId = await runBatch(mine.token, [{ id: "z:nothing", text: "글." }]);
    const body = (await (await list(mine.token)).json()) as { batches: { id: string }[] };
    expect(body.batches.map((b) => b.id)).toContain(batchId);
  });
});

describe("POST /api/v1/batches/[batchId]/restore", () => {
  it("undoes the batch", async () => {
    const mine = await token(f.user);
    const batchId = await runBatch(mine.token, [{ id: f.zone, text: "되돌림." }]);
    const response = await restore(mine.token, batchId);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results: [{ id: f.zone, field: "text", status: "retired" }] });
  });

  it("survives its token being revoked: a new token restores it", async () => {
    const first = await token(f.user);
    const batchId = await runBatch(first.token, [{ id: f.zone, text: "되돌림." }]);
    await revokeToken(first.row.id, f.user);
    expect((await restore((await token(f.user)).token, batchId)).status).toBe(200);
  });

  it("403 for a read token", async () => {
    const mine = await token(f.user);
    const batchId = await runBatch(mine.token, [{ id: f.zone, text: "되돌림." }]);
    expect((await restore((await token(f.user, "read")).token, batchId)).status).toBe(403);
  });

  it("403 for another user", async () => {
    const batchId = await runBatch((await token(f.user)).token, [{ id: f.zone, text: "되돌림." }]);
    expect((await restore((await token(other.user)).token, batchId)).status).toBe(403);
  });

  it("lets a global admin restore anyone's", async () => {
    const batchId = await runBatch((await token(f.user)).token, [{ id: f.zone, text: "되돌림." }]);
    await asSystem.query(`update "user" set "role" = 'admin' where "id" = $1`, [other.user]);
    expect((await restore((await token(other.user)).token, batchId)).status).toBe(200);
  });

  it("403 for a token in another language, admin or not", async () => {
    const batchId = await runBatch((await token(f.user)).token, [{ id: f.zone, text: "되돌림." }]);
    expect((await restore((await token(f.user, "write", "zhTW")).token, batchId)).status).toBe(403);
    await asSystem.query(`update "user" set "role" = 'admin' where "id" = $1`, [other.user]);
    expect((await restore((await token(other.user, "write", "zhTW")).token, batchId)).status).toBe(403);
  });

  it("404 on an unknown id and on one that is no uuid", async () => {
    const mine = await token(f.user);
    expect((await restore(mine.token, "00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await restore(mine.token, "nope")).status).toBe(404);
  });
});
