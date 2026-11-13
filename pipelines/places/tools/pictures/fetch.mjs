#!/usr/bin/env node
// Fetches a picture for every zone and area page from warcraft.wiki.gg, preferring one the wiki
// marks as Classic over the lead image, which is often a later expansion's. Writes manifest.json
// (page, file, licence, author) and the downloads to cache/pictures/raw/; prepare.py makes the textures.
//
// Usage: node tools/pictures/fetch.mjs [--refresh]
//   --refresh  ask the wiki again for pages already in the manifest (downloads stay cached)

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { API, CACHE, ROOT, USER_AGENT, THROTTLE_MS, sleep, readJson, readJsonIfExists } from "../lib/wiki.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(HERE, "manifest.json");
const RAW = join(CACHE, "pictures", "raw");
const DATA = join(ROOT, "addons/Spoken_Places/Data/enUS");
// Wide enough to crop a 2:1 banner from at twice the shipped size.
const THUMB_WIDTH = 1024;

const refresh = process.argv.includes("--refresh");

// Files that are never a picture of the place: maps, icons, interface art, card game art.
const NOT_A_PLACE = /(^vz-|\bmap\b|minimap|worldmap|taximap|adventuremap|globe|icon|^inv[_ ]|achievement|ability[_ ]|spell[_ ]|ui[-_ ]|banner|tcg|hearthstone|\bhs\b|card|loading ?screen|logo|\.gif$|\.svg$|portrait|faction|crest|emblem|symbol|wc[123]\b|warcraft ?(i|ii|iii|3)\b|\bw3\b|\broc\b|\btft\b|reign of chaos|frozen throne|old hatreds|pre-?wow|\brpg\b|wrpg|concept|chronicle|cinematic|artwork|key ?art|\bart\b|illustration|exploring azeroth|comic|manga|novel|painting|sketch|wallpaper|promo|glowei)/i;
// Files the wiki names as the place before Cataclysm.
const CLASSIC = /(classic|vanilla|pre-?cata)/i;
// Files named for a later expansion.
const LATER = /(mists|pandaria|draenor|\bwod\b|legion|\bbfa\b|battle for azeroth|shadowlands|dragonflight|war within|midnight|\btbc\b|\bwotlk\b|\bmop\b|\bdf\b|\bsl\b|8\.\d|9\.\d|10\.\d|11\.\d)/i;
// Files named for Cataclysm, which reshaped most of the old world: refused, except in the zones
// it left as they were (UNCHANGED, by uiMapID), where its screenshots show the Classic place.
const CATACLYSM = /(cataclysm|cata\d|\bcata\b|post-?cata)/i;
const UNCHANGED = new Set([1412, 1438, 1429, 1430, 1449, 1450, 1452, 1455, 1456, 1457, 1458]);
// Azeroth and the continents have no picture: their pages carry maps, not views of a place.
const NO_PICTURE = new Set(["zone-947", "zone-1414", "zone-1415"]);
// A picture chosen by hand after looking (choices.json beside this script): the wiki file to use
// for a place, or null for none.
const CHOICES = join(HERE, "choices.json");

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    await sleep(THROTTLE_MS);
    if (res.ok) return res.json();
    if (attempt >= 3) throw new Error(`${res.status} for ${url}`);
    await sleep(2000 * (attempt + 1));
  }
}

