/** Needs DATABASE_URL and migrations applied. */
import { randomBytes } from "node:crypto";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { closeDb } from "@/lib/db";
import { placeObject, testBackend } from "@/lib/storage/testing";
import { serveTake } from "@/lib/takes/serve";
import { systemRows } from "@/lib/teams/testing";

import { serveBlob } from "./serve";
import { memoryBlobs, useArchiveForTests } from "./store";
import { blobBytes, locate, QUARANTINE } from "./where";

afterAll(closeDb);

const restores: (() => void)[] = [];
afterEach(() => restores.splice(0).forEach((restore) => restore()));

const fresh = (prefix = "takes") => `${prefix}/${randomBytes(32).toString("hex")}`;
const bytes = Buffer.from("team bytes");

function ours() {
  const store = memoryBlobs();
  restores.push(useArchiveForTests(store, "r2"));
  return store;
}

async function team(options?: Parameters<typeof testBackend>[0]) {
  const backend = await testBackend(options);
  restores.push(backend.restore);
  return backend;
}

describe("locate", () => {
  it("finds an object no team kept in our bucket", async () => {
    const house = ours();
    const where = await locate(fresh());
    expect(where.store).toBe(house);
    expect(where.backendId).toBeNull();
  });

  it("finds a team's object in its bucket, and one waiting for it in our quarantine", async () => {
    ours();
    const backend = await team();
    const kept = fresh();
    await placeObject(kept, backend.id);
    expect(await locate(kept)).toMatchObject({ store: backend.store, key: kept, backendId: backend.id });

    const waiting = fresh();
    await placeObject(waiting, backend.id, { pending: true });
    expect(await locate(waiting)).toMatchObject({ key: `${QUARANTINE}${waiting}`, backendId: null });
  });

  it("reads our copy once every team copy is missing", async () => {
    const house = ours();
    const backend = await team();
    const key = fresh();
    await placeObject(key, backend.id, { missing: true });
    expect((await locate(key)).store).toBe(house);
  });
});

describe("blobBytes", () => {
  it("marks a team's copy missing when its bucket no longer has it, and falls back to ours", async () => {
    const house = ours();
    const backend = await team();
    const key = fresh();
    await placeObject(key, backend.id);
    house.objects.set(key, { data: bytes, contentType: "audio/mpeg" });

    expect((await blobBytes(key))?.equals(bytes)).toBe(true);
    const [row] = await systemRows<{ missing: boolean }>(
      `select "missingAt" is not null as "missing" from "archive_object" where "sha256" = $1`,
      [key.slice("takes/".length)],
    );
    expect(row.missing).toBe(true);
  });
});

describe("serving a team's object", () => {
  it("redirects a take to the team's public address", async () => {
    ours();
    const backend = await team();
    const key = fresh();
    await placeObject(key, backend.id);
    const res = await serveTake(new Request("https://spoken.test/a"), { kind: "blob", key }, { immutable: true });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`https://team.test/${key}`);
  });

  it("signs a private bucket's address, and lets nothing cache the redirect for as long as the signature", async () => {
    ours();
    const backend = await team({ publicUrl: null });
    const key = fresh();
    await placeObject(key, backend.id);
    const res = await serveTake(new Request("https://spoken.test/a"), { kind: "blob", key }, { immutable: true });
    expect(res.headers.get("location")).toBe(`https://signed.test/${key}?method=GET&expires=3600`);
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
  });

  it("streams a private object from the team's bucket", async () => {
    ours();
    const backend = await team();
    const key = fresh("recordings");
    await placeObject(key, backend.id);
    backend.store.objects.set(key, { data: bytes, contentType: "audio/ogg" });
    const res = await serveBlob(new Request("https://spoken.test/a"), key, { cacheControl: "no-cache" });
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
  });
});
