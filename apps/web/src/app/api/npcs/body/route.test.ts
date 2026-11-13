/**
 * An admin's answer for one body of an NPC, and splitting or unsplitting it. Modelled on
 * api/npcs/route.test.ts.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";
import { asSystem } from "@/lib/teams/testing";
import { getBodies, upsertResolution } from "@/lib/npc/store";

const RESOLVER = "test-npcs-body-route";

vi.mock("@/lib/generation/authz", () => ({
  requireAdmin: async () => ({ lang: "enUS", session: { user: { id: RESOLVER } }, denied: null }),
}));

import { POST } from "./route";

const npcId = 900_000_000 + Math.floor(Math.random() * 99_999_999);

beforeAll(async () => {
  await asSystem.query(
    `insert into "user" ("id", "name", "email", "emailVerified") values ($1, 'Test Resolver', $2, false)
     on conflict ("id") do nothing`,
    [RESOLVER, `${RESOLVER}@example.invalid`],
  );
});

beforeEach(async () => {
  await upsertResolution({
    npcKind: "creature", npcId, npcName: null, race: "human", gender: "male", flavor: "official",
    provenance: "corpus", confirmed: true, doubtful: false, modelFileId: null, sex: null,
    creatureType: null, build: null, note: null, resolvedBy: null,
  });
});

afterEach(async () => {
  await asSystem.query(`delete from "npc" where "npcId" = $1`, [npcId]);
  await asSystem.query(`delete from "activity" where "actorId" = $1`, [RESOLVER]);
});

afterAll(async () => {
  await asSystem.query(`delete from "user" where "id" = $1`, [RESOLVER]);
  await closeDb();
});

function post(body: Record<string, unknown>): Promise<Response> {
  return POST(new Request("https://example.com/api/npcs/body", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ npcKind: "creature", npcId, ...body }),
  }));
}

describe("POST /api/npcs/body", () => {
  it("splits an NPC, its own sex keeping its answer and the other doubtful", async () => {
    const response = await post({ action: "split" });
    expect(response.status).toBe(200);
    expect((await getBodies("creature", npcId)).map((row) => [row.race, row.sex, row.provenance, row.doubtful])).toEqual([
      ["human", 2, "moderator", false],
      ["human", 3, "moderator", true],
    ]);
  });

  it("answers one sex, and refuses a flavor the roster has no voice for", async () => {
    await post({ action: "split" });
    expect((await post({ sex: 3, race: "human", flavor: "warrior" })).status).toBe(200);
    expect((await getBodies("creature", npcId))[1]).toMatchObject({ gender: "female", flavor: "warrior", doubtful: false });
    expect((await post({ sex: 3, race: "human", flavor: "nonsense" })).status).toBe(400);
  });

  it("unsplits an NPC", async () => {
    await post({ action: "split" });
    await post({ action: "unsplit" });
    expect(await getBodies("creature", npcId)).toEqual([]);
  });

  it("refuses an answer for one sex of an NPC that is not split", async () => {
    expect((await post({ sex: 3, race: "human", flavor: "warrior" })).status).toBe(400);
    expect(await getBodies("creature", npcId)).toEqual([]);
  });

  it("refuses to split an NPC that is neither a man nor a woman", async () => {
    await asSystem.query(`update "npc" set "race" = 'beast', "gender" = null where "npcId" = $1`, [npcId]);
    expect((await post({ action: "split" })).status).toBe(400);
    expect(await getBodies("creature", npcId)).toEqual([]);
  });

  it("refuses a gameobject and a sex that is not a man's or a woman's", async () => {
    expect((await post({ npcKind: "gameobject", action: "split" })).status).toBe(400);
    expect((await post({ sex: 1, race: "human", flavor: "official" })).status).toBe(400);
  });

  it("adds a body of another race, splitting the NPC with its own kept", async () => {
    expect((await post({ action: "add", race: "gnome", sex: 2 })).status).toBe(200);
    expect((await getBodies("creature", npcId)).map((row) => [row.race, row.sex, row.provenance])).toEqual([
      ["human", 2, "moderator"],
      ["gnome", 2, "moderator"],
    ]);
  });

  it("refuses to add the body the NPC already is, or one already there", async () => {
    expect((await post({ action: "add", race: "human", sex: 2 })).status).toBe(400);
    await post({ action: "add", race: "gnome", sex: 2 });
    expect((await post({ action: "add", race: "gnome", sex: 2 })).status).toBe(400);
  });

  it("adds the NPC's own body to an NPC split without it", async () => {
    await asSystem.query(
      `insert into "npc_body" ("npcKind", "npcId", "race", "sex", "flavor", "provenance")
       values ('creature', $1, 'gnome', 2, 'standard', 'corpus'), ('creature', $1, 'gnome', 3, 'standard', 'corpus')`,
      [npcId],
    );
    expect((await post({ action: "add", race: "human", sex: 2 })).status).toBe(200);
    expect((await getBodies("creature", npcId)).map((row) => [row.race, row.sex, row.provenance])).toEqual([
      ["gnome", 2, "corpus"],
      ["human", 2, "moderator"],
      ["gnome", 3, "corpus"],
    ]);
  });

  it("removes a body, and the second-last unsplits", async () => {
    await post({ action: "add", race: "gnome", sex: 2 });
    await post({ action: "add", race: "gnome", sex: 3 });
    expect((await post({ action: "remove", race: "gnome", sex: 3 })).status).toBe(200);
    expect((await getBodies("creature", npcId)).length).toBe(2);
    const response = await post({ action: "remove", race: "gnome", sex: 2 });
    expect(await response.json()).toEqual({ bodies: [] });
  });

  it("refuses a race the roster has no type for", async () => {
    expect((await post({ action: "add", race: "nonsense", sex: 2 })).status).toBe(400);
  });
});
