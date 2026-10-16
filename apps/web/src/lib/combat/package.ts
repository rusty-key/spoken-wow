import "server-only";

import { readFile } from "node:fs/promises";
import { BASE_LANG } from "@/lib/lang";
import { takePath } from "@/lib/takes/store";
import { COMBAT_KEYS, COMBAT_VOICES } from "./catalogue";
import { combatRecordings } from "./recordings";
import { recordingsZip } from "./zip";
import { COMBAT_AUDIO_ADDON, combatAudioToc, combatAudioManifest } from "./audio-pack";

export async function combatPackage(): Promise<Buffer> {
  const recordings = await combatRecordings();
  const sets = COMBAT_VOICES.map((voice) => ({ voice: voice.id,
    lines: recordings.filter((line) => line.voice === voice.id),
  })).filter((set) => set.lines.length === COMBAT_KEYS.length && set.lines.every((line) => line.ready));
  if (!sets.length) throw new Error("At least one complete combat voice set needs current recordings of at most 6 seconds before downloading.");
  const lines = sets.flatMap((set) => set.lines);
  const files = await Promise.all(lines.map(async (line) => {
    // Resolve the selected version so a concurrent regeneration cannot change the download mid-build.
    const bytes = await takePath("quests", line.file, line.version!, BASE_LANG);
    if (bytes.kind !== "file") throw new Error(`Recording missing: ${line.key}`);
    return { name: `${COMBAT_AUDIO_ADDON}/Sounds/Combat/${line.voice}-${line.key}.mp3`, data: await readFile(bytes.path) };
  }));
  const manifest = combatAudioManifest(sets.map((set) => ({ voice: set.voice,
    clips: set.lines.map((line) => ({ key: line.key, duration: line.duration! })),
  })));
  files.push({ name: `${COMBAT_AUDIO_ADDON}/Data/Sounds.lua`, data: Buffer.from(manifest) });
  files.push({ name: `${COMBAT_AUDIO_ADDON}/${COMBAT_AUDIO_ADDON}.toc`, data: Buffer.from(combatAudioToc()) });
  return recordingsZip(files);
}
