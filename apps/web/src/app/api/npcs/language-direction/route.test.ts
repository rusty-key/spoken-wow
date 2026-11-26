/**
 * The language direction route against a real Postgres, with only the session and its grants
 * mocked, so the language check is the real requireIn.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import type { Grant } from "@/lib/permissions";
import { asSystem } from "@/lib/teams/testing";

const viewer = vi.hoisted(() => ({ grants: [] as Grant[] }));
const USER = vi.hoisted(() => `test-npc-lang-dir-${Math.random().toString(36).slice(2, 10)}`);

vi.mock("@/lib/session", () => ({ currentSession: async () => ({ user: { id: USER, role: null } }) }));
vi.mock("@/lib/grants/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/grants/store")>()),
  viewerOf: async () => ({ role: null, grants: viewer.grants }),
}));

import { npcDirections } from "@/lib/generation/npc-direction";
import { directionsIn, listLanguageDirections, setDirection, upsertResolution } from "@/lib/npc/store";

import { POST } from "./route";

const npcId = 900_000_000 + Math.floor(Math.random() * 99_999_999);
const key = `creature:${npcId}`;

beforeAll(async () => {
  await asSystem.query(
    `insert into "user" ("id", "name", "email", "emailVerified") values ($1, 'Test Direction', $2, false)`,
    [USER, `${USER}@example.invalid`],
  );
});

beforeEach(async () => {
  viewer.grants = [{ lang: "deDE", capability: "configure" }];
  await upsertResolution({
    npcKind: "creature", npcId, npcName: null, race: "human", gender: "male", flavor: "standard",
    provenance: "corpus", confirmed: true, doubtful: false, modelFileId: null, sex: null,
    creatureType: null, build: null, note: null, resolvedBy: null,
  });
});

afterEach(async () => {
  await asSystem.query(`delete from "npc" where "npcId" = $1`, [npcId]);
});

afterAll(async () => {
  await asSystem.query(`delete from "activity" where "actorId" = $1`, [USER]);
  await asSystem.query(`delete from "user" where "id" = $1`, [USER]);
  await closeDb();
});

function post(body: Record<string, unknown>, lang = "deDE"): Promise<Response> {
  return POST(new Request(`https://example.com/api/npcs/language-direction?lang=${lang}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ npcKind: "creature", npcId, ...body }),
  }));
}

describe("POST /api/npcs/language-direction", () => {
  it("400, not 500, on a body that is not an object", async () => {
    const response = await POST(new Request("https://example.com/api/npcs/language-direction?lang=deDE", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    }));
    expect(response.status).toBe(400);
  });

  it("overrides the global direction in its language only, and clears back to it", async () => {
    await setDirection("creature", npcId, "[pirate accent]");

    const response = await post({ direction: " sailor's drawl " });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ direction: "[sailor's drawl]" });
    expect((await directionsIn("deDE")).get(key)).toBe("[sailor's drawl]");
    expect((await directionsIn("frFR")).get(key)).toBe("[pirate accent]");

    expect((await post({ direction: "" })).status).toBe(200);
    expect((await listLanguageDirections("deDE")).has(key)).toBe(false);
    expect((await directionsIn("deDE")).get(key)).toBe("[pirate accent]");
  });

  it("is what the language's lines are voiced with", async () => {
    await post({ direction: "sailor's drawl" });
    const of = await npcDirections("deDE");
    expect(of({ lineId: "q:0:accept", npcType: "creature", npcId })).toBe("[sailor's drawl]");
  });

  it("refuses somebody who does not configure the language", async () => {
    viewer.grants = [{ lang: "deDE", capability: "regenerate" }, { lang: "frFR", capability: "configure" }];
    expect((await post({ direction: "pirate accent" })).status).toBe(403);
  });

  it("refuses English, whose direction is the global one", async () => {
    viewer.grants = [{ lang: "enUS", capability: "configure" }];
    expect((await post({ direction: "pirate accent" }, "enUS")).status).toBe(400);
  });

  it("refuses an angle bracket, which the narrator would read", async () => {
    expect((await post({ direction: "<pirate>" })).status).toBe(400);
  });

  it("404s an NPC not on file", async () => {
    expect((await post({ npcId: npcId + 1, direction: "pirate accent" })).status).toBe(404);
  });
});
