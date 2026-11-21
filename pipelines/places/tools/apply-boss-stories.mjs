#!/usr/bin/env node
// Records boss stories in boss_line, origin 'rewritten'.
//
//   node tools/apply-boss-stories.mjs <dir of *.json>
//
// Each JSON file is an array of { map, key, lang?, text }: a boss's story (key = its key) in one
// language, enUS where lang is left out. A dungeon's own (key "_") is skipped: a dungeon's page is
// empty. The stories rewritten into one voice come from the source material
// tools/build-boss-stories.mjs --packets writes; tools/assemble-boss-stories.mjs writes this shape
// directly. A story's source is the wiki article boss-sources.json names for the boss, where it
// names one. Every file is read and checked before anything is written.
//
// A story an editor has changed on the site stays current: the rewrite lands beneath it. Data/Stories.lua
// is written from the table by make bosses-export. Credit is in THIRD_PARTY.md.

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { close, readBosses, recordStory, requireDatabase } from "./bosses/store.mjs";
import { loadEnvFile } from "./lib/env.mjs";
import { resolveStories, storyInput } from "./lib/boss-stories.mjs";
import { ROOT, sourceUrl } from "./lib/wiki.mjs";

const dir = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;
if (!dir) {
  console.error("usage: apply-boss-stories.mjs <dir of *.json>");
  process.exit(1);
}
await loadEnvFile();
try {
  requireDatabase("apply-boss-stories");
  await main();
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
} finally {
  await close();
}

async function main() {
  const idOf = new Map((await readBosses()).map((b) => [`${b.map}\t${b.key}`, b.id]));
  const titles = JSON.parse(await readFile(join(ROOT, "pipelines/places/tools/boss-sources.json"), "utf8"));
  const titleOf = new Map(titles.filter((s) => s.wikiTitle).map((s) => [`${s.map}\t${s.key}`, s.wikiTitle]));

  const stories = [];
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json")).sort()) {
    for (const raw of JSON.parse(await readFile(join(dir, file), "utf8"))) {
      let row;
      try {
        row = storyInput(raw);
      } catch (err) {
        throw new Error(`${file}: ${err.message}`);
      }
      if (row) stories.push({ ...row, file });
    }
  }

  const { resolved, unresolved } = resolveStories(stories, idOf);
  if (unresolved.length > 0) {
    console.error(`${unresolved.length} stories name no live boss; nothing written:`);
    for (const { map, key, lang, file } of unresolved) console.error(`  ${map} "${key}" ${lang} (${file})`);
    process.exitCode = 1;
    return;
  }

  const counts = { inserted: 0, unchanged: 0, "kept-edit": 0 };
  const total = resolved.length;
  console.log(`recording ${total} stories`);
  for (const [i, { map, key, bossId, lang, text }] of resolved.entries()) {
    const title = titleOf.get(`${map}\t${key}`);
    const source = title ? sourceUrl(title) : null;
    counts[await recordStory({ bossId, lang, text, source, origin: "rewritten" })]++;
    // Against production each story is a round trip, so a long run says how far it has got.
    if ((i + 1) % 50 === 0 || i + 1 === total) {
      console.log(`  ${i + 1}/${total} ${lang} (${counts.inserted} inserted, ${counts.unchanged} unchanged, ${counts["kept-edit"]} kept-edit)`);
    }
  }

  console.log(`${counts.inserted} inserted, ${counts.unchanged} unchanged, ${counts["kept-edit"]} kept-edit`);
  if (counts.inserted > 0) console.log("then: make bosses-export");
}
