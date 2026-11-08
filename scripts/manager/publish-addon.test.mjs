import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { gc } from "./gc.mjs";
import { IMMUTABLE, INDEX_CACHE, publish } from "./publish.mjs";
import { publishAddon } from "./publish-addon.mjs";
import { generateKeys, openJson, sealJson, sha256Text } from "./sign.mjs";
import { ConflictError, memoryStore } from "./store.mjs";

const keys = generateKeys();
const quiet = () => {};
const index = (store) => openJson(store.objects.get("index.json").body.toString(), keys.publicKey).value;

function zip(version, text = `zip ${version}`) {
  const dir = mkdtempSync(join(tmpdir(), "addon-"));
  const file = join(dir, `Spoken-${version}.zip`);
  writeFileSync(file, text);
  return file;
}

async function channel(value = { generatedAt: "2026-01-01T00:00:00.000Z", packs: { P: { rev: "r" } } }) {
  const store = memoryStore();
  await store.put("index.json", sealJson(value, keys.privateKey).text);
  return store;
}

const run = (store, version, extra = {}) =>
  publishAddon({ store, signingKey: keys.privateKey, zipPath: zip(version), log: quiet, clock: () => new Date("2026-11-08T00:00:00Z"), ...extra });

test("the zip goes up under its hash and the signed index lists it, packs untouched", async () => {
  const store = await channel();
  const out = await run(store, "3.8.3");
  const sha256 = sha256Text("zip 3.8.3");
  assert.equal(out.key, `blobs/${sha256}`);
  assert.equal(store.objects.get(out.key).cacheControl, IMMUTABLE);
  assert.equal(store.objects.get("index.json").cacheControl, INDEX_CACHE);
  const value = index(store);
  assert.deepEqual(value.addons.spoken, [{ version: "3.8.3", sha256, size: "zip 3.8.3".length }]);
  assert.deepEqual(value.packs, { P: { rev: "r" } });
  assert.equal(value.generatedAt, "2026-11-08T00:00:00.000Z");
});

test("the index keeps the newest versions, newest first", async () => {
  const store = await channel();
  for (const v of ["3.8.0", "3.10.0", "3.9.0", "3.11.0"]) await run(store, v);
  assert.deepEqual(index(store).addons.spoken.map((e) => e.version), ["3.11.0", "3.10.0", "3.9.0"]);
});

test("running it twice for the same zip changes nothing", async () => {
  const store = await channel();
  await run(store, "3.8.3");
  const before = store.objects.get("index.json").etag;
  assert.equal((await run(store, "3.8.3")).changed, false);
  assert.equal(store.objects.get("index.json").etag, before);
});

test("a dry run sends nothing", async () => {
  const store = await channel();
  const before = store.objects.get("index.json").etag;
  await run(store, "3.8.3", { dryRun: true });
  assert.equal(store.objects.get("index.json").etag, before);
  assert.equal(store.objects.size, 1);
});

test("betas and misnamed files are refused", async () => {
  const store = await channel();
  await assert.rejects(run(store, "3.9.0-beta.1"), /stable/);
  await assert.rejects(run(store, "3.8.3", { zipPath: "/tmp/other.zip" }), /stable/);
  assert.equal(store.objects.size, 1);
});

test("losing the index race retries on the index the other publish wrote", async () => {
  const store = await channel();
  const put = store.put.bind(store);
  let raced = false;
  store.put = async (key, body, opts) => {
    if (key === "index.json" && !raced) {
      raced = true;
      await put("index.json", sealJson({ generatedAt: "2026-02-01T00:00:00.000Z", packs: { Q: { rev: "new" } } }, keys.privateKey).text);
    }
    return put(key, body, opts);
  };
  await run(store, "3.8.3");
  assert.deepEqual(index(store).packs, { Q: { rev: "new" } });
  assert.equal(index(store).addons.spoken.length, 1);
});

test("a run that keeps losing the race reports the conflict", async () => {
  const store = await channel();
  const put = store.put.bind(store);
  store.put = async (key, body, opts) => {
    if (key === "index.json") throw new ConflictError(key);
    return put(key, body, opts);
  };
  await assert.rejects(run(store, "3.8.3"), ConflictError);
});

test("a voice pack publish keeps the zips listed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dist-"));
  mkdirSync(join(dir, "SpokenPlacesAudio_deDE"));
  writeFileSync(join(dir, "SpokenPlacesAudio_deDE", "SpokenPlacesAudio_deDE.toc"), "toc");
  const store = await channel({ generatedAt: "2026-01-01T00:00:00.000Z", packs: {} });
  await run(store, "3.8.3");
  await publish({
    store, packs: [{ folder: "SpokenPlacesAudio_deDE", section: "places", lang: "deDE" }], distDir: dir, signingKey: keys.privateKey,
    minSpoken: { places: "3.0.0" }, latestSpoken: "3.8.3", cache: new Map(), log: quiet, now: new Date("2026-11-09T00:00:00Z"),
  });
  assert.equal(index(store).addons.spoken[0].version, "3.8.3");
  assert.ok(index(store).packs.SpokenPlacesAudio_deDE);
});

test("gc deletes only the zips the index no longer lists, after the grace period", async () => {
  const store = await channel({ generatedAt: "", packs: {} });
  for (const v of ["3.0.0", "3.1.0", "3.2.0", "3.3.0"]) await run(store, v);
  const dropped = `blobs/${sha256Text("zip 3.0.0")}`;
  const live = `blobs/${sha256Text("zip 3.3.0")}`;

  const young = await gc({ store, signingKey: keys.privateKey, now: new Date(Date.now() + 1000), log: quiet });
  assert.deepEqual(young.deleted, []);

  const out = await gc({ store, signingKey: keys.privateKey, now: new Date(Date.now() + 2 * 86400000), log: quiet });
  assert.deepEqual(out.deleted, [dropped]);
  assert.equal(store.objects.has(dropped), false);
  assert.equal(store.objects.has(live), true);
});
