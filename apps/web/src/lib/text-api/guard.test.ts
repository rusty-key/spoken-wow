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

const acting = vi.hoisted(() => ({
  team: null as string | null,
  privileged: "team-a" as string | null,
  second: new Set<string>(),
  reads: 0,
}));

vi.mock("@/lib/teams/acting", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/teams/acting")>()),
  teamIn: async () => {
    acting.reads += 1;
    return acting.team;
  },
}));
vi.mock("@/lib/teams/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/teams/store")>()),
  privilegedOf: async () => acting.privileged,
  secondTeamLangs: async () => acting.second,
}));

import { createToken, revokeToken } from "@/lib/tokens/store";
import type { TokenAccess } from "@/lib/tokens/types";

import { requireToken, withToken, writeLayer, type Layer, type TokenContext } from "./guard";

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
  acting.team = null;
  acting.privileged = "team-a";
  acting.second = new Set();
  acting.reads = 0;
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

  it("lets a read token read when its owner holds only regenerate, as an override writer", async () => {
    const { token } = await make("read");
    viewer.grants = [{ lang: "deDE", capability: "regenerate" }];
    const { context, denied } = await requireToken(request(`Bearer ${token}`), { need: "read" });
    expect(denied).toBeNull();
    expect(context?.layers).toEqual({ original: false, override: true });
  });

  it("403 when the owner holds neither text nor regenerate", async () => {
    const { token } = await make("read");
    viewer.grants = [{ lang: "deDE", capability: "configure" }];
    const result = await requireToken(request(`Bearer ${token}`));
    expect(result.denied?.status).toBe(403);
    expect(await result.denied?.json()).toEqual({
      error: "this token's owner holds neither text nor regenerate in deDE",
    });
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
    expect(await result.denied?.json()).toEqual({
      error: "this token's owner holds neither text nor regenerate in deDE",
    });
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

  it("reports generate in the context, and no layer for a token without text access", async () => {
    const { token } = await make("none", USER, true);
    viewer.grants = [{ lang: "deDE", capability: "regenerate" }];
    const { context } = await requireToken(request(`Bearer ${token}`), { need: "generate" });
    expect(context).toMatchObject({ access: "none", generate: true, layers: { original: false, override: false } });
  });
});

describe("writeLayer", () => {
  async function contextWith(grants: Grant[]): Promise<TokenContext> {
    const { token } = await make("write");
    viewer.grants = grants;
    const { context } = await requireToken(request(`Bearer ${token}`), { need: "write" });
    if (!context) throw new Error("the token was refused");
    return context;
  }

  async function refusal(result: Layer | Response): Promise<[number, unknown]> {
    if (!(result instanceof Response)) throw new Error(`expected a refusal, got ${result}`);
    return [result.status, await result.json()];
  }

  it("writes a regenerate-only owner's override, and refuses the original or an unknown layer", async () => {
    const context = await contextWith([{ lang: "deDE", capability: "regenerate" }]);
    expect(context.layers).toEqual({ original: false, override: true });
    expect(writeLayer(context, undefined)).toBe("override");
    expect(writeLayer(context, "override")).toBe("override");
    expect(await refusal(writeLayer(context, "original"))).toEqual([
      403,
      { error: "this token's owner is not a text maintainer in deDE, so it writes only its team's overrides" },
    ]);
    expect(await refusal(writeLayer(context, "both"))).toEqual([
      400,
      { error: 'layer must be "original" or "override"' },
    ]);
  });

  it("writes the original by default for an owner with both grants, and the override on request", async () => {
    const context = await contextWith([
      { lang: "deDE", capability: "text" },
      { lang: "deDE", capability: "regenerate" },
    ]);
    expect(writeLayer(context, undefined)).toBe("original");
    expect(writeLayer(context, "original")).toBe("original");
    expect(writeLayer(context, "override")).toBe("override");
  });

  it("refuses a write with no layer from a context that backs neither", async () => {
    const context = await contextWith([{ lang: "deDE", capability: "text" }]);
    const bare = { ...context, layers: { original: false, override: false } };
    expect(await refusal(writeLayer(bare, undefined))).toEqual([
      403,
      { error: "this token's owner holds neither text nor regenerate in deDE" },
    ]);
  });

  it("keeps a text-only owner on the original", async () => {
    const context = await contextWith([{ lang: "deDE", capability: "text" }]);
    expect(context.layers).toEqual({ original: true, override: false });
    expect(writeLayer(context, undefined)).toBe("original");
    expect(await refusal(writeLayer(context, "override"))).toEqual([
      403,
      { error: "this token's owner does not hold regenerate in deDE, so it cannot write overrides" },
    ]);
  });
});

describe("a second team's owner", () => {
  beforeEach(() => {
    acting.second = new Set(["deDE"]);
  });

  it("is refused by requireToken, and passes withToken", async () => {
    acting.team = "team-b";
    const { token } = await make("read");
    const refused = await requireToken(request(`Bearer ${token}`), { need: "read" });
    expect(refused.denied?.status).toBe(403);
    expect(await refused.denied?.json()).toEqual({ error: "this route does not work for a second team yet" });

    const passed = await withToken(request(`Bearer ${token}`), { need: "read" }, async () => new Response("ran"));
    expect(await passed.text()).toBe("ran");
  });

  it("is not refused in the privileged team", async () => {
    acting.team = "team-a";
    const { token } = await make("read");
    expect((await requireToken(request(`Bearer ${token}`), { need: "read" })).denied).toBeNull();
  });
});

describe("a language with one team", () => {
  it("reads nobody's team", async () => {
    acting.team = "team-b";
    const { token } = await make("read");
    expect((await requireToken(request(`Bearer ${token}`), { need: "read" })).denied).toBeNull();
    expect(acting.reads).toBe(0);
  });
});
