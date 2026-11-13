#!/usr/bin/env node
//
// Selects lore lines and reports on them. It does not synthesize anything.
//
//   node tools/voice/generate.mjs --all                 every entry
//   node tools/voice/generate.mjs --zone Durotar        one zone and its subzones
//   node tools/voice/generate.mjs --missing --stale     what needs work
//
// THIS COMMAND CANNOT SPEND CREDITS, and that is the point of it. Voicing a line
// happens on the droplet, through the site: one queue, one leader holding one
// advisory lock, one roster of voices, and a key that belongs to the signed-in
// editor rather than to whichever laptop ran a script. A second generator here
// would be a second answer to every one of those, and the way two of them drift
// is already on record -- see the note at the top of store.mjs.
//
// What is left is the text half, which the site has no reason to own: which lines
// exist, which are missing audio, which have had their text rewritten since they
// were cut, and what re-cutting them would cost. Answering that needs no key, so
// it stays runnable from a laptop with no credentials.

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvFile } from "../lib/env.mjs";
import { readLines, ROOT } from "../lib/loredata.mjs";
import { assignFiles, lineId, textHash } from "./naming.mjs";
import { hasBrackets, loadPronunciation, toSpokenText } from "./normalise.mjs";
import { close as closeStore, currentDictionary, loadManifest } from "./store.mjs";

/**
 * The fallback credit rate, from tools/voice/config.json.
 *
 * Read here rather than through a client module, because there is no client module: every
 * request to ElevenLabs is the site's. This is the whole of what that file still holds --
 * see its own _notes -- and it only matters until the manifest has a generated line to
 * measure a real rate from.
 */
async function loadRate() {
  const path = join(ROOT, "pipelines/places/tools/voice/config.json");
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

//------------------------------------------------------------------------------
// Arguments
//------------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    zones: [],
    zonesOnly: false,
    subzonesOnly: false,
    missing: false,
    stale: false,
    dictionaryDrift: false,
    olderThan: null,
    all: false,
    limit: null,
    list: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };

    switch (arg) {
      case "--zone": args.zones.push(next()); break;
      case "--zones-only": args.zonesOnly = true; break;
      case "--subzones-only": args.subzonesOnly = true; break;
      case "--missing": args.missing = true; break;
      case "--stale": args.stale = true; break;
      case "--dictionary-drift": args.dictionaryDrift = true; break;
      case "--older-than": args.olderThan = next(); break;
      case "--all": args.all = true; break;
      case "--limit": args.limit = Number(next()); break;
      case "--list": args.list = true; break;
      case "--help": case "-h": usage(); process.exit(0);
      default: throw new Error(`unknown argument ${arg} (try --help)`);
    }
  }
  return args;
}

function usage() {
  console.log(`Usage: node tools/voice/generate.mjs [selectors]

Reports on lore lines. Generating audio is the site's, on the droplet.

Selectors (combine freely; a zone selects its subzones too):
  --zone <id|name>     repeatable, e.g. --zone 1411 --zone "The Barrens"
  --zones-only         zone entries, no subzones
  --subzones-only      subzone entries only
  --missing            no audio yet
  --stale              spoken text changed since it was generated
  --dictionary-drift   spoken with a pronunciation dictionary other than the
                       one the lexicon currently points at. Needs DATABASE_URL,
                       which is where that locator lives. Never implied by
                       --stale: a lexicon change does not alter the text, so
                       these lines are only worth re-cutting deliberately
  --older-than <date>  generated before this ISO date
  --all                every entry
  --limit <n>          cap the selection

Output:
  (default)            counts, characters, credits, minutes
  --list               list every selected line, however many (a selection of
                       %d or fewer lists itself)
`.replace("%d", String(AUTO_LIST_LIMIT)));
}

//------------------------------------------------------------------------------
// Selection
//------------------------------------------------------------------------------

export async function buildCatalogue() {
  const entries = await readLines();
  const rules = await loadPronunciation();
  const files = assignFiles(entries);

  // Subzones carry only their parent's uiMapID, so --zone Durotar needs the zone
  // name attached to every entry for the name form of the selector to reach them.
  const zoneNames = new Map(
    entries.filter((e) => e.kind === "zone").map((e) => [e.mapID, e.name]),
  );

  return entries.map((entry) => {
    const spoken = toSpokenText(entry.full, rules);
    return {
      ...entry,
      zoneName: zoneNames.get(entry.mapID) ?? "",
      id: lineId(entry),
      file: files.get(lineId(entry)),
      spoken,
      hash: textHash(spoken),
    };
  });
}

function matchesZone(entry, zones) {
  return zones.some((wanted) => {
    if (/^\d+$/.test(wanted)) return entry.mapID === Number(wanted);
    return normaliseName(entry.zoneName ?? "") === normaliseName(wanted);
  });
}

