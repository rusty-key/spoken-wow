#!/usr/bin/env node
// Builds Data/Stories.lua for Spoken NPCs: each boss's story and each dungeon's.
//
// Sources, in order:
//   1. The game's own Adventure Guide (the retail client's JournalEncounter and JournalInstance
//      tables, wago.tools): Blizzard's text, in every language the game has.
//   2. warcraft.wiki.gg (CC BY-SA 4.0), for a boss the guide has no text for: the article's lead or its
//      lore sections, era-filtered to Classic as the zones' lore is, in English (lib/wiki.mjs: an
//      identified agent, one request every half second, cached).
//
// SpokenBossStories[instance map][boss key] = the story: a string (English) or { "English", deDE = ..,
// ... }. The key "_" holds the dungeon's own story. A boss with no text anywhere has no entry.
//
// The result is Blizzard's and the wiki's text, not the project's data: it is written for the local build
// (the Data/Stories.lua of local/game) and kept out of commits to the repository. Credit for it is in
// THIRD_PARTY.md.
//
// With --packets <file> it writes, instead of Stories.lua, the source material of every story: for each boss the
// guide's text and the wiki's, to be rewritten into one voice (tools/apply-boss-stories.mjs puts the rewritten
// text into Stories.lua). The guide and the wiki differ in length and in how they are written; the rewrite is what
// makes the stories read as one.
//
// Usage: node tools/build-boss-stories.mjs [--out <file>] [--no-wiki] [--report] [--packets <file>]

import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { STORY_MAX_CHARS, guideFinder, readBosses } from "../../lib/bosses.mjs";
import { LOCALES, loadDungeons } from "../../lib/dungeons.mjs";
import { RETAIL_BUILD, wagoTable } from "../../lib/wago.mjs";
import { ROOT, capParagraphs, creatureTitles, fetchLoreText, isDisambiguation, sourceUrl } from "./lib/wiki.mjs";
import { renderStories } from "./lib/boss-stories.mjs";

const args = process.argv.slice(2);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const OUT = value("--out") ?? join(ROOT, "addons/Spoken_NPCs/Data/Stories.lua");



