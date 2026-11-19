#!/usr/bin/env node
// Assemble a section's Sounds folder from the database: every live take, copied out of the
// archive under the path the addon plays it from.
//
//   node scripts/audio/sounds.mjs <quests|places|readables|bosses>        (LOCAL_DB names the database)
//   node scripts/audio/sounds.mjs --list <quests|places|readables|bosses> the archive files it would copy
//   node scripts/audio/sounds.mjs --lang=esMX places            another language's pack
//
// A language other than English is assembled into `build/<section>/<lang>/`, never into
// English's folder; its takes are archived under `<archive>/<lang>/` (`historyDirOf` in
// `apps/web/src/lib/takes/adapters.ts`).
//
// THE ARCHIVE IS THE ONLY AUDIO THERE IS. Every take is one file there, written once by the
// site and never changed; which take is live is a flag on its row. So the folder a pack is
// built from is not kept anywhere -- it is made here, from the live rows and the archive,
// right before packaging, and thrown away and made again the next time.
//
// Needs the section's live takes on this machine (make <section>-pull-live) and a database
// that matches production (make <section>-sync). A live take whose file is not here is a
// pack that would ship silence for that line, so it stops rather than build one.
//
// The folder is only ever emptied if this script made it -- it leaves a marker -- so a
// folder holding audio from before the archive was the record is refused, not deleted.
//
// Copies are clones where the filesystem has them (APFS, btrfs, XFS): no extra space and
// next to no time, and unlike a hard link, a tool that later writes into Sounds/ cannot
// reach the archive. The database is asked through psql, as scripts/db/ does, so this needs
// no node_modules.
//
// SPOKEN_CLIP_POINTERS=1 writes pointers instead (scripts/lib/clip-pointer.mjs), for a Manager
// pack built without its clips on this machine. A quests pointer names the take's encoding, the Ogg
// its pack ships, and durations.json carries what the build would otherwise read from the clips.
import { execFileSync } from "node:child_process";
import { constants, existsSync, readdirSync } from "node:fs";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readLines, shipped } from "../../pipelines/places/tools/lib/loredata.mjs";
import { assignFiles } from "../../pipelines/places/tools/voice/naming.mjs";
import { packTimes } from "../../pipelines/lib/word-times.mjs";
import { archiveOf, ENCODING_PROFILE, sourceOf } from "../lib/archives.mjs";
import { pointerText, writePointers } from "../lib/clip-pointer.mjs";
import { archiveBase, eachParallel, fetchRetrying } from "../lib/download.mjs";
import { releaseTeamSql } from "../../pipelines/lib/release-team.mjs";
import { CURRENT_TEXT_SQL, NAMED_QUESTS_SQL, currentTextFor, namedBy } from "./relevant.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const BASE_LANG = "enUS";

const SECTIONS = {
  quests: { archive: archiveOf("quests"), out: join(ROOT, "pipelines/quests/audio") },
  places: { archive: archiveOf("places"), out: join(ROOT, "addons/SpokenPlacesAudio/Sounds") },
  readables: { archive: archiveOf("readables"), out: join(ROOT, "addons/SpokenReadablesAudio/Sounds") },
  bosses: { archive: archiveOf("bosses"), out: join(ROOT, "addons/SpokenBossesAudio/Sounds") },
};

// --list prints, relative to the archive, every file this would copy, and copies nothing.
// scripts/audio/pull-live.sh hands it to rsync, so a pull fetches exactly what a build reads,
// decided by the same query.
const args = process.argv.slice(2);
const list = args.includes("--list");
const section = args.find((arg) => !arg.startsWith("--"));
const lang = args.find((arg) => arg.startsWith("--lang="))?.slice("--lang=".length) || BASE_LANG;
const english = SECTIONS[section];
if (!english || !/^[a-z]{2}[A-Z]{2}$/.test(lang)) {
  console.error("usage: sounds.mjs [--list] [--lang=<code>] <quests|places|readables|bosses>");
  process.exit(1);
}
// Another language never writes where English's pack is assembled: its folder is a work area
// under build/, which the section's packaging stages its pack from. The archive root stays the
// section's -- a language's takes are its <lang>/ directory -- and --list prints paths relative
// to the root, which is what pull-live.sh hands to rsync.
const paths = lang === BASE_LANG
  ? english
  : {
      archive: english.archive,
      out: join(ROOT, "build", section, lang, section === "quests" ? "audio" : "Sounds"),
    };
