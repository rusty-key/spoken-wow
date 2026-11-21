#!/usr/bin/env node
// Writes addons/Spoken_Bosses/Data/{Bosses,Creatures,Stories}.lua from the boss tables.
//
//   node pipelines/places/tools/bosses/export.mjs           # write the three files
//   node pipelines/places/tools/bosses/export.mjs --check   # fail if they are out of date, write nothing
//
// The database is where boss data is authored; the Lua is what the addon ships, committed so the
// addon builds without Postgres. --check ignores each file's leading `--` comment block and line
// endings, and is not part of `make check`, which has to pass on clones with no Postgres.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { render } from "../../../lib/bosses.mjs";
import { loadEnvFile } from "../lib/env.mjs";
import { renderCreatures } from "../lib/boss-creatures.mjs";
import { renderStories } from "../lib/boss-stories.mjs";
import { ROOT } from "../lib/wiki.mjs";
import { bossesForExport, creaturesForExport, storiesForExport } from "./shape.mjs";
import { close, readBosses, readNames, readStories, requireDatabase } from "./store.mjs";

// Before anything reads DATABASE_URL.
await loadEnvFile();

const checkOnly = process.argv.includes("--check");
const DATA = join(ROOT, "addons/Spoken_Bosses/Data");

/** The text without its leading `--` comment block, and with "\n" line endings. */
const body = (text) => text.replace(/\r\n/g, "\n").replace(/^(--.*\n)+/, "");

async function main() {
  requireDatabase("bosses-export");
  const bosses = await readBosses({ includeRetired: true });
  const nameRows = await readNames("boss");
  const storyRows = await readStories();
  const files = {
    "Bosses.lua": () => {
      const { maps, names } = bossesForExport(bosses, nameRows);
      return render(maps, names);
    },
    "Creatures.lua": () => renderCreatures(creaturesForExport(bosses)),
    "Stories.lua": () => renderStories(storiesForExport(bosses, storyRows)),
  };
  let stale = 0;
  for (const [name, build] of Object.entries(files)) {
    const path = join(DATA, name);
    const text = build();
    if (checkOnly) {
      const committed = await readFile(path, "utf8").catch(() => "");
      if (body(committed) !== body(text)) {
        console.error(`${name} differs from the database: run make bosses-export`);
        stale++;
      }
    } else {
      await writeFile(path, text, "utf8");
      console.log(`wrote ${path}`);
    }
  }
  if (stale > 0) process.exitCode = 1;
  else if (checkOnly) console.log("Bosses.lua, Creatures.lua and Stories.lua match the database");
}

try {
  await main();
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
} finally {
  await close();
}
