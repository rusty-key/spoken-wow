/** Needs DATABASE_URL and migrations through 0115. */
import { randomBytes } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { memoryBlobs, sha256Of, useArchiveForTests } from "@/lib/blobs/store";
import { locate, useBackendForTests } from "@/lib/blobs/where";
import { closeDb } from "@/lib/db";
import { asSystem, ownTeam, systemRows, testUser } from "@/lib/teams/testing";

import { StorageError } from "./backends";
import { advanceMoves, cancelMove, runMoveForTests, startMove } from "./moves";
import { testBackend } from "./testing";

let fr: Awaited<ReturnType<typeof ownTeam>>;
let user: Awaited<ReturnType<typeof testUser>>;
const restores: (() => unknown)[] = [];

beforeAll(async () => {
  fr = await ownTeam("frFR");
  user = await testUser("test-storage-move");
});

afterEach(async () => {
  await asSystem.query(`delete from "storage_move" where "teamId" = $1`, [fr.team]);
  await asSystem.query(`delete from "take" where "teamId" = $1`, [fr.team]);
  for (const restore of restores.splice(0).reverse()) await restore();
});

afterAll(async () => {
  await fr.restore();
  await user.cleanup();
  await closeDb();
});

/** Takes of the French team whose bytes are in our bucket. */
async function takes(house: ReturnType<typeof memoryBlobs>, n: number) {
  const shas: string[] = [];
  for (let i = 0; i < n; i++) {
    const data = randomBytes(32);
    const sha256 = sha256Of(data);
    house.objects.set(`takes/${sha256}`, { data, contentType: "audio/mpeg" });
    await asSystem.query(
      `insert into "take" ("teamId", "source", "lang", "file", "lineId", "version", "origin", "bytes", "sha256")
       values ($1, 'quests', 'frFR', $2, $2, 1, 'generated', 32, $3)`,
      [fr.team, `quests/move-test-${i}.mp3`, sha256],
    );
    shas.push(sha256);
  }
  return shas;
}

function ours() {
  const house = memoryBlobs();
  restores.push(useArchiveForTests(house, "r2"));
  return house;
}

async function bucket(options?: Parameters<typeof testBackend>[0]) {
  const backend = await testBackend({ team: fr.team, ...options });
  restores.push(backend.restore);
  return backend;
}

describe("moving a team's objects", () => {
  it("copies ours into the team's bucket, keeps ours, and reads from the team's after", async () => {
    const house = ours();
    const backend = await bucket();
    const shas = await takes(house, 7);

    const move = await startMove(fr.team, null, backend.id, user.id);
    expect(await runMoveForTests(move.id)).toBe("done");

    for (const sha of shas) {
      expect(backend.store.objects.has(`takes/${sha}`)).toBe(true);
      expect(house.objects.has(`takes/${sha}`)).toBe(true);
      expect((await locate(`takes/${sha}`)).backendId).toBe(backend.id);
    }
    const [row] = await systemRows(`select "state", "total", "copied", "already", "missing" from "storage_move" where "id" = $1`, [move.id]);
    expect(row).toEqual({ state: "done", total: 7, copied: 7, already: 0, missing: 0 });
  });

  it("brings a team bucket's objects home without deleting them there", async () => {
    const house = ours();
    const backend = await bucket();
    const shas = await takes(house, 3);
    await runMoveForTests((await startMove(fr.team, null, backend.id, user.id)).id);
    // A take made after the switch is only in the team's bucket.
    const late = randomBytes(32);
    backend.store.objects.set(`takes/${sha256Of(late)}`, { data: late, contentType: "audio/mpeg" });
    await asSystem.query(`insert into "archive_object" ("prefix", "sha256", "backendId") values ('takes', $1, $2)`, [sha256Of(late), backend.id]);

    const home = await startMove(fr.team, backend.id, null, user.id);
    expect(await runMoveForTests(home.id)).toBe("done");
    for (const sha of [...shas, sha256Of(late)]) {
      expect(house.objects.has(`takes/${sha}`)).toBe(true);
      expect(backend.store.objects.has(`takes/${sha}`)).toBe(true);
      expect((await locate(`takes/${sha}`)).backendId).toBeNull();
    }
    const [row] = await systemRows(`select "copied", "already" from "storage_move" where "id" = $1`, [home.id]);
    expect(row).toEqual({ copied: 1, already: 3 });
  });

  it("counts an object the source lost, and carries on", async () => {
    const house = ours();
    const backend = await bucket();
    const [lost] = await takes(house, 2);
    house.objects.delete(`takes/${lost}`);
    const move = await startMove(fr.team, null, backend.id, user.id);
    expect(await runMoveForTests(move.id)).toBe("done");
    const [row] = await systemRows(`select "copied", "missing" from "storage_move" where "id" = $1`, [move.id]);
    expect(row).toEqual({ copied: 1, missing: 1 });
  });

  it("stops on a target that refuses a write, keeping what it moved, and a new move carries on", async () => {
    const house = ours();
    const backend = await bucket();
    await takes(house, 4);
    let allowed = 2;
    const flaky = {
      ...backend.store,
      put: async (key: string, data: Buffer, type: string) => {
        if (allowed-- <= 0) throw new Error("HTTP 507 full");
        return backend.store.put(key, data, type);
      },
    };
    restores.push(useBackendForTests(backend.id, flaky));
    const move = await startMove(fr.team, null, backend.id, user.id);
    expect(await runMoveForTests(move.id, 2)).toBe("failed");
    const [row] = await systemRows(`select "state", "copied", "lastError" from "storage_move" where "id" = $1`, [move.id]);
    expect(row).toEqual({ state: "failed", copied: 2, lastError: "HTTP 507 full" });

    allowed = 100;
    const again = await startMove(fr.team, null, backend.id, user.id);
    expect(await runMoveForTests(again.id)).toBe("done");
    expect(backend.store.objects.size).toBe(4);
  });

  it("allows one move at a time, only into a working bucket, and stops when asked", async () => {
    const house = ours();
    const backend = await bucket();
    const failing = await bucket({ health: "failing" });
    await takes(house, 2);
    await expect(startMove(fr.team, null, failing.id, user.id)).rejects.toBeInstanceOf(StorageError);
    const move = await startMove(fr.team, null, backend.id, user.id);
    await expect(startMove(fr.team, backend.id, null, user.id)).rejects.toThrow("already running");
    await cancelMove(fr.team, move.id);
    await advanceMoves();
    expect(backend.store.objects.size).toBe(0);
  });
});
