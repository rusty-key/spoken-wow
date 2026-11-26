/**
 * Race tags over the text API, with real tokens and only grants mocked.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Grant } from "@/lib/permissions";

const viewer = vi.hoisted(() => ({ grants: [] as Grant[] }));

vi.mock("@/lib/grants/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/grants/store")>()),
  viewerOf: async (session: { user: { role?: string | null } }) => ({ role: session.user.role, grants: viewer.grants }),
}));

import { closeDb } from "@/lib/db";
import { readSettings } from "@/lib/generation/settings";
import { LANG } from "@/lib/text-api/testing";
import { asSystem, testUser } from "@/lib/teams/testing";
import { createToken } from "@/lib/tokens/store";

import { GET, PATCH } from "./route";

const URL = "https://example.com/api/v1/race-tags";

let user: string;

async function token(access: "read" | "write" = "write") {
  return (await createToken({ userId: user, lang: LANG, access, generate: false, label: "agent", expiresAt: new Date(Date.now() + 86_400_000) }))
    .token;
}

const init = (auth: string, method = "GET", body?: unknown) => ({
  method,
  headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const clear = () => asSystem.query(`delete from "generation_setting_locale" where "lang" = $1`, [LANG]);

beforeEach(async () => {
  const created = await testUser("test-race-tags-api");
  user = created.id;
  viewer.grants = [
    { lang: LANG, capability: "text" },
    { lang: LANG, capability: "configure" },
  ];
  await clear();
  return async () => {
    await clear();
    await asSystem.query(`delete from "activity" where "actorId" = $1`, [user]);
    await created.cleanup();
  };
});

afterAll(closeDb);

describe("/api/v1/race-tags", () => {
  it("401 with no token", async () => {
    expect((await GET(new Request(URL))).status).toBe(401);
  });

  it("replaces the map, bracketed, and reads it back with a read token", async () => {
    const response = await PATCH(new Request(URL, init(await token(), "PATCH", { raceTags: { dwarf: "Scottish accent" } })));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ lang: LANG, raceTags: { dwarf: "[Scottish accent]" } });

    viewer.grants = [{ lang: LANG, capability: "text" }];
    const read = await GET(new Request(URL, init(await token("read"))));
    expect(await read.json()).toEqual({ lang: LANG, raceTags: { dwarf: "[Scottish accent]" } });
    expect((await readSettings(LANG)).config.raceTags).toEqual({ dwarf: "[Scottish accent]" });
  });

  it("drops a race left out of the map", async () => {
    const auth = await token();
    await PATCH(new Request(URL, init(auth, "PATCH", { raceTags: { dwarf: "Scottish accent", troll: "lilting" } })));
    await PATCH(new Request(URL, init(auth, "PATCH", { raceTags: { troll: "lilting" } })));
    expect((await readSettings(LANG)).config.raceTags).toEqual({ troll: "[lilting]" });
  });

  it("refuses a write without configure", async () => {
    viewer.grants = [{ lang: LANG, capability: "text" }];
    const response = await PATCH(new Request(URL, init(await token(), "PATCH", { raceTags: { dwarf: "Scottish accent" } })));
    expect(response.status).toBe(403);
    expect((await readSettings(LANG)).config.raceTags).toEqual({});
  });

  it("refuses a read-only token's write", async () => {
    const response = await PATCH(new Request(URL, init(await token("read"), "PATCH", { raceTags: {} })));
    expect(response.status).toBe(403);
  });

  it("400 on a tag the site would refuse", async () => {
    const response = await PATCH(new Request(URL, init(await token(), "PATCH", { raceTags: { dwarf: "<loud>" } })));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/angle bracket/);
  });
});
