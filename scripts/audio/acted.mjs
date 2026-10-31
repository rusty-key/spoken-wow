#!/usr/bin/env node
// Build a section's voice-acted overlay pack: every line a voice actor has recorded in one
// language, and nothing else.
//
//   node scripts/audio/acted.mjs [--lang=deDE] [--version=1.0.0] <quests|places|readables>
//   node scripts/audio/acted.mjs --list [--lang=deDE] <section>   the archive files it reads
//
// AN OVERLAY, NOT A PACK. It carries only the recorded lines, and the player prefers it where
// it has one and falls back to the generated pack for the rest:
//   quests     a data module at DataModule-Priority 200, over the generated packs' 100
//   places     an entry in SpokenPlacesAudioOverlays, which no release reads as a whole pack
//   readables  an entry in SpokenReadablesAudioOverlays, the same way
// So none of it is the TTS packs' machinery -- no corpus tables, no faction split, no tiers --
// and it is built here, in one place for all three, rather than as a flag through each.
//
// FROM THE `recording` TABLE (migration 0062): the live recording of a file is its newest one
// not removed. Needs the database synced (make <section>-sync) and the files on this machine
// (make <section>-pull-recorded), and stops rather than ship a line as silence when one is
// missing.
//
// THE AUDIO IS RE-ENCODED TO WHAT EACH PLAYER PLAYS. Uploads are kept as they came, mp3 or
// Ogg Vorbis. A quests module resolves every sound with one extension (GetSoundPath), and
// ships Ogg, so an mp3 is encoded with the generated packs' own recipe (ogg-q0-44k:
// ffmpeg decodes, oggenc -q 0) and an Ogg goes in as uploaded. Places and readables play
// `.mp3` by name, so there it is the other way round.
//
// Lengths are the database's -- ffprobe measured each upload when it was kept -- since a
// re-encode moves a clip's length by a frame at most.
//
// Credits: every actor whose recording is live, in the TOC (Author, X-Spoken-Actors) and in
// the overlay itself, where `/spz audio` lists them.
import { execFileSync, spawn } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { basename, dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BASE_LOCALE, CODES } from "../../pipelines/lib/locales.mjs";
import { luaString } from "../../pipelines/places/tools/lib/wiki.mjs";
import { archiveOf, sourceOf } from "../lib/archives.mjs";
import { actedFolder, audioFamily, languageFolder } from "../lib/packs.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** What each section's packs are called after the family: "Spoken German Audio: Places". */
const TITLES = { quests: "Quests", places: "Places", readables: "Readables" };
/** The addon that plays a section's packs, which X-Child-Of names for addon managers. */
const PLAYERS = { quests: "Spoken_Quests", places: "Spoken_Places", readables: "Spoken_Readables" };

//------------------------------------------------------------------------------
// Pure: names, paths and the Lua, so they can be tested without a database
//------------------------------------------------------------------------------

/**
 * Where a file's recordings are archived, relative to the section's archive root. The web
 * app's recordedDirOf (apps/web/src/lib/takes/adapters.ts): a quests file's directory is the
 * file without `.mp3`, a places or readables file's is the file.
 */
export function recordedDir(section, lang, file) {
  const relative = section === "quests" ? file.replace(/\.mp3$/, "") : file;
  return posix.join("recorded", lang, relative);
}

/** Where a clip sits inside the pack's folder, and with which extension. */
export function packPath(section, file) {
  if (section === "quests") return posix.join("generated", "sounds", file.replace(/\.mp3$/, ".ogg"));
  return posix.join("Sounds", `${file}.mp3`);
}

/** Everybody credited, once each, in the order they first recorded something here. */
export function creditsOf(clips) {
  const seen = [];
  for (const clip of [...clips].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (!seen.includes(clip.credit)) seen.push(clip.credit);
  }
  return seen;
}

function luaCredits(credits) {
  return `{ ${credits.map(luaString).join(", ")} }`;
}

/**
 * The places overlay's Data/Sounds.lua. Entries are shaped like a pack's
 * (pipelines/places/tools/voice/build-lookup.mjs) and keyed the same way, by the line id:
 * `z:<map>` for a zone, `s:<map>:<key>` for a subzone.
 */
