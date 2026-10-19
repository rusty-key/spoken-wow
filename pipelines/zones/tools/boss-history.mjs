#!/usr/bin/env node
// A boss's written history from warcraft.wiki.gg (CC BY-SA 4.0), word for word: the article's
// History / Background / Lore sections, and the lead's paragraphs that tell the character's story
// (not where it is found, what it drops or how it is fought). The era filter is the places' (lib/wiki.mjs).
//
// Usage: node tools/boss-history.mjs <packets.json> <out.json>
//   packets.json: from build-boss-stories.mjs --packets (each boss and whether the guide has its text).
//   out.json: [{ map, key, name, title, text }] for each boss that has no guide text and has a history.

import { readFile, writeFile } from "node:fs/promises";

import { cleanExtract, extractFromResponse, fetchFullExtract } from "./lib/wiki.mjs";
import { foldSections } from "./lib/sections.mjs";

const HISTORY = /^(?:history|background|lore|biography|story|origins?|description)$/i;
// A paragraph about the encounter, not the character.
const GAMEPLAY =
  /\b(?:bosse?s?|drops?|loot|quests?|spawns?|spawned|strateg\w*|tanks?|healers?|players?|raid|heroic|patch|located|patrol\w*|dungeon|encounter|achievements?|level \d+|elite|rare|hit points|abilit\w+|optional|killed|kill(?:ing)?|reward\w*|tier \d|respawn)\b/i;
const MAX_CHARS = 1800;

function paragraphs(text) {
  return text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
}

/** The history paragraphs of an article's plain text, or []. */
function history(plain) {
  const { lead, sections } = foldSections(plain);
  const out = [];
  for (const p of paragraphs(lead)) if (!GAMEPLAY.test(p) && p.length > 60) out.push(p);
  for (const s of sections) {
    if (HISTORY.test(s.heading.trim())) out.push(...paragraphs(s.text).filter((p) => p.length > 40));
  }
  return out;
}

async function story(name) {
  for (const title of [name, `${name} (boss)`, `${name} (NPC)`]) {
    const full = await fetchFullExtract(title);
    const found = extractFromResponse(full.json, title);
    if (!found) continue;
    if (/may refer to|can refer to|disambiguation/i.test(found.text.slice(0, 300))) continue;
    const kept = history(found.text);
    if (!kept.length) continue;
    const cleaned = cleanExtract(kept.join("\n\n"), { eraFilter: true }).full;
    if (cleaned.length < 120) continue;
    let text = "";
    for (const p of paragraphs(cleaned)) {
      if (text && text.length + p.length + 2 > MAX_CHARS) break;
      text = text ? text + "\n\n" + p : p;
    }
    return { title: found.resolvedTitle, text };
  }
  return null;
}

const [packetsFile, outFile] = process.argv.slice(2);
const packets = JSON.parse(await readFile(packetsFile, "utf8")).filter((p) => p.key !== "_" && !p.guide);
const out = [];
for (const [n, p] of packets.entries()) {
  process.stdout.write(`\r  ${n + 1}/${packets.length}`);
  const got = await story(p.name);
  if (got) out.push({ map: p.map, key: p.key, name: p.name, title: got.title, text: got.text });
}
process.stdout.write("\n");
await writeFile(outFile, JSON.stringify(out, null, 1));
console.log(`${out.length} of ${packets.length} bosses without guide text have a history -> ${outFile}`);
