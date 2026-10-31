#!/usr/bin/env node
// The sound packs, read off their store pages.
//
// A pack is a page under publishers/<group>/ whose frontmatter names a `section`. Every other
// page is an addon's. So the pages are the registry: which language has which pack, and which
// store project and GitHub tag it is released under. Adding a language is pages, not code --
// every build and release script asks this module rather than keeping a table of its own,
// which is what a case block per script per language turned into the moment there was a second
// language.
//
//   node scripts/lib/packs.mjs list <section> <lang> [github|curseforge] pack keys, or "-"; never dormant
//   node scripts/lib/packs.mjs get <section> <lang> <pack|-> <field>     one field
//   node scripts/lib/packs.mjs changelog <file> <version> <release>      a pack's notes
//   node scripts/lib/packs.mjs meta <lang> <field>                       a language's meta addon
//
// WHAT IS DERIVED AND WHAT IS WRITTEN. The folder and the release tag are rules, not fields:
// English's are the names players already have installed, and a language's are those plus its
// code. The page still writes `release:`, because descriptions.mjs links a Wago reader to it,
// and this checks the page agrees with the rule rather than trusting either.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BASE_LOCALE, CODES } from "../../pipelines/lib/locales.mjs";
import { parseFrontmatter } from "./frontmatter.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const PUBLISHERS_DIR = join(ROOT, "publishers");

export const SECTIONS = ["quests", "places", "readables", "bosses"];

// tts_cli/factions.py PACK_SUFFIXES, for the four that ship to CurseForge.
const QUESTS_PACKS = { alliance: "Alliance", horde: "Horde", shared: "Shared", gossip: "Gossip" };
// English's `all` is a BUNDLE, released on GitHub alone: one zip holding the four split packs'
// own folders, exactly as CurseForge installs them. CurseForge will not take a file that size,
// and its All project is the meta addon that pulls in the four instead, so the one page
// describes both and each store gets what it can carry. Being the same folders, the two channels
// overwrite each other rather than installing every line twice, and the player needs to know no
// fifth pack. Its `folder` names the zip only (SpokenQuestsAudioAll-<version>.zip): no folder of
// that name is ever built, and the bare SpokenQuestsAudio-<version>.zip is the meta addon's.
const ENGLISH_QUESTS_PACKS = { ...QUESTS_PACKS, all: "All" };
const ENGLISH_QUESTS_BUNDLE = Object.values(QUESTS_PACKS).map((suffix) => "SpokenQuestsAudio" + suffix);
// A language may instead ship its quests as one pack holding every line: one folder is one answer
// to "which do I install", and a GitHub release takes a file up to 2 GB. CurseForge does not take
// one that size, so a language that goes there later is split into the four. Being the only pack,
// it carries no suffix: SpokenQuestsAudio_frFR, released as quests-audio-frFR.
const LANGUAGE_QUESTS_PACKS = { ...QUESTS_PACKS, all: "" };

export function englishFolder(section, pack) {
  if (section === "places") return "SpokenPlacesAudio";
  if (section === "readables") return "SpokenReadablesAudio";
  if (section === "bosses") return "SpokenBossesAudio";
  return "SpokenQuestsAudio" + ENGLISH_QUESTS_PACKS[pack];
}

export function languageFolder(section, pack) {
  if (section !== "quests") return englishFolder(section, pack);
  return "SpokenQuestsAudio" + LANGUAGE_QUESTS_PACKS[pack];
}

function englishRelease(section, pack) {
  if (section !== "quests") return `${section}-audio`;
  return pack === "all" ? "quests-audio" : `quests-audio-${pack}`;
}

/**
 * The folder a voice-acted overlay pack ships in: the section's English pack name plus
 * "Acted", plus the language's code like any language pack. One per section and language,
 * quests included -- an overlay carries only the recorded lines, which nowhere near needs
 * splitting by faction. Not on any store yet, so a rule and not a page (scripts/audio/acted.mjs).
 *
 * The prefix matters to nothing in the player: quests finds a pack by its TOC's
 * DataModule-Version key, and places and readables by the registry it writes itself into.
 */
export function actedFolder(section, lang) {
  if (!SECTIONS.includes(section)) throw new Error(`no section '${section}'`);
  if (!CODES.includes(lang)) throw new Error(`no language '${lang}'`);
  // A language's single quests pack is the bare SpokenQuestsAudio, as places and readables
  // always are.
  return `${languageFolder(section, "all")}Acted${lang === BASE_LOCALE ? "" : `_${lang}`}`;
}

