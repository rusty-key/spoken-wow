// A line kept as sentence pieces: a folder, <file>/01.ogg, 02.ogg ..., where its clip would be
// <file>.ogg, played back to back so a paused line resumes from its sentence
// (apps/web/src/lib/takes/pieces.ts cuts them, addons/Spoken/SoundQueue.lua plays them).
//
// scripts/audio/sounds.mjs writes the folders and, beside the pack rather than in it, the pieces'
// lengths. A lookup lists `pieces` for a line only where its folder is on disk, so a line the
// release shipped whole (no pieces, or a team-deleted piece) never names pieces it lacks.

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { packTimes } from "./word-times.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FIRST_PIECE = "01.ogg";

/** Where sounds.mjs leaves a pack's piece lengths, out of the pack so it never ships. */
export function piecesFile(section, lang) {
  return join(ROOT, "build", "pieces", `${section}-${lang}.json`);
}

/** Writes `{ file: [seconds, ...] }`, packed as word times are; with none, the file is removed. */
export async function writePieceLengths(section, lang, lengths) {
  const path = piecesFile(section, lang);
  if (Object.keys(lengths).length === 0) return rm(path, { force: true });
  await mkdir(dirname(path), { recursive: true });
  const packed = Object.fromEntries(Object.entries(lengths).map(([file, seconds]) => [file, packTimes(seconds)]));
  await writeFile(path, `${JSON.stringify(packed)}\n`);
}

/** `{ file: "3.44 2.6 5.1" }` for the lines a pack keeps as pieces; empty without the file. */
export function readPieceLengths(section, lang) {
  const path = piecesFile(section, lang);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}

/** Whether `file` (its path under Sounds/, no extension) is on disk as a folder of pieces. */
export function onDiskAsPieces(soundsDir, file) {
  return existsSync(join(soundsDir, file, FIRST_PIECE));
}

/** Whether `file` is on disk, as one clip or as a folder of pieces. */
export function clipOnDisk(soundsDir, file) {
  return existsSync(join(soundsDir, `${file}.ogg`)) || onDiskAsPieces(soundsDir, file);
}

/** Every clip under `dir` by its path without `.ogg`, a folder of pieces as the one clip it plays. */
export async function clipsOnDisk(dir, prefix = "") {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) {
      if (existsSync(join(dir, item.name, FIRST_PIECE))) found.push(rel);
      else found.push(...(await clipsOnDisk(join(dir, item.name), rel)));
    } else if (item.name.endsWith(".ogg")) found.push(rel.replace(/\.ogg$/, ""));
  }
  return found;
}
