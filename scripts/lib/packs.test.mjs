import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  actedFolder, englishFolder, languageFolder,
  changelogSection, findPack, isLanguageHeading, managerFolders, loadPacks, MIN_SPOKEN, packsFor,
} from "./packs.mjs";

// A publishers/ tree in a temp directory, one page per entry: [group, file, frontmatter].
function tree(pages) {
  const dir = mkdtempSync(join(tmpdir(), "packs-"));
  for (const [group, file, fields] of pages) {
    mkdirSync(join(dir, group), { recursive: true });
    const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`);
    writeFileSync(join(dir, group, file), `---\n${lines.join("\n")}\n---\n\nBody.\n`);
  }
  return dir;
}

const placesEn = ["places", "a.md", { section: "places", lang: "enUS", curseforge: "1636532",
  wago: "b6mvD9KP", release: "places-audio", slug: "spoken-audio-places", name: "Spoken Zones Audio" }];
const placesMx = ["places", "b.md", { section: "places", lang: "esMX", version: "1.0.0",
  curseforge: "1711067", release: "places-audio-esMX", slug: "spoken-spanish-al-audio-places",
  name: "Spoken Zones Audio: Spanish (AL)" }];
const hordeEn = ["quests", "h.md", { section: "quests", lang: "enUS", pack: "horde",
  curseforge: "1660198", wago: "vNAg3OKo", release: "quests-audio-horde",
  slug: "spoken-audio-quests-horde", name: "Spoken Quests Audio: Horde" }];
const addonPage = ["places", "addon.md", { curseforge: "1636521", slug: "spoken-zones",
  name: "Spoken Zones" }];

test("English packs keep today's folders and carry no version, zip or tag", () => {
  const packs = loadPacks(tree([placesEn, hordeEn, addonPage]));
  assert.equal(findPack("places", "enUS", null, packs).folder, "SpokenPlacesAudio");
  const horde = findPack("quests", "enUS", "horde", packs);
  assert.equal(horde.folder, "SpokenQuestsAudioHorde");
  assert.equal(horde.version, null);
  assert.equal(horde.zip, null);
  assert.equal(horde.tag, null);
});

test("a language pack gets English's folder plus its code, and a zip and tag from its version", () => {
  const mx = findPack("places", "esMX", null, loadPacks(tree([placesEn, placesMx])));
  assert.equal(mx.folder, "SpokenPlacesAudio_esMX");
  assert.equal(mx.zip, "SpokenPlacesAudio_esMX-1.0.0.zip");
  assert.equal(mx.tag, "places-audio-esMX/v1.0.0");
  assert.equal(mx.wago, null);
});

test("pages without a section are addons, not packs", () => {
  assert.deepEqual(packsFor("places", "enUS", loadPacks(tree([addonPage]))), []);
});

test("packsFor lists only that section and language", () => {
  const packs = loadPacks(tree([placesEn, placesMx, hordeEn]));
  assert.deepEqual(packsFor("places", "esMX", packs).map((p) => p.folder), ["SpokenPlacesAudio_esMX"]);
  assert.deepEqual(packsFor("quests", "esMX", packs), []);
});

test("findPack names what it could not find", () => {
  assert.throws(() => findPack("readables", "deDE", null, loadPacks(tree([placesEn]))),
    /no readables pack registered for deDE/);
});

for (const [why, page, message] of [
  ["a language pack without a version", ["places", "x.md", { ...placesMx[2], version: undefined }], /version/],
  ["a code that is not a language", ["places", "x.md", { ...placesMx[2], lang: "esXX" }], /esXX/],
  ["a quests pack without a pack key", ["quests", "x.md", { ...hordeEn[2], pack: undefined }], /pack/],
  ["a places page with a pack key", ["places", "x.md", { ...placesEn[2], pack: "horde" }], /pack/],
  ["a release tag off the rule", ["places", "x.md", { ...placesMx[2], release: "zones-esMX" }], /places-audio-esMX/],
  ["an unknown section", ["places", "x.md", { ...placesEn[2], section: "maps" }], /maps/],
]) {
  test(`rejects ${why}`, () => {
    const fields = Object.fromEntries(Object.entries(page[2]).filter(([, v]) => v !== undefined));
    assert.throws(() => loadPacks(tree([[page[0], page[1], fields]])), message);
  });
}

test("rejects two pages for one pack", () => {
  assert.throws(() => loadPacks(tree([placesMx, ["places", "c.md", placesMx[2]]])), /two pages/);
});

test("a language heading is told from an English one", () => {
  assert.equal(isLanguageHeading("## 1.0.0 — places-audio-esMX — 2026-09-30"), true);
  assert.equal(isLanguageHeading("## 2.0.0 — quests-audio-horde-deDE"), true);
  assert.equal(isLanguageHeading("## 2.1.0 — audio — 2026-09-18"), false);
  assert.equal(isLanguageHeading("## 2.1.0 — 2026-09-21"), false);
  assert.equal(isLanguageHeading("## 0.3.3 — 2026-08-19 (sound packs)"), false);
});

const CHANGELOG = `# Changelog

## 2.1.0 — readables-audio-esMX — 2026-10-01

- Spanish.

## 2.1.0 — 2026-09-21

- English.
`;

test("changelogSection takes exactly the language pack's section", () => {
  assert.equal(changelogSection(CHANGELOG, "2.1.0", "readables-audio-esMX"),
    "## 2.1.0 — readables-audio-esMX — 2026-10-01\n\n- Spanish.");
  assert.throws(() => changelogSection(CHANGELOG, "2.1.0", "readables-audio-deDE"), /no "## 2.1.0 — readables-audio-deDE"/);
  assert.throws(() => changelogSection(CHANGELOG + "\n## 2.1.0 — readables-audio-esMX\n", "2.1.0", "readables-audio-esMX"), /two/);
});

test("a language may ship its quests as one pack, with no suffix", () => {
  const allFr = ["quests", "fr.md", { section: "quests", lang: "frFR", pack: "all",
    version: "2.0.0", release: "quests-audio-frFR", slug: "spoken-quests-audio-frfr",
    name: "Spoken Quests Audio: French" }];
  const fr = findPack("quests", "frFR", "all", loadPacks(tree([allFr])));
  assert.equal(fr.folder, "SpokenQuestsAudio_frFR");
  assert.equal(fr.tag, "quests-audio-frFR/v2.0.0");
  assert.equal(fr.curseforge, null);

});

test("English's all is a bundle of the four split packs' folders, zipped clear of the meta addon's name", () => {
  const allEn = ["quests", "en.md", { section: "quests", lang: "enUS", pack: "all",
    curseforge: "1660196", release: "quests-audio", slug: "spoken-quests-audio-all",
    name: "Spoken Quests Audio: All" }];
  const all = findPack("quests", "enUS", "all", loadPacks(tree([allEn])));
  assert.equal(all.folder, "SpokenQuestsAudioAll");
  assert.equal(all.release, "quests-audio");
  assert.equal(all.github, true);
  assert.deepEqual(all.bundles, ["SpokenQuestsAudioAlliance", "SpokenQuestsAudioHorde",
    "SpokenQuestsAudioShared", "SpokenQuestsAudioGossip"]);
  assert.equal(findPack("quests", "enUS", "horde", loadPacks(tree([hordeEn]))).bundles, null);
  assert.throws(() => loadPacks(tree([["quests", "en.md", { ...allEn[2], release: "quests-audio-all" }]])),
    /release should be quests-audio,/);
});

test("github: false keeps a pack off GitHub, and nothing else is accepted", () => {
  const packs = loadPacks(tree([["quests", "h.md", { ...hordeEn[2], github: "false" }], placesEn]));
  assert.equal(findPack("quests", "enUS", "horde", packs).github, false);
  assert.equal(findPack("places", "enUS", null, packs).github, true);
  assert.throws(() => loadPacks(tree([["quests", "h.md", { ...hordeEn[2], github: "true" }]])),
    /github may only be false/);
});

test("an acted overlay is the section's English folder plus Acted, and the language's code", () => {
  assert.equal(actedFolder("quests", "enUS"), "SpokenQuestsAudioActed");
  assert.equal(actedFolder("places", "deDE"), "SpokenPlacesAudioActed_deDE");
  assert.equal(actedFolder("readables", "ptBR"), "SpokenReadablesAudioActed_ptBR");
  assert.throws(() => actedFolder("places", "xxYY"));
});

const itQuests = (pack, extra = {}) => ["quests", `${pack}.md`, { section: "quests", lang: "itIT",
  pack, version: "0.0.2", curseforge: "1", release: `quests-audio-${pack}-itIT`,
  slug: `italian-spoken-quests-${pack}`, name: `Italian ${pack}`, github: "false", ...extra }];

test("a Shared pack holding every quest builds as the quests pack, and its sides are dormant", () => {
  const packs = loadPacks(tree([itQuests("shared", { holds: "quests" }),
    itQuests("alliance", { dormant: "true" }), itQuests("horde", { dormant: "true" }), itQuests("gossip")]));
  const shared = findPack("quests", "itIT", "shared", packs);
  assert.equal(shared.build, "quests");
  assert.equal(shared.folder, "SpokenQuestsAudioShared_itIT");
  assert.equal(findPack("quests", "itIT", "gossip", packs).build, "gossip");
  assert.equal(findPack("quests", "itIT", "horde", packs).dormant, true);
});

test("a dormant side needs a Shared pack holding every quest, and the other way round", () => {
  assert.throws(() => loadPacks(tree([itQuests("shared", { holds: "quests" }), itQuests("horde")])),
    /must be dormant/);
  assert.throws(() => loadPacks(tree([itQuests("shared"), itQuests("horde", { dormant: "true" })])),
    /must say holds: quests/);
});

test("only a language's shared pack holds quests, and only its sides are dormant", () => {
  assert.throws(() => loadPacks(tree([itQuests("gossip", { holds: "quests" })])), /holds: quests/);
  assert.throws(() => loadPacks(tree([itQuests("gossip", { dormant: "true" })])), /dormant: true/);
  assert.throws(() => loadPacks(tree([["quests", "h.md", { ...hordeEn[2], dormant: "true" }]])), /dormant: true/);
});

test("manager: true puts a pack's folders on the manager channel", () => {
  const onChannel = ["places", "b.md", { ...placesMx[2], manager: "true" }];
  assert.deepEqual(managerFolders(loadPacks(tree([placesEn, onChannel]))),
    [{ folder: "SpokenPlacesAudio_esMX", section: "places", lang: "esMX" }]);
});

test("English's quests bundle puts its four folders on the channel", () => {
  const all = ["quests", "all.md", { section: "quests", lang: "enUS", pack: "all", release: "quests-audio",
    slug: "spoken-audio-quests", name: "Spoken Quests Audio", manager: "true" }];
  assert.deepEqual(managerFolders(loadPacks(tree([all]))).map((p) => p.folder), [
    "SpokenQuestsAudioAlliance", "SpokenQuestsAudioHorde", "SpokenQuestsAudioShared", "SpokenQuestsAudioGossip",
  ]);
});

test("manager may only be true", () => {
  assert.throws(() => loadPacks(tree([["places", "b.md", { ...placesMx[2], manager: "yes" }]])), /manager may only be true/);
});

test("every section names the oldest Spoken its packs need", () => {
  for (const section of ["quests", "places", "readables", "bosses"]) assert.match(MIN_SPOKEN[section], /^\d+\.\d+\.\d+$/);
});

test("the bosses pack is SpokenBossesAudio, and a language's is that plus its code", () => {
  assert.equal(englishFolder("bosses"), "SpokenBossesAudio");
  assert.equal(`${languageFolder("bosses", null)}_deDE`, "SpokenBossesAudio_deDE");
  const en = ["bosses", "a.md", { section: "bosses", lang: "enUS", release: "bosses-audio",
    slug: "spoken-audio-bosses", name: "Spoken Audio: Bosses", manager: "true" }];
  const de = ["bosses", "b.md", { section: "bosses", lang: "deDE", version: "1.0.0",
    release: "bosses-audio-deDE", slug: "spoken-german-audio-bosses", name: "Spoken German Audio: Bosses" }];
  const packs = loadPacks(tree([en, de]));
  assert.equal(findPack("bosses", "enUS", null, packs).folder, "SpokenBossesAudio");
  const german = findPack("bosses", "deDE", null, packs);
  assert.equal(german.folder, "SpokenBossesAudio_deDE");
  assert.equal(german.tag, "bosses-audio-deDE/v1.0.0");
  assert.deepEqual(managerFolders(packs), [{ folder: "SpokenBossesAudio", section: "bosses", lang: "enUS" }]);
});

test("a pack bundledIn another names that pack's CurseForge project and has none of its own", () => {
  const bosses = { section: "bosses", lang: "enUS", release: "bosses-audio",
    slug: "spoken-audio-bosses", name: "Spoken Audio: Bosses" };
  const packs = loadPacks(tree([placesEn, ["bosses", "a.md", { ...bosses, bundledIn: "spoken-audio-places" }]]));
  const found = findPack("bosses", "enUS", null, packs);
  assert.equal(found.bundledIn, "spoken-audio-places");
  assert.equal(found.curseforge, null);
  assert.equal(findPack("places", "enUS", null, packs).bundledIn, null);
  assert.throws(() => loadPacks(tree([placesEn, ["bosses", "a.md", { ...bosses, bundledIn: "spoken-audio-places", curseforge: "1" }]])),
    /either as its own project or bundledIn another's/);
  assert.throws(() => loadPacks(tree([placesEn, ["bosses", "a.md", { ...bosses, bundledIn: "spoken-audio-nowhere" }]])),
    /bundledIn spoken-audio-nowhere is not an enUS pack on CurseForge/);
  assert.throws(() => loadPacks(tree([placesMx, ["bosses", "a.md", { ...bosses, bundledIn: "spoken-spanish-al-audio-places" }]])),
    /is not an enUS pack on CurseForge/);
});

test("the bosses pack's CurseForge home is the English places pack", () => {
  const packs = loadPacks();
  const bosses = findPack("bosses", "enUS", null, packs);
  assert.equal(bosses.bundledIn, findPack("places", "enUS", null, packs).slug);
  assert.equal(bosses.curseforge, null);
});