function normaliseName(name) {
  return name.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
}

// Whether a line's audio was made with a pronunciation dictionary other than the
// latest version, resolved for this run.
//
// This is the only way a lexicon change is visible here. The lexicon lives in
// ../wow-voiceover and reaches this project as dictionary rules, which the model
// applies to text this project never rewrites -- so the spoken text, and the hash
// --stale compares, do not move when a pronunciation is fixed.
//
// False when no version has been resolved, because "unknown" and "changed" are not
// the same thing and only the second is worth spending credits on.
export function driftsFromDictionary(record, config) {
  if (!record || !config?.dictionaryId || !config?.dictionaryVersionId) return false;
  return (
    record.dictionaryId !== config.dictionaryId ||
    record.dictionaryVersionId !== config.dictionaryVersionId
  );
}

export function select(catalogue, args, manifest, config = {}) {
  let out = catalogue;

  if (args.zones.length) out = out.filter((e) => matchesZone(e, args.zones));
  if (args.zonesOnly) out = out.filter((e) => e.kind === "zone");
  if (args.subzonesOnly) out = out.filter((e) => e.kind === "subzone");

  const conditions = [];
  if (args.missing) conditions.push((e) => !manifest[e.id]);
  if (args.stale) conditions.push((e) => manifest[e.id] && manifest[e.id].textHash !== e.hash);
  // Never implied by --stale, and never automatic. Adopting a shared dictionary
  // drifts all 1353 lines at once, and re-cutting them is a four-figure credit
  // decision that belongs to whoever is reading the number, not to this flag.
  if (args.dictionaryDrift) {
    conditions.push((e) => driftsFromDictionary(manifest[e.id], config));
  }
  if (args.olderThan) {
    const cutoff = Date.parse(args.olderThan);
    if (Number.isNaN(cutoff)) throw new Error(`--older-than: cannot parse "${args.olderThan}"`);
    conditions.push((e) => manifest[e.id] && Date.parse(manifest[e.id].generatedAt) < cutoff);
  }
  // Any of the state conditions, so --missing --stale reads as "needs work".
  if (conditions.length) out = out.filter((e) => conditions.some((fn) => fn(e)));

  if (args.limit != null) out = out.slice(0, args.limit);
  return out;
}

//------------------------------------------------------------------------------
// Reporting
//------------------------------------------------------------------------------

// A zone and its subzones is the natural unit of work here and fits on a screen,
// so a selection that size lists itself. --all does not, unless --list says so.
const AUTO_LIST_LIMIT = 60;

// Below this, Eleven v3 is documented as unreliable, and 305 of the 1353 entries
// are shorter -- so the ones to listen to first are worth marking.
const SHORT_LINE = 250;

function listSelection(selected, manifest, config, args) {
  if (!args.list && selected.length > AUTO_LIST_LIMIT) {
    console.log(`(${selected.length} lines; --list to see them all)\n`);
    return;
  }

  // Largest first: those are what the run costs, and what is worth checking.
  const rows = [...selected].sort((a, b) => b.spoken.length - a.spoken.length);
  const { creditRate: rate } = measureRates(manifest, config);
  const width = String(rows[0].spoken.length).length;

  console.log(`${rows.length} lines, largest first:\n`);
  for (const entry of rows) {
    const record = manifest[entry.id];
    const state = !record ? "new" : record.textHash !== entry.hash ? "stale" : "current";
    const credits = rate ? `~${String(Math.round(entry.spoken.length * rate)).padStart(width)}cr` : "";
    const short = entry.spoken.length < SHORT_LINE ? " short" : "";

    console.log(
      `  ${String(entry.spoken.length).padStart(width)}ch ${credits}  ` +
        `${state.padEnd(7)} ${(entry.name || entry.key || entry.zoneName).padEnd(34)} ${entry.file}${short}`,
    );
  }

  const shortCount = rows.filter((e) => e.spoken.length < SHORT_LINE).length;
  if (shortCount) {
    console.log(`\n  ${shortCount} under ${SHORT_LINE} characters (marked "short"): `
      + "v3 is least reliable there, so listen to those first.");
  }
  console.log("");
}

