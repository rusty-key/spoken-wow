import pack from "./audio-pack.json";

export const COMBAT_AUDIO_ADDON = pack.addon;
export const COMBAT_AUDIO_ZIP = `${pack.addon}-${pack.version}.zip`;

export function combatAudioToc(): string {
  return [
    `## Interface: ${pack.interface}`,
    `## Title: ${pack.title}`,
    "## Notes: Character combat reactions for Spoken. Requires the Spoken Combat module.",
    `## Version: ${pack.version}`,
    "## Author: rusty",
    "## IconTexture: Interface\\AddOns\\Spoken\\icon.tga",
    "## X-License: Addon code MIT. Audio supplied separately.",
    "", "Data/Sounds.lua", "",
  ].join("\n");
}

export function combatAudioManifest(sets: { voice: string; clips: { key: string; duration: number }[] }[]): string {
  return [
    "local addon = ...",
    "SpokenCombatAudioPacks = SpokenCombatAudioPacks or {}",
    ...sets.flatMap(({ voice, clips }) => [
      `SpokenCombatAudioPacks[addon .. ":${voice}"] = {`,
      `    version = 1, addon = addon, language = "enUS", voice = "${voice}",`,
      "    clips = {",
      ...clips.map((clip) => `        { key = "${clip.key}", length = ${clip.duration.toFixed(3)}, format = "mp3" },`),
      "    },", "}", "",
    ]),
  ].join("\n");
}
