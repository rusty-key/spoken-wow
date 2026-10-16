import data from "./lines.json";

export const COMBAT_VOICES = data.voices;
export const COMBAT_KEYS = data.keys;
export const COMBAT_LINES = COMBAT_VOICES.flatMap((voice) => voice.lines.map((line) => ({
  ...line, voice: voice.id,
  id: `c:${voice.id}:${line.key}`,
  file: `combat/${voice.id}-${line.key}.mp3`,
})));

export function combatLine(id: string) {
  return COMBAT_LINES.find((line) => line.id === id);
}

export function isCombatFile(file: string): boolean {
  return COMBAT_LINES.some((line) => line.file === file);
}
