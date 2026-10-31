#!/usr/bin/env node
// Lay the encodings the site made at commit into the quests build's transcode cache.
//
//   node scripts/audio/fetch-encodings.mjs [--lang=deDE]     (LOCAL_DB, SPOKEN_ARCHIVE_URL)
//
// package-audio.sh keys its cache on each master's md5 and encodes only what is missing, so this
// turns a release's hour of oggenc into a download. Run after fetch-blobs.mjs brings the masters.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { archiveOf } from "../lib/archives.mjs";
import { archiveBase, downloadVerified, eachParallel } from "../lib/download.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// Must match package-audio.sh's default profile and cache directory naming.
const PROFILE = "ogg-q0-44k";

export function cacheDir(lang, root = process.env.CACHE_ROOT ?? join(ROOT, "pipelines/quests/audio-transcoded")) {
  return join(root, lang === "enUS" ? PROFILE : `${lang}-${PROFILE}`);
}

export async function fillCache(rows, { archive, cache, base, fetchImpl = fetch }) {
  const tally = { fetched: 0, cached: 0, noMaster: 0, failed: [] };
  await eachParallel(rows, async (row) => {
    const master = join(archive, "blobs/takes", row.sha256);
    if (!existsSync(master)) {
      tally.noMaster++;
      return;
    }
    const target = join(cache, `${createHash("md5").update(await readFile(master)).digest("hex")}.ogg`);
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

/** The live quests takes of the language's privileged team, with their encodings. */
export function liveEncodings(database, lang) {
  return execFileSync("psql", [database, "-tA", "-F", "\t", "-v", `lang=${lang}`, "-v", `profile=${PROFILE}`, "-f", "-"], {
    // The owner connection bypasses row-level security, so the team is named.
    input: `select t."sha256", e."encodedSha256" from "take" t
              join "take_encoding" e on e."source" = t."source" and e."sha256" = t."sha256" and e."profile" = :'profile'
             where t."source" = 'quests' and t."lang" = :'lang' and t."isCurrent"
               and t."teamId" = team_of_lang(:'lang')`,
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
  const base = process.env.SPOKEN_ARCHIVE_URL;
  const database = process.env.LOCAL_DB;
  if (!base || !database) {
    console.error("fetch-encodings.mjs needs SPOKEN_ARCHIVE_URL and LOCAL_DB");
    process.exit(2);
  }
  const rows = liveEncodings(database, lang);
  const tally = await fillCache(rows, {
    archive: archiveOf("quests"),
    cache: cacheDir(lang),
    base: archiveBase(base),
  });
  console.log(`==> encodings: ${tally.fetched} fetched, ${tally.cached} already cached, ${tally.noMaster} without a master here`);
  // Not fatal: package-audio.sh encodes whatever is missing from its cache.
  for (const line of tally.failed.slice(0, 10)) console.warn(`  could not fetch ${line}`);
}