export function placesLua(lang, clips, credits) {
  const zones = [];
  const subzones = new Map();
  for (const clip of clips) {
    const [kind, map, ...rest] = clip.lineId.split(":");
    const row = `{ file = ${luaString(clip.file.replace(/\//g, "\\"))}, len = ${clip.durationSec} }`;
    if (kind === "z") zones.push([Number(map), row]);
    else if (kind === "s") {
      if (!subzones.has(Number(map))) subzones.set(Number(map), []);
      subzones.get(Number(map)).push([rest.join(":"), row]);
    } else throw new Error(`not a places line id: ${clip.lineId}`);
  }
  const lines = [
    "-- AUTO-GENERATED by scripts/audio/acted.mjs. Do not edit by hand.",
    "--",
    "-- A voice-acted overlay: only the lines somebody recorded. Spoken Places plays these",
    "-- over the generated pack's and falls back to that pack for every other line.",
    "",
    "local ADDON_NAME = ...",
    "",
    "local overlay = {",
    "\tversion = 1,",
    `\tlanguage = ${luaString(lang)},`,
    `\tcredits = ${luaCredits(credits)},`,
    "\tzones = {",
  ];
  for (const [map, row] of zones.sort((a, b) => a[0] - b[0])) lines.push(`\t\t[${map}] = ${row},`);
  lines.push("\t},", "\tsubzones = {");
  for (const map of [...subzones.keys()].sort((a, b) => a - b)) {
    lines.push(`\t\t[${map}] = {`);
    for (const [key, row] of subzones.get(map).sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`\t\t\t[${luaString(key)}] = ${row},`);
    }
    lines.push("\t\t},");
  }
  lines.push(
    "\t},",
    "}",
    "",
    "overlay.addon = ADDON_NAME",
    "",
    "-- Its own registry, never SpokenPlacesAudioPacks: a release that reads only that one would",
    "-- take this for a whole pack and could choose it as the one to play from.",
    "SpokenPlacesAudioOverlays = SpokenPlacesAudioOverlays or {}",
    "SpokenPlacesAudioOverlays[ADDON_NAME] = overlay",
    "",
  );
  return lines.join("\n");
}

/** The readables overlay's Data/Sounds.lua, shaped like the pack's (pipelines/readables/tools/lib/lookup.mjs). */
export function readablesLua(lang, clips, credits) {
  const lines = [
    "-- AUTO-GENERATED by scripts/audio/acted.mjs. Do not edit by hand.",
    "--",
    "-- A voice-acted overlay: only the pages somebody recorded. Spoken Writings plays these",
    "-- over the generated pack's and falls back to that pack for every other page.",
    "",
    "local ADDON_NAME = ...",
    "",
    "local overlay = {",
    "\tversion = 1,",
    "\taddon = ADDON_NAME,",
    `\tlanguage = ${luaString(lang)},`,
    `\tcredits = ${luaCredits(credits)},`,
    "\tpages = {",
  ];
  for (const clip of [...clips].sort((a, b) => Number(a.file) - Number(b.file))) {
    lines.push(`\t\t[${Number(clip.file)}] = { file = ${luaString(clip.file)}, len = ${clip.durationSec} },`);
  }
  lines.push(
    "\t},",
    "}",
    "",
    "-- Its own registry, for the reason the places overlay gives.",
    "SpokenReadablesAudioOverlays = SpokenReadablesAudioOverlays or {}",
    "SpokenReadablesAudioOverlays[ADDON_NAME] = overlay",
    "",
  );
  return lines.join("\n");
}

const QUESTS_GUARD = "if not VoiceOver or not VoiceOver.DataModules then return end";

/**
 * The quests overlay's Lua: Module.lua, which says where a sound is, and the length table,
 * which is also how the player knows a module has a line at all (DataModules.lua tries each
 * module's SoundLengthLookupByFileName in priority order). None of the generated packs'
 * lookup tables: they map quest text to ids and hashes, are the same in every pack, and the
 * generated pack the player has installed already carries them.
 */
export function questsLua(module, clips, credits) {
  const moduleLua = [
    QUESTS_GUARD,
    "",
    `${module} = {}`,
    `${module}.Credits = ${luaCredits(credits)}`,
    "",
    // The path comes from the event, as the generated module's does (tts_cli/build.py).
    `function ${module}:GetSoundPath(fileName, event)`,
    "    setfenv(1, VoiceOver)",
    "    if Enums.SoundEvent:IsQuestEvent(event) then",
    "        return format([[generated\\sounds\\quests\\%s.ogg]], fileName)",
    "    elseif Enums.SoundEvent:IsGossipEvent(event) then",
    "        return format([[generated\\sounds\\gossip\\%s.ogg]], fileName)",
    "    elseif Enums.SoundEvent.QuestFollowup and event == Enums.SoundEvent.QuestFollowup then",
    "        return format([[generated\\sounds\\followup\\%s.ogg]], fileName)",
    "    end",
    "end",
    "",
    `VoiceOver.DataModules:Register("${module}", ${module})`,
    "",
  ].join("\n");

  const lengths = [QUESTS_GUARD, `${module}.SoundLengthLookupByFileName = {`];
  for (const clip of [...clips].sort((a, b) => a.file.localeCompare(b.file))) {
    lengths.push(`    [${luaString(basename(clip.file, ".mp3"))}] = ${clip.durationSec},`);
  }
  lengths.push("}", "");
  return { "Module.lua": moduleLua, "generated/sound_length_table.lua": lengths.join("\n") };
}

