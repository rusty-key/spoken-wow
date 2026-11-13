/**
 * Creating, listing and revoking API tokens from a session, with the session and grants mocked
 * and the store real.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import type { Grant } from "@/lib/permissions";
import { asSystem } from "@/lib/teams/testing";

const viewer = vi.hoisted(() => ({ id: "", role: null as string | null, grants: [] as Grant[] }));

vi.mock("@/lib/session", () => ({
  currentSession: async () => ({ user: { id: viewer.id, role: viewer.role } }),
}));
vi.mock("@/lib/grants/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/grants/store")>()),
  viewerOf: async () => ({ role: viewer.role, grants: viewer.grants }),
}));

import { GET as adminGet, DELETE as adminDelete } from "@/app/api/tokens/route";

import { DELETE } from "./[id]/route";
import { GET, POST } from "./route";

const USER = `test-tokens-${Math.random().toString(36).slice(2, 10)}`;
const OTHER = `${USER}-other`;
const FUTURE = () => new Date(Date.now() + 86_400_000).toISOString();

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("https://example.com/api/profile/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const VALID = () => ({ lang: "deDE", access: "write", label: "agent", expiresAt: FUTURE() });

function remove(id: string): Promise<Response> {
  return DELETE(new Request(`https://example.com/api/profile/tokens/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });
}

beforeAll(async () => {
  for (const id of [USER, OTHER]) {
    await asSystem.query(
      `insert into "user" ("id", "name", "email", "emailVerified") values ($1, 'Test Tokens', $2, false)`,
      [id, `${id}@example.invalid`],
    );
  }
});

beforeEach(() => {
  viewer.id = USER;
  viewer.role = null;
  viewer.grants = [{ lang: "deDE", capability: "text" }];
});

afterAll(async () => {
  await asSystem.query(`delete from "user" where "id" = any($1)`, [[USER, OTHER]]);
  await closeDb();
});

describe("POST /api/profile/tokens", () => {
  it("creates a token where the session holds text", async () => {
    const response = await post(VALID());
    expect(response.status).toBe(200);
    expect(((await response.json()) as { token: string }).token).toMatch(/^spk_/);
  });

  it("403 in a language where the session does not hold text", async () => {
    expect((await post({ ...VALID(), lang: "frFR" })).status).toBe(403);
  });

  it.each([
    ["label", { label: "  " }],
    ["access", { access: "admin" }],
    ["expiry that is missing", { expiresAt: undefined }],
    ["expiry that is unreadable", { expiresAt: "soon" }],
    ["expiry in the past", { expiresAt: new Date(Date.now() - 1000).toISOString() }],
    ["language", { lang: "xxXX" }],
  ])("400 on a bad %s", async (_name, change) => {
    expect((await post({ ...VALID(), ...change })).status).toBe(400);
  });
});

describe("GET /api/profile/tokens", () => {
  it("lists the caller's tokens and never carries the token", async () => {
    const created = (await (await post(VALID())).json()) as { token: string; row: { id: string } };
    const body = await (await GET()).text();
    expect(body).toContain(created.row.id);
    expect(body).not.toContain(created.token);
  });
});

describe("DELETE /api/profile/tokens/[id]", () => {
  it("revokes the caller's own token", async () => {
    const { row } = (await (await post(VALID())).json()) as { row: { id: string } };
    expect((await remove(row.id)).status).toBe(200);
  });

  it("404 on another user's token", async () => {
    const { row } = (await (await post(VALID())).json()) as { row: { id: string } };
    viewer.id = OTHER;
    expect((await remove(row.id)).status).toBe(404);
  });

  it("404 on an id that is no uuid", async () => {
    expect((await remove("nope")).status).toBe(404);
  });
});

describe("/api/tokens", () => {
  it("403 for somebody who is no global admin", async () => {
    expect((await adminGet()).status).toBe(403);
    expect(
      (await adminDelete(new Request("https://example.com/api/tokens?id=x", { method: "DELETE" }))).status,
    ).toBe(403);
  });

  it("lets a global admin list and revoke anyone's", async () => {
    const { row } = (await (await post(VALID())).json()) as { row: { id: string } };
    viewer.id = OTHER;
    viewer.role = "admin";
    expect(await (await adminGet()).text()).toContain(row.id);
    const response = await adminDelete(
      new Request(`https://example.com/api/tokens?id=${row.id}`, { method: "DELETE" }),
    );
    expect(response.status).toBe(200);
  });
});