/** The guide's markup out of a text: line breaks kept, colours, icons and spell templates dropped. */
function clean(text) {
  return String(text ?? "")
    .replace(/\|n/g, "\n")
    .replace(/\|c[0-9a-fA-F]{8}/g, "")
    .replace(/\|r/g, "")
    .replace(/\|T[^|]*\|t/g, "")
    .replace(/\$bullet;/gi, "- ")
    .replace(/\$@[A-Za-z]+\d*/g, "")
    .replace(/\$\d*[A-Za-z]\d*/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function journal() {
  const get = (name, locale) => wagoTable(name, { build: RETAIL_BUILD, locale });
  const tables = { enUS: { encounters: await get("JournalEncounter", "enUS"), instances: await get("JournalInstance", "enUS") } };
  for (const locale of LOCALES) {
    tables[locale] = { encounters: await get("JournalEncounter", locale), instances: await get("JournalInstance", locale) };
  }
  return tables;
}

function pack(texts) {
  const english = texts.enUS;
  if (!english) return null;
  const out = { [1]: english };
  for (const locale of LOCALES) {
    const text = texts[locale];
    if (text && text !== english) out[locale] = text;
  }
  return out;
}


/** The wiki's lore for `name`: { text, title } or null. */
async function wikiStory(name) {
  for (const title of creatureTitles(name)) {
    const res = await fetchLoreText(title, { minChars: 400 });
    if (res.missing || res.cleaned.empty || res.cleaned.full.length < 40) continue;
    if (isDisambiguation(res.cleaned.full)) continue;
    return { text: res.cleaned.full, title: res.resolvedTitle };
  }
  return null;
}

async function main() {
  const bosses = await readBosses();
  const tables = await journal();
  const known = loadDungeons();
  const dungeonNames = new Map(Object.entries({ ...known.dungeons, ...known.worldBosses }).map(([map, row]) => [Number(map), row.name]));
  const guideOf = guideFinder(tables.enUS.encounters);
  const localized = {};
  for (const locale of ["enUS", ...LOCALES]) {
    localized[locale] = new Map(tables[locale].encounters.map((r) => [r.ID, clean(r.Description_lang)]));
  }

  const stories = {};
  const sources = [];
  const gaps = [];
  for (const boss of bosses) {
    const row = guideOf(boss);
    const texts = {};
    if (row) for (const locale of ["enUS", ...LOCALES]) texts[locale] = localized[locale].get(row.ID);
    const story = texts.enUS ? pack(texts) : null;
    if (story) {
      (stories[boss.map] ??= {})[boss.key] = story;
      sources.push(`${boss.map}\t${boss.key}\tAdventure Guide`);
    } else {
      gaps.push(boss);
    }
  }

  // The dungeons' own stories.
  const instances = new Map(tables.enUS.instances.map((r) => [Number(r.MapID), r]));
  const instanceText = {};
  for (const locale of ["enUS", ...LOCALES]) {
    instanceText[locale] = new Map(tables[locale].instances.map((r) => [r.ID, clean(r.Description_lang)]));
  }
  for (const map of new Set(bosses.map((b) => b.map))) {
    const row = instances.get(map);
    if (!row) continue;
    const texts = Object.fromEntries(["enUS", ...LOCALES].map((l) => [l, instanceText[l].get(row.ID)]));
    const story = texts.enUS ? pack(texts) : null;
    if (story) {
      (stories[map] ??= {})._ = story;
      sources.push(`${map}\t_\tAdventure Guide`);
    }
  }

  if (value("--packets")) {
    const packets = [];
    for (const [n, boss] of bosses.entries()) {
      const wiki = await wikiStory(boss.name);
      const guide = stories[boss.map]?.[boss.key]?.[1] ?? null;
      process.stdout.write(`\r  packets ${n + 1}/${bosses.length}`);
      packets.push({ map: boss.map, key: boss.key, name: boss.name, dungeon: dungeonNames.get(boss.map) ?? null,
        guide, wiki: wiki ? wiki.text.slice(0, 5000) : null, wikiTitle: wiki?.title ?? null });
    }
    for (const map of new Set(bosses.map((b) => b.map))) {
      const guide = stories[map]?._?.[1];
      if (guide) packets.push({ map, key: "_", name: dungeonNames.get(map) ?? String(map), dungeon: null, guide, wiki: null, wikiTitle: null });
    }
    process.stdout.write("\n");
    await writeFile(value("--packets"), JSON.stringify(packets, null, 1));
    console.log(`${packets.length} packets in ${value("--packets")}`);
    return;
  }

  const fromGuide = bosses.length - gaps.length;
  let fromWiki = 0;
  const missing = [];
  if (!args.includes("--no-wiki")) {
    for (const [n, boss] of gaps.entries()) {
      const got = await wikiStory(boss.name);
      process.stdout.write(`\r  wiki ${n + 1}/${gaps.length}`);
      if (!got) {
        missing.push(`${boss.map}/${boss.name}`);
        continue;
      }
      const text = got.text.length > STORY_MAX_CHARS ? capParagraphs(got.text.split("\n\n"), STORY_MAX_CHARS) : got.text;
      (stories[boss.map] ??= {})[boss.key] = { [1]: text };
      sources.push(`${boss.map}\t${boss.key}\t${sourceUrl(got.title)}`);
      fromWiki++;
    }
    process.stdout.write("\n");
  } else {
    missing.push(...gaps.map((b) => `${b.map}/${b.name}`));
  }

  await writeFile(OUT, renderStories(stories));
  await writeFile(OUT.replace(/\.lua$/, ".sources.txt"), sources.join("\n") + "\n");
  console.log(`${bosses.length} bosses: ${fromGuide} from the Adventure Guide, ${fromWiki} from the wiki, ${missing.length} with none`);
  if (args.includes("--report") || missing.length) console.log("none: " + missing.join(", "));
}

await main();
