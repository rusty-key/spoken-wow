import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { rewriteToc, stagePack, stagedWithTakes } from "./stage-pack.mjs";

function tree(root, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

const DEVELOPERS = "SpokenDeveloperCharacters = {}\n";

// A checkout's root holding Spoken's developer list, which every pack carries.
function stageRoot() {
  const root = mkdtempSync(join(tmpdir(), "stage-"));
  tree(root, { "addons/Spoken/Data/DeveloperList.lua": DEVELOPERS });
  return root;
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

/** A one-folder plan as releasePlan gives it (release-pack.mjs): a page pack's, or with `toc` a derived one's. */
function planOf({ folder, title, version, toc = null, team = null }) {
  return {
    folders: [{ folder, section: null, lang: null, pack: null, title, version, team }],
    toc: toc ?? {},
    readmePage: null,
    badgeOptional: toc !== null,
  };
}

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
  const root = stageRoot();
  tree(join(root, "addons/SpokenPlacesAudio"), source);
  tree(join(root, "build/places/frFR"), { "Sounds/1/zone.mp3": "french clip", "Sounds/.from-takes": "", "Data/Sounds.lua": "french lookup" });
  tree(root, { "pipelines/places/assets/spoken-zones-frFR.tga": "french icon" });
  const plan = planOf({ folder: "SpokenPlacesAudio_frFR", title: "Spoken French Audio: Places", version: "2.0.0" });
  const out = await stagePack("places", "frFR", { root, plan, readme: "french readme" });
  assert.equal(out.version, "2.0.0");
  const read = files(root);
  assert.equal(read("SpokenPlacesAudio_frFR/Sounds/1/zone.mp3"), "french clip");
  assert.equal(read("SpokenPlacesAudio_frFR/Data/Sounds.lua"), "french lookup");
  assert.equal(read("SpokenPlacesAudio_frFR/Textures/AddonIcon.tga"), "french icon");
  assert.equal(read("SpokenPlacesAudio_frFR/README.md"), "french readme");
  assert.equal(read("SpokenPlacesAudio_frFR/Developers.lua"), DEVELOPERS);
  assert.match(read("SpokenPlacesAudio_frFR/SpokenPlacesAudio_frFR.toc"), /Language: frFR/);
  assert.equal(existsSync(join(root, "dist/SpokenPlacesAudio_frFR/SpokenPlacesAudio.toc")), false);
  assert.equal(existsSync(join(root, "dist/SpokenPlacesAudio_frFR/Sounds/.from-takes")), false);
  assert.equal(existsSync(join(root, "dist/SpokenPlacesAudio_frFR/.DS_Store")), false);
});

test("a bosses language pack wears its badged icon", async () => {
  const root = stageRoot();
  tree(join(root, "addons/SpokenBossesAudio"), {
    "SpokenBossesAudio.toc": TOC.replaceAll("X-SpokenPlaces", "X-SpokenBosses"),
    "Textures/AddonIcon.tga": "english icon",
    "Data/Sounds.lua": "english lookup",
    "Sounds/1.mp3": "english clip",
  });
  tree(join(root, "build/bosses/deDE"), { "Sounds/1.mp3": "german clip", "Data/Sounds.lua": "german lookup" });
  tree(root, { "pipelines/bosses/assets/spoken-bosses-deDE.tga": "german icon" });
  const plan = planOf({ folder: "SpokenBossesAudio_deDE", title: "Spoken German Audio: Bosses", version: "1.0.0" });
  await stagePack("bosses", "deDE", { root, plan });
  assert.equal(files(root)("SpokenBossesAudio_deDE/Textures/AddonIcon.tga"), "german icon");
});

