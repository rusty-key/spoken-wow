/**
 * The bearer guard, with real tokens and only the grants mocked: losing a grant must kill a
 * token that is otherwise live.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import type { Grant } from "@/lib/permissions";
import { asSystem } from "@/lib/teams/testing";

const viewer = vi.hoisted(() => ({ grants: [] as Grant[] }));

vi.mock("@/lib/grants/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/grants/store")>()),
  viewerOf: async (session: { user: { role?: string | null } }) => ({
    role: session.user.role,
    grants: viewer.grants,
  }),
}));

import { createToken, revokeToken } from "@/lib/tokens/store";
import type { TokenAccess } from "@/lib/tokens/types";

import { requireToken } from "./guard";

const USER = `test-guard-${Math.random().toString(36).slice(2, 10)}`;

function make(access: TokenAccess = "write", userId = USER, generate = false) {
  return createToken({
    userId,
    lang: "deDE",
    access,
    generate,
    label: "agent",
    expiresAt: new Date(Date.now() + 86_400_000),
  });
}

function request(token?: string, method = "GET", query = ""): Request {
  return new Request(`https://example.com/api/v1/places${query}`, {
    method,
    headers: token === undefined ? {} : { authorization: token },
  });
}

beforeAll(async () => {
  await asSystem.query(
    `insert into "user" ("id", "name", "email", "emailVerified") values ($1, 'Test Guard', $2, false)`,
    [USER, `${USER}@example.invalid`],
  );
});

beforeEach(() => {
  viewer.grants = [{ lang: "deDE", capability: "text" }];
});

afterAll(async () => {
  await asSystem.query(`delete from "user" where "id" = $1`, [USER]);
  await closeDb();
});

describe("requireToken", () => {
  it("401 with no header", async () => {
    expect((await requireToken(request())).denied?.status).toBe(401);
  });

  it("401 with a header that is not Bearer", async () => {
    const { token } = await make();
    expect((await requireToken(request(`Basic ${token}`))).denied?.status).toBe(401);
  });

  it("401 with an unknown token", async () => {
    expect((await requireToken(request("Bearer spk_nothing"))).denied?.status).toBe(401);
  });

  it("401 with a revoked token", async () => {
    const { token, row } = await make();
    await revokeToken(row.id, USER);
    expect((await requireToken(request(`Bearer ${token}`))).denied?.status).toBe(401);
  });

  it("401 with an expired token", async () => {
    const { token, row } = await make();
    await asSystem.query(`update "api_token" set "expiresAt" = now() - interval '1 second' where "id" = $1`, [row.id]);
    expect((await requireToken(request(`Bearer ${token}`))).denied?.status).toBe(401);
  });

  it("403 when the owner no longer holds text in the token's language", async () => {
    const { token } = await make("read");
    viewer.grants = [{ lang: "frFR", capability: "text" }];
    expect((await requireToken(request(`Bearer ${token}`))).denied?.status).toBe(403);
  });

  it("403 when the owner's capability there is only regenerate", async () => {
    const { token } = await make("read");
    viewer.grants = [{ lang: "deDE", capability: "regenerate" }];
    expect((await requireToken(request(`Bearer ${token}`))).denied?.status).toBe(403);
  });

  it("403 for a read token asking to write", async () => {
    const { token } = await make("read");
    expect((await requireToken(request(`Bearer ${token}`), { need: "write" })).denied?.status).toBe(403);
  });

  it("lets a read token read", async () => {
    const { token } = await make("read");
    expect((await requireToken(request(`Bearer ${token}`))).denied).toBeNull();
  });

  it("lets a write token write", async () => {
    const { token } = await make("write");
    expect((await requireToken(request(`Bearer ${token}`), { need: "write" })).denied).toBeNull();
  });

  it("passes a global admin's token with no language grant", async () => {
    await asSystem.query(`update "user" set "role" = 'admin' where "id" = $1`, [USER]);
    const { token } = await make("read");
    viewer.grants = [];
    expect((await requireToken(request(`Bearer ${token}`))).context?.role).toBe("admin");
    await asSystem.query(`update "user" set "role" = null where "id" = $1`, [USER]);
  });

  it("returns the language from the token and ignores ?lang=", async () => {
    const { token, row } = await make();
    const { context } = await requireToken(request(`Bearer ${token}`, "GET", "?lang=frFR"));
    expect(context).toMatchObject({ lang: "deDE", tokenId: row.id, userId: USER, access: "write" });
  });

  it("lets a generate-only token generate and pass any, but not read", async () => {
    const { token } = await make("none", USER, true);
    viewer.grants = [{ lang: "deDE", capability: "regenerate" }];
    expect((await requireToken(request(`Bearer ${token}`), { need: "generate" })).denied).toBeNull();
    expect((await requireToken(request(`Bearer ${token}`), { need: "any" })).denied).toBeNull();
    const read = await requireToken(request(`Bearer ${token}`));
    expect(read.denied?.status).toBe(403);
    expect(await read.denied?.json()).toEqual({ error: "this token has no text access" });
  });

  it("403 for any when a generate-only token's owner has no grants", async () => {
    const { token } = await make("none", USER, true);
    viewer.grants = [];
    const result = await requireToken(request(`Bearer ${token}`), { need: "any" });
    expect(result.denied?.status).toBe(403);
    expect(await result.denied?.json()).toEqual({ error: "this token's owner does not hold regenerate in deDE" });
  });

  it("403 for any when a read token's owner has no text", async () => {
    const { token } = await make("read");
    viewer.grants = [];
    const result = await requireToken(request(`Bearer ${token}`), { need: "any" });
    expect(result.denied?.status).toBe(403);
    expect(await result.denied?.json()).toEqual({ error: "this token's owner is not a text maintainer in deDE" });
  });

  it("403 for a read token asking to generate", async () => {
    const { token } = await make("read");
    const result = await requireToken(request(`Bearer ${token}`), { need: "generate" });
    expect(result.denied?.status).toBe(403);
    expect(await result.denied?.json()).toEqual({ error: "this token cannot generate" });
  });

  it("asks for regenerate on every generate, so losing it kills the scope", async () => {
    const { token } = await make("write", USER, true);
    viewer.grants = [
      { lang: "deDE", capability: "text" },
      { lang: "deDE", capability: "regenerate" },
    ];
    expect((await requireToken(request(`Bearer ${token}`), { need: "generate" })).denied).toBeNull();
    viewer.grants = [{ lang: "deDE", capability: "text" }];
    const result = await requireToken(request(`Bearer ${token}`), { need: "generate" });
    expect(result.denied?.status).toBe(403);
    expect(await result.denied?.json()).toEqual({ error: "this token's owner does not hold regenerate in deDE" });
    expect((await requireToken(request(`Bearer ${token}`))).denied).toBeNull();
  });

  it("reports generate in the context", async () => {
    const { token } = await make("none", USER, true);
    viewer.grants = [{ lang: "deDE", capability: "regenerate" }];
    const { context } = await requireToken(request(`Bearer ${token}`), { need: "generate" });
    expect(context).toMatchObject({ access: "none", generate: true });
  });
});
