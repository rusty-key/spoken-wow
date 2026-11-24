#!/usr/bin/env node
// Lay the encodings the site made at commit into a section's build cache.
//
//   node scripts/audio/fetch-encodings.mjs [--lang=deDE] [--team=<slug>] <section>     (LOCAL_DB, SPOKEN_ARCHIVE_URL)
//
// --team names the team whose takes it reads; without it, the team with the language's plain packs.
//
// The build encodes only what is missing from its cache, so this turns an hour of oggenc into a
// download, and the pack ships the same Ogg the site does. Quests' cache (package-audio.sh) is
// keyed on each master's md5, the others' (sounds.mjs) on its SHA-256. Run after fetch-blobs.mjs
// brings the masters.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { scriptTeamId } from "../../pipelines/lib/release-team.mjs";
import { archiveOf, encodesOf, ENCODING_PROFILE as PROFILE } from "../lib/archives.mjs";
import { archiveBase, downloadVerified, eachParallel } from "../lib/download.mjs";

/** The cache file's name for a take, from its row and its master's path. */
export function keyOf(section) {
  if (section === "quests") return async (_row, master) => createHash("md5").update(await readFile(master)).digest("hex");
  return async (row) => row.sha256;
}

export async function fillCache(rows, { archive, cache, base, key = keyOf("quests"), fetchImpl = fetch }) {
  const tally = { fetched: 0, cached: 0, noMaster: 0, failed: [] };
  await eachParallel(rows, async (row) => {
    const master = join(archive, "blobs/takes", row.sha256);
    if (!existsSync(master)) {
      tally.noMaster++;
      return;
    }
    const target = join(cache, `${await key(row, master)}.ogg`);
    if (existsSync(target)) {
      tally.cached++;
      return;
    }
    try {
      await downloadVerified(`${base}encodings/${row.encodedSha256}`, row.encodedSha256, target, fetchImpl);
      tally.fetched++;
    } catch (error) {
      tally.failed.push(`${row.encodedSha256}: ${error.message}`);
    }
  });
  return tally;
}

/** A section's live takes of team `slug` in the language, else of its plain packs' team, with their encodings. */
export function liveEncodings(database, section, lang, slug = null) {
  const team = scriptTeamId(database, lang, slug);
  return execFileSync("psql", [database, "-tA", "-F", "\t", "-v", `source=${section}`, "-v", `lang=${lang}`, "-v", `profile=${PROFILE}`, "-v", `team=${team}`, "-f", "-"], {
    // The owner connection bypasses row-level security, so the team is named.
    input: `select t."sha256", e."encodedSha256" from "take" t
              join "take_encoding" e on e."source" = t."source" and e."sha256" = t."sha256" and e."profile" = :'profile'
             where t."source" = :'source' and t."lang" = :'lang' and t."isCurrent"
               and t."teamId" = :'team'::uuid`,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha256, encodedSha256] = line.split("\t");
      return { sha256, encodedSha256 };
    });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const lang = process.argv.find((arg) => arg.startsWith("--lang="))?.slice(7) || "enUS";
  const team = process.argv.find((arg) => arg.startsWith("--team="))?.slice(7) || null;
  const section = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!["quests", "places", "readables", "bosses"].includes(section)) {
    console.error("usage: fetch-encodings.mjs [--lang=<code>] [--team=<slug>] <quests|places|readables|bosses>");
    process.exit(2);
  }
  const base = process.env.SPOKEN_ARCHIVE_URL;
  const database = process.env.LOCAL_DB;
  if (!base || !database) {
    console.error("fetch-encodings.mjs needs SPOKEN_ARCHIVE_URL and LOCAL_DB");
    process.exit(2);
  }
  const rows = liveEncodings(database, section, lang, team);
  const tally = await fillCache(rows, {
    archive: archiveOf(section),
    cache: encodesOf(section, lang),
    base: archiveBase(base),
    key: keyOf(section),
  });
  console.log(`==> encodings: ${tally.fetched} fetched, ${tally.cached} already cached, ${tally.noMaster} without a master here`);
  // Not fatal: the build encodes whatever is missing from its cache.
  for (const line of tally.failed.slice(0, 10)) console.warn(`  could not fetch ${line}`);
}
