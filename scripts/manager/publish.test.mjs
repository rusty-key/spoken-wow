import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { generateKeys, openJson, sha256Text } from "./sign.mjs";
import { ConflictError, memoryStore } from "./store.mjs";
import { IMMUTABLE, INDEX_CACHE, latestSpokenRelease, publish } from "./publish.mjs";

const keys = generateKeys();
const minSpoken = { quests: "3.0.0", places: "3.0.0", readables: "3.0.0" };
const packs = [{ folder: "SpokenPlacesAudio_deDE", section: "places", lang: "deDE" }];
const quiet = () => {};

function dist(files) {
  const dir = mkdtempSync(join(tmpdir(), "dist-"));
  writeFolder(dir, files);
  return dir;
}
function writeFolder(dir, files) {
  const root = join(dir, "SpokenPlacesAudio_deDE");
  rmSync(root, { recursive: true, force: true });
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(root, ...p.split("/").slice(0, -1)), { recursive: true });
    writeFileSync(join(root, ...p.split("/")), text);
  }
}
const run = (store, distDir, extra = {}) => publish({
  store, packs, distDir, signingKey: keys.privateKey, minSpoken, latestSpoken: "3.0.0",
  cache: new Map(), log: quiet, now: new Date("2026-10-18T14:22:33Z"), ...extra,
});
const index = (store) => openJson(store.objects.get("index.json").body.toString(), keys.publicKey).value;

test("a first publish uploads every blob, the manifest, then the index", async () => {
  const store = memoryStore();
  const out = await run(store, dist({ "SpokenPlacesAudio_deDE.toc": "toc", "s/1.ogg": "one" }));
  assert.equal(out.rev, "20261018T142233Z");
  assert.equal(out.blobs, 2);
  const puts = store.log.filter(([op]) => op === "put").map(([, k]) => k);
  assert.equal(puts.at(-1), "index.json");
  assert.ok(puts.indexOf("packs/SpokenPlacesAudio_deDE/20261018T142233Z.json") < puts.indexOf("index.json"));
  const entry = index(store).packs.SpokenPlacesAudio_deDE;
  const manifest = openJson(store.objects.get("packs/SpokenPlacesAudio_deDE/20261018T142233Z.json").body.toString(), keys.publicKey);
  assert.equal(entry.manifestSha256, sha256Text(manifest.signed));
  assert.deepEqual(entry.requires, { Spoken: ">=3.0.0" });
  assert.equal(store.objects.get(`blobs/${sha256Text("one")}`).cacheControl, IMMUTABLE);
  assert.equal(store.objects.get("index.json").cacheControl, INDEX_CACHE);
});

test("an unchanged pack gets no new rev and nothing is uploaded", async () => {
  const store = memoryStore();
  const d = dist({ "SpokenPlacesAudio_deDE.toc": "toc" });
  await run(store, d);
  store.log.length = 0;
  const out = await run(store, d, { now: new Date("2026-10-19T00:00:00Z") });
  assert.equal(out.rev, null);
  assert.equal(store.log.filter(([op]) => op === "put").length, 0);
});

test("a change uploads only the new blob", async () => {
  const store = memoryStore();
  const d = dist({ "SpokenPlacesAudio_deDE.toc": "toc", "s/1.ogg": "one" });
  await run(store, d);
  writeFolder(d, { "SpokenPlacesAudio_deDE.toc": "toc", "s/1.ogg": "one", "s/2.ogg": "two" });
  store.log.length = 0;
  const out = await run(store, d, { now: new Date("2026-10-19T00:00:00Z") });
  assert.equal(out.blobs, 1);
  assert.deepEqual(store.log.filter(([op, k]) => op === "put" && k.startsWith("blobs/")).map(([, k]) => k), [`blobs/${sha256Text("two")}`]);
  assert.equal(index(store).packs.SpokenPlacesAudio_deDE.rev, "20261019T000000Z");
});

test("a dry run sends nothing", async () => {
  const store = memoryStore();
  const out = await run(store, dist({ "SpokenPlacesAudio_deDE.toc": "toc" }), { dryRun: true });
  assert.equal(out.blobs, 1);
  assert.equal(store.objects.size, 0);
});

test("a missing folder stops the run before anything is read or sent", async () => {
  const store = memoryStore();
  await assert.rejects(run(store, mkdtempSync(join(tmpdir(), "empty-"))), /dist\/SpokenPlacesAudio_deDE is missing/);
  assert.equal(store.log.length, 0);
});

test("onlyPresent publishes the folders dist/ holds and skips the absent ones", async () => {
  const store = memoryStore();
  const two = [...packs, { folder: "SpokenPlacesAudio_frFR", section: "places", lang: "frFR" }];
  const out = await run(store, dist({ "SpokenPlacesAudio_deDE.toc": "toc" }), { packs: two, onlyPresent: true });
  assert.deepEqual(out.changed, ["SpokenPlacesAudio_deDE"]);
});

