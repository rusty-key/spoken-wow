#!/usr/bin/env node
// Reports how much of the UI each language has strings for.
//
//   node tools/locale/check-strings.mjs
//
// addons/Spoken_Places/Locale/enUS.lua is the key set: every string the interface can
// show, named. A translation is a file of the same keys with different values,
// and anything it leaves out falls back to English at runtime.
//
// THIS DOES NOT FAIL ON AN INCOMPLETE LANGUAGE. An empty locale is the normal
// state of one nobody has started, and a build that refused it would make adding
// the file the last step rather than the first. Incompleteness is reported, and
// what it decides is whether the language is offered to players at all -- see
// build-languages.mjs.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { BASE_LOCALE, CODES } from "../lib/locales.mjs";
import { ROOT } from "../lib/wiki.mjs";

const LOCALE_DIR = join(ROOT, "addons/Spoken_Places/Locale");

// The emitted files are one assignment per line, so a regex reader is enough --
// the same bet validate.mjs makes about the data files.
const ASSIGNMENT = /^L\.([A-Z0-9_]+)\s*=/gm;

async function keysIn(code) {
  const src = await readFile(join(LOCALE_DIR, `${code}.lua`), "utf8").catch((err) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  if (src === null) return null;
  return new Set([...src.matchAll(ASSIGNMENT)].map((m) => m[1]));
}

/** @returns {Promise<Map<string, {done: number, total: number, missing: string[]}>>} */
export async function stringCoverage() {
  const base = await keysIn(BASE_LOCALE);
  if (!base) throw new Error(`${LOCALE_DIR}/${BASE_LOCALE}.lua is missing -- it is the key set`);

  const coverage = new Map();
  for (const code of CODES) {
    const keys = (code === BASE_LOCALE ? base : await keysIn(code)) || new Set();
    const missing = [...base].filter((key) => !keys.has(key));
    coverage.set(code, { done: base.size - missing.length, total: base.size, missing });

    // A key a translation has and English does not is a string that was renamed
    // or removed on the English side and left behind here -- dead weight that
    // reads as coverage.
    for (const key of keys) {
      if (!base.has(key)) {
        console.warn(`warning: ${code}.lua defines ${key}, which ${BASE_LOCALE}.lua does not`);
      }
    }
  }
  return coverage;
}

async function main() {
  const coverage = await stringCoverage();
  for (const [code, { done, total }] of coverage) {
    const pct = total ? ((done / total) * 100).toFixed(0) : "0";
    console.log(`${code}: ${done} of ${total} strings (${pct}%)`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
