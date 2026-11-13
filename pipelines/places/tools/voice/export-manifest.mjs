#!/usr/bin/env node
//
// the take table -> tools/voice/manifest.json
//
//   node tools/voice/export-manifest.mjs
//   node tools/voice/export-manifest.mjs --check    (exit 1 if the file is out of date)
//
// The manifest stops being hand-maintained and starts being an export. Its shape does
// not change, it stays committed, and build-lookup.mjs / validate-audio.mjs /
// package-audio.sh keep reading it -- so the addon pipeline never learns the database
// exists, and a clone with no Postgres can still ship the addon.
//
// Run after any generation, before build-lookup.mjs. `make lookup` does both.
//
// --check re-exports and compares against the committed file without writing it, so CI
// can prove the committed manifest is what the database says. The database is the record;
// this file is only ever written from it.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvFile } from "../lib/env.mjs";
import * as db from "./db.mjs";
import { LANG, loadManifest, manifestPath } from "./store.mjs";

// The same serialisation writeManifestFile uses: sorted keys, two-space indent,
// trailing newline. Duplicated deliberately rather than exported from store.mjs --
// this script's whole job is to produce that exact text, so it should say so.
function serialise(manifest) {
  const ordered = Object.fromEntries(
    Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)),
  );
  return JSON.stringify(ordered, null, 2) + "\n";
}

/**
 * Writes the manifest from the database. Returns what happened, so the web app can
 * call this after a generation without parsing anything.
 *
 * With no database this is a no-op rather than an error: `make lookup` runs it before
 * build-lookup.mjs, and with DATABASE_URL unset the manifest is already the record
 * rather than a stale copy of one. Failing here would make the addon build require
 * Postgres, which is the opposite of what this seam is for.
 */
export async function exportManifest({ check = false } = {}) {
  if (!db.isEnabled()) {
    return { skipped: true, changed: false, count: 0 };
  }

  const path = manifestPath();
  const manifest = await loadManifest();
  const next = serialise(manifest);
  const current = await readFile(path, "utf8").catch((err) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });

  const count = Object.keys(manifest).length;
  const before = current === null ? 0 : Object.keys(JSON.parse(current)).length;

  if (current === next) return { skipped: false, changed: false, count, before };
  if (check) return { skipped: false, changed: true, count, before, stale: true };

  // REFUSES TO EMPTY A MANIFEST THAT HAD ENTRIES. "The database has no takes for this
  // language" is far more often a DATABASE_URL pointing somewhere unexpected than a truth
  // about the project -- and this file is the record of what has been paid for, the
  // fallback a clone with no Postgres builds the addon from, and not something any run
  // can put back.
  //
  // It has happened: the merged app's queue publishes when it drains, a test seeded zone
  // jobs against a database holding only quests rows, and the drain exported an empty
  // manifest straight over the committed one. Nothing complained, because writing what
  // the database says is exactly what this function is for.
  //
  // Deliberately not "refuses to shrink it". Retiring takes is a real operation and a
  // language legitimately loses entries. Zero is the one count
  // that cannot be arrived at by any sequence of real edits, because a take is never
  // deleted -- it is superseded.
  if (count === 0 && before > 0) {
    throw new Error(
      `refusing to empty ${path}: the database reports no ${LANG} takes, but the file has ` +
        `${before}. Check DATABASE_URL points at the database you mean.`,
    );
  }

  // A language's directory may not exist yet -- `make places-lookup LOCALE=xx` can run before
  // `make places-sounds LOCALE=xx` has staged build/places/<lang>/ -- so the write below would
  // otherwise die with ENOENT before the manifest could ever be exported.
  await mkdir(dirname(path), { recursive: true });

  // Temp file and rename, for the reason store.mjs gives: this is the record of
  // everything already paid for, and a crash partway through a write would destroy it.
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, next);
  await rename(temp, path);

  return { skipped: false, changed: true, count, before };
}

async function main() {
  const check = process.argv.includes("--check");
  const result = await exportManifest({ check });

  if (result.skipped) {
    console.log("DATABASE_URL is not set; tools/voice/manifest.json is already the record.");
    return;
  }
  if (!result.changed) {
    console.log(`${manifestPath()} is up to date (${result.count} lines).`);
    return;
  }
  if (result.stale) {
    console.error(`error: ${manifestPath()} does not match the database.`);
    console.error("       run:  node tools/voice/export-manifest.mjs");
    process.exit(1);
  }

  console.log(`wrote ${manifestPath()}`);
  console.log(`  ${result.count} lines (was ${result.before})`);
  console.log("\nnext:  node tools/voice/build-lookup.mjs");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // .env is bridged here and not at module top: the explorer imports this module, and
  // its paths must come from the server environment, not from a file webpack resolves
  // against the build machine.
  loadEnvFile()
    .then(main)
    .catch((err) => {
      console.error(`error: ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => db.close());
}
