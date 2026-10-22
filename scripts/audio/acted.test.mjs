import { test } from "node:test";
import assert from "node:assert/strict";

import { booksLua, creditsOf, packPath, questsLua, recordedDir, toc, zonesLua } from "./acted.mjs";

const clip = (file, extra = {}) => ({ file, durationSec: 2.5, credit: "A", createdAt: "2026-10-01", lineId: "", ...extra });

test("a recording is read from where the site archived it", () => {
  // apps/web/src/lib/takes/adapters.ts recordedDirOf: the same per-file directory, under recorded/<lang>/.
  assert.equal(recordedDir("quests", "deDE", "gossip/31ab.mp3"), "recorded/deDE/gossip/31ab");
  assert.equal(recordedDir("zones", "enUS", "1411/razor-hill"), "recorded/enUS/1411/razor-hill");
  assert.equal(recordedDir("books", "ptBR", "1381"), "recorded/ptBR/1381");
});

test("each clip lands where its player looks, quests in Ogg and the others in mp3", () => {
  assert.equal(packPath("quests", "quests/33-accept.mp3"), "generated/sounds/quests/33-accept.ogg");
  assert.equal(packPath("zones", "947/zone"), "Sounds/947/zone.mp3");
  assert.equal(packPath("books", "1381"), "Sounds/1381.mp3");
});

test("everybody is credited once, earliest first", () => {
  assert.deepEqual(
    creditsOf([clip("1", { credit: "B", createdAt: "2026-10-02" }), clip("2"), clip("3", { credit: "B" })]),
    ["A", "B"],
  );
});

test("the zones overlay registers apart from the packs, keyed like a pack", () => {
  const lua = zonesLua("deDE", [clip("1411/zone", { lineId: "z:1411" }), clip("1411/razor-hill", { lineId: "s:1411:razor hill" })], ["A"]);
  assert.match(lua, /SpokenZonesAudioOverlays\[ADDON_NAME\] = overlay/);
  assert.doesNotMatch(lua, /SpokenZonesAudioPacks\[/);
  assert.match(lua, /\[1411\] = \{ file = "1411\\\\zone", len = 2.5 \}/);
  assert.match(lua, /\["razor hill"\] = \{ file = "1411\\\\razor-hill", len = 2.5 \}/);
  assert.match(lua, /language = "deDE"/);
  assert.match(lua, /credits = \{ "A" \}/);
  assert.throws(() => zonesLua("deDE", [clip("1/x", { lineId: "q:1:accept" })], []));
});

test("the books overlay registers apart from the packs, by page id", () => {
  const lua = booksLua("enUS", [clip("1381")], ["A"]);
  assert.match(lua, /SpokenBooksAudioOverlays\[ADDON_NAME\] = overlay/);
  assert.match(lua, /\[1381\] = \{ file = "1381", len = 2.5 \}/);
});

test("the quests overlay is a module whose length table is its list of lines", () => {
  const files = questsLua("SpokenQuestsAudioActed_deDE", [clip("quests/m-33-accept.mp3")], ["A"]);
  assert.match(files["generated/sound_length_table.lua"], /\["m-33-accept"\] = 2.5,/);
  assert.match(files["Module.lua"], /DataModules:Register\("SpokenQuestsAudioActed_deDE"/);
  assert.match(files["Module.lua"], /%s\.ogg/);
});

test("a quests overlay outranks the generated packs, and says its language", () => {
  const text = toc({ section: "quests", lang: "deDE", version: "1.0.0", credits: ["A", "B"], iface: "11509" });
  assert.match(text, /^## Title: \|cffb48cffSpoken\|r German Audio: Quests - Voice Actors$/m);
  assert.match(text, /^## X-SpokenQuests-Language: deDE$/m);
  assert.match(text, /^## X-SpokenQuests-DataModule-Priority: 200$/m);
  assert.match(text, /^## X-VoiceOver-DataModule-Priority: 200$/m);
  assert.match(text, /^## X-Spoken-Actors: A, B$/m);
  assert.match(text, /^## Author: rusty, A, B$/m);
  const english = toc({ section: "zones", lang: "enUS", version: "1.0.0", credits: ["A"], iface: "11509" });
  assert.match(english, /^## Title: \|cffb48cffSpoken\|r Audio: Places - Voice Actors$/m);
  assert.doesNotMatch(english, /Language/);
  assert.match(english, /^Data\/Sounds.lua$/m);
});

test("every overlay nests under Spoken and names the addon that plays it", () => {
  for (const [section, player] of [["quests", "Spoken_Quests"], ["zones", "Spoken_Places"], ["books", "Spoken_Readables"]]) {
    const text = toc({ section, lang: "enUS", version: "1.0.0", credits: ["A"], iface: "11509", maps: "0" });
    assert.match(text, /^## Group: Spoken$/m);
    assert.match(text, /^## X-Part-Of: Spoken$/m);
    assert.match(text, new RegExp(`^## X-Child-Of: ${player}$`, "m"));
  }
});
