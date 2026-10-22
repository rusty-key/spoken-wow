#!/usr/bin/env node
// Writes Data/Stories.lua for Spoken NPCs from written sources only, best first, all of it kept to Classic:
//   1. the Adventure Guide's text for the boss (build-boss-stories.mjs --no-wiki),
//   2. its History on warcraft.wiki.gg, word for word (boss-history.mjs),
//   3. the story already in Stories.lua that was written from the game's Classic quest text.
// A sentence that names something after Classic (the era filter of lib/wiki.mjs) is dropped; a guide text
// that loses one is kept in English only, since the other languages cannot be filtered the same way.
// A boss none of them covers has no story. The dungeons' own stories ("_") are not kept.
//
// Usage: node tools/assemble-boss-stories.mjs <guide.json> <history.json> <current.json> [--out file]
//   guide.json:   [{ map, key, texts: { "1": English, deDE: ... } }]   (the guide's text, every language)
//   history.json: [{ map, key, title, text }]
//   current.json: [{ map, key, text }]                                  (the English of Stories.lua now)

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { cleanExtract, ROOT } from "./lib/wiki.mjs";
import { renderStories } from "./lib/boss-stories.mjs";

const args = process.argv.slice(2);
const [guideFile, historyFile, currentFile] = args;
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : join(ROOT, "addons/Spoken_NPCs/Data/Stories.lua");
const load = async (file) => JSON.parse(await readFile(file, "utf8"));
const id = (r) => `${r.map}\t${r.key}`;
const MIN_CHARS = 60;

const guide = new Map((await load(guideFile)).map((r) => [id(r), r]));
const history = new Map((await load(historyFile)).map((r) => [id(r), r]));
const current = new Map((await load(currentFile)).map((r) => [id(r), r]));

const stories = {};
const counts = { guide: 0, guideTrimmed: 0, history: 0, current: 0 };
const trimmed = [];
const dropped = [];
const put = (r, value, source) => {
  (stories[r.map] ??= {})[r.key] = value;
  counts[source]++;
};

for (const key of new Set([...guide.keys(), ...history.keys(), ...current.keys()])) {
  const [map, bossKey] = key.split("	");
  if (bossKey === "_") continue;
  const r = { map: Number(map), key: bossKey };
  const g = guide.get(key);
  if (g) {
    const english = g.texts["1"];
    const cleaned = cleanExtract(english, { eraFilter: true });
    if (cleaned.droppedCount === 0) {
      put(g, g.texts, "guide");
      continue;
    }
    trimmed.push(`${g.map}/${g.key}`);
    if (cleaned.full.length >= MIN_CHARS) {
      put(g, cleaned.full, "guideTrimmed");
      continue;
    }
  }
  const h = history.get(key);
  if (h) {
    put(h, h.text, "history");
    continue;
  }
  const c = current.get(key);
  if (c) {
    const cleaned = cleanExtract(c.text, { eraFilter: true });
    if (cleaned.full.length >= MIN_CHARS) {
      put(c, cleaned.full, "current");
      continue;
    }
  }
  dropped.push(`${r.map}/${r.key}`);
}

await writeFile(OUT, renderStories(stories));
console.log(JSON.stringify(counts), "trimmed by the era filter:", trimmed.join(", "));
console.log("no story:", dropped.join(", "));
