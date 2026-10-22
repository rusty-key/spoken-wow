#!/usr/bin/env node
// Sanity-checks the generated Lua data files without a Lua interpreter.
//
//   node tools/validate.mjs
//
// The definitive test is loading the addon in-game, but a bad string escape there
// costs a relog to discover, so check the mechanical properties here: balanced
// structure, properly terminated strings, no raw newlines or control characters
// inside strings, deterministic ordering, and no post-vanilla lore leaking
// through the era filter.
//
// It also guards the two places where Core.lua reimplements a JS function in Lua:
// normaliseKey, and the slug half of naming.mjs that the report URLs are built from.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, normaliseKey } from "./lib/wiki.mjs";
import { loadClientAreas } from "./lib/era.mjs";
import { BASE_LOCALE, CODES, LOCALES } from "./lib/locales.mjs";
import { slugFor } from "./voice/naming.mjs";

const DATA = join(ROOT, "addons/Spoken_Places/Data");

// Terms that should never survive the era filter. Case-sensitive where the
// lower-case word is legitimate vanilla lore ("the black dragonflight").
const FORBIDDEN = [
  /\bcataclysm\b/i,
  /\bDeathwing\b/,
  /\bPandaria\b/,
  /\bShadowlands\b/,
  /\bGarrosh\b/,
  /\bAzerite\b/,
  /\bOutland\b/,
  /\bDragonflight\b/, // the expansion; "dragonflight" the faction is fine
  /\bN'Zoth\b/,
  /\bBroken Isles\b/,
  /\bIcecrown Citadel\b/,
  /\bphas(?:ed|ing)\b/i,
  // Battle for Azeroth and Shadowlands respectively, named as events rather than
  // expansions, so nothing above caught them. Eleven shipped lines described
  // Tirisfal and Lordaeron as they stand after a war that has not happened in Era.
  /\bBattle (?:for|of) Lordaeron\b/,
  /\bthe Jailer\b/,
  // From the 2026-08 full-corpus review (dist/review-findings.md): zero
  // legitimate vanilla uses, found leaked into shipped text. Kept in step with
  // the same block in lib/wiki.mjs POST_VANILLA.
  /\bWar of the Thorns\b/,
  /\bBilgewater\b/,
  /\bsaronite\b/i,
  /\bVanessa VanCleef\b/,
  /\bDelaryn Summermoon\b/,
  /\bAlennah Starsong\b/,
  /\bLorash Sunbeam\b/,
  /\bSira Moonwarden\b/,
  /\bPrimalists?\b/,
  /\bTwilight Highlands\b/,
  /\bwarfronts?\b/i,
  /\bHorde Council\b/,
  /\bXenedar\b/,
  /\bFirelands\b/,
];

const problems = [];
const note = (msg) => problems.push(msg);

// Every generated field line, at any nesting depth.
const FIELD = /^\t+(name|short|full|source) = "(.*)",$/;

