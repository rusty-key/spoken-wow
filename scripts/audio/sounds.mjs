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
// Quests clips are cloned where the filesystem can (APFS, btrfs, XFS): no extra space, and a tool
// that later writes into the folder cannot reach the archive the way it could through a hard link.
// scripts/quests/package-audio.sh encodes them. Places, Readables and Bosses ship their folder as
// it is, so their clips are encoded here into the pack's Ogg, through a cache keyed by each
// master's hash. The database is asked through psql, as scripts/db/ does, so this needs no
// node_modules.
//
// SPOKEN_CLIP_POINTERS=1 writes pointers instead (scripts/lib/clip-pointer.mjs), for a Manager
// pack built without its clips on this machine. A pointer names the take's encoding, the Ogg its
// pack ships. For quests, durations.json carries what the build would otherwise read from the clips.
//
// SPOKEN_PIECES=1, with SPOKEN_CLIP_POINTERS, ships a take cut into sentence pieces (take_pieces,
// apps/web/src/lib/takes/pieces.ts) as a folder of pointers, <stem>/01.ogg, 02.ogg ..., so a paused
// line resumes from its sentence. Their lengths go in the quests store's pieces.json, and for the
// other sections beside the pack (pipelines/lib/pieces.mjs), where its lookup reads them. Off by default: the
// line's file becomes a folder, which every player downloads again and only a Spoken that plays
// pieces finds, so turning it on is a release decision (raise the section's MIN_SPOKEN with it).
//
// SPOKEN_SELECTED_TAKES=<file> writes there, once the folder is made, the takes it holds, as
// { <take file>: { version, sha256 } }: what a staged release built from, which its review plays
// (scripts/manager/release.mjs --stage).
import { execFileSync } from "node:child_process";
import { constants, existsSync, readdirSync } from "node:fs";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readLines, shipped } from "../../pipelines/places/tools/lib/loredata.mjs";
import { assignFiles } from "../../pipelines/places/tools/voice/naming.mjs";
import { writePieceLengths } from "../../pipelines/lib/pieces.mjs";
import { packTimes } from "../../pipelines/lib/word-times.mjs";
import { archiveOf, encodesOf, ENCODING_PROFILE, sourceOf } from "../lib/archives.mjs";
import { pointerText } from "../lib/clip-pointer.mjs";
import { archiveBase, eachParallel, fetchRetrying } from "../lib/download.mjs";
import { cachedOgg, haveEncoders } from "../lib/ogg.mjs";
import { releaseTeamSql } from "../../pipelines/lib/release-team.mjs";
import { PLAYER_WORDS_SQL, registerPlayerWordRows, writtenPlayerTokens } from "../../pipelines/lib/player-words.mjs";
import { CURRENT_TEXT_SQL, NAMED_QUESTS_SQL, currentLines, currentTextFor, namedBy } from "./relevant.mjs";

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

// Sentence pieces, where asked for: only pointers carry them.
const pieces = process.env.SPOKEN_PIECES === "1" && Boolean(process.env.SPOKEN_CLIP_POINTERS);
// The last run's lengths would otherwise reach a lookup that finds the same folders.
if (section !== "quests" && !list) await writePieceLengths(section, lang, {});
if (pieces && psql(`select to_regclass('take_pieces') is not null`)[0] !== "t") {
  console.error("SPOKEN_PIECES needs take_pieces (migration 0133): this database has none");
  process.exit(1);
}
const piecesColumns = pieces
  ? `coalesce(array_to_json(p."encodedSha256s")::text, ''), coalesce(array_to_json(p."bytes")::text, ''),
     coalesce(array_to_json(p."lengthsSec")::text, '')`
  : `'', '', ''`;
const piecesJoin = pieces
  ? `left join "take_pieces" p on p."source" = t."source" and p."sha256" = t."sha256" and p."profile" = :'profile'`
  : "";

