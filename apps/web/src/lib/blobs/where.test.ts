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
    expect(await locate(waiting)).toMatchObject({ key: `${QUARANTINE}${backend.id}/${waiting}`, backendId: null });
  });

  it("reads our copy once every team copy is missing", async () => {
    const house = ours();
    const backend = await team();
    const key = fresh();
    await placeObject(key, backend.id, { missing: true });
    expect((await locate(key)).store).toBe(house);
  });
});

describe("locate across teams", () => {
  it("prefers the reading language's own team's copy, and still reads another team's", async () => {
    const { asSystem, ownTeam } = await import("@/lib/teams/testing");
    ours();
    const fr = await ownTeam("frFR");
    try {
      const english = await team();
      const french = await testBackend({ team: fr.team });
      const key = fresh("samples");
      await placeObject(key, french.id);
      await placeObject(key, english.id);
      expect((await locate(key, "frFR")).backendId).toBe(french.id);
      expect((await locate(key, "enUS")).backendId).toBe(english.id);

      // A language handed over leaves its objects in the old team's bucket.
      const handed = fresh("takes");
      await placeObject(handed, english.id);
      expect((await locate(handed, "frFR")).backendId).toBe(english.id);
      french.restore();
    } finally {
      await asSystem.query(`delete from "archive_object" where "teamId" = $1`, [fr.team]);
      await asSystem.query(`delete from "storage_backend" where "teamId" = $1`, [fr.team]);
      await fr.restore();
    }
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
  it("redirects a take to the team's public address, cached only briefly since the team may move it", async () => {
    ours();
    const backend = await team();
    const key = fresh();
    await placeObject(key, backend.id);
    const res = await serveTake(new Request("https://spoken.test/a"), { kind: "blob", key }, { immutable: true });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`https://team.test/${key}`);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
  });

  it("never caches a redirect to a quarantined copy for long, and caches ours for good", async () => {
    ours();
    const backend = await team();
    const waiting = fresh();
    await placeObject(waiting, backend.id, { pending: true });
    const quarantined = await serveTake(new Request("https://spoken.test/a"), { kind: "blob", key: waiting }, { immutable: true });
    expect(quarantined.headers.get("location")).toBe(`https://archive.test/${QUARANTINE}${backend.id}/${waiting}`);
    expect(quarantined.headers.get("cache-control")).toBe("public, max-age=300");

    const ourOwn = await serveTake(new Request("https://spoken.test/a"), { kind: "blob", key: fresh() }, { immutable: true });
    expect(ourOwn.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
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
