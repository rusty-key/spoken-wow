import { test } from "node:test";
import assert from "node:assert/strict";

import { localeEntries, lookupPath, packLua } from "./lookup.mjs";
import { quote } from "./lua.mjs";
import { pageChecksum } from "./naming.mjs";

test("English's lookup stays in the pack folder", () => {
  assert.match(lookupPath("enUS"), /addons\/SpokenReadablesAudio\/Data\/Sounds\.lua$/);
});

test("a voiced page carries layout-preserving caption text from its current language row", () => {
  const lua = packLua("esMX", [{ pageId: 15, file: "15", durationSec: 2.5,
    text: "<H1>Registro</H1>Hola.$BAdiós." }]);
  assert.ok(lua.includes(`text = ${quote("Registro\nHola.\nAdiós.")}`));
});

test("an English clip carries no text: Books.lua has the words", () => {
  const lua = packLua("enUS", [{ pageId: 15, file: "15", durationSec: 2.5, text: "<H1>Ledger</H1>Three crates." }]);
  assert.match(lua, /\[15\] = \{ file = "15", len = 2\.5 \},/);
  assert.doesNotMatch(lua, /Three crates/);
});

test("a take with word times carries them packed, and one without carries none", () => {
  const lua = packLua("enUS", [
    { pageId: 15, file: "15", durationSec: 2.5, wordTimes: [0, 0.42, 1.5] },
    { pageId: 16, file: "16", durationSec: 1.5, wordTimes: null },
  ]);
  assert.match(lua, /\[15\] = \{ file = "15", len = 2\.5, times = "0 \.42 1\.5" \},/);
  assert.match(lua, /\[16\] = \{ file = "16", len = 1\.5 \},/);
});

test("another language's is build output, never in English's folder", () => {
  const path = lookupPath("esMX");
  assert.match(path, /build\/readables\/esMX\/Data\/Sounds\.lua$/);
  assert.doesNotMatch(path, /addons\//);
});

const CLIPS = [{ pageId: 15, file: "15", durationSec: 2.5 }];
const PAGES = [
  { pageId: "15", numeric: true, bookId: "15", pageNumber: 1, ownerKind: "object", ownerIds: [7, 8], inEnglish: true, texts: ["Hola."] },
  { pageId: "16", numeric: true, bookId: "15", pageNumber: 2, ownerKind: "item", ownerIds: [9], inEnglish: true, texts: ["Adiós."] },
];
const NAMES = [
  { kind: "gameobject", entityId: "7", name: "Registro" },
  { kind: "gameobject", entityId: "8", name: "Registro del pueblo" },
  { kind: "item", entityId: "7", name: "Not this one" },
];

test("a translated page is listed under each name its owners have in that language", () => {
  const [first, second] = localeEntries(PAGES, NAMES).known;
  assert.deepEqual(first.titles, ["Registro", "Registro del pueblo"]);
  assert.deepEqual(second.titles, []);
});

test("a language's pack carries its index, keyed on its own titles and words", () => {
  const lua = packLua("esMX", CLIPS, localeEntries(PAGES, NAMES));
  assert.match(lua, /language = "esMX"/);
  assert.ok(lua.includes(`["Registro del pueblo"] = {`));
  assert.ok(lua.includes(`[1] = { [${pageChecksum("Hola.")}] = 15 }`));
});

test("a page whose owners have no name there is still found by its words", () => {
  const lua = packLua("esMX", CLIPS, localeEntries(PAGES, NAMES));
  const loose = lua.slice(lua.indexOf("loose = {"));
  assert.ok(loose.includes(`[${pageChecksum("Adiós.")}] = 16`));
});

test("a page listed under two names is not ambiguous with itself", () => {
  const lua = packLua("esMX", CLIPS, localeEntries(PAGES, NAMES));
  const loose = lua.slice(lua.indexOf("loose = {"));
  assert.ok(loose.includes(`[${pageChecksum("Hola.")}] = 15`));
});

test("English's pack carries no index: the addon's own is English", () => {
  const lua = packLua("enUS", CLIPS);
  assert.doesNotMatch(lua, /index = \{|loose = \{/i);
  assert.match(lua, /\[15\] = \{ file = "15", len = 2\.5 \},\n\t\},\n\}\n/);
});

const MINTED = "n0b8f4e2a-1c1d-4f7e-9a51-2a0c9d6c7e11";

test("a pack keeps pages English lacks out of the index older addons read", () => {
  const lua = packLua("esES", [
    { pageId: 38, file: "38", durationSec: 3 },
    { pageId: MINTED, file: MINTED, durationSec: 2 },
  ], {
    known: [{ pageId: 38, bookId: 38, pageNumber: 1, titles: ["Nota de Wiley"], texts: ["Mantorrecio:"] }],
    extra: [{ pageId: MINTED, bookId: "n1", pageNumber: 1, titles: ["Instrucciones"], texts: ["Trotamundos"] }],
  });
  const index = lua.slice(lua.indexOf("\tindex = {"), lua.indexOf("\tloose = {"));
  assert.ok(!index.includes("n0b8f4e2a"));
  assert.match(lua, /\textraIndex = \{/);
  assert.match(lua, new RegExp(`\\tplaces = \\{\\n\\t\\t\\["${MINTED}"\\] = \\{ book = "n1", number = 1 \\},`));
  assert.match(lua, /\tbooks = \{\n\t\t\["n1"\] = \{ pages = \{ "n0b8f4e2a-1c1d-4f7e-9a51-2a0c9d6c7e11" \} \},/);
  assert.match(lua, /\["n0b8f4e2a-1c1d-4f7e-9a51-2a0c9d6c7e11"\] = \{ file = "n0b8f4e2a-1c1d-4f7e-9a51-2a0c9d6c7e11", len = 2/);
});

test("English's pack carries the English pages Books.lua lacks, and no empty index", () => {
  const { extra } = localeEntries([
    { pageId: MINTED, numeric: false, bookId: "n1", pageNumber: 1, ownerKind: null, ownerIds: [], inEnglish: true, texts: ["Wanderer"], ownTitle: "Instructions" },
    { pageId: "38", numeric: true, bookId: "38", pageNumber: 1, ownerKind: null, ownerIds: [], inEnglish: true, texts: ["Known"], ownTitle: "Wiley" },
  ], []);
  const lua = packLua("enUS", [{ pageId: MINTED, file: MINTED, durationSec: 2 }], { known: [], extra });
  assert.match(lua, /\textraIndex = \{\n\t\t\["Instructions"\]/);
  assert.equal(extra.length, 1);
  assert.match(lua, /\tplaces = \{/);
  assert.doesNotMatch(lua, /\n\tindex = \{|\n\tloose = \{/);
});

test("a corrected page is still found by the wording the client shows", () => {
  const { known } = localeEntries([
    { pageId: "15", numeric: true, bookId: "15", pageNumber: 1, ownerKind: null, ownerIds: [], inEnglish: true, texts: ["Texto corregido.", "Texto original."], ownTitle: "Diario" },
  ], []);
  const lua = packLua("ptBR", [], { known, extra: [] });
  assert.ok(lua.includes(`[${pageChecksum("Texto corregido.")}] = 15`));
  assert.ok(lua.includes(`[${pageChecksum("Texto original.")}] = 15`));
});

test("an absorbed page keeps the file its take was cut to under the real numeric id", () => {
  const lua = packLua("esMX", [{ pageId: 38, file: "n1b2c", durationSec: 2.5 }]);
  assert.match(lua, /\[38\] = \{ file = "n1b2c", len = /);
});
