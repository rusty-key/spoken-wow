#!/usr/bin/env node
// What a release is called and what changed in it, for the Discord announcement.
//
//   node scripts/lib/announce.mjs <tag>     {"name", "version", "notes"} or {"skip": "<why>"}
//
// THE NOTES ARE THE CHANGELOG, NOT THE RELEASE BODY. Three different things write a release's
// body -- GitHub's generated PR list for most addons, release-template.md's download tables for
// quests, the changelog for the sound packs -- and the generated list runs from the previous tag
// of ANY addon, so it would announce a quests pack's PRs under Spoken. The changelog is
// written for players and is what CurseForge and Wago already show.
//
// The name is the store page's, so Discord says exactly what the stores say. A pack's page names
// its tag in `release:` (packs.mjs); the four addon pages are matched by their directory, which
// is the tag prefix. spoken's directory also holds the meta addons, Spoken: English (all.md) and
// each language's (all-<lang>.md), whose pages have no `section` either.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseFrontmatter } from "./frontmatter.mjs";
import { changelogSection, isLanguageHeading, loadPacks } from "./packs.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const ADDONS = ["spoken", "quests", "places", "readables"];

// Which `## <version> ...` heading in the section's CHANGELOG.md is this release's. The addon
// and its English audio share one file and, in places and readables, one heading shape, so the
// kind words are what tell them apart: quests says `— player` / `— sound pack(s)` or `— Spoken
// Quests Audio`, places marks its audio `— audio` or `(sound packs)`. Readables numbers its
// English audio with the addon, so a readables-audio tag takes whichever heading carries its version.
const AUDIO_WORDS = /\b(audio|sound packs?)\b/i;

function addonHeading(section) {
  if (section === "quests") return (l) => /\bplayer\b/i.test(l);
  return (l) => !AUDIO_WORDS.test(l);
}

function englishAudioHeading(section) {
  if (section === "quests" || section === "places") return (l) => AUDIO_WORDS.test(l);
  return () => true;
}

// The section's body, without its heading: the embed title already names the version.
function sectionFor(text, version, matches) {
  const lines = text.split("\n");
  const starts = lines.flatMap((l, i) =>
    l.startsWith(`## ${version} `) && !isLanguageHeading(l) && matches(l) ? [i] : []);
  if (starts.length !== 1) return null;
  let end = lines.length;
  for (let i = starts[0] + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) { end = i; break; }
  }
  return lines.slice(starts[0] + 1, end).join("\n").trim();
}

function addonName(publishersDir, prefix) {
  let pages;
  try {
    pages = readdirSync(join(publishersDir, prefix)).filter((f) => f.endsWith(".md") && !/^all(-.+)?\.md$/.test(f));
  } catch {
    return null;
  }
  for (const file of pages.sort()) {
    const { meta } = parseFrontmatter(readFileSync(join(publishersDir, prefix, file), "utf8"), file);
    if (meta.section === undefined) return meta.name;
  }
  return null;
}

export function announcement(tag, { publishersDir = join(ROOT, "publishers"), docsDir = join(ROOT, "docs") } = {}) {
  const match = tag.match(/^(.+)\/v(\d+\.\d+\.\d+)$/);
  if (!match) return { skip: `${tag} is not <release>/vX.Y.Z` };
  const [, prefix, version] = match;

  const pack = loadPacks(publishersDir).find((p) => p.release === prefix);
  let name, section, notes;
  if (pack) {
    ({ name, section } = pack);
    const text = readFileSync(join(docsDir, section, "CHANGELOG.md"), "utf8");
    if (pack.lang === "enUS") {
      notes = sectionFor(text, version, englishAudioHeading(section));
    } else {
      try {
        notes = changelogSection(text, version, prefix).split("\n").slice(1).join("\n").trim();
      } catch {
        notes = null;
      }
    }
  } else if (ADDONS.includes(prefix)) {
    name = addonName(publishersDir, prefix);
    section = prefix;
    notes = sectionFor(readFileSync(join(docsDir, section, "CHANGELOG.md"), "utf8"), version, addonHeading(section));
  }
  // Legacy and freeze tags have no public addon behind them; a name a player cannot find is
  // worse than no announcement.
  if (!name) return { skip: `no publishers page for ${tag}` };
  return { name, version, notes };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const [tag] = process.argv.slice(2);
    if (!tag) throw new Error("usage: announce.mjs <tag>");
    console.log(JSON.stringify(announcement(tag)));
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(1);
  }
}