/** The `## Interface:` line the section's generated packs ship with, so both load on the same clients. */
function interfaceOf(section) {
  const source =
    section === "quests"
      ? join(ROOT, "pipelines/quests/tts_cli/build.py")
      : join(ROOT, "addons", languageFolder(section, "all"), `${languageFolder(section, "all")}.toc`);
  // Not anchored: in build.py the line opens a string literal, `TOC_HEADER = """## Interface: …`.
  const found = readFileSync(source, "utf8").match(/## Interface: (.+)$/m);
  if (!found) throw new Error(`no ## Interface line in ${source}`);
  return found[1].trim();
}

export function toc({ section, lang, version, credits, iface }) {
  const title = `${audioFamily(lang)}: ${TITLES[section]} - Voice Actors`;
  const lines = [
    `## Interface: ${iface}`,
    `## Title: ${title.replace(/^Spoken/, "|cffb48cffSpoken|r")}`,
    `## Notes: Lines read by voice actors, played instead of the generated narration where there is one. Voiced by ${credits.join(", ")}.`,
    `## Version: ${version}`,
    `## Author: ${["rusty", ...credits].join(", ")}`,
    `## X-Spoken-Actors: ${credits.join(", ")}`,
    "## Group: Spoken",
    "## X-Part-Of: Spoken",
    `## X-Child-Of: ${PLAYERS[section]}`,
  ];
  if (section === "quests") {
    // Both generations of each key, as the generated packs write them (tts_cli/build.py).
    lines.push(
      "## LoadOnDemand: 1",
      "## X-SpokenQuests-DataModule-Version: 1",
      // Over the generated packs' 100, which is what makes this the one asked first within a
      // language. Language still comes before priority: a German recording does not play
      // for somebody listening in English.
      "## X-SpokenQuests-DataModule-Priority: 200",
      "## X-VoiceOver-DataModule-Version: 1",
      "## X-VoiceOver-DataModule-Priority: 200",
    );
    // Only for a language, as the generated packs do: an absent key reads as enUS.
    if (lang !== BASE_LOCALE) lines.unshift(`## X-SpokenQuests-Language: ${lang}`);
    lines.push("", "Module.lua", "generated\\sound_length_table.lua", "");
  } else {
    lines.push("", "Data/Sounds.lua", "");
  }
  return lines.join("\n");
}

//------------------------------------------------------------------------------
// The build
//------------------------------------------------------------------------------

function live(section, lang) {
  const database = process.env.LOCAL_DB;
  if (!database) throw new Error("LOCAL_DB is not set");
  const out = execFileSync("psql", [database, "-tA", "-F", "\t", "-v", `source=${section}`, "-v", `lang=${lang}`, "-f", "-"], {
    input: `select distinct on (r."file") r."file", coalesce(r."archiveFile", ''), r."format", r."durationSec",
                   r."credit", r."createdAt", coalesce(r."lineId", ''), coalesce(r."sha256", '')
              from "recording" r
             where r."source" = :'source' and r."lang" = :'lang' and r."deletedAt" is null
               and r."teamId" = (select "teamId" from "team_language" where "lang" = :'lang' and "privileged")
             order by r."file", r."version" desc`,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split("\n")
    .filter(Boolean)
    .map((row) => {
      const [file, archiveFile, format, durationSec, credit, createdAt, lineId, sha256] = row.split("\t");
      const archived = sourceOf("recordings", sha256, archiveFile ? posix.join(recordedDir(section, lang, file), archiveFile) : "");
      return { file, archived, format, durationSec: Number(durationSec), credit, createdAt, lineId };
    });
}

/** A child process, resolving when it exits cleanly. */
function run(child, what) {
  return new Promise((done, fail) => {
    child.on("error", fail);
    child.on("close", (code) => (code === 0 ? done() : fail(new Error(`${what} exited ${code}`))));
  });
}

/**
 * One clip into the pack, with the generated packs' own recipes: places' VBR mono mp3
 * (scripts/places/package-audio.sh) and quests' ogg-q0-44k (scripts/quests/package-audio.sh),
 * so an overlay sits at the bitrate of the pack under it.
 */
async function encode(section, clip, from, to) {
  await mkdir(dirname(to), { recursive: true });
  const wanted = section === "quests" ? "ogg" : "mp3";
  if (clip.format === wanted) return copyFile(from, to);
  if (wanted === "mp3") {
    const ffmpeg = spawn("ffmpeg", ["-nostdin", "-loglevel", "error", "-i", from, "-codec:a", "libmp3lame", "-q:a", "6", "-ac", "1", "-y", to], { stdio: "inherit" });
    return run(ffmpeg, `ffmpeg on ${from}`);
  }
  const ffmpeg = spawn("ffmpeg", ["-nostdin", "-loglevel", "error", "-i", from, "-ac", "1", "-map_metadata", "-1", "-bitexact", "-f", "wav", "-"], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const oggenc = spawn("oggenc", ["-Q", "-q", "0", "-o", to, "-"], { stdio: ["pipe", "inherit", "inherit"] });
  // Piped here rather than handed over as oggenc's stdin: a stream given as another child's
  // stdio is not a handle Node waits on, and the build exited with every encode unfinished.
  ffmpeg.stdout.pipe(oggenc.stdin);
  await Promise.all([run(ffmpeg, `ffmpeg on ${from}`), run(oggenc, `oggenc for ${to}`)]);
}

/** Every clip encoded, as many at once as there are cores: each encoder is one thread. */
async function encodeAll(section, jobs) {
  const queue = [...jobs];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) await encode(section, ...job);
  };
  await Promise.all(Array.from({ length: availableParallelism() }, worker));
}

async function main(args) {
  const list = args.includes("--list");
  const section = args.find((arg) => !arg.startsWith("--"));
  const lang = args.find((arg) => arg.startsWith("--lang="))?.slice(7) || BASE_LOCALE;
  const version = args.find((arg) => arg.startsWith("--version="))?.slice(10) || "1.0.0";
  if (!TITLES[section] || !CODES.includes(lang) || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error("usage: acted.mjs [--list] [--lang=<code>] [--version=x.y.z] <quests|places|readables>");
  }

  const clips = live(section, lang);
  if (list) {
    for (const clip of clips) console.log(clip.archived);
    return;
  }
  if (clips.length === 0) throw new Error(`no live ${section} recordings in ${lang}; nothing to build`);

  const missing = clips
    .map((clip) => join(archiveOf(section), clip.archived))
    .filter((path) => !existsSync(path));
  if (missing.length) {
    console.error(`${missing.length} live recordings are not on this machine, e.g.:`);
    for (const path of missing.slice(0, 5)) console.error(`  ${path}`);
    console.error(`Fetch them with:  make ${section}-pull-recorded${lang === BASE_LOCALE ? "" : ` LOCALE=${lang}`}`);
    process.exit(1);
  }

  const folder = actedFolder(section, lang);
  const credits = creditsOf(clips);
  const staging = mkdtempSync(join(tmpdir(), "acted-"));
  const out = join(staging, folder);
  try {
    await encodeAll(
      section,
      clips.map((clip) => [
        clip,
        join(archiveOf(section), clip.archived),
        join(out, packPath(section, clip.file)),
      ]),
    );

    const files =
      section === "quests"
        ? questsLua(folder, clips, credits)
        : { "Data/Sounds.lua": (section === "places" ? placesLua : readablesLua)(lang, clips, credits) };
    files[`${folder}.toc`] = toc({
      section,
      lang,
      version,
      credits,
      iface: interfaceOf(section),
    });
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(out, name)), { recursive: true });
      writeFileSync(join(out, name), text);
    }

    const dist = join(ROOT, "dist");
    mkdirSync(dist, { recursive: true });
    const zip = join(dist, `${folder}-${version}.zip`);
    rmSync(zip, { force: true });
    execFileSync("zip", ["-r", "-q", "-X", zip, folder, "-x", "*.DS_Store"], { cwd: staging });
    console.log(`built ${zip.slice(ROOT.length + 1)}: ${clips.length} recordings by ${credits.join(", ")}`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`error: ${error.message}`);
    process.exit(1);
  });
}
