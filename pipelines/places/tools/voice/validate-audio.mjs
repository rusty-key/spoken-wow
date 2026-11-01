#!/usr/bin/env node
//
// Checks that the manifest, the files on disk, the generated lookup table and the
// lore data all still agree.
//
// This is the failure worth catching here: a lookup row pointing at a file that
// is not there plays silence in-game and reports nothing. So does the reverse, an
// mp3 the lookup does not list: German Places 2.1.1 shipped every clip beside an
// empty table, because its manifest was missing and read as empty. Every other
// kind of mistake announces itself.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { loadEnvFile } from "../lib/env.mjs";
import { readLines, shipped } from "../lib/loredata.mjs";
import { assignFiles, lineId } from "./naming.mjs";
import { hasBrackets, loadPronunciation, toSpokenText } from "./normalise.mjs";
import { LANG, loadManifest, packDir, soundsDir } from "./store.mjs";

const LOOKUP_PATH = join(packDir(), "Data/Sounds.lua");

const problems = [];
const notes = [];

function problem(text) { problems.push(text); }
function note(text) { notes.push(text); }

/**
 * @param lookup        the text of Data/Sounds.lua
 * @param onDisk        the mp3s in Sounds/, as paths without the extension
 * @param shippedFiles  the files of the takes whose place has words
 * @param validKeys     `mapID:key` for every subzone in the lore data
 */
export function checkLookup({ lookup, onDisk, shippedFiles, validKeys }) {
  const problems = [];
  // The table stores WoW-style backslash paths (escaped in Lua source); the
  // files on disk are POSIX. Compare in one form.
  const referenced = new Set([...lookup.matchAll(/file = "([^"]+)"/g)].map((m) =>
    m[1].replace(/\\\\/g, "/").replace(/\\/g, "/"),
  ));
  for (const file of referenced) {
    if (!onDisk.has(file)) problems.push(`lookup table points at ${file}.mp3, which is not on disk (plays silence)`);
  }
  const missingFromLookup = [...shippedFiles].filter((f) => !referenced.has(f));
  if (missingFromLookup.length) {
    problems.push(`${missingFromLookup.length} generated files are not in the lookup table `
      + "(unreachable in-game) -- run node tools/voice/build-lookup.mjs");
  }
  // Checked against the disk as well as the manifest: an empty manifest lists nothing, so
  // the check above passes an empty table beside a full Sounds/.
  const unlisted = [...onDisk].filter((f) => !referenced.has(f)).sort();
  if (unlisted.length) {
    problems.push(`${unlisted.length} mp3s on disk are not in the lookup table (unreachable in-game), `
      + `e.g. ${unlisted.slice(0, 3).map((f) => `${f}.mp3`).join(", ")}`);
  }

  // Keys in the table must be exactly what SpokenPlaces:NormaliseAreaKey produces,
  // or the lookup silently misses.
  let currentMap = null;
  for (const line of lookup.split("\n")) {
    const zoneHeader = line.match(/^\t\t\[(\d+)\] = \{$/);
    if (zoneHeader) { currentMap = zoneHeader[1]; continue; }
    const keyRow = line.match(/^\t\t\t\["([^"]+)"\]/);
    if (keyRow && currentMap && !validKeys.has(`${currentMap}:${keyRow[1]}`)) {
      problems.push(`lookup key "${keyRow[1]}" under ${currentMap} matches no subzone in the lore data`);
    }
  }
  return problems;
}

async function mp3sOnDisk(dir, prefix = "") {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) found.push(...(await mp3sOnDisk(join(dir, item.name), rel)));
    else if (item.name.endsWith(".mp3")) found.push(rel.replace(/\.mp3$/, ""));
  }
  return found;
}

async function main() {
  const entries = await readLines();
  const rules = await loadPronunciation();
  const files = assignFiles(entries);
  const manifest = await loadManifest();
  const lore = shipped(entries);

  //-- the spoken text is safe for v3 ----------------------------------------
  let bracketed = 0;
  for (const entry of entries) {
    if (hasBrackets(toSpokenText(entry.full, rules))) bracketed++;
  }
  if (bracketed) {
    problem(`${bracketed} lines still contain square brackets after normalising; `
      + "Eleven v3 reads those as performance directions");
  }

  //-- the shared lexicon covers this project's spellings ---------------------

  //-- file paths are unique -------------------------------------------------
  const byFile = new Map();
  for (const [id, file] of files) {
    if (byFile.has(file)) problem(`file collision: ${byFile.get(file)} and ${id} both map to ${file}`);
    byFile.set(file, id);
  }

  //-- manifest vs disk ------------------------------------------------------
  const onDisk = new Set(await mp3sOnDisk(soundsDir()));
  const manifestFiles = new Set(Object.values(manifest).map((r) => r.file));
  // What the lookup lists and the pack ships: a take whose place has no words is left out.
  const shippedFiles = new Set(
    Object.entries(manifest).filter(([id]) => lore.has(id)).map(([, r]) => r.file),
  );

  for (const [id, record] of Object.entries(manifest)) {
    if (!lore.has(id)) {
      note(`${id}: live, but the lore has no words for it; left out of the pack`);
      continue;
    }
    if (!onDisk.has(record.file)) problem(`${id}: manifest says ${record.file}.mp3, which is not on disk`);
  }
  for (const file of onDisk) {
    if (!manifestFiles.has(file)) note(`${file}.mp3 is on disk with no manifest entry (orphan)`);
    else if (!shippedFiles.has(file)) problem(`${file}.mp3 is on disk but no place with words plays it`);
  }

  //-- lookup table vs disk --------------------------------------------------
  if (existsSync(LOOKUP_PATH)) {
    const validKeys = new Set(entries.filter((e) => e.key).map((e) => `${e.mapID}:${e.key}`));
    problems.push(...checkLookup({ lookup: await readFile(LOOKUP_PATH, "utf8"), onDisk, shippedFiles, validKeys }));
  } else if (Object.keys(manifest).length || onDisk.size) {
    problem("audio has been generated but no lookup table exists -- run node tools/voice/build-lookup.mjs");
  }

  //-- report ----------------------------------------------------------------
  const total = Object.keys(manifest).length;
  if (problems.length === 0) {
    console.log(`OK -- ${total} generated, ${onDisk.size} files on disk, lookup in step`);
    for (const text of notes) console.log(`     note: ${text}`);
    return;
  }

  console.error(`FAILED -- ${problems.length} problem(s)`);
  for (const text of problems.slice(0, 20)) console.error(`  ${text}`);
  if (problems.length > 20) console.error(`  ... and ${problems.length - 20} more`);
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  loadEnvFile()
    .then(main)
    .catch((err) => {
      // err.stack, not err.message: a thrown non-Error and a rejected promise carrying one
      // both print an empty message, which reports a failure while hiding every word of it.
      console.error(`error: ${err?.stack || err}`);
      process.exit(1);
    });
}
