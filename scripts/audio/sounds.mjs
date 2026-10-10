#!/usr/bin/env node
// Assemble a section's Sounds folder from the database: every live take, copied out of the
// archive under the path the addon plays it from.
//
//   node scripts/audio/sounds.mjs <quests|zones|books>          (LOCAL_DB names the database)
//   node scripts/audio/sounds.mjs --list <quests|zones|books>   the archive files it would copy
//   node scripts/audio/sounds.mjs --lang=esMX zones               another language's pack
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
import { execFileSync } from "node:child_process";
import { constants, existsSync, readdirSync } from "node:fs";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { archiveOf } from "../lib/archives.mjs";
import { NAMED_QUESTS_SQL, namedBy } from "./relevant.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const BASE_LANG = "enUS";

const SECTIONS = {
  quests: { archive: archiveOf("quests"), out: join(ROOT, "pipelines/quests/audio") },
  zones: { archive: archiveOf("zones"), out: join(ROOT, "addons/SpokenZonesAudio/Sounds") },
  books: { archive: archiveOf("books"), out: join(ROOT, "addons/SpokenBooksAudio/Sounds") },
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
  console.error("usage: sounds.mjs [--list] [--lang=<code>] <quests|zones|books>");
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
    [database, "-tA", "-F", "\t", "-v", `source=${section}`, "-v", `lang=${lang}`, "-f", "-"],
    { input: sql, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\n")
    .filter(Boolean);
}

// file <tab> archiveFile, for every live take. A quests file carries its extension and the
// other two do not; the archive directory is the file without it either way.
const listing = psql(`select "file", coalesce("archiveFile", '') from "take"
                       where "source" = :'source' and "lang" = :'lang' and "isCurrent"
                       order by "file"`);

// The archive path of a live take: the take's own directory -- its file without the
// extension -- holding the archive file. Blank when the take's clip was never kept.
const takes = listing.map((row) => {
  const [file, name] = row.split("\t");
  const stem = file.replace(/\.mp3$/, "");
  return { file, stem, archived: name ? join(prefix, stem, name) : "" };
});

// Quests carry only the audio a current line names (relevant.mjs).
const relevant = section === "quests" ? namedBy(psql(NAMED_QUESTS_SQL)) : () => true;
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

console.log(`${section}: ${copied} clips in ${paths.out.slice(ROOT.length + 1)}`);
if (unnamed) console.log(`  ${unnamed} live takes left out: no current line names their file`);
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
