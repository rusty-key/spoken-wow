import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { pointerText } from "../lib/clip-pointer.mjs";
import { generateKeys, openJson, sealJson, sha256Text } from "./sign.mjs";
import { ConflictError, memoryStore } from "./store.mjs";
import { MIN_SPOKEN_TEAM } from "../lib/packs.mjs";
import { delist, IMMUTABLE, INDEX_CACHE, latestSpokenRelease, minSpokenFor, promote, publish } from "./publish.mjs";

const keys = generateKeys();
const minSpoken = { quests: "3.0.0", places: "3.0.0", readables: "3.0.0" };
const packs = [{ folder: "SpokenPlacesAudio_deDE", section: "places", lang: "deDE" }];
const quiet = () => {};

/** A dist/ holding each of `folders`, a folder name to its files. */
function distOf(folders) {
  const dir = mkdtempSync(join(tmpdir(), "dist-"));
  for (const [folder, files] of Object.entries(folders)) writeFolder(dir, files, folder);
  return dir;
}
const dist = (files) => distOf({ SpokenPlacesAudio_deDE: files });
function writeFolder(dir, files, folder = "SpokenPlacesAudio_deDE") {
  const root = join(dir, folder);
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

test("a pack losing many of its files is refused until allowed", async () => {
  const store = memoryStore();
  const full = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`Sounds/${i}.mp3`, `clip ${i}`]));
  const toc = { "SpokenPlacesAudio_deDE.toc": "toc" };
  await run(store, dist({ ...toc, ...full }), { now: new Date("2026-01-01T00:00:00Z") });
  const before = index(store).packs.SpokenPlacesAudio_deDE.rev;

  const short = dist({ ...toc, "Sounds/0.mp3": "clip 0" });
  await assert.rejects(run(store, short, { now: new Date("2026-01-02T00:00:00Z") }), /would lose 19 of its 21 files/);
  assert.equal(index(store).packs.SpokenPlacesAudio_deDE.rev, before);

  const out = await run(store, short, { now: new Date("2026-01-03T00:00:00Z"), allowRemovals: true });
  assert.deepEqual(out.changed, ["SpokenPlacesAudio_deDE"]);
});

