#!/usr/bin/env node
// Fetches pictures of the bosses from warcraft.wiki.gg, the way fetch.mjs does the zones': for each
// boss in addons/Spoken_NPCs/Data/Bosses.lua, the wiki page of that name, its pictures ranked by
// whether the file is named for the boss, and the best few downloaded to cache/pictures/raw/. Writes
// bosses.json (page, file, licence, author) and, with --folders, a folder per boss under
// <dir>\<dungeon>\<boss>\ with the candidates, the best one marked "[picked] ", for choosing by hand
// before the AI pass.
//
// Usage: node tools/pictures/fetch-bosses.mjs [--folders <dir>] [--per-boss 3] [--no-mark] [--only "<boss>"]
//   --no-mark  leave every candidate unmarked, for choosing among them all by hand

import { writeFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CACHE } from "../lib/wiki.mjs";
import { downloadRaw, pageImages, imageInfo } from "./fetch.mjs";
import { flat, readBosses } from "../../../lib/bosses.mjs";
import { loadDungeons } from "../../../lib/dungeons.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(HERE, "bosses.json");
const RAW = join(CACHE, "pictures", "raw");

const args = process.argv.slice(2);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const FOLDERS = value("--folders");
const PER_BOSS = Number(value("--per-boss") ?? 3);
const ONLY = value("--only");
const MARK = !args.includes("--no-mark");

// Files that are never a picture of the boss: icons, interface art, cards, other games, logos.
const NOT_A_BOSS = /(icon|^inv[_ ]|achievement|ability[_ ]|spell[_ ]|ui[-_ ]|banner|tcg|hearthstone|\bhs\b|\bcard|logo|\.gif$|\.svg$|\bmap\b|minimap|worldmap|faction|crest|emblem|symbol|wc[123]\b|warcraft ?(i|ii|iii|3)\b|\bw3\b|\broc\b|\btft\b|mercenar|chronicle|cinematic|comic|manga|novel|painting|sketch|wallpaper|promo|costume|\btoy\b|statue|figure|funko|plush|loot|quest|button|header|tooltip|loading ?screen|journal|\bpet\b|mount|\bhero\b|battlegrounds|cosmetic|transmog|set ?-|armor|weapon|tabard|lego|vinyl|diorama|diablo|overwatch|starcraft|heroes of the storm|\bhots\b|legion ?remix|timewalking|wowhead)/i;
// Named for a later expansion's version of the boss.
const LATER = /(mists|pandaria|draenor|\bwod\b|legion|\bbfa\b|battle for azeroth|shadowlands|dragonflight|war within|midnight|\bcata\b|cata\d|cataclysm|\bdf\b|\bsl\b|\bmop\b|8\.\d|9\.\d|10\.\d|11\.\d)/i;
const SOFT = /(concept|artwork|illustration|\bart\b|key ?art|render)/i;
const MIN_SIDE = 300;



/** The page's files, best first: named for the boss, then the lead image; none the rules turn down. */
function candidates(page, name) {
  if (!page) return [];
  const wanted = flat(name);
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  const usable = (f) => /\.(jpe?g|png|webp)$/i.test(f) && !NOT_A_BOSS.test(f.replace(/^File:/, "")) && !LATER.test(f);
  const score = (f, lead) => {
    const base = flat(f.replace(/^File:/, "").replace(/\.[^.]+$/, ""));
    let s = 0;
    if (base.includes(wanted)) s += 100;
    else if (words.length && words.filter((w) => base.includes(w)).length >= Math.ceil(words.length / 2)) s += 60;
    if (lead) s += 20;
    if (/classic|vanilla/i.test(f)) s += 10;
    if (SOFT.test(f)) s -= 15;
    return s;
  };
  const files = [...new Set([...(page.lead ? [page.lead] : []), ...page.images])].filter(usable);
  return files
    .map((file) => ({ file, score: score(file, file === page.lead) }))
    .filter((c) => c.score >= 40)
    .sort((a, b) => b.score - a.score);
}

async function main() {
  const { dungeons } = loadDungeons();
  const bosses = (await readBosses()).filter((b) => !ONLY || b.name === ONLY);
  const titles = [...new Set(bosses.map((b) => b.name))];
  console.log(`${bosses.length} bosses, ${titles.length} pages`);
  const pages = await pageImages(titles);

  const options = new Map(bosses.map((b) => [`${b.map}/${b.key}`, candidates(pages.get(b.name), b.name)]));
  const files = [...new Set([...options.values()].flatMap((list) => list.slice(0, PER_BOSS + 3).map((c) => c.file)))];
  const info = await imageInfo(files);
  const fits = (i) => i && i.width >= MIN_SIDE && i.height >= MIN_SIDE;

  const pictures = {};
  for (const b of bosses) {
    const id = `${b.map}/${b.key}`;
    const picks = options.get(id).filter((c) => fits(info.get(c.file))).slice(0, PER_BOSS);
    pictures[id] = { map: b.map, key: b.key, name: b.name, files: picks.map((c) => ({ file: c.file, score: c.score, ...info.get(c.file) })) };
  }

  await mkdir(RAW, { recursive: true });
  let fetched = 0;
  for (const p of Object.values(pictures)) {
    for (const f of p.files) {
      const got = await downloadRaw(f.file, f.url);
      if (got.raw) f.raw = got.raw;
      if (got.fetched) process.stdout.write(`\r  downloaded ${++fetched}`);
    }
  }
  process.stdout.write("\n");

  if (FOLDERS) {
    const safe = (s) => s.replace(/[<>:"/\\|?*]/g, "").trim();
    for (const p of Object.values(pictures)) {
      const where = join(FOLDERS, safe(dungeons[p.map]?.name ?? String(p.map)), safe(p.name));
      await mkdir(where, { recursive: true });
      for (const [n, f] of p.files.entries()) {
        if (!f.raw) continue;
        const name = `${MARK && n === 0 ? "[picked] " : ""}${f.file.replace(/^File:/, "").replace(/[<>:"/\\|?*]/g, "")}`;
        const dest = join(where, name.replace(/\.[^.]+$/, "") + "." + f.raw.split(".").pop());
        if (!existsSync(dest)) await copyFile(join(RAW, f.raw), dest);
      }
    }
  }

  await writeFile(MANIFEST, JSON.stringify({ source: "https://warcraft.wiki.gg", pictures }, null, 2) + "\n");
  const values = Object.values(pictures);
  const none = values.filter((p) => p.files.length === 0);
  console.log(`bosses with a picture: ${values.length - none.length}/${values.length}`);
  console.log("none: " + none.map((p) => `${p.map}/${p.name}`).join(", "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
