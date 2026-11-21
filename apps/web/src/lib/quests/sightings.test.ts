/**
 * Where players met NPCs, against a real Postgres: the vouching rule lives in the query.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";

import { confirmedSightings, offeredZones, recordSightings, uploaderOf, VOUCHERS } from "./sightings";

// Ids far above any real creature's, so the rows are this test's alone.
const thork = 990_000_001;
const post = 990_000_002;
const sighting = (npcId: number, zones: number[]) => ({ npcType: "creature" as const, npcId, zones });

afterEach(async () => {
  await db().query(`delete from "npc_sighting" where "npcId" in ($1, $2)`, [thork, post]);
});

afterAll(async () => {
  await closeDb();
});

describe("sightings", () => {
  it("count a zone once enough uploaders agree on it", async () => {
    expect(VOUCHERS).toBe(2);
    await recordSightings([sighting(thork, [1413])], "user:a");
    expect((await confirmedSightings()).get(`creature:${thork}`)).toBeUndefined();
    await recordSightings([sighting(thork, [1413, 1411])], "ip:b");
    expect((await confirmedSightings()).get(`creature:${thork}`)).toEqual([1413]);
  });

  it("keep one uploader's file sent twice as one voice", async () => {
    expect(await recordSightings([sighting(post, [1411])], "user:a")).toBe(1);
    expect(await recordSightings([sighting(post, [1411])], "user:a")).toBe(0);
    expect((await confirmedSightings()).get(`creature:${post}`)).toBeUndefined();
  });

  it("drop a zone no list knows, and the world and continents", async () => {
    expect(await recordSightings([sighting(thork, [999_999, 947, 1414])], "user:a")).toBe(0);
  });

  it("offer a zone once vouched for, by name", async () => {
    await recordSightings([sighting(thork, [1450])], "user:a");
    await recordSightings([sighting(thork, [1450])], "user:b");
    const zones = await offeredZones(Date.now() + 120_000);
    expect(zones).toContainEqual({ uiMapID: 1450, name: "Moonglade" });
    expect(zones.map((zone) => zone.name)).toEqual([...zones.map((zone) => zone.name)].sort((a, b) => a.localeCompare(b)));
  });
});

describe("uploaderOf", () => {
  it("names the account, else the install, else a hash of the address and never the address", () => {
    expect(uploaderOf({ userId: "u1", installId: "i1", ip: "203.0.113.9" })).toBe("user:u1");
    expect(uploaderOf({ userId: null, installId: "i1", ip: "203.0.113.9" })).toBe("install:i1");
    const byIp = uploaderOf({ userId: null, installId: null, ip: "203.0.113.9" });
    expect(byIp).toMatch(/^ip:[0-9a-f]{64}$/);
    expect(byIp).not.toContain("203.0.113.9");
  });
});