const NOT_A_PAGE = new Set(["README.md"]);

function pageFiles(dir) {
  const files = [];
  for (const group of readdirSync(dir).sort()) {
    const groupDir = join(dir, group);
    if (!statSync(groupDir).isDirectory()) continue;
    for (const file of readdirSync(groupDir).sort()) {
      if (file.endsWith(".md") && !NOT_A_PAGE.has(file)) files.push(join(group, file));
    }
  }
  return files;
}

function toPack(page, meta) {
  const fail = (why) => { throw new Error(`publishers/${page}: ${why}`); };
  const { section, lang } = meta;
  if (!SECTIONS.includes(section)) fail(`section '${section}' is not one of ${SECTIONS.join(", ")}`);
  if (!CODES.includes(lang)) fail(`lang '${lang}' is not one of ${CODES.join(", ")}`);

  const english = lang === BASE_LOCALE;
  const pack = meta.pack ?? null;
  const allowed = english ? ENGLISH_QUESTS_PACKS : LANGUAGE_QUESTS_PACKS;
  if (section === "quests" && !(pack in allowed)) {
    fail(`a ${lang} quests pack needs pack: one of ${Object.keys(allowed).join(", ")}`);
  }
  if (section !== "quests" && pack !== null) fail(`only a quests pack has a pack key`);

  const version = meta.version ?? null;
  if (!english && !/^\d+\.\d+\.\d+$/.test(version ?? "")) {
    fail(`a ${lang} pack needs version: x.y.z (English's comes from its .toc)`);
  }
  if (english && version !== null) fail(`an English pack's version is its .toc's, not the page's`);

  const release = englishRelease(section, pack) + (english ? "" : `-${lang}`);
  if (meta.release !== release) fail(`release should be ${release}, not ${meta.release}`);

  // No `curseforge` until the project exists: a pack can go out on GitHub before it has one.
  for (const key of ["slug", "name"]) if (!meta[key]) fail(`missing '${key}'`);

  // `bundledIn: <slug>` is a pack with no CurseForge project of its own, whose folder ships in the
  // zip of the pack with that slug (the bosses inside Spoken Audio: Places and Bosses), so a
  // player sent to CurseForge for it is sent there. loadPacks checks the slug names a pack on
  // CurseForge.
  if (meta.bundledIn !== undefined && meta.curseforge !== undefined) {
    fail(`a pack is on CurseForge either as its own project or bundledIn another's, not both`);
  }

  // `github: false` keeps a pack off GitHub: English's four split packs, since the single `all`
  // pack is what GitHub offers. Everything else goes there, where the ceiling is 2 GB a file.
  if (meta.github !== undefined && meta.github !== "false") fail(`github may only be false`);
  const github = meta.github !== "false";

  // `manager: true` puts the pack on the manager's channel (scripts/manager/), one language at a
  // time, so a language goes there only once its packs have been checked against it.
  if (meta.manager !== undefined && meta.manager !== "true") fail(`manager may only be true`);

  // A language with too few players yet for three quest packs ships two: Gossip, and a Shared
  // pack that `holds: quests` -- every quest line, both sides' included (tts_cli/factions.py
  // builds it as the 'quests' pack). Its Alliance and Horde pages stay, project ids and all, as
  // `dormant: true`: nothing builds or uploads them until the language is split, when Shared
  // goes back to holding shared quests and its players keep the folder and add their side.
  if (meta.holds !== undefined && !(meta.holds === "quests" && !english && pack === "shared")) {
    fail(`only a language's shared quests pack may say holds: quests`);
  }
  if (meta.dormant !== undefined && !(meta.dormant === "true" && !english && ["alliance", "horde"].includes(pack))) {
    fail(`only a language's alliance or horde quests pack may say dormant: true`);
  }

  const folder = english ? englishFolder(section, pack) : `${languageFolder(section, pack)}_${lang}`;
  return {
    page, section, lang, pack, version, github,
    build: meta.holds ?? pack, dormant: meta.dormant === "true", manager: meta.manager === "true",
    curseforge: meta.curseforge ?? null, bundledIn: meta.bundledIn ?? null, wago: meta.wago ?? null, release,
    bundles: english && section === "quests" && pack === "all" ? ENGLISH_QUESTS_BUNDLE : null,
    slug: meta.slug, name: meta.name, folder,
    zip: english ? null : `${folder}-${version}.zip`,
    tag: english ? null : `${release}/v${version}`,
  };
}

