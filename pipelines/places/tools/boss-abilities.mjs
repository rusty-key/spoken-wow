#!/usr/bin/env node
// What each boss casts, from the Abilities of its warcraft.wiki.gg article (CC BY-SA 4.0): the spell ids in its
// {{Abilities|name|text|icon=|id=}} lines that are the boss's own: under its heading (or every phase of its
// fight where no heading names it), not under another creature's name, and not marked for another season.
//
// Usage: node tools/boss-abilities.mjs <out.json>      out.json: [{ map, key, name, title, spells: [ids] }]
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { flat, readBosses } from "../../lib/bosses.mjs";
import { cachedQuery, creatureTitles, isDisambiguation, ROOT } from "./lib/wiki.mjs";

// A heading that is a variant of the fight or a crowd with it, by whole words: "Petrification" is no pet.
const CROWD = /\b(?:seasons?|hardcore|heroic|mythic|adds?|guards?|protectors?|minions?|trash|pets?)\b/i;
// A heading that is not a boss: a crowd, or one phase of the fight.
const NOT_BOSS = new RegExp(`${CROWD.source}|\\bphase\\b`, "i");
// A heading that parts one fight rather than naming who casts: a phase or form, the shared or unique abilities,
// the original fight where the page also has Classic Timewalking's.
const PART = /\bphase\b|\bform$|^(?:shared |unique )?abilities$|^original$/i;
// A bold bullet that labels the lines under it rather than naming a creature: "Note:".
const LABEL = /:$|^(?:notes?|tips?|warnings?|strategy)\b/i;
// Season of Mastery's brands on Ebonroc and Flamegor: never in Forever.
const OTHER_SEASON = /\(\s*Season of Mastery only\s*\)/i;
const TEMPLATE = /\{\{abilities\|/i;

/** Wiki markup to plain words: [[a|b]] -> b, bold and italics dropped. */
const plain = (s) =>
  s
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/'{2,}/g, "")
    .trim();

/** The name (first unnamed parameter) of the line's {{Abilities}} template, markup kept. */
function templateName(line) {
  const body = line.slice(line.search(TEMPLATE) + "{{abilities|".length);
  let depth = 0;
  let field = "";
  for (const c of body) {
    if (c === "[" || c === "{") depth++;
    if (c === "]" || c === "}") {
      if (depth === 0) break;
      depth--;
    }
    if (c === "|" && depth === 0) {
      if (!/^\s*[\w ]+=/.test(field)) return field.trim();
      field = "";
    } else field += c;
  }
  return /^\s*[\w ]+=/.test(field) ? "" : field.trim();
}

// What a phase or form heading stands for: the boss itself, whoever's lines came before it.
const BOSS_AGAIN = Symbol("boss");

/** The creature a line stands for, where it is a name on its own: '''Ohgan''', ;[[Jank]], ====Sir Zeliek====.
 * BOSS_AGAIN where it names a phase or form of the fight, null where it names nothing or only labels the lines under it. */
function ownerOf(line) {
  const m = line.match(/^'''(.+?)'''\s*:?\s*$/) ?? line.match(/^;\s*(.+?)\s*$/) ?? line.match(/^={4,}\s*(.+?)\s*={4,}\s*$/);
  const name = m && plain(m[1]);
  if (!name) return null;
  return PART.test(name) ? BOSS_AGAIN : LABEL.test(name) ? null : name;
}

/** A bullet whose sub-bullets are another creature's: a name on its own, a creature linked with no spell id, a
 * summon. An ability named by a link to its spell has an id, and is the boss's. */
function namesCreature(line) {
  const alone = line.match(/^\*+\s*'''(.+?)'''\s*:?\s*$/) ?? line.match(/^\*+\s*('{2,3})?(\[\[[^\]]+\]\])\1\s*:?\s*$/);
  if (alone) {
    const name = plain(alone.at(-1));
    return !PART.test(name) && !LABEL.test(name);
  }
  if (!TEMPLATE.test(line)) return false;
  const name = templateName(line);
  return (name.includes("[[") && !/\bid=\d/i.test(line)) || /^summon\b/i.test(name);
}

/** A name as its words, each without punctuation: "Jin'do the Hexxer" is jindo, the, hexxer. */
const wordsOf = (s) => s.split(/\s+/).map(flat).filter(Boolean);

/** Where `needle` stands in `words` as a run of whole words, -1 where it does not. */
function findWords(words, needle) {
  if (!needle.length) return -1;
  return words.findIndex((_, i) => needle.every((w, j) => words[i + j] === w));
}

/** The ids of one part of the section, the lines of creatures other than `name` left out. */
function idsOfPart(chunk, mine) {
  const lines = chunk.split(/\r?\n/);
  const owners = lines.map(ownerOf);
  const bossNamed = owners.some((o) => typeof o === "string" && mine(o));
  const groups = new Map([[null, []]]);
  let owner = null;
  let bold = false; // `owner` was named on a bold line
  let boss = null; // the boss's own name on the page, where a heading gives it
  let stack = [];
  for (const [i, line] of lines.entries()) {
    if (owners[i]) {
      owner = owners[i] === BOSS_AGAIN ? boss : owners[i];
      if (typeof owner === "string" && mine(owner)) boss = owner;
      bold = line.startsWith("'''");
      stack = [];
      continue;
    }
    const depth = line.match(/^\*+/)?.[0].length ?? 0;
    // A blank line or prose does not end the list its sub-bullets belong to.
    if (depth === 0 && !TEMPLATE.test(line)) continue;
    while (stack.length && stack.at(-1).depth >= depth) stack.pop();
    const under = stack.some((s) => s.other);
    if (depth) stack.push({ depth, other: namesCreature(line) || OTHER_SEASON.test(line) });
    // Another creature's lines are left out where a line names the boss, and under a bold name where none does: the
    // members of a fight of several are named by a ; line or a heading.
    if (under || OTHER_SEASON.test(line) || (owner !== null && !mine(owner) && (bossNamed || bold))) continue;
    if (!groups.has(owner)) groups.set(owner, []);
    groups.get(owner).push(...[...line.matchAll(/\{\{abilities\|[^\n]*?\bid=(\d+)/gi)].map((m) => Number(m[1])));
  }
  // An encounter of several (The Ugly Goblin's five goblins): one of each in turn, so the cap leaves none out.
  const [first, ...rest] = [...groups.values()];
  const out = [...first];
  for (let k = 0; rest.some((ids) => k < ids.length); k++) for (const ids of rest) if (k < ids.length) out.push(ids[k]);
  return out;
}

/** The spell ids of the article's Abilities that belong to `name`. */
export function abilities(text, name) {
  const section = text.match(/^==\s*Abilities\s*==\s*$([\s\S]*?)(?=^==[^=]|(?![\s\S]))/m);
  if (!section) return [];
  const bossWords = wordsOf(name);
  // The boss's name and the heading's, one inside the other by whole words ("Mandokir" in "Bloodlord Mandokir"),
  // but not "Son of Hakkar" or "Onyxian Whelps": an add named after its boss is not the boss.
  const mine = (s) => {
    const words = wordsOf(plain(s));
    const at = findWords(words, bossWords);
    if (at >= 0) return !(words[at - 1] === "of" || (words[at - 1] === "the" && words[at - 2] === "of"));
    return findWords(bossWords, words) >= 0;
  };
  const parts = section[1].split(/^===(?!=)\s*(.+?)\s*===\s*$/m);
  const headings = [];
  for (let i = 1; i < parts.length; i += 2) headings.push({ heading: parts[i], chunk: parts[i + 1] });
  const named = headings.filter((h) => mine(h.heading));
  const own = named.length
    ? named
    : headings.filter(
        (h) => (PART.test(h.heading) && !CROWD.test(h.heading)) || (headings.length === 1 && !NOT_BOSS.test(h.heading)),
      );
  return [...new Set([parts[0], ...own.map((h) => h.chunk)].flatMap((chunk) => idsOfPart(chunk, mine)))];
}

async function wikitext(title) {
  const query = `action=parse&format=json&formatversion=2&redirects=1&prop=wikitext&page=${encodeURIComponent(title)}`;
  const { json } = await cachedQuery(query, `${title}#wikitext`);
  return json?.parse ? { text: json.parse.wikitext, title: json.parse.title } : null;
}

async function main() {
  // boss-sources.json: for each boss the wiki pages the research found (wikiTitle, abilityTitle) and its
  // creature ids. The pages tried first.
  const hints = new Map(
    JSON.parse(await readFile(join(ROOT, "pipelines/places/tools/boss-sources.json"), "utf8")).map((h) => [`${h.map}\t${h.key}`, h]),
  );
  const out = [];
  const bosses = await readBosses();
  for (const [n, boss] of bosses.entries()) {
    process.stdout.write(`\r  ${n + 1}/${bosses.length}`);
    const hint = hints.get(`${boss.map}\t${boss.key}`);
    const titles = [hint?.abilityTitle, hint?.wikiTitle, ...creatureTitles(boss.name)].filter(Boolean);
    for (const title of [...new Set(titles)]) {
      let page;
      try {
        page = await wikitext(title);
      } catch {
        continue;
      }
      if (!page || isDisambiguation(page.text)) continue;
      const spells = abilities(page.text, boss.name);
      if (spells.length) {
        out.push({ map: boss.map, key: boss.key, name: boss.name, title: page.title, spells });
        break;
      }
    }
  }
  process.stdout.write("\n");
  await writeFile(process.argv[2], JSON.stringify(out, null, 1));
  console.log(`${out.length} of ${bosses.length} bosses have abilities in their article -> ${process.argv[2]}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
