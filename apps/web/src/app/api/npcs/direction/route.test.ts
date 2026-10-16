/**
 * An admin's direction for one NPC. Modelled on api/npcs/sex/route.test.ts.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";
import { getResolution, listDirections, upsertResolution } from "@/lib/npc/store";

const RESOLVER = "test-npcs-direction-route";

vi.mock("@/lib/generation/authz", () => ({
  requireAdmin: async () => ({ lang: "enUS", session: { user: { id: RESOLVER } }, denied: null }),
}));

import { POST } from "./route";

const npcId = 900_000_000 + Math.floor(Math.random() * 99_999_999);

beforeAll(async () => {
  await db().query(
    `insert into "user" ("id", "name", "email", "emailVerified") values ($1, 'Test Resolver', $2, false)
     on conflict ("id") do nothing`,
    [RESOLVER, `${RESOLVER}@example.invalid`],
  );
});

beforeEach(async () => {
  await upsertResolution({
    npcKind: "creature", npcId, npcName: null, race: "human", gender: "male", flavor: "standard",
    provenance: "corpus", confirmed: true, doubtful: false, modelFileId: null, sex: null,
    creatureType: null, build: null, note: null, resolvedBy: null,
  });
});

afterEach(async () => {
  await db().query(`delete from "npc" where "npcId" = $1`, [npcId]);
  await db().query(`delete from "activity" where "actorId" = $1`, [RESOLVER]);
});

afterAll(async () => {
  await db().query(`delete from "user" where "id" = $1`, [RESOLVER]);
  await closeDb();
});

function post(body: Record<string, unknown>): Promise<Response> {
  return POST(new Request("https://example.com/api/npcs/direction", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ npcKind: "creature", npcId, ...body }),
  }));
}

describe("POST /api/npcs/direction", () => {
  it("stores a direction bracketed, and clears it", async () => {
    const response = await post({ direction: " pirate accent " });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ direction: "[pirate accent]" });
    expect((await listDirections()).get(`creature:${npcId}`)).toBe("[pirate accent]");

    expect((await post({ direction: "" })).status).toBe(200);
    expect((await getResolution("creature", npcId))?.direction).toBeNull();
  });

  it("survives the corpus answering again", async () => {
    await post({ direction: "pirate accent" });
    await upsertResolution({
      npcKind: "creature", npcId, npcName: null, race: "human", gender: "male", flavor: "official",
      provenance: "corpus", confirmed: true, doubtful: false, modelFileId: null, sex: null,
      creatureType: null, build: null, note: null, resolvedBy: null,
    });
    expect((await getResolution("creature", npcId))?.direction).toBe("[pirate accent]");
  });

  it("refuses an angle bracket, which the narrator would read", async () => {
    expect((await post({ direction: "<pirate>" })).status).toBe(400);
  });

  it("404s an NPC not on file", async () => {
    expect((await post({ npcId: npcId + 1, direction: "pirate accent" })).status).toBe(404);
  });
});
