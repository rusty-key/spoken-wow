// The game's own NPC voice clips (greeting, farewell, pissed) as file ids, per NPCSounds row, from
// Forever's tables. A pack that voices these moments mutes the game's files from this list, so a
// file left off it plays the game's voice beside ours.
//
// A shopkeeper's row has its own greeting kit, the plain greetings plus the shop lines, so a set
// here is a row, not a voice.
//
//   node pipelines/lib/npc-sounds.mjs          (make npc-sounds)
//   node pipelines/lib/npc-sounds.mjs --check  fails if the client's tables would change the file

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { FOREVER_BUILD, wagoTable } from "./wago.mjs";

const OUT = fileURLToPath(new URL("../quests/voice/npc-sounds.json", import.meta.url));
const DISPLAY_VOICES = fileURLToPath(new URL("../../apps/web/src/lib/npc/display-voices.json", import.meta.url));

// NPCSounds' columns in the client's order. The fourth, acknowledge, is empty in every row.
const KINDS = { greeting: "SoundID_0", farewell: "SoundID_1", pissed: "SoundID_2" };

/** { [npcSoundsId]: { voice, greeting, farewell, pissed } }, each kind's file ids sorted. */
export function buildNpcSounds({ npcSounds, kitEntries, voices }) {
  const filesOf = new Map();
  for (const entry of kitEntries) {
    const kit = entry.SoundKitID;
    if (!filesOf.has(kit)) filesOf.set(kit, new Set());
    filesOf.get(kit).add(Number(entry.FileDataID));
  }
  const files = (kit) => [...(filesOf.get(kit) ?? [])].sort((a, b) => a - b);

  const sets = {};
  for (const row of npcSounds) {
    const kinds = Object.fromEntries(Object.entries(KINDS).map(([kind, column]) => [kind, files(row[column])]));
    if (Object.values(kinds).every((list) => !list.length)) continue;
    sets[row.ID] = { voice: voices[row.ID] ?? null, ...kinds };
  }
  return sets;
}

export function voicesBySet(displayVoices) {
  const voices = {};
  for (const [, npcSoundsId, voice] of Object.values(displayVoices)) {
    if (npcSoundsId && voice) voices[npcSoundsId] = voice;
  }
  return voices;
}

/** The file as written: one set per line, so a client update shows as a readable diff. */
export function render(sets) {
  const lines = Object.entries(sets).map(([id, set]) => `    ${JSON.stringify(id)}: ${JSON.stringify(set)}`);
  return `{\n  "build": ${JSON.stringify(FOREVER_BUILD)},\n  "sets": {\n${lines.join(",\n")}\n  }\n}\n`;
}

async function main() {
  const check = process.argv.includes("--check");
  const [npcSounds, kitEntries, displayVoices] = await Promise.all([
    wagoTable("NPCSounds"),
    wagoTable("SoundKitEntry"),
    readFile(DISPLAY_VOICES, "utf8").then(JSON.parse),
  ]);
  const sets = buildNpcSounds({ npcSounds, kitEntries, voices: voicesBySet(displayVoices) });
  const text = render(sets);
  const current = await readFile(OUT, "utf8").catch(() => "");
  if (check) {
    if (current !== text) {
      console.error(`${OUT} is out of date with Forever ${FOREVER_BUILD}: run make npc-sounds`);
      process.exit(1);
    }
    return;
  }
  await writeFile(OUT, text);
  const all = new Set(Object.values(sets).flatMap((s) => [...s.greeting, ...s.farewell, ...s.pissed]));
  const named = Object.values(sets).filter((s) => s.voice).length;
  console.log(`${Object.keys(sets).length} sets (${named} with a voice), ${all.size} files -> ${OUT}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
