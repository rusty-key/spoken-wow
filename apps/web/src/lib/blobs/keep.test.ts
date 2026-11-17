/** Needs DATABASE_URL and migrations applied. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import { testBackend } from "@/lib/storage/testing";
import { systemRows } from "@/lib/teams/testing";

import { keep, landQuarantined, storageRefusal } from "./keep";
import { memoryBlobs, sha256Of, useArchiveForTests } from "./store";
import { locate, QUARANTINE, useBackendForTests } from "./where";

vi.mock("node:timers/promises", () => ({ setTimeout: async () => {} }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blobs-keep-"));
const data = Buffer.from("kept bytes");
const sha = sha256Of(data);

const restores: (() => unknown)[] = [];
afterEach(async () => {
  for (const restore of restores.splice(0).reverse()) await restore();
  vi.restoreAllMocks();
});
afterAll(async () => {
  fs.rmSync(dir, { recursive: true, force: true });
  await closeDb();
});

const ours = (mode: "dual" | "r2", options?: Parameters<typeof memoryBlobs>[0]) => {
  const store = memoryBlobs(options);
  restores.push(useArchiveForTests(store, mode));
  return store;
};

const team = async (options?: Parameters<typeof testBackend>[0]) => {
  const backend = await testBackend({ writing: true, ...options });
  restores.push(backend.restore);
  return backend;
};

const rowOf = async (sha256: string, backendId: string) =>
  (await systemRows<{ pending: boolean }>(
    `select "pending" from "archive_object" where "sha256" = $1 and "backendId" = $2`,
    [sha256, backendId],
  ))[0];

describe("keep", () => {
  it("writes the volume and not the bucket in disk mode", async () => {
    const file = path.join(dir, "disk.mp3");
    expect(await keep("takes", data, "audio/mpeg", file, "enUS")).toBeNull();
    expect(fs.readFileSync(file).equals(data)).toBe(true);
  });

  it("writes both in dual mode", async () => {
    const bucket = ours("dual");
    const file = path.join(dir, "dual.mp3");
    expect(await keep("takes", data, "audio/mpeg", file, "enUS")).toBe(sha);
    expect(bucket.objects.get(`takes/${sha}`)?.data.equals(data)).toBe(true);
    expect(fs.existsSync(file)).toBe(true);
  });

  it("keeps the volume copy and reports no bucket when the PUT fails in dual mode", async () => {
    ours("dual", { refusePut: true });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const file = path.join(dir, "dual-refused.mp3");
    expect(await keep("takes", data, "audio/mpeg", file, "enUS")).toBeNull();
    expect(fs.existsSync(file)).toBe(true);
    expect(logged).toHaveBeenCalledOnce();
  });

  it("throws when the PUT fails in r2 mode, where the bucket is the only copy", async () => {
    ours("r2", { refusePut: true });
    const file = path.join(dir, "r2-refused.mp3");
    await expect(keep("takes", data, "audio/mpeg", file, "enUS")).rejects.toThrow("HTTP 503");
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe("keep with a team bucket", () => {
  it("quarantines without blaming the bucket when this site cannot open its key", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const house = ours("r2");
    const backend = await team();
    const { SealError } = await import("./seal");
    const unopened = { ...backend.store, put: async () => { throw new SealError("SPOKEN_STORAGE_KEY is not set"); } };
    restores.push(useBackendForTests(backend.id, unopened));
    const bytes = randomBytes(64);
    const sha256 = (await keep("takes", bytes, "audio/mpeg", path.join(dir, "seal.mp3"), "enUS"))!;
    expect(house.objects.has(`${QUARANTINE}takes/${sha256}`)).toBe(true);
    const [row] = await systemRows(`select "health" from "storage_backend" where "id" = $1`, [backend.id]);
    expect(row.health).toBe("ok");
  });

  it("never writes one team's object to another team's bucket", async () => {
    const { ownTeam } = await import("@/lib/teams/testing");
    const house = ours("r2");
    const fr = await ownTeam("frFR");
    restores.push(fr.restore);
    const english = await team();
    const bytes = randomBytes(64);
    await keep("takes", bytes, "audio/mpeg", path.join(dir, "fr.mp3"), "frFR");
    expect(house.objects.has(`takes/${sha256Of(bytes)}`)).toBe(true);
    expect(english.store.objects.size).toBe(0);
  });

  it("writes to the team's bucket and not ours, and records where", async () => {
    const house = ours("r2");
    const backend = await team();
    const bytes = randomBytes(64);
    const sha256 = await keep("takes", bytes, "audio/mpeg", path.join(dir, "team.mp3"), "enUS");
    expect(sha256).toBe(sha256Of(bytes));
    expect(backend.store.objects.get(`takes/${sha256}`)?.data.equals(bytes)).toBe(true);
    expect(house.objects.size).toBe(0);
    expect(await rowOf(sha256!, backend.id)).toEqual({ pending: false });
    expect((await locate(`takes/${sha256}`)).backendId).toBe(backend.id);
  });

  it("leaves a team bucket that is not switched on alone", async () => {
    const house = ours("r2");
    await team({ writing: false });
    const bytes = randomBytes(64);
    await keep("takes", bytes, "audio/mpeg", path.join(dir, "off.mp3"), "enUS");
    expect(house.objects.has(`takes/${sha256Of(bytes)}`)).toBe(true);
  });

  it("quarantines in ours what a refusing bucket would not take, marks it failing, and lands it later", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const house = ours("r2");
    const backend = await team();
    const refusing = { ...backend.store, put: async () => { throw new Error("HTTP 403 AccessDenied"); } };
    restores.push(useBackendForTests(backend.id, refusing));

    const bytes = randomBytes(64);
    const sha256 = (await keep("takes", bytes, "audio/mpeg", path.join(dir, "q.mp3"), "enUS"))!;
    const key = `takes/${sha256}`;
    expect(house.objects.get(`${QUARANTINE}${key}`)?.data.equals(bytes)).toBe(true);
    expect(await rowOf(sha256, backend.id)).toEqual({ pending: true });
    expect((await locate(key)).key).toBe(`${QUARANTINE}${key}`);
    const [failing] = await systemRows(`select "health", "lastError" from "storage_backend" where "id" = $1`, [backend.id]);
    expect(failing).toEqual({ health: "failing", lastError: "Writing an object: HTTP 403 AccessDenied" });
    expect(await storageRefusal("enUS")).toContain("failing");

    // Still refusing: nothing lands, nothing is lost.
    expect(await landQuarantined()).toBe(0);
    expect(house.objects.has(`${QUARANTINE}${key}`)).toBe(true);

    restores.push(useBackendForTests(backend.id, backend.store));
    expect(await landQuarantined()).toBeGreaterThanOrEqual(1);
    expect(backend.store.objects.get(key)?.data.equals(bytes)).toBe(true);
    expect(house.objects.has(`${QUARANTINE}${key}`)).toBe(false);
    expect(await rowOf(sha256, backend.id)).toEqual({ pending: false });
    const [healed] = await systemRows(`select "health" from "storage_backend" where "id" = $1`, [backend.id]);
    expect(healed.health).toBe("ok");
    expect(await storageRefusal("enUS")).toBeNull();
  });
});