export function loadPacks(dir = PUBLISHERS_DIR) {
  const packs = [];
  for (const page of pageFiles(dir)) {
    const { meta } = parseFrontmatter(readFileSync(join(dir, page), "utf8"), page);
    if (meta.section === undefined) continue;
    packs.push(toPack(page, meta));
  }
  const seen = new Map();
  for (const p of packs) {
    const key = `${p.section}/${p.lang}/${p.pack ?? "-"}`;
    if (seen.has(key)) throw new Error(`two pages for one pack (${key}): publishers/${seen.get(key)} and publishers/${p.page}`);
    seen.set(key, p.page);
  }
  for (const p of packs.filter((p) => p.bundledIn !== null)) {
    const home = packs.find((h) => h.slug === p.bundledIn);
    if (!home || home.curseforge === null || home.lang !== p.lang) {
      throw new Error(`publishers/${p.page}: bundledIn ${p.bundledIn} is not an ${p.lang} pack on CurseForge`);
    }
  }
  // Shared holding every quest and a side's own pack would ship that side's lines twice; Shared
  // holding only shared quests with a side dormant would ship them nowhere.
  for (const shared of packs.filter((p) => p.section === "quests" && p.pack === "shared")) {
    for (const side of packs.filter((p) => p.section === "quests" && p.lang === shared.lang &&
      ["alliance", "horde"].includes(p.pack))) {
      if (side.dormant !== (shared.build === "quests")) {
        throw new Error(shared.build === "quests"
          ? `publishers/${shared.page} holds every quest, so publishers/${side.page} must be dormant: true`
          : `publishers/${side.page} is dormant, so publishers/${shared.page} must say holds: quests`);
      }
    }
  }
  return packs;
}

// A null section means every section's.
export function packsFor(section, lang, packs = loadPacks()) {
  return packs.filter((p) => (section === null || p.section === section) && p.lang === lang);
}

export function findPack(section, lang, pack, packs = loadPacks()) {
  const found = packsFor(section, lang, packs).find((p) => p.pack === (pack ?? null));
  if (!found) throw new Error(`no ${section} pack registered for ${lang}${pack ? ` (${pack})` : ""}`);
  return found;
}

// The oldest Spoken whose lookups each section's packs are built for. Bumped by hand only when a
// section's lookup format changes; scripts/manager/ refuses to publish past the latest release.
// Bosses: 3.6.0 has no boss audio, so the pack waits on the release after it.
export const MIN_SPOKEN = { quests: "3.0.0", places: "3.0.0", readables: "3.0.0", bosses: "3.7.0" };

// The folders the manager channel carries, each once: a bundle's folders, else the pack's own.
export function managerFolders(packs = loadPacks()) {
  const out = [];
  for (const p of packs) {
    if (!p.manager) continue;
    for (const folder of p.bundles ?? [p.folder]) {
      if (!out.some((o) => o.folder === folder)) out.push({ folder, section: p.section, lang: p.lang });
    }
  }
  return out;
}

// The words before the colon in a sound pack's title: "Spoken Audio" for English and, for
// another language, its meta addon's name without the colon plus "Audio" -- "Spoken: German"
// gives "Spoken German Audio" -- so a language is spelled the way its store pages spell it.
export function audioFamily(lang, dir = PUBLISHERS_DIR) {
  if (lang === BASE_LOCALE) return "Spoken Audio";
  const page = join("spoken", `all-${lang.toLowerCase()}.md`);
  const { meta } = parseFrontmatter(readFileSync(join(dir, page), "utf8"), page);
  return `${meta.name.replace(/^Spoken: /, "Spoken ")} Audio`;
}

