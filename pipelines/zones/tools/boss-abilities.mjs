#!/usr/bin/env node
// What each boss casts, from the Abilities of its warcraft.wiki.gg article (CC BY-SA 4.0): the spell ids in its
// {{Abilities|name|text|icon=|id=}} lines, only those under the boss's own heading (or all when the
// section has no headings).
//
// Usage: node tools/boss-abilities.mjs <out.json>      out.json: [{ map, key, name, title, spells: [ids] }]
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { flat, readBosses } from "../../lib/bosses.mjs";
import { cachedQuery, creatureTitles, isDisambiguation, ROOT } from "./lib/wiki.mjs";

// boss-sources.json: for each boss the wiki pages the research found (wikiTitle, abilityTitle) and its
// creature ids. The pages tried first.
const hints = new Map(
  JSON.parse(await readFile(join(ROOT, "pipelines/zones/tools/boss-sources.json"), "utf8")).map((h) => [`${h.map}\t${h.key}`, h]),
);

// A heading that is not a boss: a variant of the fight or a crowd with it.
const NOT_BOSS = /season|hardcore|heroic|mythic|phase|adds?\b|guards?|protectors?|minions?|trash|pet/i;


async function wikitext(title) {
  const query = `action=parse&format=json&formatversion=2&redirects=1&prop=wikitext&page=${encodeURIComponent(title)}`;
  const { json } = await cachedQuery(query, `${title}#wikitext`);
  return json?.parse ? { text: json.parse.wikitext, title: json.parse.title } : null;
}

/** The spell ids of the article's Abilities that belong to `name`. */
function abilities(text, name) {
  const section = text.match(/^==\s*Abilities\s*==\s*$([\s\S]*?)(?=^==[^=]|(?![\s\S]))/m);
  if (!section) return [];
  const parts = section[1].split(/^===\s*(.+?)\s*===\s*$/m);
  const idsOf = (chunk) => [...chunk.matchAll(/\{\{Abilities\|[^\n]*?\bid=(\d+)/g)].map((m) => Number(m[1]));
  if (parts.length === 1) return idsOf(parts[0]);
  const own = [];
  for (let i = 1; i < parts.length; i += 2) {
    const heading = parts[i];
    const mine = flat(heading).includes(flat(name)) || flat(name).includes(flat(heading));
    if (mine || (!NOT_BOSS.test(heading) && parts.length === 3)) own.push(...idsOf(parts[i + 1]));
  }
  return [...new Set([...idsOf(parts[0]), ...own])];
}

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
