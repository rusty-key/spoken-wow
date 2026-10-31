#!/usr/bin/env node
//
// Checks SpokenBossesAudio's lookup, the mp3s beside it and the live takes against each other.
//
//   node pipelines/places/tools/bosses/validate-audio.mjs [--lang deDE]
//
// Fails on a lookup entry with no mp3, an mp3 with no entry, an entry whose len is missing or
// more than 0.01 s off its take's, and an entry its take does not back. A lookup row pointing
// at a missing file plays silence in-game and reports nothing, which is what this is for.
//
// A take cut before its story was last edited is stale. The addon has no hash to notice that
// with and plays it, as places does, so a stale take is reported here and does not fail.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvFile } from "../lib/env.mjs";
import { textHash } from "../voice/naming.mjs";
import { loadPronunciation, toSpokenText } from "../voice/normalise.mjs";
import { lookupPath } from "./build-lookup.mjs";
import { close, readBosses, readLiveTakes, readStories, requireDatabase } from "./store.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BASE_LANG = "enUS";
const TOLERANCE = 0.01;

export function soundsDir(lang) {
  return lang === BASE_LANG
    ? join(ROOT, "addons/SpokenBossesAudio/Sounds")
    : join(ROOT, "build/bosses", lang, "Sounds");
}

function unquote(text) {
  return text.replace(/\\(.)/g, "$1");
}

const STRING = String.raw`"((?:[^"\\]|\\.)*)"`;
const MAP_ROW = /^\t\t\[(\d+)\] = \{$/;
const ENTRY_ROW = new RegExp(String.raw`^\t\t\t\[${STRING}\] = \{ file = ${STRING}, len = ([^,}\s]+)`);

/** Sounds.lua's entries, as renderLookup writes them: { map, key, file (with /), len }. */
export function parseLookup(lua) {
  const entries = [];
  let map = null;
  for (const line of lua.split("\n")) {
    const m = MAP_ROW.exec(line);
    if (m) {
      map = Number(m[1]);
      continue;
    }
    const e = ENTRY_ROW.exec(line);
    if (e && map !== null) {
      entries.push({ map, key: unquote(e[1]), file: unquote(e[2]).replace(/\\/g, "/"), len: Number(e[3]) });
    }
  }
  return entries;
}

/**
 * @param lookup  parseLookup's entries
 * @param onDisk  the mp3s in Sounds/, as paths without the extension
 * @param takes   the live takes: { lineId, file, durationSec, spokenHash }
 * @param hashes  lineId -> the hash of the current story's spoken text
 */
export function checkPack({ lookup, onDisk, takes, hashes }) {
  const problems = [];
  const notes = [];
  const byLine = new Map(takes.map((t) => [t.lineId, t]));
  const listed = new Set();

  for (const entry of lookup) {
    const id = `boss:${entry.map}:${entry.key}`;
    listed.add(entry.file);
    if (!onDisk.has(entry.file)) problems.push(`${id}: the lookup names ${entry.file}.mp3, which is not on disk`);
    if (!Number.isFinite(entry.len) || entry.len <= 0) problems.push(`${id}: no len in the lookup`);

    const take = byLine.get(id);
    if (!take) {
      problems.push(`${id}: in the lookup, but no live take`);
      continue;
    }
    if (take.file !== entry.file) problems.push(`${id}: the lookup names ${entry.file}, its take ${take.file}`);
    const duration = Number(take.durationSec);
    if (Number.isFinite(entry.len) && Math.abs(entry.len - duration) > TOLERANCE + 1e-9) {
      problems.push(`${id}: len ${entry.len} in the lookup, ${duration} on the take`);
    }
    const hash = hashes.get(id) ?? null;
    if (take.spokenHash !== hash) notes.push(`${id}: stale, the take was cut from other text than the current story`);
  }

  for (const file of [...onDisk].sort()) {
    if (!listed.has(file)) problems.push(`${file}.mp3 is on disk, but the lookup does not list it`);
  }
  return { problems, notes };
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
  const at = process.argv.indexOf("--lang");
  const lang = at > 0 ? process.argv[at + 1] : BASE_LANG;
  requireDatabase("bosses-validate-audio");

  const path = lookupPath(lang);
  if (!existsSync(path)) throw new Error(`no ${path}: make bosses-lookup${lang === BASE_LANG ? "" : ` LOCALE=${lang}`}`);
  const [lua, onDisk, takes, bosses, stories, rules] = await Promise.all([
    readFile(path, "utf8"),
    mp3sOnDisk(soundsDir(lang)),
    readLiveTakes(lang),
    readBosses({ includeRetired: true }),
    readStories(),
    // As the site's catalogue hashes it: the committed rules are English's.
    lang === BASE_LANG ? loadPronunciation() : Promise.resolve({}),
  ]);

  const hashes = new Map();
  for (const boss of bosses) {
    const text = stories.get(boss.id)?.get(lang)?.text;
    if (text && text.trim() !== "") hashes.set(`boss:${boss.map}:${boss.key}`, textHash(toSpokenText(text, rules)));
  }

  const lookup = parseLookup(lua);
  const { problems, notes } = checkPack({ lookup, onDisk: new Set(onDisk), takes, hashes });
  console.log(`${lang}: ${lookup.length} lookup entries, ${onDisk.length} mp3s`);
  for (const note of notes) console.log(`  note: ${note}`);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(`FAILED: ${problems.length} problem(s)`);
    process.exitCode = 1;
    return;
  }
  console.log("OK");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  loadEnvFile()
    .then(main)
    .catch((err) => {
      console.error(`error: ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => close());
}