// A quests file carries its extension and the other two do not; the archive directory is the file
// without it either way.
const listing = psql(`select t."file", coalesce(t."archiveFile", ''),
                             coalesce(array_to_json(t."wordTimes")::text, ''), coalesce(t."sha256", ''),
                             coalesce(e."encodedSha256", ''), coalesce(e."bytes"::text, ''), coalesce(e."durationSec"::text, ''),
                             coalesce(to_json(t."shownText")::text, ''),
                             ${inTeamBucket("takes", `t."sha256"`)}, ${inTeamBucket("encodings", `e."encodedSha256"`)},
                             t."version", ${piecesColumns}
                        from "take" t
                        left join "take_encoding" e
                          on e."source" = t."source" and e."sha256" = t."sha256" and e."profile" = :'profile'
                        ${piecesJoin}
                       where t."source" = :'source' and t."lang" = :'lang' and t."isCurrent"
                         -- the release's team, else the one with plain packs, so a build outside a release reads what it always did
                         and t."teamId" = ${releaseTeamSql(`:'lang'`)}
                       order by t."file"`);

// A live take's archive path: its bucket object, or the take's own directory (its file without
// the extension) holding the archive file. Blank when the take's clip was never kept.
const takes = listing.map((row) => {
  const [file, name, times, sha256, encodedSha256, bytes, durationSec, shownText, teamTake, teamEncoding, version,
    pieceShas, pieceBytes, pieceLengths] = row.split("\t");
  const stem = file.replace(/\.mp3$/, "");
  // Two or more: a take recorded "whole" has none, and ships as one file.
  const split = pieceShas ? JSON.parse(pieceShas) : [];
  return {
    file, stem, sha256, archived: sourceOf("takes", sha256, name ? join(prefix, stem, name) : ""), times,
    encodedSha256, bytes, durationSec, shownText: shownText ? JSON.parse(shownText) : null,
    teamTake: teamTake === "true", teamEncoding: teamEncoding === "true", version: Number(version),
    pieces: split.length >= 2
      ? split.map((sha, i) => ({ sha, bytes: JSON.parse(pieceBytes)[i], length: Number(JSON.parse(pieceLengths)[i]) }))
      : null,
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
                                 -- the release's team, else the one with plain packs, so a build outside a release reads what it always did
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

// Whether an archive address is a site's archive route rather than a bucket's own address.
function throughSite(url) {
  try {
    return /\/api\/archive\/?$/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}
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
  // A team's language keeps its words in the database, and the site spoke the take's text with them.
  registerPlayerWordRows(psql(PLAYER_WORDS_SQL).map((row) => row.split("\t")));
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
  await writeLineText(rows);
  await writeQuestTitles();
}

// Every current line's words, recorded or not, so a quest page shows a line in the pack's language
// before anyone voiced it. Its tokens are left for the addon to fill, in the forms it fills. English
// ships its words in the addon itself.
async function writeLineText(rows) {
  if (lang === BASE_LANG) return;
  const texts = {};
  for (const [stem, { text }] of currentLines(rows)) if (text) texts[stem] = writtenPlayerTokens(text);
  await writeFile(join(paths.out, "line-text.json"), `${JSON.stringify(texts)}\n`);
}

// The quests' titles in the language, for the Compendium: a client knows only the titles of quests
// it has shown, and only in its own language.
async function writeQuestTitles() {
  if (lang === BASE_LANG) return;
  const titles = Object.fromEntries(
    psql(`select "entityId", to_json("name")::text from "entity_name"
           where "kind" = 'quest' and "lang" = :'lang' and "isCurrent" and "name" <> ''
           order by "entityId"`).map((row) => {
      const [id, name] = row.split("\t");
      return [id, JSON.parse(name)];
    }),
  );
  await writeFile(join(paths.out, "quest-titles.json"), `${JSON.stringify(titles)}\n`);
}

/** The takes the folder holds, for a staged release's review; nothing without SPOKEN_SELECTED_TAKES. */
async function writeSelection(held) {
  const file = process.env.SPOKEN_SELECTED_TAKES;
  if (!file) return;
  const selected = Object.fromEntries(held.map((take) => [take.file, { version: take.version, sha256: take.sha256 || null }]));
  await writeFile(file, `${JSON.stringify(selected)}\n`);
}

/** Every directory the takes' clips go in, made once each. */
function makeDirs(takes) {
  return Promise.all([...new Set(takes.map(({ stem }) => dirname(join(paths.out, stem))))].map((dir) => mkdir(dir, { recursive: true })));
}

/** Writes the pointers and returns the live takes left out, by file. */
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
  // Every Places, Readables and Bosses clip is named by its lookup, which a missing file fails, so
  // a clip its team deleted stops the build, named as such: the team voices the line again.
  if (gone.size && section !== "quests") {
    console.error(`error: ${gone.size} live takes were deleted from their team's bucket: regenerate them, e.g. ${[...gone][0]}`);
    process.exit(1);
  }
  if (gone.size) console.warn(`  ${gone.size} live takes left out: their team deleted the Ogg from its bucket, e.g. ${[...gone][0]}`);
  // A team-kept piece its team deleted ships its line whole, as it was before it was cut.
  const whole = new Set();
  await eachParallel(pointed.filter((take) => take.pieces && take.teamEncoding && !gone.has(take.file)), async (take) => {
    for (const { sha } of take.pieces) {
      const res = await fetchRetrying(`${archiveBase(process.env.SPOKEN_ARCHIVE_URL)}encodings/${sha}`, (u) => fetch(u, { method: "HEAD" }));
      if (res.status === 404) return void whole.add(take.file);
      if (!res.ok) unreachable.push(`${take.file}: HTTP ${res.status}`);
    }
  });
  if (unreachable.length) {
    console.error(`error: ${unreachable.length} team-kept pieces could not be checked, e.g. ${unreachable[0]}`);
    process.exit(1);
  }
  const shipped = pointed.filter((take) => !gone.has(take.file));
  const cut = shipped.filter((take) => take.pieces && !whole.has(take.file));
  let done = 0;
  await eachParallel(shipped, async (take) => {
    const { stem, encodedSha256, bytes } = take;
    if (take.pieces && !whole.has(take.file)) {
      await mkdir(join(paths.out, stem), { recursive: true });
      for (const [i, piece] of take.pieces.entries()) {
        const name = `${String(i + 1).padStart(2, "0")}.ogg`;
        await writeFile(join(paths.out, stem, name), pointerText(piece.sha, piece.bytes, "encodings"));
      }
    } else {
      await writeFile(join(paths.out, `${stem}.ogg`), pointerText(encodedSha256, bytes, "encodings"));
    }
    if (++done % 5000 === 0) console.log(`  ${done}/${shipped.length} pointers`);
  });
  // Only the quests build reads no database for its lengths; anywhere else this file would ship.
  if (section === "quests") {
    const durations = Object.fromEntries(shipped.map(({ stem, durationSec }) => [stem, Number(durationSec)]));
    await writeFile(join(paths.out, "durations.json"), `${JSON.stringify(durations)}\n`);
  }
  if (pieces && section === "quests") {
    const lengths = Object.fromEntries(cut.map(({ stem, pieces: split }) => [stem, packTimes(split.map((p) => p.length))]));
    await writeFile(join(paths.out, "pieces.json"), `${JSON.stringify(lengths)}\n`);
  } else if (pieces) {
    await writePieceLengths(section, lang, Object.fromEntries(cut.map(({ stem, pieces: split }) => [stem, split.map((p) => p.length)])));
  }
  if (pieces) {
    console.log(`  ${cut.length} lines as sentence pieces`);
  }
  return gone;
}

if (process.env.SPOKEN_CLIP_POINTERS) {
  if (!process.env.SPOKEN_ARCHIVE_URL) {
    console.error("SPOKEN_CLIP_POINTERS needs SPOKEN_ARCHIVE_URL");
    process.exit(1);
  }
  // A take kept in its team's own bucket is reached only through a site's /api/archive/, which
  // finds each object wherever it is kept. Our bucket's own address answers 404 for it, which reads
  // as the team's deletion: Places, Readables and Bosses would stop on it, and quests ship it silent.
  const teamKept = live.filter((take) => take.teamTake || take.teamEncoding);
  if (teamKept.length && !throughSite(process.env.SPOKEN_ARCHIVE_URL)) {
    console.error(
      `error: ${teamKept.length} live takes are kept in their team's own bucket, e.g. ${teamKept[0].file}, which only a ` +
        `site's archive route reaches: set SPOKEN_ARCHIVE_URL to <site>/api/archive/, not ${process.env.SPOKEN_ARCHIVE_URL}`,
    );
    process.exit(1);
  }
  const unhashed = live.filter((take) => take.archived && !take.sha256);
  if (unhashed.length) {
    console.error(`${unhashed.length} live takes are only on the droplet's volume, e.g. ${unhashed[0].file}: build with their clips instead`);
    process.exit(1);
  }
  const pointed = live.filter((take) => take.sha256);
  await makeDirs(pointed);
  const leftOut = await writeEncodingPointers(pointed);
  if (section === "quests") {
    await writeWordTimes();
    await writeTakeText();
  }
  console.log(`${section}: ${pointed.length - leftOut.size} pointers in ${paths.out.slice(ROOT.length + 1)}`);
  if (unnamed) console.log(`  ${unnamed} live takes left out: no current line names their file, no lore their place, or their boss is retired`);
  if (live.length > pointed.length) console.log(`  ${live.length - pointed.length} live takes had their clip discarded before the archive kept every take; shipped silent`);
  await writeSelection(pointed.filter((take) => !leftOut.has(take.file)));
  process.exit(0);
}

const encodes = section === "quests" ? null : encodesOf(section);
const kept = live.filter((take) => take.archived);
if (encodes && kept.length && !(await haveEncoders())) {
  console.error("error: encoding the clips needs ffmpeg and oggenc on PATH (brew install ffmpeg vorbis-tools)");
  process.exit(1);
}

let copied = 0;
const missing = [];
const failed = [];
await makeDirs(kept);
// oggenc is single-threaded, so one per core.
await eachParallel(kept, async ({ stem, archived, sha256 }) => {
  const source = join(paths.archive, archived);
  if (!existsSync(source)) {
    missing.push(source);
    return;
  }
  if (!encodes) {
    await copyFile(source, join(paths.out, `${stem}.mp3`), constants.COPYFILE_FICLONE);
    copied++;
    return;
  }
  try {
    await copyFile(await cachedOgg(source, encodes, sha256), join(paths.out, `${stem}.ogg`), constants.COPYFILE_FICLONE);
  } catch (error) {
    // Collected rather than thrown, so the other encoders finish and every bad master is named.
    failed.push(`${stem} (${sha256 || source}): ${error.message}`);
    return;
  }
  if (++copied % 500 === 0) console.log(`  ${copied}/${kept.length} clips`);
}, encodes ? availableParallelism() : undefined);

if (section === "quests") {
  await writeWordTimes();
  await writeTakeText();
}

console.log(`${section}: ${copied} clips in ${paths.out.slice(ROOT.length + 1)}`);
if (unnamed) console.log(`  ${unnamed} live takes left out: no current line names their file, no lore their place, or their boss is retired`);
if (live.length > kept.length) {
  // Known, and not this machine's fault: the take's clip was not kept before the archive
  // was the record. The line ships without audio, the same as one never generated.
  console.log(`  ${live.length - kept.length} live takes had their clip discarded before the archive kept every take; shipped silent`);
}
if (failed.length) {
  console.error(`  ${failed.length} live takes could not be encoded, e.g.:`);
  for (const line of failed.slice(0, 5)) console.error(`    ${line}`);
  process.exit(1);
}
if (missing.length) {
  console.error(`  ${missing.length} live takes are not in this machine's archive, e.g.:`);
  for (const path of missing.slice(0, 5)) console.error(`    ${path}`);
  console.error(`  Fetch them with:  make ${section}-pull-live${lang === BASE_LANG ? "" : ` LOCALE=${lang}`}`);
  process.exit(1);
}
await writeSelection(kept);