test("English's version is its .toc's, and a rebuild leaves nothing of the last one", async () => {
  const root = stageRoot();
  tree(join(root, "addons/SpokenPlacesAudio"), source);
  tree(root, { "dist/SpokenPlacesAudio/Sounds/gone.mp3": "stale" });
  const plan = planOf({ folder: "SpokenPlacesAudio", title: "Spoken Audio: Places", version: null });
  const out = await stagePack("places", "enUS", { root, plan });
  assert.equal(out.version, "1.2.3");
  assert.equal(existsSync(join(root, "dist/SpokenPlacesAudio/Sounds/gone.mp3")), false);
  assert.equal(files(root)("SpokenPlacesAudio/Sounds/1/zone.mp3"), "english clip");
  assert.match(files(root)("SpokenPlacesAudio/SpokenPlacesAudio.toc"), /^## Title: \|cffb48cffSpoken\|r Audio: Places$/m);
});

test("no clips or no lookup stops the stage", async () => {
  const root = stageRoot();
  tree(join(root, "addons/SpokenPlacesAudio"), { "SpokenPlacesAudio.toc": TOC });
  const plan = planOf({ folder: "SpokenPlacesAudio", title: "n", version: null });
  await assert.rejects(stagePack("places", "enUS", { root, plan }), /Sounds/);
  tree(join(root, "addons/SpokenPlacesAudio"), { "Sounds/1.mp3": "x" });
  await assert.rejects(stagePack("places", "enUS", { root, plan }), /lookup/);
});

test("quests has no such build", async () => {
  await assert.rejects(stagePack("quests", "enUS", { plan: planOf({ folder: "F", title: "T", version: null }) }), /no Manager-only build/);
});

test("a second team's pack is its own folder, named for the team, with the language's badge", async () => {
  const root = stageRoot();
  tree(join(root, "addons/SpokenPlacesAudio"), source);
  tree(join(root, "build/places/deDE"), { "Sounds/1/zone.mp3": "german clip", "Data/Sounds.lua": "german lookup" });
  tree(root, { "pipelines/places/assets/spoken-zones-deDE.tga": "german icon" });
  const plan = planOf({
    folder: "SpokenPlacesAudio_deDE_stimmen", title: "Spoken German Audio: Places (Stimmen)", version: "1.0.0",
    toc: { team: "stimmen", teamName: "Stimmen" }, team: { slug: "t", name: "T", official: false },
  });
  const out = await stagePack("places", "deDE", { root, plan, readme: null });
  assert.deepEqual(out, { folder: "SpokenPlacesAudio_deDE_stimmen", version: "1.0.0" });
  const read = files(root);
  const toc = read("SpokenPlacesAudio_deDE_stimmen/SpokenPlacesAudio_deDE_stimmen.toc");
  assert.match(toc, /^## Title: \|cffb48cffSpoken\|r German Audio: Places \(Stimmen\)$/m);
  assert.match(toc, /^## Version: 1\.0\.0\n## X-Spoken-Team: stimmen\n## X-Spoken-TeamName: Stimmen$/m);
  assert.match(toc, /^## X-SpokenPlaces-Language: deDE$/m);
  assert.equal(read("SpokenPlacesAudio_deDE_stimmen/Textures/AddonIcon.tga"), "german icon");
  assert.equal(read("SpokenPlacesAudio_deDE_stimmen/Sounds/1/zone.mp3"), "german clip");
});

test("a new language's pack names its language and wears English's mark when it has no badge", async () => {
  const root = stageRoot();
  tree(join(root, "addons/SpokenReadablesAudio"), {
    "SpokenReadablesAudio.toc": "## Title: Spoken Audio: Readables\n## Version: 2.3.0\n## IconTexture: x\n## X-SpokenReadables-Language: enUS\n",
    "Textures/AddonIcon.tga": "english icon",
    "Data/Sounds.lua": "english lookup",
  });
  tree(join(root, "build/readables/jaJP"), { "Sounds/1.mp3": "japanese clip", "Data/Sounds.lua": "japanese lookup" });
  const plan = planOf({
    folder: "SpokenReadablesAudio_jaJP", title: "Spoken Japanese Audio: Readables", version: "1.0.0",
    toc: { languageName: "Japanese", languageNative: "日本語" }, team: { slug: "t", name: "T", official: false },
  });
  await stagePack("readables", "jaJP", { root, plan, readme: null });
  const read = files(root);
  const toc = read("SpokenReadablesAudio_jaJP/SpokenReadablesAudio_jaJP.toc");
  assert.match(toc, /^## X-Spoken-LanguageName: Japanese\n## X-Spoken-LanguageNative: 日本語$/m);
  // The language the addon files the pack under.
  assert.match(toc, /^## X-SpokenReadables-Language: jaJP$/m);
  assert.equal(read("SpokenReadablesAudio_jaJP/Textures/AddonIcon.tga"), "english icon");
});

// The readables packager (scripts/readables/package-audio.sh) sets it too: the addon files a pack
// whose .toc says enUS under English, so a German page pack would read as English's.
test("a language's readables page pack names its language, and English's keeps its .toc", async () => {
  const root = stageRoot();
  const committed = "## Title: Spoken Audio: Readables\n## Version: 2.3.0\n## IconTexture: x\n## X-SpokenReadables-Language: enUS\n";
  tree(join(root, "addons/SpokenReadablesAudio"), {
    "SpokenReadablesAudio.toc": committed,
    "Textures/AddonIcon.tga": "english icon",
    "Data/Sounds.lua": "english lookup",
    "Sounds/1.mp3": "english clip",
  });
  tree(join(root, "build/readables/deDE"), { "Sounds/1.mp3": "german clip", "Data/Sounds.lua": "german lookup" });
  tree(root, { "pipelines/readables/assets/spoken-books-deDE.tga": "german icon" });
  const german = planOf({ folder: "SpokenReadablesAudio_deDE", title: "Spoken German Audio: Readables", version: "2.1.1" });
  await stagePack("readables", "deDE", { root, plan: german, readme: null });
  const read = files(root);
  assert.match(read("SpokenReadablesAudio_deDE/SpokenReadablesAudio_deDE.toc"), /^## X-SpokenReadables-Language: deDE$/m);
  const english = planOf({ folder: "SpokenReadablesAudio", title: "Spoken Audio: Readables", version: null });
  await stagePack("readables", "enUS", { root, plan: english, readme: null });
  assert.equal(read("SpokenReadablesAudio/SpokenReadablesAudio.toc"), committed);
  assert.equal(read("SpokenReadablesAudio/Developers.lua"), DEVELOPERS);
});

test("a page pack missing its badge is still an error", async () => {
  const root = stageRoot();
  tree(join(root, "addons/SpokenPlacesAudio"), source);
  tree(join(root, "build/places/frFR"), { "Sounds/1/zone.mp3": "french clip", "Data/Sounds.lua": "french lookup" });
  const plan = planOf({ folder: "SpokenPlacesAudio_frFR", title: "Spoken French Audio: Places", version: "2.0.0" });
  await assert.rejects(stagePack("places", "frFR", { root, plan, readme: null }), /spoken-zones-frFR\.tga/);
});

test("a staged release carries the takes its pointers were made from, when they were recorded", async () => {
  const dir = mkdtempSync(join(tmpdir(), "staged-takes-"));
  const staged = { version: "1.0.0", packs: { SpokenPlacesAudio_deDE_x: { rev: "r1", baseRev: null } }, languages: {} };
  const takes = { "1411/razor-hill": { version: 3, sha256: "a".repeat(64) } };
  writeFileSync(join(dir, "selected-takes.json"), JSON.stringify(takes));
  assert.deepEqual(await stagedWithTakes(staged, join(dir, "selected-takes.json")), { ...staged, takes });
  assert.deepEqual(await stagedWithTakes(staged, join(dir, "none.json")), staged);
});