// A place the client has that nobody has written about yet. It leads its entry, so a
// single forward pass knows the empty fields below it are deliberate.
const PENDING = /^\t+pending = true,$/;
const ENTRY_OPEN = /^\t+\[("?[^\]]*"?)\] = \{$/;

function checkStrings(src, label) {
  let fields = 0;
  let pending = false;

  src.split("\n").forEach((line, i) => {
    const lineNo = i + 1;
    if (ENTRY_OPEN.test(line)) {
      pending = false;
      return;
    }
    if (PENDING.test(line)) {
      pending = true;
      return;
    }
    if (!/^\t+\w+ = /.test(line)) return;

    const m = line.match(FIELD);
    if (!m) {
      note(`${label}:${lineNo}: field line is not a terminated Lua string: ${line.slice(0, 70)}`);
      return;
    }

    const [, field, bodyText] = m;
    fields++;

    // Walk the body checking that every " and \ is escaped.
    for (let j = 0; j < bodyText.length; j++) {
      const ch = bodyText[j];
      if (ch === "\\") {
        const next = bodyText[j + 1];
        if (next === undefined) {
          note(`${label}:${lineNo}: ${field} ends with a dangling backslash`);
        } else if (!'\\"nrt'.includes(next)) {
          note(`${label}:${lineNo}: ${field} has unknown escape \\${next}`);
        }
        j++; // consume the escaped character
      } else if (ch === '"') {
        note(`${label}:${lineNo}: ${field} contains an unescaped double quote`);
      } else if (ch.charCodeAt(0) < 0x20) {
        note(
          `${label}:${lineNo}: ${field} contains a raw control character ` +
            `(0x${ch.charCodeAt(0).toString(16)})`
        );
      }
    }

    // Empty text is a broken entry for every origin but one: a pending entry is a place
    // the addon names and says nothing about, on purpose.
    if ((field === "full" || field === "short") && bodyText.trim().length === 0 && !pending) {
      note(`${label}:${lineNo}: ${field} is empty`);
    }

    if (field === "full" || field === "short") {
      for (const re of FORBIDDEN) {
        if (re.test(bodyText)) {
          note(`${label}:${lineNo}: post-vanilla term ${re} leaked into ${field}`);
        }
      }
    }
  });

  return fields;
}

function checkBraces(src, label) {
  const opens = (src.match(/\{/g) || []).length;
  const closes = (src.match(/\}/g) || []).length;
  if (opens !== closes) {
    note(`${label}: unbalanced braces, ${opens} '{' vs ${closes} '}'`);
  }
}

// Every generated data file opens with the vararg header and a guard, and ends by
// handing its table to Language.lua. A file missing the guard builds its table on
// every client at once; one missing the registration call builds it for nobody.
function checkHeader(src, label, { lang, local, kind }) {
  if (!/^local _, SpokenZones = \.\.\.$/m.test(src)) {
    note(`${label}: missing the 'local _, SpokenZones = ...' vararg header`);
  }
  if (!src.includes(`if not SpokenZones:ShouldLoadLanguage("${lang}") then`)) {
    note(`${label}: missing the ShouldLoadLanguage("${lang}") guard -- would load on every client`);
  }
  if (!new RegExp(`^local ${local} = \\{$`, "m").test(src)) {
    note(`${label}: missing the 'local ${local} = {' table`);
  }
  if (!src.includes(`SpokenZones:RegisterLoreData("${lang}", "${kind}", ${local})`)) {
    note(`${label}: missing the RegisterLoreData call -- the table would never be reachable`);
  }
}

//------------------------------------------------------------------------------
// Corpora
//
// One pair of files per translated language, under Data/<lang>/. English is the
// reference: every other language is keyed by the same English subzone keys, so
// a key outside English's set is a line nothing can ever look up.
//------------------------------------------------------------------------------

const languages = (await readdir(DATA, { withFileTypes: true }))
  .filter((e) => e.isDirectory() && CODES.includes(e.name))
  .map((e) => e.name)
  .sort();

if (!languages.includes(BASE_LOCALE)) {
  note(`Data/${BASE_LOCALE}/ is missing -- English is the fallback corpus and is not optional`);
}

const client = await loadClientAreas();
const corpora = new Map();

for (const lang of languages) {
  const zonesSrc = await readFile(join(DATA, lang, "Zones.lua"), "utf8").catch(() => null);
  const subSrc = await readFile(join(DATA, lang, "Subzones.lua"), "utf8").catch(() => null);

  // Neither file: a locale directory with only Aliases.lua. Exactly one is not
  // that -- it is an export that stopped between its two writes, and skipping it
  // silently would report a half-corpus as fine.
  if (zonesSrc === null && subSrc === null) continue;
  if (zonesSrc === null || subSrc === null) {
    note(
      `${lang}/: has ${zonesSrc === null ? "Subzones" : "Zones"}.lua but not its pair -- ` +
        `an interrupted export? re-run: make lore-export`,
    );
    continue;
  }

  const zLabel = `${lang}/Zones.lua`;
  checkBraces(zonesSrc, zLabel);
  checkHeader(zonesSrc, zLabel, { lang, local: "zones", kind: "zones" });

  const zoneIDs = [...zonesSrc.matchAll(/^\t\[(\d+)\] = \{$/gm)].map((m) => Number(m[1]));
  if (zoneIDs.length === 0) note(`${zLabel}: no zone entries found`);

  const seenZones = new Set();
  for (const id of zoneIDs) {
    if (seenZones.has(id)) note(`${zLabel}: duplicate uiMapID ${id}`);
    seenZones.add(id);
  }
  if (zoneIDs.join(",") !== [...zoneIDs].sort((a, b) => a - b).join(",")) {
    note(`${zLabel}: entries are not sorted by uiMapID (output is not deterministic)`);
  }

  const zoneFields = checkStrings(zonesSrc, zLabel);
  if (zoneFields !== zoneIDs.length * 4) {
    note(`${zLabel}: ${zoneFields} field lines for ${zoneIDs.length} entries (expected 4 each)`);
  }

  const sLabel = `${lang}/Subzones.lua`;
  checkBraces(subSrc, sLabel);
  checkHeader(subSrc, sLabel, { lang, local: "subzones", kind: "subzones" });

  const subParents = [...subSrc.matchAll(/^\t\[(\d+)\] = \{$/gm)].map((m) => Number(m[1]));
  const subKeys = [...subSrc.matchAll(/^\t\t\["([^"]*)"\] = \{$/gm)].map((m) => m[1]);

  if (subParents.length === 0) note(`${sLabel}: no parent zones found`);
  if (subKeys.length === 0) note(`${sLabel}: no subzone entries found`);

  // Every parent zone must itself be a known zone, or the panel can never reach it.
  for (const parent of subParents) {
    if (!seenZones.has(parent)) {
      note(`${sLabel}: parent uiMapID ${parent} is not present in ${lang}/Zones.lua`);
    }
  }

  // Keys must already be in canonical form -- the addon normalises the client's
  // area name and looks it up directly, so a non-canonical key is unreachable.
  for (const key of subKeys) {
    const canonical = normaliseKey(key);
    if (key !== canonical) {
      note(`${sLabel}: key "${key}" is not canonical (expected "${canonical}") -- unreachable`);
    }
  }

  // Every key must be an area name the Era client can report (its own AreaTable,
  // dumped into tools/seed/era-areas.json). A key outside that list is either a
  // post-vanilla place the wiki category slipped in, or a name the client would
  // never hand to the lookup -- unreachable either way.
  for (const key of subKeys) {
    if (!client.keys.has(key)) {
      note(
        `${sLabel}: "${key}" is not an area in any supported client ` +
          `(builds ${client.builds.join(", ")})`,
      );
    }
  }

  const subFields = checkStrings(subSrc, sLabel);
  if (subFields !== subKeys.length * 4) {
    note(`${sLabel}: ${subFields} field lines for ${subKeys.length} entries (expected 4 each)`);
  }

  corpora.set(lang, { zonesSrc, subSrc, zoneIDs, subParents, subKeys });
}

const base = corpora.get(BASE_LOCALE);
const baseKeys = new Set(base ? base.subKeys : []);
const baseZones = new Set(base ? base.zoneIDs : []);
const baseStories = new Set();
for (const [, mapID, body] of (base ? base.subSrc : "").matchAll(/^\t\[(\d+)\] = \{$([\s\S]*?)^\t\},?$/gm)) {
  for (const [, key] of body.matchAll(/^\t\t\["([^"]*)"\] = \{$/gm)) baseStories.add(`${mapID}/${key}`);
}

for (const [lang, corpus] of corpora) {
  if (lang === BASE_LOCALE) continue;
  for (const key of corpus.subKeys) {
    if (!baseKeys.has(key)) {
      note(`${lang}/Subzones.lua: "${key}" has no English entry -- translated from what?`);
    }
  }
  for (const id of corpus.zoneIDs) {
    if (!baseZones.has(id)) {
      note(`${lang}/Zones.lua: uiMapID ${id} has no English entry -- translated from what?`);
    }
  }
}

//------------------------------------------------------------------------------
// Alias tables
//
// A non-English client reports its own area names, which match no corpus key at
// all until Data/<locale>/Aliases.lua turns them back into English ones. An alias
// pointing at a key the corpus does not have is a lookup that can never succeed,
// which is exactly the failure the aliases exist to remove.
//------------------------------------------------------------------------------

const aliasCounts = new Map();

for (const lang of languages) {
  const path = join(DATA, lang, "Aliases.lua");
  const src = await readFile(path, "utf8").catch(() => null);
  if (src === null) continue;

  const label = `${lang}/Aliases.lua`;
  checkBraces(src, label);
  if (!src.includes(`if not SpokenZones:ShouldLoadAliases("${lang}") then`)) {
    note(`${label}: missing the ShouldLoadAliases("${lang}") guard -- would load on every client`);
  }
  if (
    !src.includes(`SpokenZones:RegisterAliases("${lang}", aliases)`) &&
    !src.includes(`SpokenZones:RegisterAliases("${lang}", aliases, byZone)`)
  ) {
    note(`${label}: missing the RegisterAliases call -- the table would never be reachable`);
  }

  const targets = [...src.matchAll(/^\t\["(?:[^"\\]|\\.)*"\] = "([^"]*)",$/gm)].map((m) => m[1]);
  const rows = (src.match(/^\t\[".*"\] = ".*",$/gm) || []).length;
  if (targets.length !== rows) {
    note(`${label}: ${rows} rows but ${targets.length} parsed targets -- an alias line is malformed`);
  }
  for (const target of targets) {
    if (!baseKeys.has(target)) {
      note(`${label}: alias points at "${target}", which no English subzone uses`);
    }
  }
  // A name told apart by zone: each key must be a story kept under that zone, or the player
  // there gets no story where the flat table would have given one.
  for (const [, cells] of src.matchAll(/^\t\["(?:[^"\\]|\\.)*"\] = \{ (.*) \},$/gm)) {
    for (const [, mapID, key] of cells.matchAll(/\[(\d+)\] = "([^"]*)"/g)) {
      if (!baseStories.has(`${mapID}/${key}`)) {
        note(`${label}: "${key}" under ${mapID} is told apart by zone, but no English story is kept there`);
      }
    }
  }
  aliasCounts.set(lang, new Set(targets).size);
}

//------------------------------------------------------------------------------
// Load order
//
// Language.lua answers "which language is being read" while the files after it
// are loading, and it can only answer it once Data/Languages.lua has said which
// languages are finished. Getting this backwards does not error: every player
// silently reads English, which is also what a correct build looks like today.
//------------------------------------------------------------------------------

{
  const toc = await readFile(join(ROOT, "addons/Spoken_Places/Spoken_Places.toc"), "utf8");
  const files = toc
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".lua"));

  const order = (name) => files.indexOf(name);
  const languages = order("Data/Languages.lua");
  const language = order("Language.lua");

  if (languages === -1) note("Spoken_Places.toc: Data/Languages.lua is not loaded");
  if (language === -1) note("Spoken_Places.toc: Language.lua is not loaded");
  if (languages > -1 && language > -1 && languages > language) {
    note("Spoken_Places.toc: Data/Languages.lua must load before Language.lua, or no language is ever ready");
  }

  for (const file of files) {
    if ((file.startsWith("Data/") && file !== "Data/Languages.lua") || file.startsWith("Locale/")) {
      if (order(file) < language) {
        note(`Spoken_Places.toc: ${file} loads before Language.lua, whose guard it calls`);
      }
    }
  }

  // Every generated file must actually be listed, or it is a file on disk that no
  // client ever reads -- which looks exactly like a language having no data.
  for (const lang of languages > -1 ? CODES : []) {
    for (const name of ["Zones.lua", "Subzones.lua", "Aliases.lua"]) {
      const path = `Data/${lang}/${name}`;
      const exists = await readFile(join(DATA, lang, name), "utf8").then(() => true, () => false);
      if (exists && order(path) === -1) note(`Spoken_Places.toc: ${path} exists but is not loaded`);
    }
    const localePath = `Locale/${lang}.lua`;
    const localeExists = await readFile(join(ROOT, "addons/Spoken_Places", localePath), "utf8").then(
      () => true,
      () => false,
    );
    if (localeExists && order(localePath) === -1) {
      note(`Spoken_Places.toc: ${localePath} exists but is not loaded`);
    }
  }
}

//------------------------------------------------------------------------------
// Locale list parity
//
// Language.lua and lib/locales.mjs both enumerate the languages, one for the
// addon and one for everything that generates files for it. A code in only one of
// them is either a language nothing can be built for or a directory the addon
// will never load.
//------------------------------------------------------------------------------

{
  const languageLua = await readFile(join(ROOT, "addons/Spoken_Places/Language.lua"), "utf8");
  const luaCodes = [...languageLua.matchAll(/\{ code = "(\w+)"/g)].map((m) => m[1]);
  if (luaCodes.join(",") !== CODES.join(",")) {
    note(
      `Language.lua LOCALES and lib/locales.mjs LOCALES have drifted:\n` +
        `      Lua: ${luaCodes.join(" ")}\n` +
        `      JS:  ${CODES.join(" ")}`
    );
  }

  // Which languages no client runs in. The addon keeps Auto off them and the pipelines
  // build nothing client-keyed for them; one side thinking a client exists and the other
  // not is aliases built for nobody, or Auto landing on a language with none.
  const luaNonClient = [...languageLua.matchAll(/\{ code = "(\w+)"[^}]*client = false/g)].map((m) => m[1]);
  const jsNonClient = LOCALES.filter((l) => l.client === false).map((l) => l.code);
  if (luaNonClient.join(",") !== jsNonClient.join(",")) {
    note(
      `Language.lua and lib/locales.mjs disagree on which languages no client runs in:\n` +
        `      Lua: ${luaNonClient.join(" ") || "(none)"}\n` +
        `      JS:  ${jsNonClient.join(" ") || "(none)"}`
    );
  }

  // The site is not compared here any more: it serves English only and keeps no
  // locale list of its own. The addon's list is still the one this guards.
}

//------------------------------------------------------------------------------
// Report URL slugs
//
// SpokenZones:ReportURL builds spoken.rusty.one/{lang}/zones/r/{mapID}/{slug} in Lua, and the site
// resolves that path back to a line by looking it up among the file paths
// naming.mjs assigns. That only works while every slug is derivable from the key
// alone: assignFiles has a hash fallback for collisions, and the addon has no way
// to reproduce it, so a collision would ship a Report button that 404s.
//
// "zone" is reserved for a zone's own line, so a subzone slugging to it collides
// with its own parent.
//------------------------------------------------------------------------------

const byParent = new Map();
if (base) {
  let parent = null;
  for (const m of base.subSrc.matchAll(/^\t\[(\d+)\] = \{$|^\t\t\["([^"]*)"\] = \{$/gm)) {
    if (m[1] !== undefined) {
      parent = Number(m[1]);
      byParent.set(parent, []);
    } else if (parent !== null) {
      byParent.get(parent).push(m[2]);
    }
  }
}

for (const [parent, keys] of byParent) {
  const taken = new Map([["zone", "(the zone's own line)"]]);
  for (const key of keys) {
    const slug = slugFor(key);
    const other = taken.get(slug);
    if (other !== undefined) {
      note(`Subzones.lua: [${parent}] "${key}" and ${other} both slug to "${slug}" -- report URLs collide`);
    }
    taken.set(slug, `"${key}"`);
  }
}

//------------------------------------------------------------------------------
// Lua/JS parity
//
// Core.lua reimplements normaliseKey and naming.mjs's slugFor in Lua. If either
// drifts, lookups silently miss and report links point at nothing, so check the
// Lua source still performs the same steps in the same order.
//------------------------------------------------------------------------------

const coreSrc = await readFile(join(ROOT, "addons/Spoken_Places/Core.lua"), "utf8");
const expectedSteps = [
  /key = name:lower\(\)/,
  /key = key:gsub\("'", ""\)/,
  /key = key:gsub\("\^the%s\+", ""\)/,
  /key = key:gsub\("\[\^a-z0-9\]\+", " "\)/,
];
for (const step of expectedSteps) {
  if (!step.test(coreSrc)) {
    note(`Core.lua: NormaliseAreaKey no longer matches lib/wiki.mjs normaliseKey (missing ${step})`);
  }
}

const expectedSlugSteps = [
  /slug = areaKey:gsub\("%s\+", "-"\)/,
  /slug = slug:gsub\("\[\^a-z0-9%-\]", ""\)/,
];
for (const step of expectedSlugSteps) {
  if (!step.test(coreSrc)) {
    note(`Core.lua: ReportURL no longer matches voice/naming.mjs slugFor (missing ${step})`);
  }
}

//------------------------------------------------------------------------------
// Report
//------------------------------------------------------------------------------

if (problems.length) {
  console.error(`FAIL -- ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ! ${p}`);
  process.exit(1);
}

for (const [lang, corpus] of corpora) {
  const kb = ((corpus.zonesSrc.length + corpus.subSrc.length) / 1024).toFixed(1);
  console.log(
    `OK -- ${lang}: ${corpus.zoneIDs.length} zones, ${corpus.subKeys.length} subzones ` +
      `across ${corpus.subParents.length} zones (${kb} KB), all keys canonical`
  );
}
for (const [lang, covered] of aliasCounts) {
  const pct = baseKeys.size ? ((covered / baseKeys.size) * 100).toFixed(0) : "0";
  console.log(`     ${lang} aliases: ${covered} of ${baseKeys.size} subzone keys reachable (${pct}%)`);
}
console.log("     no era leaks, report slugs unique, Lua/JS normalisation, slugging and locales in step");