const prefix = lang === BASE_LANG ? "" : lang;
const database = process.env.LOCAL_DB;
if (!database) {
  console.error("LOCAL_DB is not set");
  process.exit(1);
}

function psql(sql) {
  return execFileSync(
    "psql",
    [database, "-tA", "-F", "\t", "-v", `source=${section}`, "-v", `lang=${lang}`, "-v", `profile=${ENCODING_PROFILE}`, "-f", "-"],
    { input: sql, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\n")
    .filter(Boolean);
}

// Whether a team's own bucket holds the clip (docs/platform/STORAGE.md): a database from before
// migration 0114 has no such table, and every clip is in ours.
const teamBuckets = psql(`select to_regclass('archive_object') is not null`)[0] === "t";
const inTeamBucket = (prefix, sha) =>
  // Landed copies only: a waiting one is read from our quarantine, so its 404 is a loss, not a deletion.
  teamBuckets ? `exists (select 1 from "archive_object" a where a."prefix" = '${prefix}' and a."sha256" = ${sha} and not a."pending")::text` : `'false'`;

// A quests file carries its extension and the other two do not; the archive directory is the file
// without it either way. Only quests takes have an Ogg.
const listing = psql(`select t."file", coalesce(t."archiveFile", ''),
                             coalesce(array_to_json(t."wordTimes")::text, ''), coalesce(t."sha256", ''),
                             coalesce(e."encodedSha256", ''), coalesce(e."bytes"::text, ''), coalesce(e."durationSec"::text, ''),
                             coalesce(to_json(t."shownText")::text, ''),
                             ${inTeamBucket("takes", `t."sha256"`)}, ${inTeamBucket("encodings", `e."encodedSha256"`)}
                        from "take" t
                        left join "take_encoding" e
                          on e."source" = t."source" and e."sha256" = t."sha256" and e."profile" = :'profile'
                       where t."source" = :'source' and t."lang" = :'lang' and t."isCurrent"
                         -- the release's team, else the privileged team, so a build outside a release reads what it always did
                         and t."teamId" = ${releaseTeamSql(`:'lang'`)}
                       order by t."file"`);

// A live take's archive path: its bucket object, or the take's own directory (its file without
// the extension) holding the archive file. Blank when the take's clip was never kept.
const takes = listing.map((row) => {
  const [file, name, times, sha256, encodedSha256, bytes, durationSec, shownText, teamTake, teamEncoding] = row.split("\t");
  const stem = file.replace(/\.mp3$/, "");
  return {
    file, stem, sha256, archived: sourceOf("takes", sha256, name ? join(prefix, stem, name) : ""), times,
    encodedSha256, bytes, durationSec, shownText: shownText ? JSON.parse(shownText) : null,
    teamTake: teamTake === "true", teamEncoding: teamEncoding === "true",
  };
});

// Quests carry only the audio a current line names (relevant.mjs), and places only the areas the
// committed lore has words for: a take stays live after its place leaves the lore, and the lookup
// (build-lookup.mjs) does not list it.
async function placesShipped() {
  const entries = await readLines();
  const lore = shipped(entries);
  const files = new Set([...assignFiles(entries)].filter(([id]) => lore.has(id)).map(([, file]) => file));
  return (stem) => files.has(stem);
}
// Bosses carry the live bosses' takes only, the ones bosses/build-lookup.mjs lists: a retired
// boss keeps its take, and shipping it would be a clip no entry points at.
function bossesShipped() {
  const files = new Set(psql(`select t."file" from "take" t
                                join "boss" b on t."lineId" = 'boss:' || b."map" || ':' || b."key"
                               where t."source" = :'source' and t."lang" = :'lang' and t."isCurrent"
                                 -- the release's team, else the privileged team, so a build outside a release reads what it always did
                                 and t."teamId" = ${releaseTeamSql(`:'lang'`)}
                                 and not b."retired"`));
  return (stem) => files.has(stem);
}
const relevant =
  section === "quests" ? namedBy(psql(NAMED_QUESTS_SQL))
    : section === "places" ? await placesShipped()
    : section === "bosses" ? bossesShipped()
    : () => true;
const live = takes.filter((take) => relevant(take.stem));
const unnamed = takes.length - live.length;

if (list) {
  for (const take of live) if (take.archived) console.log(take.archived);
  process.exit(0);
}

const marker = join(paths.out, ".from-takes");
if (existsSync(paths.out) && !existsSync(marker) && readdirSync(paths.out).length > 0) {
  console.error(`refusing: ${paths.out} holds audio this script did not put there.`);
  console.error("It is from before the archive was the record. Move it aside, then run this again:");
  console.error(`  mv '${paths.out}' '${paths.out}.before-archive'`);
  process.exit(1);
}

await rm(paths.out, { recursive: true, force: true });
await mkdir(paths.out, { recursive: true });
await writeFile(marker, "");

// The quests build reads no database (tts_cli/build.py), so the takes' word times go beside
// their clips; places and readables read them from the take table when they write their lookup.
async function writeWordTimes() {
  const times = Object.fromEntries(
    live.filter((take) => take.times).map((take) => [take.stem, packTimes(JSON.parse(take.times))]),
  );
  await writeFile(join(paths.out, "word-times.json"), `${JSON.stringify(times)}\n`);
}

async function writeTakeText() {
  const rows = psql(CURRENT_TEXT_SQL).map((row) => {
    const [stem, text, playerGender] = row.split("\t");
    return { stem, text: JSON.parse(text), playerGender };
  });
  const textOf = currentTextFor(rows, lang);
  const texts = {};
  for (const take of live) {
    const text = take.shownText ?? textOf(take.stem);
    if (text) texts[take.stem] = text;
  }
  await writeFile(join(paths.out, "take-text.json"), `${JSON.stringify(texts)}\n`);
}

/** Writes the quests pointers and returns how many live takes were left out. */
async function writeEncodingPointers(pointed) {
  // Encoding one here instead would make players download it again: oggenc's bytes differ every run.
  const lacking = pointed.filter((take) => !take.encodedSha256 || !take.durationSec);
  if (lacking.length) {
    console.error(`error: ${lacking.length} live takes have no Ogg in take_encoding or no duration on it, e.g. ${lacking[0].file}`);
    for (const { file, sha256 } of lacking.slice(0, 10)) console.error(`  ${file} (${sha256})`);
    process.exit(1);
  }
  // A team may delete from its own bucket, and its line then ships unvoiced rather than stopping
  // the release. Only those are looked for: an Ogg in ours is there.
  const gone = new Set();
  const unreachable = [];
  await eachParallel(pointed.filter((take) => take.teamEncoding), async ({ file, encodedSha256 }) => {
    const res = await fetchRetrying(`${archiveBase(process.env.SPOKEN_ARCHIVE_URL)}encodings/${encodedSha256}`, (u) => fetch(u, { method: "HEAD" }));
    // Only a 404 is a deletion. Anything else (a wrong archive address, the site down) stops the
    // build, rather than shipping every team-kept line silent.
    if (res.status === 404) gone.add(file);
    else if (!res.ok) unreachable.push(`${file}: HTTP ${res.status}`);
  });
  if (unreachable.length) {
    console.error(`error: ${unreachable.length} team-kept Oggs could not be checked, e.g.:`);
    for (const line of unreachable.slice(0, 5)) console.error(`  ${line}`);
    process.exit(1);
  }
  if (gone.size) console.warn(`  ${gone.size} live takes left out: their team deleted the Ogg from its bucket, e.g. ${[...gone][0]}`);
  let done = 0;
  await eachParallel(pointed.filter((take) => !gone.has(take.file)), async ({ stem, encodedSha256, bytes }) => {
    await writeFile(join(paths.out, `${stem}.ogg`), pointerText(encodedSha256, bytes, "encodings"));
    if (++done % 5000 === 0) console.log(`  ${done}/${pointed.length - gone.size} pointers`);
  });
  const durations = Object.fromEntries(pointed.filter((take) => !gone.has(take.file)).map(({ stem, durationSec }) => [stem, Number(durationSec)]));
  await writeFile(join(paths.out, "durations.json"), `${JSON.stringify(durations)}\n`);
  return gone.size;
}

if (process.env.SPOKEN_CLIP_POINTERS) {
  if (!process.env.SPOKEN_ARCHIVE_URL) {
    console.error("SPOKEN_CLIP_POINTERS needs SPOKEN_ARCHIVE_URL");
    process.exit(1);
  }
  const unhashed = live.filter((take) => take.archived && !take.sha256);
  if (unhashed.length) {
    console.error(`${unhashed.length} live takes are only on the droplet's volume, e.g. ${unhashed[0].file}: build with their clips instead`);
    process.exit(1);
  }
  const pointed = live.filter((take) => take.sha256);
  await Promise.all([...new Set(pointed.map(({ stem }) => dirname(join(paths.out, stem))))].map((dir) => mkdir(dir, { recursive: true })));
  let absent = [];
  let leftOut = 0;
  if (section === "quests") {
    leftOut = await writeEncodingPointers(pointed);
    await writeWordTimes();
    await writeTakeText();
  } else absent = await writePointers(pointed.map(({ stem, sha256 }) => ({ sha256, target: join(paths.out, `${stem}.mp3`) })), process.env.SPOKEN_ARCHIVE_URL);
  console.log(`${section}: ${pointed.length - absent.length - leftOut} pointers in ${paths.out.slice(ROOT.length + 1)}`);
  if (unnamed) console.log(`  ${unnamed} live takes left out: no current line names their file, no lore their place, or their boss is retired`);
  if (live.length > pointed.length) console.log(`  ${live.length - pointed.length} live takes had their clip discarded before the archive kept every take; shipped silent`);
  // Every Places, Readables and Bosses clip is named by its lookup, which a missing file fails, so a
  // clip its team deleted stops the build too, named as such: the team voices the line again.
  // Only quests leave such a line out (writeEncodingPointers).
  if (absent.length) {
    const teamTargets = new Set(pointed.filter((take) => take.teamTake).map(({ stem }) => join(paths.out, `${stem}.mp3`)));
    const deleted = absent.filter(({ target, reason }) => teamTargets.has(target) && reason === "HTTP 404");
    if (deleted.length) console.error(`  ${deleted.length} live takes were deleted from their team's bucket: regenerate them, e.g. ${deleted[0].target}`);
    console.error(`  ${absent.length} live takes are not in the archive, e.g.:`);
    for (const { target, reason } of absent.slice(0, 5)) console.error(`    ${target}: ${reason}`);
    process.exit(1);
  }
  process.exit(0);
}

let copied = 0;
const gone = [];
const missing = [];
const made = new Set();
for (const { file, stem, archived } of live) {
  if (!archived) {
    gone.push(file);
    continue;
  }
  const source = join(paths.archive, archived);
  const target = join(paths.out, `${stem}.mp3`);
  const dir = dirname(target);
  if (!made.has(dir)) {
    await mkdir(dir, { recursive: true });
    made.add(dir);
  }
  try {
    await copyFile(source, target, constants.COPYFILE_FICLONE);
    copied++;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    missing.push(source);
  }
}

if (section === "quests") {
  await writeWordTimes();
  await writeTakeText();
}

console.log(`${section}: ${copied} clips in ${paths.out.slice(ROOT.length + 1)}`);
if (unnamed) console.log(`  ${unnamed} live takes left out: no current line names their file, no lore their place, or their boss is retired`);
if (gone.length) {
  // Known, and not this machine's fault: the take's clip was not kept before the archive
  // was the record. The line ships without audio, the same as one never generated.
  console.log(`  ${gone.length} live takes had their clip discarded before the archive kept every take; shipped silent`);
}
if (missing.length) {
  console.error(`  ${missing.length} live takes are not in this machine's archive, e.g.:`);
  for (const path of missing.slice(0, 5)) console.error(`    ${path}`);
  console.error(`  Fetch them with:  make ${section}-pull-live${lang === BASE_LANG ? "" : ` LOCALE=${lang}`}`);
  process.exit(1);
}