// A language's meta addon, "Spoken: <Language>": publishers/spoken/all-<lang>.md, the language's
// counterpart of Spoken: English (scripts/spoken/package-meta.sh). Not a pack -- the page has
// no `section` -- but its dependencies are the packs, so they are read off the registry here
// rather than listed a second time: every pack of the language that is on CurseForge and not
// dormant, quests, places and readables alike. A language without a places or readables project
// simply has none to name.
export function metaFor(lang, packs = loadPacks(), dir = PUBLISHERS_DIR) {
  if (lang === BASE_LOCALE) throw new Error(`English's meta addon is spoken-all itself, not a language's`);
  const page = join("spoken", `all-${lang.toLowerCase()}.md`);
  let text;
  try { text = readFileSync(join(dir, page), "utf8"); } catch { throw new Error(`no meta addon page publishers/${page}`); }
  const { meta } = parseFrontmatter(text, page);
  const fail = (why) => { throw new Error(`publishers/${page}: ${why}`); };
  if (meta.lang !== lang) fail(`lang should be ${lang}, not ${meta.lang}`);
  if (!/^\d+\.\d+\.\d+$/.test(meta.version ?? "")) fail(`needs version: x.y.z`);
  const order = (p) => SECTIONS.indexOf(p.section) * 10 + ["alliance", "horde", "shared", "gossip"].indexOf(p.pack);
  const shipped = packsFor(null, lang, packs).filter((p) => !p.dormant && p.curseforge !== null).sort((a, b) => order(a) - order(b));
  if (!shipped.some((p) => p.section === "quests")) fail(`${lang} has no quests pack on CurseForge to depend on`);
  return {
    page, lang, version: meta.version, slug: meta.slug, name: meta.name,
    curseforge: meta.curseforge ?? null,
    folder: `SpokenAll_${lang}`, release: `spoken-all-${lang}`,
    dependencies: ["spoken", ...shipped.map((p) => p.slug)],
  };
}

// `## 1.0.0 — places-audio-esMX`: a release tag ending in a language code. English headings
// name a kind (`— audio`, `— pack`) or nothing, never a tag, so this is how an English matcher
// steps over a language pack's notes that happen to share its version number.
const LANGUAGE_HEADING = /^## \S+ — [a-z]+(?:-[a-z]+)+-[a-z]{2}[A-Z]{2}(?:\s|$)/;

export function isLanguageHeading(line) {
  return LANGUAGE_HEADING.test(line);
}

export function changelogSection(text, version, release) {
  const lines = text.split("\n");
  const heading = new RegExp(`^## ${version.replace(/\./g, "\\.")} — ${release}(?:\\s|$)`);
  const starts = lines.flatMap((l, i) => (heading.test(l) ? [i] : []));
  if (starts.length === 0) throw new Error(`no "## ${version} — ${release}" section`);
  if (starts.length > 1) throw new Error(`two "## ${version} — ${release}" sections`);
  let end = lines.length;
  for (let i = starts[0] + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) { end = i; break; }
  }
  return lines.slice(starts[0], end).join("\n").trim();
}

function main([command, ...args]) {
  if (command === "list") {
    const [section, lang, only] = args;
    // Dormant packs are never listed: the list is what gets built and released.
    if (only !== undefined && only !== "github" && only !== "curseforge") {
      throw new Error(`list filters by 'github' or 'curseforge' only, not '${only}'`);
    }
    const packs = packsFor(section, lang).filter((p) => !p.dormant &&
      (only === undefined || (only === "github" ? p.github : p.curseforge !== null)));
    if (packs.length === 0) throw new Error(`no ${section} packs registered for ${lang}${only ? ` on ${only}` : ""}`);
    for (const p of packs) console.log(p.pack ?? "-");
  } else if (command === "get") {
    const [section, lang, pack, field] = args;
    const found = findPack(section, lang, pack === "-" ? null : pack);
    if (!(field in found)) throw new Error(`no field '${field}'`);
    const value = found[field];
    console.log(Array.isArray(value) ? value.join(" ") : value ?? "");
  } else if (command === "meta") {
    const [lang, field] = args;
    const found = metaFor(lang);
    if (!(field in found)) throw new Error(`no field '${field}'`);
    const value = found[field];
    console.log(Array.isArray(value) ? value.join(" ") : value ?? "");
  } else if (command === "changelog") {
    const [file, version, release] = args;
    process.stdout.write(changelogSection(readFileSync(file, "utf8"), version, release));
  } else {
    throw new Error("usage: packs.mjs list <section> <lang> [github|curseforge] | get <section> <lang> <pack|-> <field> | changelog <file> <version> <release> | meta <lang> <field>");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(1);
  }
}
