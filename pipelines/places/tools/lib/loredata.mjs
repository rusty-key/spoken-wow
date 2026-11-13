// Reads the generated Lua data files back into JS records.
//
// Both files are machine-written by tools/scrape*.mjs with a fixed shape, one
// field per line, so a regex reader is enough and keeps the repo free of a Lua
// interpreter -- the same bet tools/validate.mjs already makes.
//
// Used by tools/voice/* and by validate.mjs, so there is one parser rather than
// one per consumer.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BASE_LOCALE } from "./locales.mjs";

// The monorepo root. Everything under the places pipeline derives its paths from this
// one constant.
//
// Four levels up, not two: this file is pipelines/places/tools/lib/. The constant has to
// reach the repo root rather than the pipeline root because what it resolves is now
// split across the tree -- the lore corpus lives in addons/Spoken_Places/Data/, the voice
// config in pipelines/places/tools/voice/, the CurseForge descriptions in
// publishers/places/ and the built zips in dist/. One root with full paths beats four
// roots.
//
// The override is what makes the explorer deployable. Next bundles these modules with
// webpack, which replaces `import.meta.url` with the *build machine's* path -- so a
// bundle built in CI carries a literal
// "file:///home/runner/work/wow-lore/wow-lore/tools/lib/loredata.mjs" and every path
// below it resolves to a directory that does not exist on the droplet. Deriving the
// root from the module's own location is right for a script and impossible for a
// bundle, so a deployed process says where the root is instead.
//
// Unset -- which is every local run, CLI or `next dev` -- this behaves exactly as it
// did before. See deploy/README.md for the full set.
//
// SPOKEN_ZONES_ROOT is the variable's name before the rename, which a droplet whose
// shared/ecosystem.config.js predates it still sets.
export const ROOT =
  process.env.SPOKEN_PLACES_ROOT ||
  process.env.SPOKEN_ZONES_ROOT ||
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
// The corpus, under the enUS directory it has always been committed in. The directory
// name is kept rather than flattened: the addon's TOC lists these paths, and a path in a
// shipped TOC is not worth churning to save a level.
//
// Every other language sits beside it in Data/<lang>/, which is where Language.lua's guard
// and validate.mjs both expect it.
export function zonesLua(lang = BASE_LOCALE) {
  return join(ROOT, `addons/Spoken_Places/Data/${lang}/Zones.lua`);
}

export function subzonesLua(lang = BASE_LOCALE) {
  return join(ROOT, `addons/Spoken_Places/Data/${lang}/Subzones.lua`);
}

// The emitter escapes exactly these, so the reader reverses exactly these.
function unescapeLua(text) {
  return text
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function fields(block) {
  const out = {};
  for (const [, key, value] of block.matchAll(
    /^\t+(name|short|full|source) = "((?:[^"\\]|\\.)*)",$/gm,
  )) {
    out[key] = unescapeLua(value);
  }
  return out;
}

// A Windows checkout has CRLF on disk; every pattern here matches lines as Git stores them.
async function readLua(path) {
  return (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
}

export async function readZones() {
  const src = await readLua(zonesLua());
  const zones = [];

  // Split on the top-level "[id] = {" headers, so each block is one zone.
  const parts = src.split(/^\t\[(\d+)\] = \{$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const mapID = Number(parts[i]);
    zones.push({ mapID, ...fields(parts[i + 1]) });
  }
  return zones;
}

export async function readSubzones() {
  const src = await readLua(subzonesLua());
  const subzones = [];

  const zoneParts = src.split(/^\t\[(\d+)\] = \{$/m);
  for (let i = 1; i < zoneParts.length; i += 2) {
    const mapID = Number(zoneParts[i]);

    const keyParts = zoneParts[i + 1].split(/^\t\t\["([^"]*)"\] = \{$/m);
    for (let j = 1; j < keyParts.length; j += 2) {
      subzones.push({ mapID, key: keyParts[j], ...fields(keyParts[j + 1]) });
    }
  }
  return subzones;
}

// Every voiceable entry, in a single shape. `key` is null for a zone. A pending entry (a place
// nobody has written yet) is one too, with empty text: `shipped` tells the two apart.
export async function readLines() {
  const [zones, subzones] = await Promise.all([readZones(), readSubzones()]);
  return [
    ...zones.map((z) => ({ ...z, key: null, kind: "zone" })),
    ...subzones.map((s) => ({ ...s, kind: "subzone" })),
  ];
}

/** The lineIds of the entries the addon has words for: neither pending nor empty. */
export function shipped(entries) {
  return new Set(
    entries.filter((e) => e.full).map((e) => (e.key ? `s:${e.mapID}:${e.key}` : `z:${e.mapID}`)),
  );
}
