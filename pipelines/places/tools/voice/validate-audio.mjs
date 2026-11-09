#!/usr/bin/env node
//
// Checks that the manifest, the files on disk, the generated lookup table and the
// lore data all still agree.
//
// This is the failure worth catching here: a lookup row pointing at a file that
// is not there plays silence in-game and reports nothing. Every other kind of
// mistake announces itself.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readdir } from "node:fs/promises";

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
  // A manifest export with no database writes nothing, and an empty lookup then agrees with it.
  if (onDisk.size > 0 && manifestFiles.size === 0) {
    problem(`${onDisk.size} clips on disk and an empty manifest: the pack would play nothing. Was DATABASE_URL set for its lookup?`);
  }
  for (const file of onDisk) {
    if (!manifestFiles.has(file)) note(`${file}.mp3 is on disk with no manifest entry (orphan)`);
    else if (!shippedFiles.has(file)) problem(`${file}.mp3 is on disk but no place with words plays it`);
  }

  //-- lookup table vs disk --------------------------------------------------
  if (existsSync(LOOKUP_PATH)) {
    const lookup = await readFile(LOOKUP_PATH, "utf8");
    // The table stores WoW-style backslash paths (escaped in Lua source); the
    // files on disk are POSIX. Compare in one form.
    const referenced = [...lookup.matchAll(/file = "([^"]+)"/g)].map((m) =>
      m[1].replace(/\\\\/g, "/").replace(/\\/g, "/"),
    );
    for (const file of referenced) {
      if (!onDisk.has(file)) problem(`lookup table points at ${file}.mp3, which is not on disk (plays silence)`);
    }
    const missingFromLookup = [...shippedFiles].filter((f) => !referenced.includes(f));
    if (missingFromLookup.length) {
      problem(`${missingFromLookup.length} generated files are not in the lookup table `
        + "(unreachable in-game) -- run node tools/voice/build-lookup.mjs");
    }

    // Keys in the table must be exactly what SpokenPlaces:NormaliseAreaKey produces,
    // or the lookup silently misses.
    const validKeys = new Set(entries.filter((e) => e.key).map((e) => `${e.mapID}:${e.key}`));
    let currentMap = null;
    for (const line of lookup.split("\n")) {
      const zoneHeader = line.match(/^\t\t\[(\d+)\] = \{$/);
      if (zoneHeader) { currentMap = zoneHeader[1]; continue; }
      const keyRow = line.match(/^\t\t\t\["([^"]+)"\]/);
      if (keyRow && currentMap && !validKeys.has(`${currentMap}:${keyRow[1]}`)) {
        problem(`lookup key "${keyRow[1]}" under ${currentMap} matches no subzone in the lore data`);
      }
    }
  } else if (Object.keys(manifest).length) {
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

loadEnvFile()
  .then(main)
  .catch((err) => {
    // err.stack, not err.message: a thrown non-Error and a rejected promise carrying one
    // both print an empty message, which reports a failure while hiding every word of it.
    console.error(`error: ${err?.stack || err}`);
    process.exit(1);
  });
