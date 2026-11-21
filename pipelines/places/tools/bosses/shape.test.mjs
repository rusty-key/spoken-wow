import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { render } from "../../../lib/bosses.mjs";
import { LOCALES } from "../../../lib/dungeons.mjs";
import { renderCreatures } from "../lib/boss-creatures.mjs";
import { renderStories } from "../lib/boss-stories.mjs";
import { bossesForExport, creaturesForExport, storiesForExport } from "./shape.mjs";

const boss = (over) => ({
  id: 1,
  map: 70,
  key: "x",
  position: 1,
  encounterIds: [over.id ?? 1],
  creatureId: null,
  displayId: null,
  zone: null,
  retired: false,
  ...over,
});
const names = (entries) => new Map(Object.entries(entries).map(([id, langs]) => [id, new Map(Object.entries(langs))]));
const lines = (entries) => new Map(Object.entries(entries).map(([lang, text]) => [lang, { text, source: null, origin: "rewritten" }]));

test("retired bosses are left out of every file", () => {
  const live = boss({ id: 1, key: "live", creatureId: 5 });
  const gone = boss({ id: 2, key: "gone", creatureId: 6, retired: true });
  const nm = names({ 1: { enUS: "Live" }, 2: { enUS: "Gone" } });
  const stories = new Map([[1, lines({ enUS: "a" })], [2, lines({ enUS: "b" })]]);
  assert.deepEqual(bossesForExport([live, gone], nm).maps[70].map((b) => b.key), ["live"]);
  assert.deepEqual(creaturesForExport([live, gone]).map((r) => r.key), ["live"]);
  assert.deepEqual(storiesForExport([live, gone], stories), { 70: { live: "a" } });
});

test("a story with no English row still exports in its own language", () => {
  const bosses = [boss({ id: 1, key: "de only" }), boss({ id: 2, key: "two" }), boss({ id: 3, key: "en only" })];
  const stories = new Map([
    [1, lines({ deDE: "Deutsch" })],
    [2, lines({ enUS: "English", frFR: "Français" })],
    [3, lines({ enUS: "Only English" })],
  ]);
  const out = storiesForExport(bosses, stories);
  assert.deepEqual(out[70]["de only"], { deDE: "Deutsch" });
  assert.deepEqual(out[70].two, { 1: "English", frFR: "Français" });
  assert.equal(out[70]["en only"], "Only English");
  const lua = renderStories(out);
  assert.match(lua, /\["de only"\] = \{ deDE = "Deutsch" \},/);
  assert.match(lua, /\["two"\] = \{ "English", frFR = "Français" \},/);
});

test("a boss with no story is not in Stories", () => {
  assert.deepEqual(storiesForExport([boss({})], new Map()), {});
});

test("names equal to English are omitted, as render expects", () => {
  const nm = names({ 1: { enUS: "Boss", deDE: "Boss", frFR: "Chef" } });
  const { maps, names: out } = bossesForExport([boss({ id: 1, key: "boss" })], nm);
  assert.equal(maps[70][0].name, "Boss");
  assert.deepEqual(out.frFR, { 1: "Chef" });
  assert.ok(!("esES" in out) || !("1" in out.esES));
  const lua = render(maps, out);
  assert.match(lua, /"Boss", frFR = "Chef" \}/);
  assert.doesNotMatch(lua, /deDE = "Boss"/);
});

test("a boss with no English name fails loudly", () => {
  assert.throws(() => bossesForExport([boss({ id: 1 })], names({ 1: { deDE: "x" } })), /English/);
});

// ---- the committed files, parsed back into the database's shapes and rendered again ----

const dataDir = fileURLToPath(new URL("../../../../addons/Spoken_Bosses/Data/", import.meta.url));
const read = async (name) => (await readFile(dataDir + name, "utf8")).replace(/\r\n/g, "\n");
/** The file without its leading `--` comment block. */
const body = (text) => text.replace(/^(--.*\n)+/, "");
const unquote = (s) => s.replace(/\\(.)/g, (_, c) => (c === "n" ? "\n" : c));
const STR = String.raw`"((?:[^"\\]|\\.)*)"`;

