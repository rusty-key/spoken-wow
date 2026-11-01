import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { rewriteToc, stagePack } from "./stage-pack.mjs";

function tree(root, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

const TOC = [
  "## Interface: 11509",
  "## Title: Spoken Audio",
  "## Version: 1.2.3",
  "## IconTexture: x",
  "## X-SpokenPlaces-Quality: low",
  "## X-SpokenPlaces-Bitrate: 64",
  "## X-SpokenPlaces-Language: enUS",
  "Data/Sounds.lua",
  "",
].join("\n");

const source = {
  "SpokenPlacesAudio.toc": TOC,
  "README.md": "readme",
  "Textures/AddonIcon.tga": "english icon",
  "Data/Sounds.lua": "english lookup",
  "Sounds/1/zone.mp3": "english clip",
  "Sounds/.from-takes": "",
  ".DS_Store": "",
};
const files = (root) => (name) => readFileSync(join(root, "dist", name), "utf8");

test("rewriteToc sets the pack's lines and leaves the rest", () => {
  const out = rewriteToc(TOC, { folder: "F", title: "Spoken French", version: "2.0.0", lang: "frFR", tocPrefix: "X-SpokenPlaces" });
  assert.match(out, /^## Interface: 11509$/m);
  assert.match(out, /^## Title: \|cffb48cffSpoken\|r French$/m);
  assert.match(out, /^## Version: 2\.0\.0$/m);
  assert.match(out, /^## IconTexture: Interface\\AddOns\\F\\Textures\\AddonIcon\.tga$/m);
  assert.match(out, /^## X-SpokenPlaces-Quality: high$/m);
  assert.match(out, /^## X-SpokenPlaces-Bitrate: 128$/m);
  assert.match(out, /^## X-SpokenPlaces-Language: frFR$/m);
});

test("rewriteToc refuses a .toc missing a line it must set", () => {
  assert.throws(() => rewriteToc("## Title: x\n", { folder: "F", title: "T", version: "1", lang: "frFR", tocPrefix: null }), /IconTexture/);
});

test("a language's pack takes its clips, lookup, icon and name from its own", async () => {
  const root = mkdtempSync(join(tmpdir(), "stage-"));
  tree(join(root, "addons/SpokenPlacesAudio"), source);
  tree(join(root, "build/places/frFR"), { "Sounds/1/zone.mp3": "french clip", "Sounds/.from-takes": "", "Data/Sounds.lua": "french lookup" });
  tree(root, { "pipelines/places/assets/spoken-zones-frFR.tga": "french icon" });
  const pack = { folder: "SpokenPlacesAudio_frFR", name: "Spoken French Audio: Places", version: "2.0.0" };
  const out = await stagePack("places", "frFR", { root, pack, readme: "french readme" });
  assert.equal(out.version, "2.0.0");
  const read = files(root);
  assert.equal(read("SpokenPlacesAudio_frFR/Sounds/1/zone.mp3"), "french clip");
  assert.equal(read("SpokenPlacesAudio_frFR/Data/Sounds.lua"), "french lookup");
  assert.equal(read("SpokenPlacesAudio_frFR/Textures/AddonIcon.tga"), "french icon");
  assert.equal(read("SpokenPlacesAudio_frFR/README.md"), "french readme");
  assert.match(read("SpokenPlacesAudio_frFR/SpokenPlacesAudio_frFR.toc"), /Language: frFR/);
  assert.equal(existsSync(join(root, "dist/SpokenPlacesAudio_frFR/SpokenPlacesAudio.toc")), false);
  assert.equal(existsSync(join(root, "dist/SpokenPlacesAudio_frFR/Sounds/.from-takes")), false);
  assert.equal(existsSync(join(root, "dist/SpokenPlacesAudio_frFR/.DS_Store")), false);
});

test("English's version is its .toc's, and a rebuild leaves nothing of the last one", async () => {
  const root = mkdtempSync(join(tmpdir(), "stage-"));
  tree(join(root, "addons/SpokenPlacesAudio"), source);
  tree(root, { "dist/SpokenPlacesAudio/Sounds/gone.mp3": "stale" });
  const pack = { folder: "SpokenPlacesAudio", name: "Spoken Audio: Places and Bosses", version: null };
  const out = await stagePack("places", "enUS", { root, pack });
  assert.equal(out.version, "1.2.3");
  assert.equal(existsSync(join(root, "dist/SpokenPlacesAudio/Sounds/gone.mp3")), false);
  assert.equal(files(root)("SpokenPlacesAudio/Sounds/1/zone.mp3"), "english clip");
  assert.match(files(root)("SpokenPlacesAudio/SpokenPlacesAudio.toc"), /^## Title: \|cffb48cffSpoken\|r Audio: Places$/m);
});

test("no clips or no lookup stops the stage", async () => {
  const root = mkdtempSync(join(tmpdir(), "stage-"));
  tree(join(root, "addons/SpokenPlacesAudio"), { "SpokenPlacesAudio.toc": TOC });
  const pack = { folder: "SpokenPlacesAudio", name: "n", version: null };
  await assert.rejects(stagePack("places", "enUS", { root, pack }), /Sounds/);
  tree(join(root, "addons/SpokenPlacesAudio"), { "Sounds/1.mp3": "x" });
  await assert.rejects(stagePack("places", "enUS", { root, pack }), /lookup/);
});

test("quests has no such build", async () => {
  await assert.rejects(stagePack("quests", "enUS", { pack: {} }), /no Manager-only build/);
});