// Every entry with a wiki source: { id, parent, key, name, title }.
export async function entries() {
  const out = [];
  const zones = await readFile(join(DATA, "Zones.lua"), "utf8");
  let id;
  for (const line of zones.split(/\r?\n/)) {
    const open = line.match(/^\t\[(\d+)\] = \{/);
    if (open) id = open[1];
    const source = line.match(/source = "https:\/\/warcraft\.wiki\.gg\/wiki\/([^"]+)"/);
    if (source && id) out.push({ id: `zone-${id}`, parent: Number(id), title: decodeURIComponent(source[1]).replace(/_/g, " ") });
  }
  const subzones = await readFile(join(DATA, "Subzones.lua"), "utf8");
  let parent, key;
  for (const line of subzones.split(/\r?\n/)) {
    const open = line.match(/^\t\[(\d+)\] = \{/);
    if (open) parent = open[1];
    const sub = line.match(/^\t\t\["([^"]+)"\] = \{/);
    if (sub) key = sub[1];
    const source = line.match(/source = "https:\/\/warcraft\.wiki\.gg\/wiki\/([^"]+)"/);
    if (source && parent && key) {
      out.push({
        id: `${parent}-${key.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
        parent: Number(parent), key, title: decodeURIComponent(source[1]).replace(/_/g, " "),
      });
      key = undefined;
    }
  }
  return out;
}

// For each title: its lead image and every image it uses, following redirects.
export async function pageImages(titles) {
  const found = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const alias = new Map(batch.map((t) => [t, t]));
    let cont = {};
    for (;;) {
      const json = await api({ action: "query", prop: "pageimages|images", piprop: "name", imlimit: "max",
        redirects: "1", titles: batch.join("|"), ...cont });
      const q = json.query || {};
      for (const n of q.normalized || []) alias.set(n.to, alias.get(n.from) ?? n.from);
      for (const r of q.redirects || []) alias.set(r.to, alias.get(r.from) ?? r.from);
      for (const page of q.pages || []) {
        const original = [...alias].find(([to]) => to === page.title)?.[1] ?? page.title;
        const entry = found.get(original) || { lead: null, images: [] };
        if (page.pageimage) entry.lead = `File:${page.pageimage.replace(/_/g, " ")}`;
        for (const im of page.images || []) entry.images.push(im.title);
        found.set(original, entry);
      }
      if (!json.continue) break;
      cont = json.continue;
    }
    process.stdout.write(`\r  pages ${Math.min(i + 50, titles.length)}/${titles.length}`);
  }
  process.stdout.write("\n");
  return found;
}

// A page's pictures by preference: those named Classic, then the lead image, then other photos,
// leaving out art from outside the game and any named for a later expansion.
function candidates(page, parent) {
  if (!page) return [];
  const later = (f) => LATER.test(f) || (!UNCHANGED.has(parent) && CATACLYSM.test(f));
  const usable = (f) => /\.(jpe?g|png|webp)$/i.test(f) && !NOT_A_PLACE.test(f.replace(/^File:/, "")) && !later(f);
  const photos = page.images.filter(usable);
  const out = photos.filter((f) => CLASSIC.test(f)).map((file) => ({ file, era: "classic" }));
  if (page.lead && usable(page.lead)) out.push({ file: page.lead, era: "lead" });
  for (const file of photos) out.push({ file, era: "other" });
  const seen = new Set();
  return out.filter((c) => !seen.has(c.file) && seen.add(c.file));
}
// Smaller than this is a map marker or a thumbnail, not a picture of the place; narrower than
// MIN_ASPECT is a portrait or a poster, which no 2:1 banner can be cut from.
const MIN_WIDTH = 600, MIN_HEIGHT = 300, MIN_ASPECT = 1.25;
const fits = (i) => i && i.width >= MIN_WIDTH && i.height >= MIN_HEIGHT && i.width / i.height >= MIN_ASPECT;

export async function imageInfo(files) {
  const info = new Map();
  for (let i = 0; i < files.length; i += 50) {
    const json = await api({ action: "query", prop: "imageinfo", iiprop: "url|size|extmetadata",
      iiurlwidth: String(THUMB_WIDTH), iiextmetadatafilter: "LicenseShortName|Artist|Credit",
      titles: files.slice(i, i + 50).join("|") });
    const q = json.query || {};
    const alias = new Map((q.normalized || []).map((n) => [n.to, n.from]));
    for (const page of q.pages || []) {
      const ii = page.imageinfo?.[0];
      if (!ii) continue;
      const meta = ii.extmetadata || {};
      const strip = (v) => (v?.value || "").replace(/<[^>]+>/g, "").trim();
      info.set(alias.get(page.title) ?? page.title, {
        url: ii.thumburl || ii.url, width: ii.width, height: ii.height, page: ii.descriptionurl,
        license: strip(meta.LicenseShortName), artist: strip(meta.Artist) || strip(meta.Credit),
      });
    }
    process.stdout.write(`\r  files ${Math.min(i + 50, files.length)}/${files.length}`);
  }
  process.stdout.write("\n");
  return info;
}

/** A wiki file's picture in cache/pictures/raw/, downloaded once: { raw: its name there, or null
 * where the wiki refused it, fetched: whether it was downloaded now }. Named for the wiki file, so a
 * page that comes to choose another picture downloads it. */
export async function downloadRaw(file, url) {
  const ext = (url.match(/\.(jpe?g|png|webp)(?:$|\?)/i)?.[1] || "jpg").toLowerCase();
  const raw = `${file.replace(/^File:/, "").replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9]+/g, "_")}.${ext}`;
  const path = join(RAW, raw);
  if (existsSync(path)) return { raw, fetched: false };
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  await sleep(THROTTLE_MS);
  if (!res.ok) {
    console.warn(`\n  ${res.status} ${url}`);
    return { raw: null, fetched: false };
  }
  await writeFile(path, Buffer.from(await res.arrayBuffer()));
  return { raw, fetched: true };
}

async function main() {
  const all = await entries();
  const old = existsSync(MANIFEST) ? await readJson(MANIFEST) : { pictures: {} };
  const todo = refresh ? all : all.filter((e) => !old.pictures[e.id]);
  console.log(`${all.length} entries, ${todo.length} to ask the wiki about`);

  const pages = await pageImages([...new Set(todo.map((e) => e.title))]);
  const choices = await readJsonIfExists(CHOICES);
  const options = new Map(todo.map((e) => [e.id, candidates(pages.get(e.title), e.parent)]));
  // A file chosen by hand is asked about even where the rules turned it down.
  for (const e of todo) {
    const pick = choices[e.id];
    if (pick && !options.get(e.id).some((c) => c.file === pick)) options.get(e.id).unshift({ file: pick, era: "chosen" });
  }
  const files = [...new Set([...options.values()].flat().map((c) => c.file))];
  const info = await imageInfo(files);
  const chosen = new Map();
  for (const e of todo) {
    let pick = null;
    if (NO_PICTURE.has(e.id) || choices[e.id] === null) pick = null;
    else if (choices[e.id]) pick = options.get(e.id).find((c) => c.file === choices[e.id]) || null;
    else pick = options.get(e.id).find((c) => fits(info.get(c.file))) || null;
    chosen.set(e.id, pick);
  }

  const pictures = { ...old.pictures };
  for (const e of todo) {
    const c = chosen.get(e.id);
    const i = c && info.get(c.file);
    // The others that pass, for choosing another by hand (choices.json).
    const others = options.get(e.id).filter((o) => o.file !== c?.file && fits(info.get(o.file))).map((o) => o.file);
    pictures[e.id] = i
      ? { parent: e.parent, key: e.key, title: e.title, file: c.file, era: c.era, ...i, others }
      : { parent: e.parent, key: e.key, title: e.title, file: null, others };
  }

  await mkdir(RAW, { recursive: true });
  let fetched = 0;
  for (const [id, p] of Object.entries(pictures)) {
    if (!p.file) continue;
    const got = await downloadRaw(p.file, p.url);
    if (got.raw) p.raw = got.raw;
    if (got.fetched) process.stdout.write(`\r  downloaded ${++fetched}`);
  }
  process.stdout.write("\n");

  const ordered = Object.fromEntries(Object.entries(pictures).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(MANIFEST, JSON.stringify({ source: "https://warcraft.wiki.gg", pictures: ordered }, null, 2) + "\n");
  const values = Object.values(ordered);
  const count = (era) => values.filter((p) => p.era === era).length;
  console.log(`pictures: ${values.filter((p) => p.file).length}/${values.length} ` +
    `(classic ${count("classic")}, lead ${count("lead")}, other ${count("other")}), none ${values.filter((p) => !p.file).length}`);
}

// Run, unless imported (gallery.mjs uses the functions above).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