test("render reproduces the committed Bosses.lua", async () => {
  const bosses = [];
  const nm = new Map();
  let map = null;
  let position = 0;
  for (const line of (await read("Bosses.lua")).split("\n")) {
    const head = line.match(/^\t\t\[(\d+)\] = \{/);
    if (head) {
      map = Number(head[1]);
      continue;
    }
    const m = line.match(new RegExp(String.raw`^\t\t\t\{ id = (\d+), ids = \{ ([^}]*) \}, key = ${STR}, ${STR}(.*) \},$`));
    if (!m) continue;
    const id = Number(m[1]);
    bosses.push(boss({ id, map, key: unquote(m[3]), position: position++, encounterIds: m[2].split(", ").map(Number) }));
    const langs = new Map([["enUS", unquote(m[4])]]);
    for (const [, loc, text] of m[5].matchAll(new RegExp(String.raw`(\w+) = ${STR}`, "g"))) langs.set(loc, unquote(text));
    nm.set(String(id), langs);
  }
  assert.ok(bosses.length > 100);
  const { maps, names: byLocale } = bossesForExport(bosses, nm);
  assert.equal(body(render(maps, byLocale)), body(await read("Bosses.lua")));
});

test("renderCreatures reproduces the committed file", async () => {
  const bosses = [];
  let map = null;
  for (const line of (await read("Creatures.lua")).split("\n")) {
    const head = line.match(/^\t\[(\d+)\] = \{/);
    if (head) {
      map = Number(head[1]);
      continue;
    }
    const m = line.match(new RegExp(String.raw`^\t\t\[${STR}\] = \{ creature = (\w+), display = (\w+) \},$`));
    if (!m) continue;
    const num = (s) => (s === "nil" ? null : Number(s));
    bosses.push(boss({ id: bosses.length + 1, map, key: unquote(m[1]), creatureId: num(m[2]), displayId: num(m[3]) }));
  }
  assert.ok(bosses.length > 100);
  const text = renderCreatures(creaturesForExport(bosses));
  assert.ok(text.includes("\r\n") && !/[^\r]\n/.test(text));
  assert.equal(body(text.replace(/\r\n/g, "\n")), body(await read("Creatures.lua")));
});

test("renderStories reproduces the committed Stories.lua", async () => {
  const bosses = [];
  const stories = new Map();
  let map = null;
  for (const line of (await read("Stories.lua")).split("\n")) {
    const head = line.match(/^\t\[(\d+)\] = \{/);
    if (head) {
      map = Number(head[1]);
      continue;
    }
    const m = line.match(new RegExp(String.raw`^\t\t\[${STR}\] = (.*),$`));
    if (!m) continue;
    const id = bosses.length + 1;
    bosses.push(boss({ id, map, key: unquote(m[1]) }));
    const rest = m[2];
    const langs = {};
    if (rest.startsWith("{")) {
      const first = rest.match(new RegExp(String.raw`^\{ ${STR}`));
      if (first) langs.enUS = unquote(first[1]);
      for (const [, loc, text] of rest.matchAll(new RegExp(String.raw`(\w+) = ${STR}`, "g"))) langs[loc] = unquote(text);
    } else {
      langs.enUS = unquote(rest.match(new RegExp(`^${STR}$`))[1]);
    }
    stories.set(id, lines(langs));
  }
  assert.ok(bosses.length > 100);
  assert.equal(body(renderStories(storiesForExport(bosses, stories))), body(await read("Stories.lua")));
});

test("LOCALES order is kept in a story table", () => {
  const out = storiesForExport([boss({})], new Map([[1, lines({ zhTW: "z", deDE: "d", enUS: "e" })]]));
  assert.ok(LOCALES.indexOf("deDE") < LOCALES.indexOf("zhTW"));
  assert.match(renderStories(out), /\{ "e", deDE = "d", zhTW = "z" \}/);
});