test("onlyPresent with nothing built is refused rather than publishing nothing", async () => {
  const store = memoryStore();
  await assert.rejects(run(store, mkdtempSync(join(tmpdir(), "empty-")), { onlyPresent: true }), /nothing in dist\/ to publish/);
  assert.equal(store.log.length, 0);
});

test("a folder older than its zip is refused as a stale build", async () => {
  const store = memoryStore();
  const d = dist({ "SpokenPlacesAudio_deDE.toc": "toc" });
  const old = new Date("2026-01-01T00:00:00Z");
  utimesSync(join(d, "SpokenPlacesAudio_deDE", "SpokenPlacesAudio_deDE.toc"), old, old);
  writeFileSync(join(d, "SpokenPlacesAudio_deDE-1.0.0.zip"), "zip");
  await assert.rejects(run(store, d), /dist\/SpokenPlacesAudio_deDE is older than its zip: rebuild it \(make places-package-audio\)/);
  assert.equal(store.log.length, 0);
});

test("a folder with no root .toc is refused: the build did not finish", async () => {
  const store = memoryStore();
  await assert.rejects(run(store, dist({ "s/1.ogg": "one" })), /dist\/SpokenPlacesAudio_deDE has no SpokenPlacesAudio_deDE\.toc: the build did not finish/);
  assert.equal(store.log.length, 0);
});

test("a folder name the manager would reject is refused before anything is read", async () => {
  const store = memoryStore();
  await assert.rejects(run(store, dist({}), { packs: [{ folder: "Spoken Zones", section: "places" }] }), /not a pack id the manager accepts/);
  assert.equal(store.log.length, 0);
});

test("a reserved Windows device name in a file path is refused", async () => {
  const store = memoryStore();
  await assert.rejects(run(store, dist({ "SpokenPlacesAudio_deDE.toc": "toc", "Sounds/nul.ogg": "x" })), /unsafe file name Sounds\/nul\.ogg/);
  assert.equal(store.log.filter(([op]) => op === "put").length, 0);
});

test("a pack that needs an unreleased Spoken is refused", async () => {
  await assert.rejects(run(memoryStore(), dist({ "SpokenPlacesAudio_deDE.toc": "t" }), { minSpoken: { ...minSpoken, places: "3.1.0" } }),
    /needs Spoken 3.1.0, but the latest release is 3.0.0/);
});

test("a publish that loses the race to the index fails", async () => {
  const store = memoryStore();
  const d = dist({ "SpokenPlacesAudio_deDE.toc": "toc" });
  await run(store, d);
  writeFolder(d, { "SpokenPlacesAudio_deDE.toc": "changed" });
  const realGet = store.get;
  store.get = async (key) => {
    const got = await realGet(key);
    if (key === "index.json") await store.put("index.json", store.objects.get("index.json").body);
    return got;
  };
  await assert.rejects(run(store, d, { now: new Date("2026-10-19T00:00:00Z") }), ConflictError);
});

test("two publishes in the same second do not overwrite a manifest", async () => {
  const store = memoryStore();
  const d = dist({ "SpokenPlacesAudio_deDE.toc": "toc" });
  await run(store, d);
  writeFolder(d, { "SpokenPlacesAudio_deDE.toc": "changed" });
  await assert.rejects(run(store, d), ConflictError);
});

test("latestSpokenRelease picks the highest published spoken/v tag", async () => {
  const fake = async () => new Response(JSON.stringify([
    { tag_name: "spoken/v3.0.0", draft: false, prerelease: false },
    { tag_name: "spoken/v3.10.0", draft: false, prerelease: false },
    { tag_name: "spoken/v3.11.0-beta.1", draft: false, prerelease: true },
    { tag_name: "places-audio/v9.0.0", draft: false, prerelease: false },
  ]));
  assert.equal(await latestSpokenRelease(fake), "3.10.0");
});

test("latestSpokenRelease reads past a page with no spoken/v release", async () => {
  const requests = [];
  const fake = async (url) => {
    const page = Number(new URL(url).searchParams.get("page"));
    requests.push(page);
    const body = page === 1
      ? Array.from({ length: 100 }, (_, i) => ({ tag_name: `places-audio/v1.0.${i}`, draft: false, prerelease: false }))
      : page === 2
        ? [{ tag_name: "spoken/v3.2.0", draft: false, prerelease: false }, { tag_name: "spoken/v3.1.0", draft: false, prerelease: false }]
        : [];
    return new Response(JSON.stringify(body));
  };
  assert.equal(await latestSpokenRelease(fake), "3.2.0");
  assert.equal(requests.length, 2);
});

test("a blob whose bytes no longer match its hash is refused and nothing is indexed", async () => {
  const store = memoryStore();
  const d = dist({ "SpokenPlacesAudio_deDE.toc": "toc" });
  const abs = join(d, "SpokenPlacesAudio_deDE", "SpokenPlacesAudio_deDE.toc");
  const st = statSync(abs);
  const cache = new Map([[abs, { size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, sha256: "0".repeat(64) }]]);
  await assert.rejects(run(store, d, { cache }), /changed while publishing/);
  assert.equal(store.objects.has("index.json"), false);
});
