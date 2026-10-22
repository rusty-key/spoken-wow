#!/usr/bin/env node
// Writes Data/Stories.lua for Spoken NPCs from the stories rewritten into one voice.
//
//   node tools/apply-boss-stories.mjs <dir of rewritten *.json> [--out <file>]
//
// Each JSON file is an array of { map, key, text }: a boss's story (key = its key). A dungeon's own
// (key "_") is skipped: a dungeon's page is empty. tools/build-boss-stories.mjs --packets writes the
// source material they were rewritten from.
// English only: the stories are written in English, and the page shows them in every language.
//
// Like the packets, the result is built from Blizzard's and the wiki's text, and goes to the local build
// (local/game), not into commits to the repository. Credit is in THIRD_PARTY.md.

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ROOT } from "./lib/wiki.mjs";
import { renderStories } from "./lib/boss-stories.mjs";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--out");
if (!dir) {
  console.error("usage: apply-boss-stories.mjs <dir of rewritten *.json> [--out <file>]");
  process.exit(1);
}
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : join(ROOT, "addons/Spoken_NPCs/Data/Stories.lua");

const stories = {};
let count = 0;
for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json")).sort()) {
  for (const row of JSON.parse(await readFile(join(dir, file), "utf8"))) {
    const text = String(row.text ?? "").trim();
    if (!text || row.key === "_") continue;
    (stories[row.map] ??= {})[row.key] = text;
    count++;
  }
}

await writeFile(OUT, renderStories(stories));
console.log(`${count} stories in ${OUT}`);