test("a pack losing a few files publishes", async () => {
  const store = memoryStore();
  const toc = { "SpokenPlacesAudio_deDE.toc": "toc" };
  await run(store, dist({ ...toc, "Sounds/a.mp3": "a", "Sounds/b.mp3": "b" }), { now: new Date("2026-01-01T00:00:00Z") });
  const out = await run(store, dist({ ...toc, "Sounds/a.mp3": "a" }), { now: new Date("2026-01-02T00:00:00Z") });
  assert.deepEqual(out.changed, ["SpokenPlacesAudio_deDE"]);
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

test("a team's pack needs the first Spoken that plays team voices", () => {
  assert.equal(minSpokenFor("SpokenPlacesAudio_deDE_stimmen", "places", minSpoken, "3.12.0"), "3.12.0");
  assert.equal(minSpokenFor("SpokenQuestsAudioHorde_deDE_die-stimmen", "quests", minSpoken, "3.12.0"), "3.12.0");
  // ...or its section's, where that is later.
  assert.equal(minSpokenFor("SpokenPlacesAudio_deDE_stimmen", "places", { ...minSpoken, places: "4.0.0" }, "3.12.0"), "4.0.0");
  assert.throws(() => minSpokenFor("SpokenPlacesAudio_deDE_stimmen", "places", minSpoken, undefined), /team's pack/);
});

test("a language's plain pack, and English's, keep their section's", () => {
  assert.equal(minSpokenFor("SpokenPlacesAudio_deDE", "places", minSpoken, "3.12.0"), "3.0.0");
  assert.equal(minSpokenFor("SpokenPlacesAudio", "places", minSpoken, "3.12.0"), "3.0.0");
  assert.equal(minSpokenFor("SpokenQuestsAudioHorde_deDE", "quests", minSpoken, undefined), "3.0.0");
});

test("the Spoken that plays team voices is named, if not yet released", () => {
  assert.match(MIN_SPOKEN_TEAM, /^\d+\.\d+\.\d+$/);
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

const CLIP = Buffer.from("the real clip's bytes");
const clipSha = sha256Text(CLIP);
const pointer = pointerText(clipSha, CLIP.length);
const archiveOf = (body = CLIP, status = 200) => {
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    return new Response(body, { status });
  };
  return { asked, extra: { archiveUrl: "https://archive.example", fetchImpl } };
};
const manifestOf = (store, rev = "20261018T142233Z") =>
  openJson(store.objects.get(`packs/SpokenPlacesAudio_deDE/${rev}.json`).body.toString(), keys.publicKey).value;

test("a pointer to an encoding publishes as that Ogg, copied from the archive", async () => {
  const store = memoryStore();
  const { asked, extra } = archiveOf();
  const files = { "SpokenPlacesAudio_deDE.toc": "toc", "Sounds/1.ogg": pointerText(clipSha, CLIP.length, "encodings") };
  await run(store, dist(files), extra);
  assert.deepEqual(asked, [`https://archive.example/encodings/${clipSha}`]);
  assert.deepEqual(store.objects.get(`blobs/${clipSha}`).body, CLIP);
});

test("a pointer publishes as the clip it names, copied from the archive", async () => {
  const store = memoryStore();
  const { asked, extra } = archiveOf();
  await run(store, dist({ "SpokenPlacesAudio_deDE.toc": "toc", "Sounds/1.mp3": pointer }), extra);
  assert.deepEqual(asked, [`https://archive.example/takes/${clipSha}`]);
  assert.deepEqual(store.objects.get(`blobs/${clipSha}`).body, CLIP);
  const file = manifestOf(store).files.find((f) => f.path === "Sounds/1.mp3");
  assert.deepEqual(file, { path: "Sounds/1.mp3", sha256: clipSha, size: CLIP.length });
  assert.equal(store.objects.has(`blobs/${sha256Text(pointer)}`), false);
});

test("a pointer matches the pack built from the real clip, so nothing changes", async () => {
  const store = memoryStore();
  const { asked, extra } = archiveOf();
  await run(store, dist({ "SpokenPlacesAudio_deDE.toc": "toc", "Sounds/1.mp3": CLIP }));
  const out = await run(store, dist({ "SpokenPlacesAudio_deDE.toc": "toc", "Sounds/1.mp3": pointer }), { ...extra, now: new Date("2026-10-19T00:00:00Z") });
  assert.equal(out.rev, null);
  assert.deepEqual(asked, []);
});

test("a clip the channel already has is not fetched again", async () => {
  const store = memoryStore();
  const { asked, extra } = archiveOf();
  await run(store, dist({ "SpokenPlacesAudio_deDE.toc": "one", "Sounds/1.mp3": pointer }), extra);
  asked.length = 0;
  const out = await run(store, dist({ "SpokenPlacesAudio_deDE.toc": "two", "Sounds/1.mp3": pointer }), { ...extra, now: new Date("2026-10-19T00:00:00Z") });
  assert.equal(out.blobs, 1);
  assert.deepEqual(asked, []);
});

test("archive bytes that do not match their name are refused and nothing is indexed", async () => {
  const store = memoryStore();
  const { extra } = archiveOf(Buffer.from("the wrong bytes, same length!"));
  await assert.rejects(run(store, dist({ "SpokenPlacesAudio_deDE.toc": "toc", "Sounds/1.mp3": pointer }), extra), /do not match/);
  assert.equal(store.objects.has("index.json"), false);
});

test("a clip the archive cannot give stops the publish before the index", async () => {
  const store = memoryStore();
  const { extra } = archiveOf(null, 404);
  await assert.rejects(run(store, dist({ "SpokenPlacesAudio_deDE.toc": "toc", "Sounds/1.mp3": pointer }), extra), /HTTP 404/);
  assert.equal(store.objects.has("index.json"), false);
});

test("pointers without the archive's address stop the publish before anything is sent", async () => {
  const store = memoryStore();
  await assert.rejects(run(store, dist({ "SpokenPlacesAudio_deDE.toc": "toc", "Sounds/1.mp3": pointer })), /SPOKEN_ARCHIVE_URL/);
  assert.equal(store.log.filter(([op]) => op === "put").length, 0);
});

test("a dry run with pointers fetches nothing", async () => {
  const store = memoryStore();
  const { asked, extra } = archiveOf();
  const out = await run(store, dist({ "SpokenPlacesAudio_deDE.toc": "toc", "Sounds/1.mp3": pointer }), { ...extra, dryRun: true });
  assert.equal(out.bytes, CLIP.length + 3);
  assert.deepEqual(asked, []);
});

const toc = (version) => `## Title: Pack\n## Version: ${version}\n`;
const liveToc = (store, rev, folder = "SpokenPlacesAudio_deDE") => {
  const manifest = openJson(store.objects.get(`packs/${folder}/${rev}.json`).body.toString(), keys.publicKey).value;
  const file = manifest.files.find((f) => f.path === `${folder}.toc`);
  return store.objects.get(`blobs/${file.sha256}`).body.toString();
};
const later = new Date("2026-10-19T00:00:00Z");

test("a bump's first publish keeps the staged version", async () => {
  const store = memoryStore();
  const out = await run(store, dist({ "SpokenPlacesAudio_deDE.toc": toc("0.0.3"), "s/1.ogg": "one" }), { bump: "patch" });
  assert.equal(out.version, "0.0.3");
  assert.equal(liveToc(store, out.rev), toc("0.0.3"));
});

for (const [bump, next] of [["patch", "1.2.4"], ["minor", "1.3.0"], ["major", "2.0.0"]]) {
  test(`a ${bump} bump counts from the channel, not from what was staged`, async () => {
    const store = memoryStore();
    await run(store, dist({ "SpokenPlacesAudio_deDE.toc": toc("1.2.3"), "s/1.ogg": "one" }));
    const out = await run(store, dist({ "SpokenPlacesAudio_deDE.toc": toc("0.0.1"), "s/1.ogg": "two" }), { bump, now: later });
    assert.equal(out.version, next);
    assert.equal(liveToc(store, out.rev), toc(next));
  });
}

test("a bump finds nothing to release when only the staged version differs", async () => {
  const store = memoryStore();
  await run(store, dist({ "SpokenPlacesAudio_deDE.toc": toc("1.2.3"), "s/1.ogg": "one" }));
  const before = store.objects.get("index.json").body.toString();
  const out = await run(store, dist({ "SpokenPlacesAudio_deDE.toc": toc("0.0.1"), "s/1.ogg": "one" }), { bump: "major", now: later });
  assert.deepEqual(out.changed, []);
  assert.equal(out.version, null);
  assert.equal(store.objects.get("index.json").body.toString(), before);
});

test("one press gives its changed folders one version, past the highest, and leaves the others", async () => {
  const folders = ["SpokenQuestsAudioAlliance", "SpokenQuestsAudioHorde", "SpokenQuestsAudioShared"];
  const quests = folders.map((folder) => ({ folder, section: "quests", lang: "enUS" }));
  const distDir = mkdtempSync(join(tmpdir(), "dist-"));
  const write = (folder, version, clip) => writeFolder(distDir, { [`${folder}.toc`]: toc(version), "1.ogg": clip }, folder);
  const store = memoryStore();
  write(folders[0], "2.5.0", "a");
  write(folders[1], "2.6.0", "b");
  write(folders[2], "2.5.0", "c");
  await run(store, distDir, { packs: quests });
  const first = index(store).packs;

  write(folders[0], "9.9.9", "a2");
  write(folders[1], "9.9.9", "b");
  write(folders[2], "9.9.9", "c2");
  const out = await run(store, distDir, { packs: quests, bump: "patch", now: later });
  assert.equal(out.version, "2.6.1");
  assert.deepEqual(out.changed, [folders[0], folders[2]]);
  assert.equal(liveToc(store, out.rev, folders[0]), toc("2.6.1"));
  assert.equal(liveToc(store, out.rev, folders[2]), toc("2.6.1"));
  assert.equal(index(store).packs[folders[1]].rev, first[folders[1]].rev);
});

// index-v2.json is the channel's record; index.json is written from it with only the ids an
// older Manager accepts.
const indexV2 = (store) => openJson(store.objects.get("index-v2.json").body.toString(), keys.publicKey).value;
const stimmen = { slug: "stimmen", name: "Stimmen", official: false };
const SPOKEN = { spoken: [{ version: "3.6.0", sha256: "z".repeat(64), size: 1 }] };

/** A channel as it was before index-v2.json: index.json alone, with Spoken's zip and a German pack. */
async function legacyChannel() {
  const store = memoryStore();
  await run(store, dist({ "SpokenPlacesAudio_deDE.toc": "toc", "s/1.ogg": "one" }));
  store.objects.delete("index-v2.json");
  const legacy = { ...index(store), addons: SPOKEN };
  await store.put("index.json", sealJson(legacy, keys.privateKey).text, {});
  return store;
}

test("a first publish onto a channel with only index.json seeds index-v2.json from it", async () => {
  const store = await legacyChannel();
  const before = index(store).packs.SpokenPlacesAudio_deDE;
  const d = distOf({ SpokenPlacesAudio_frFR: { "SpokenPlacesAudio_frFR.toc": "toc", "s/1.ogg": "un" } });
  // The fixture's own publish wrote both indexes; the order checked is this publish's.
  store.log.length = 0;
  await run(store, d, { packs: [{ folder: "SpokenPlacesAudio_frFR", section: "places", lang: "frFR" }], now: later });
  const v2 = indexV2(store);
  assert.deepEqual(v2.packs.SpokenPlacesAudio_deDE, { ...before, lang: "deDE", section: "places", pack: null, team: null });
  assert.equal(v2.packs.SpokenPlacesAudio_frFR.lang, "frFR");
  assert.deepEqual(v2.addons, SPOKEN);
  assert.deepEqual(index(store).addons, SPOKEN);
  const puts = store.log.filter(([op]) => op === "put").map(([, k]) => k);
  assert.ok(puts.indexOf("index-v2.json") < puts.indexOf("index.json"));
  assert.equal(store.objects.get("index-v2.json").cacheControl, INDEX_CACHE);
});

test("a second team's pack is in index-v2.json with its team, and not in index.json", async () => {
  const store = await legacyChannel();
  const legacyBefore = index(store).packs;
  const folder = "SpokenPlacesAudio_deDE_stimmen";
  const d = distOf({ [folder]: { [`${folder}.toc`]: "toc", "s/1.ogg": "eins" } });
  await run(store, d, {
    packs: [{ folder, section: "places", lang: "deDE", team: stimmen }],
    languages: [{ code: "deDE", name: "German", native: "Deutsch" }],
    now: later,
  });
  const v2 = indexV2(store);
  assert.deepEqual(
    { lang: v2.packs[folder].lang, section: v2.packs[folder].section, pack: v2.packs[folder].pack, team: v2.packs[folder].team },
    { lang: "deDE", section: "places", pack: null, team: stimmen },
  );
  assert.deepEqual(v2.languages, { deDE: { code: "deDE", name: "German", native: "Deutsch" } });
  const legacy = index(store);
  assert.equal(legacy.packs[folder], undefined);
  // Every legacy entry is still there, at its rev, in its old shape.
  assert.deepEqual(legacy.packs, legacyBefore);
  assert.equal(legacy.languages, undefined);
});

test("a new language's own pack is in both indexes, and index-v2.json names its language", async () => {
  const store = await legacyChannel();
  const folder = "SpokenReadablesAudio_jaJP";
  const d = distOf({ [folder]: { [`${folder}.toc`]: "toc", "1.ogg": "ichi" } });
  const team = { slug: "nihongo", name: "Nihongo", official: false };
  await run(store, d, {
    packs: [{ folder, section: "readables", lang: "jaJP", team }],
    languages: [{ code: "jaJP", name: "Japanese", native: "日本語" }],
    now: later,
  });
  assert.deepEqual(indexV2(store).packs[folder].team, team);
  assert.deepEqual(indexV2(store).languages.jaJP, { code: "jaJP", name: "Japanese", native: "日本語" });
  const legacy = index(store).packs[folder];
  assert.equal(legacy.rev, indexV2(store).packs[folder].rev);
  assert.deepEqual(Object.keys(legacy).sort(), ["fileCount", "manifestSha256", "requires", "rev", "totalSize"]);
});

test("a second publish reads its live rev from index-v2.json", async () => {
  const store = memoryStore();
  const folder = "SpokenPlacesAudio_deDE_stimmen";
  const packsOf = [{ folder, section: "places", lang: "deDE", team: stimmen }];
  const d = distOf({ [folder]: { [`${folder}.toc`]: "toc", "s/1.ogg": "eins" } });
  await run(store, d, { packs: packsOf });
  store.log.length = 0;
  const out = await run(store, d, { packs: packsOf, now: later });
  assert.equal(out.rev, null);
  assert.equal(store.log.filter(([op]) => op === "put").length, 0);
});

test("a pack whose files are unchanged takes its new team and language names, at its rev", async () => {
  const store = memoryStore();
  const folder = "SpokenPlacesAudio_deDE_stimmen";
  const d = distOf({ [folder]: { [`${folder}.toc`]: "toc", "s/1.ogg": "eins" } });
  const first = await run(store, d, {
    packs: [{ folder, section: "places", lang: "deDE", team: stimmen }],
    languages: [{ code: "deDE", name: "German", native: "Deutsch" }],
  });
  const legacyBefore = index(store).packs;
  store.log.length = 0;
  const renamed = { ...stimmen, name: "Stimmen Azeroths", official: true };
  const out = await run(store, d, {
    packs: [{ folder, section: "places", lang: "deDE", team: renamed }],
    languages: [{ code: "deDE", name: "German (Germany)", native: "Deutsch" }],
    now: later,
  });
  assert.equal(out.rev, null);
  assert.deepEqual(out.changed, []);
  const entry = indexV2(store).packs[folder];
  assert.equal(entry.rev, first.rev);
  assert.deepEqual(entry.team, renamed);
  assert.equal(indexV2(store).languages.deDE.name, "German (Germany)");
  assert.deepEqual(index(store).packs, legacyBefore);
  // Nothing but the indexes: no blob, no manifest.
  assert.deepEqual(store.log.filter(([op]) => op === "put").map(([, k]) => k), ["index-v2.json", "index.json"]);
});

test("a publish that finds index.json behind index-v2.json brings it up to date", async () => {
  const store = memoryStore();
  const d = dist({ "SpokenPlacesAudio_deDE.toc": "toc", "s/1.ogg": "one" });
  await run(store, d);
  await store.put("index.json", sealJson({ ...index(store), packs: {} }, keys.privateKey).text, {});
  await run(store, d, { now: later });
  assert.equal(index(store).packs.SpokenPlacesAudio_deDE.rev, indexV2(store).packs.SpokenPlacesAudio_deDE.rev);
});

test("a failure after index-v2.json says index.json is behind it", async () => {
  const store = memoryStore();
  const put = store.put;
  store.put = async (key, ...rest) => {
    if (key === "index.json") throw new Error("network down");
    return put(key, ...rest);
  };
  await assert.rejects(run(store, dist({ "SpokenPlacesAudio_deDE.toc": "toc" })), /index\.json is behind index-v2\.json.*network down/);
  assert.ok(store.objects.has("index-v2.json"));
});

test("with no bump a publish takes the .toc as staged", async () => {
  const store = memoryStore();
  await run(store, dist({ "SpokenPlacesAudio_deDE.toc": toc("1.2.3"), "s/1.ogg": "one" }));
  const out = await run(store, dist({ "SpokenPlacesAudio_deDE.toc": toc("1.2.4"), "s/1.ogg": "one" }), { now: later });
  assert.equal(out.version, null);
  assert.equal(liveToc(store, out.rev), toc("1.2.4"));
});

// A team that is not official stages: blobs and manifests go up, no index changes, and a site
// owner's approval promotes what was staged into both indexes.
const stimmenFolder = "SpokenPlacesAudio_deDE_stimmen";
const stimmenPacks = [{ folder: stimmenFolder, section: "places", lang: "deDE", team: stimmen }];
const GERMAN = [{ code: "deDE", name: "German", native: "Deutsch" }];
const stage = (store, files, extra = {}) =>
  run(store, distOf({ [stimmenFolder]: { [`${stimmenFolder}.toc`]: toc("1.0.0"), ...files } }), {
    packs: stimmenPacks, languages: GERMAN, stage: true, bump: "patch", now: later, ...extra,
  });
const promoting = (store, staged, extra = {}) =>
  promote({ store, signingKey: keys.privateKey, staged, log: quiet, now: new Date("2026-10-20T00:00:00Z"), ...extra });
const indexBytes = (store) => [store.objects.get("index.json")?.body.toString(), store.objects.get("index-v2.json")?.body.toString()];

test("a staged publish leaves both indexes as they were, with its manifest and blobs in place", async () => {
  const store = await legacyChannel();
  const before = indexBytes(store);
  const out = await stage(store, { "s/1.ogg": "eins" });
  assert.deepEqual(indexBytes(store), before);
  const entry = out.staged.packs[stimmenFolder];
  assert.equal(entry.baseRev, null);
  assert.equal(out.staged.version, "1.0.0");
  assert.deepEqual(entry.team, stimmen);
  assert.equal(entry.lang, "deDE");
  assert.ok(store.objects.has(`packs/${stimmenFolder}/${entry.rev}.json`));
  assert.ok(store.objects.has(`blobs/${sha256Text("eins")}`));
  assert.deepEqual(out.staged.languages, { deDE: GERMAN[0] });
  assert.equal(out.version, "1.0.0");
});

test("a staged publish of nothing new stages nothing", async () => {
  const store = memoryStore();
  const first = await stage(store, { "s/1.ogg": "eins" });
  await promoting(store, first.staged);
  const out = await stage(store, { "s/1.ogg": "eins" }, { now: new Date("2026-10-21T00:00:00Z") });
  assert.deepEqual(out.staged.packs, {});
  assert.equal(out.version, null);
});

test("promoting lists what was staged in index-v2.json, and in index.json only an id an older Manager accepts", async () => {
  const store = await legacyChannel();
  const staged = await stage(store, { "s/1.ogg": "eins" });
  const jaFolder = "SpokenReadablesAudio_jaJP";
  const ja = await run(store, distOf({ [jaFolder]: { [`${jaFolder}.toc`]: toc("1.0.0"), "1.ogg": "ichi" } }), {
    packs: [{ folder: jaFolder, section: "readables", lang: "jaJP", team: { slug: "nihongo", name: "Nihongo", official: false } }],
    languages: [{ code: "jaJP", name: "Japanese", native: "日本語" }],
    stage: true, bump: "patch", now: later,
  });
  const both = {
    version: staged.staged.version,
    packs: { ...staged.staged.packs, ...ja.staged.packs },
    languages: { ...staged.staged.languages, ...ja.staged.languages },
  };
  const out = await promoting(store, both);
  assert.deepEqual([...out.promoted].sort(), [stimmenFolder, jaFolder]);
  const v2 = indexV2(store);
  assert.equal(v2.packs[stimmenFolder].rev, staged.staged.packs[stimmenFolder].rev);
  assert.equal(v2.packs[stimmenFolder].manifestSha256, staged.staged.packs[stimmenFolder].manifestSha256);
  assert.deepEqual(v2.packs[stimmenFolder].team, stimmen);
  assert.equal(v2.packs[stimmenFolder].baseRev, undefined);
  assert.equal(v2.packs[stimmenFolder].version, undefined);
  assert.deepEqual(v2.languages.jaJP, { code: "jaJP", name: "Japanese", native: "日本語" });
  assert.equal(index(store).packs[stimmenFolder], undefined);
  assert.deepEqual(Object.keys(index(store).packs[jaFolder]).sort(), ["fileCount", "manifestSha256", "requires", "rev", "totalSize"]);
  assert.deepEqual(index(store).addons, SPOKEN);
  // The German page pack is still there.
  assert.ok(index(store).packs.SpokenPlacesAudio_deDE);
});

// A store whose next index.json write fails, as a dropped connection between the two index writes would.
function dropNextIndexJson(store) {
  const put = store.put;
  let dropped = false;
  store.put = async (key, ...rest) => {
    if (key === "index.json" && !dropped) {
      dropped = true;
      throw new Error("network down");
    }
    return put(key, ...rest);
  };
  return store;
}

test("promoting again after index.json failed to write lists the pack there too", async () => {
  const store = await legacyChannel();
  const jaFolder = "SpokenReadablesAudio_jaJP";
  const ja = await run(store, distOf({ [jaFolder]: { [`${jaFolder}.toc`]: toc("1.0.0"), "1.ogg": "ichi" } }), {
    packs: [{ folder: jaFolder, section: "readables", lang: "jaJP", team: { slug: "nihongo", name: "Nihongo", official: false } }],
    languages: [{ code: "jaJP", name: "Japanese", native: "日本語" }],
    stage: true, bump: "patch", now: later,
  });
  dropNextIndexJson(store);
  await assert.rejects(promoting(store, ja.staged), /index\.json is behind index-v2\.json.*network down/);
  assert.equal(indexV2(store).packs[jaFolder].rev, ja.staged.packs[jaFolder].rev);
  assert.equal(index(store).packs[jaFolder], undefined);
  const out = await promoting(store, ja.staged, { now: new Date("2026-10-21T00:00:00Z") });
  assert.deepEqual(out.promoted, [jaFolder]);
  assert.equal(index(store).packs[jaFolder].rev, ja.staged.packs[jaFolder].rev);
});

test("promoting a pack whose live rev moved since it was staged is refused, and writes nothing", async () => {
  const store = memoryStore();
  const first = await stage(store, { "s/1.ogg": "eins" });
  await promoting(store, first.staged);
  const older = await stage(store, { "s/1.ogg": "zwei" }, { now: new Date("2026-10-21T00:00:00Z") });
  const newer = await stage(store, { "s/1.ogg": "drei" }, { now: new Date("2026-10-22T00:00:00Z") });
  await promoting(store, newer.staged, { now: new Date("2026-10-23T00:00:00Z") });
  const before = indexBytes(store);
  await assert.rejects(
    promoting(store, older.staged, { now: new Date("2026-10-24T00:00:00Z") }),
    { message: `${stimmenFolder} changed on the channel since it was staged: ask Stimmen to release again` },
  );
  assert.deepEqual(indexBytes(store), before);
});

test("promoting a staged entry whose manifest is missing is refused", async () => {
  const store = memoryStore();
  const staged = await stage(store, { "s/1.ogg": "eins" });
  store.objects.delete(`packs/${stimmenFolder}/${staged.staged.packs[stimmenFolder].rev}.json`);
  await assert.rejects(promoting(store, staged.staged), /has no manifest/);
  assert.equal(store.objects.has("index-v2.json"), false);
});

test("delisting removes a pack from both indexes and keeps its manifest", async () => {
  const store = await legacyChannel();
  const staged = await stage(store, { "s/1.ogg": "eins" });
  await promoting(store, staged.staged);
  const out = await delist({
    store, signingKey: keys.privateKey, folders: [stimmenFolder, "SpokenPlacesAudio_deDE"], log: quiet,
    now: new Date("2026-10-21T00:00:00Z"),
  });
  assert.deepEqual(out.delisted, [stimmenFolder, "SpokenPlacesAudio_deDE"]);
  assert.equal(indexV2(store).packs[stimmenFolder], undefined);
  assert.equal(index(store).packs.SpokenPlacesAudio_deDE, undefined);
  assert.equal(indexV2(store).languages.deDE, undefined);
  assert.deepEqual(index(store).addons, SPOKEN);
  assert.ok(store.objects.has(`packs/${stimmenFolder}/${staged.staged.packs[stimmenFolder].rev}.json`));
});

test("delisting a folder no index lists writes nothing, and says so", async () => {
  const store = memoryStore();
  await run(store, dist({ "SpokenPlacesAudio_deDE.toc": "toc" }));
  const before = indexBytes(store);
  const said = [];
  const out = await delist({ store, signingKey: keys.privateKey, folders: [stimmenFolder], log: (line) => said.push(line) });
  assert.deepEqual(out.delisted, []);
  assert.deepEqual(indexBytes(store), before);
  assert.ok(said.some((line) => line.includes(`${stimmenFolder} is not listed`)));
});

test("delisting again after index.json failed to write takes the pack out of it too", async () => {
  const store = await legacyChannel();
  const delisting = (now) => delist({ store, signingKey: keys.privateKey, folders: ["SpokenPlacesAudio_deDE"], log: quiet, now });
  dropNextIndexJson(store);
  await assert.rejects(delisting(new Date("2026-10-21T00:00:00Z")), /index\.json is behind index-v2\.json.*network down/);
  assert.equal(indexV2(store).packs.SpokenPlacesAudio_deDE, undefined);
  assert.ok(index(store).packs.SpokenPlacesAudio_deDE);
  const out = await delisting(new Date("2026-10-22T00:00:00Z"));
  assert.deepEqual(out.delisted, []);
  assert.equal(index(store).packs.SpokenPlacesAudio_deDE, undefined);
  assert.deepEqual(index(store).addons, SPOKEN);
});