// Credits per character and characters per second, measured from what has
// already been generated rather than assumed.
//
// Both were constants first, and both were wrong: 0.55 and 15 against a measured
// 0.61 and 12.9, which is a 10% understatement of the bill and of the runtime.
// Every generated line records what it actually cost and how long it came out, so
// the estimate should come from that and improve as the corpus fills. The config
// values remain the answer for a manifest with nothing in it yet.
export function measureRates(manifest, config) {
  let chars = 0, credits = 0, seconds = 0, counted = 0;

  for (const record of Object.values(manifest)) {
    if (typeof record.credits !== "number" || typeof record.chars !== "number") continue;
    chars += record.chars;
    credits += record.credits;
    if (typeof record.durationSec === "number") seconds += record.durationSec;
    counted++;
  }

  if (counted === 0 || chars === 0) {
    return {
      creditRate: config?.creditRate ?? null,
      charsPerSecond: 15,
      measuredFrom: 0,
    };
  }

  return {
    creditRate: credits / chars,
    charsPerSecond: seconds > 0 ? chars / seconds : 15,
    measuredFrom: counted,
  };
}

function summarise(selected, manifest, label, config) {
  const chars = selected.reduce((n, e) => n + e.spoken.length, 0);
  const missing = selected.filter((e) => !manifest[e.id]).length;
  const stale = selected.filter((e) => manifest[e.id] && manifest[e.id].textHash !== e.hash).length;

  const { creditRate, charsPerSecond, measuredFrom } = measureRates(manifest, config);
  const credits = creditRate ? Math.round(chars * creditRate) : null;
  const source = measuredFrom
    ? `measured over ${measuredFrom} generated line${measuredFrom === 1 ? "" : "s"}`
    : "estimated from config.json";

  console.log(`${label}: ${selected.length} lines`);
  console.log(`  characters : ${chars.toLocaleString()}`);
  console.log(
    credits === null
      ? "  credits    : unknown (set creditRate in tools/voice/config.json)"
      : `  credits    : ~${credits.toLocaleString()} at ${creditRate.toFixed(3)}/char, ${source}`,
  );
  console.log(`  audio      : ~${Math.round(chars / charsPerSecond / 60)} minutes at ${charsPerSecond.toFixed(1)} chars/second`);
  console.log(`  state      : ${missing} missing, ${stale} stale, ${selected.length - missing - stale} already current`);

  // Reported, never acted on. A dictionary change does not move the text hash, so
  // none of these lines count as stale and none of them are selected unless
  // --dictionary-drift asks for them by name.
  const drifted = selected.filter((e) => driftsFromDictionary(manifest[e.id], config)).length;
  if (drifted) {
    console.log(
      `  dictionary : ${drifted} spoken with an older pronunciation dictionary ` +
        "(--dictionary-drift selects them)",
    );
  }
}

//------------------------------------------------------------------------------
// Entry point
//------------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const catalogue = await buildCatalogue();
  const config = await loadRate();

  // Enforced here rather than left to the model: a bracket that reaches v3 is
  // performed rather than spoken, which is silent corruption of a paid clip.
  const leaked = catalogue.filter((e) => hasBrackets(e.spoken));
  if (leaked.length) {
    console.error(`error: ${leaked.length} lines still contain square brackets after normalising.`);
    for (const entry of leaked.slice(0, 5)) console.error(`  ${entry.id}`);
    console.error("Eleven v3 reads brackets as performance directions. Fix tools/voice/normalise.mjs.");
    process.exit(1);
  }

  const manifest = await loadManifest();
  const anySelector =
    args.all || args.zones.length || args.zonesOnly || args.subzonesOnly ||
    args.missing || args.stale || args.dictionaryDrift || args.olderThan;

  if (!anySelector) {
    usage();
    console.error("error: pick a selector (--all is the everything one).");
    process.exit(1);
  }

  // The locator comes from the lexicon in the database, which is what the site
  // generates against. Asking ElevenLabs for it instead would put a credential back
  // in this command's hands for the sake of one selector.
  if (args.dictionaryDrift) {
    const locator = await currentDictionary();
    if (!locator) {
      console.error(
        "error: --dictionary-drift needs DATABASE_URL, and a lexicon that has been " +
          "synced to ElevenLabs at least once. That locator is what a take is compared against.",
      );
      process.exit(1);
    }
    config.dictionaryId = locator.dictionaryId;
    config.dictionaryVersionId = locator.versionId;
  }

  const selected = select(catalogue, args, manifest, config);
  if (selected.length === 0) {
    console.log("nothing selected.");
    return;
  }

  listSelection(selected, manifest, config, args);
  summarise(selected, manifest, "would generate", config);
  console.log("\nTo cut these, select them on /places and regenerate there.");
}

// Only when run as a script. buildCatalogue and select are imported by
// validate.mjs and by tests, and a module that runs a CLI on import would run it
// for them too.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // .env bridged in the CLI guard only; the explorer imports this module.
  loadEnvFile()
    .then(main)
    .catch((err) => {
      console.error(`error: ${err.message}`);
      process.exitCode = 1;
    })
    // An open connection pool keeps the process alive after main() returns, which
    // looks exactly like a hang. Harmless with DATABASE_URL unset.
    .finally(() => closeStore());
}
