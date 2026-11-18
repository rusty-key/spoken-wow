/** Needs DATABASE_URL and migrations through 0116. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { closeDb } from "@/lib/db";
import { testBackend } from "@/lib/storage/testing";
import { createTeam } from "@/lib/teams/admin";
import { asSystem, ownTeam, systemRows, testUser } from "@/lib/teams/testing";

import { keep, OwnStorageError, ownStorageRefusal, storageRefusal } from "./keep";
import { memoryBlobs, sha256Of, useArchiveForTests } from "./store";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "own-storage-"));
let fr: Awaited<ReturnType<typeof ownTeam>>;
const restores: (() => unknown)[] = [];

beforeAll(async () => {
  fr = await ownTeam("frFR");
  await asSystem.query(`update "team" set "ownStorage" = true where "id" = $1`, [fr.team]);
});
afterEach(async () => {
  for (const restore of restores.splice(0).reverse()) await restore();
});
afterAll(async () => {
  fs.rmSync(dir, { recursive: true, force: true });
  await fr.restore();
  await closeDb();
});

const ours = (mode: "disk" | "dual" | "r2") => {
  const store = memoryBlobs();
  restores.push(useArchiveForTests(store, mode));
  return store;
};

describe("a team that keeps its own storage", () => {
  it("keeps nothing in our archive or on our volume without a bucket, in any mode", async () => {
    const file = path.join(dir, "refused.mp3");
    // Each mode pinned: vitest leaves SPOKEN_ARCHIVE_STORE alone when the shell exports one.
    for (const mode of ["disk", "dual"] as const) {
      const house = ours(mode);
      await expect(keep("takes", randomBytes(16), "audio/mpeg", file, "frFR")).rejects.toBeInstanceOf(OwnStorageError);
      expect(fs.existsSync(file)).toBe(false);
      expect(house.objects.size).toBe(0);
    }

    const house = ours("r2");
    await expect(keep("takes", randomBytes(16), "audio/mpeg", file, "frFR")).rejects.toThrow("connect one on the Storage page");
    expect(house.objects.size).toBe(0);
    expect(await storageRefusal("frFR")).toMatchObject({ kind: "storage-required", message: expect.stringContaining("connect one") });
  });

  it("cannot keep anything while our archive is not a bucket, even with one switched on", async () => {
    ours("dual");
    const backend = await testBackend({ team: fr.team, writing: true });
    restores.push(backend.restore);
    expect(await ownStorageRefusal("frFR")).toContain("cannot use team buckets yet");
  });

  it("keeps in its bucket once one is switched on", async () => {
    const house = ours("r2");
    const backend = await testBackend({ team: fr.team, writing: true });
    restores.push(backend.restore);
    const bytes = randomBytes(16);
    await keep("takes", bytes, "audio/mpeg", path.join(dir, "kept.mp3"), "frFR");
    expect(backend.store.objects.has(`takes/${sha256Of(bytes)}`)).toBe(true);
    expect(house.objects.size).toBe(0);
    expect(await ownStorageRefusal("frFR")).toBeNull();
  });

  it("leaves every other team on our archive", async () => {
    expect(await ownStorageRefusal("enUS")).toBeNull();
  });
});

describe("a team a person creates", () => {
  it("keeps its own storage from the start", async () => {
    const user = await testUser("test-own-storage");
    const slug = `own-storage-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const { id } = await createTeam({ slug, name: slug, adminEmail: null }, user.id);
      const [row] = await systemRows<{ ownStorage: boolean }>(`select "ownStorage" from "team" where "id" = $1`, [id]);
      expect(row.ownStorage).toBe(true);
    } finally {
      await asSystem.query(`delete from "activity" where "subject" = $1`, [slug]);
      await asSystem.query(`delete from "team" where "slug" = $1`, [slug]);
      await user.cleanup();
    }
  });
});
