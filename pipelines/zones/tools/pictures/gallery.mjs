#!/usr/bin/env node
// Downloads every picture on each zone's and area's warcraft.wiki.gg pages into a folder per
// place, to choose from by eye: the page the lore cites (often "<Zone> (Classic)") and the main
// page, which carries far more (concept art, every expansion's screenshots):
// <out>/<Zone>/<Place>/<wiki file name>. The picture fetch.mjs chose is prefixed "[picked] ".
// Only icons, animations and pictures under MIN_WIDTH wide are left out. This is browsing
// material only: what ships is the reviewed Azeroth/... tree prepare.py reads.
//
// Usage: node tools/pictures/gallery.mjs [out]   (default: ~/Desktop/Zone picture choices)

import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CACHE, ROOT, USER_AGENT, THROTTLE_MS, sleep, readJson, stripClassicSuffix } from "../lib/wiki.mjs";
import { entries, pageImages, imageInfo } from "./fetch.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || join(homedir(), "Desktop", "Zone picture choices");
const STORE = join(CACHE, "pictures", "gallery");
const MIN_WIDTH = 300;

const safe = (s) => s.replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, " ").trim();

async function main() {
  const all = await entries();
  const manifest = (await readJson(join(HERE, "manifest.json"))).pictures;
  const zones = await readFile(join(ROOT, "addons/Spoken_Zones/Data/enUS/Zones.lua"), "utf8");
  const zoneName = new Map([...zones.matchAll(/\[(\d+)\] = \{\s*\n\s*name = "([^"]+)"/g)].map((m) => [Number(m[1]), m[2]]));

  // The main page beside the Classic one the lore cites: "Arathi Highlands (Classic)" has 41
  // pictures, "Arathi Highlands" 137.
  const titles = (e) => [e.title, stripClassicSuffix(e.title)];
  const pages = await pageImages([...new Set(all.flatMap(titles))]);
  const imagesOf = (e) => [...new Set(titles(e).flatMap((t) => pages.get(t)?.images || []))];
  // Logos (WoW Classic's, Warcraft III's) sit on many place pages and are never a picture of one.
  const pictureFile = (f) => /\.(jpe?g|png|webp)$/i.test(f) && !/(^File:.*_\d\d\.png$|icon|logo)/i.test(f);
  const files = [...new Set([...pages.values()].flatMap((p) => p.images.filter(pictureFile)))];
  console.log(`${files.length} pictures on ${pages.size} pages`);
  const info = await imageInfo(files);

  await mkdir(STORE, { recursive: true });
  let fetched = 0, placed = 0;
  for (const e of all) {
    const images = imagesOf(e);
    if (!images.length) continue;
    const zone = safe(zoneName.get(e.parent) || String(e.parent));
    const place = e.id.startsWith("zone-") ? `${zone} (the zone)` : safe(stripClassicSuffix(e.title));
    const dir = join(OUT, zone, place);
    const picked = manifest[e.id]?.file;
    for (const file of images.filter(pictureFile)) {
      const i = info.get(file);
      if (!i || i.width < MIN_WIDTH) continue;
      const name = safe(file.replace(/^File:/, ""));
      const stored = join(STORE, name);
      if (!existsSync(stored)) {
        const res = await fetch(i.url, { headers: { "User-Agent": USER_AGENT } });
        await sleep(THROTTLE_MS);
        if (!res.ok) { console.warn(`\n  ${res.status} ${i.url}`); continue; }
        await writeFile(stored, Buffer.from(await res.arrayBuffer()));
        fetched++;
      }
      await mkdir(dir, { recursive: true });
      await copyFile(stored, join(dir, (file === picked ? "[picked] " : "") + name));
      placed++;
      process.stdout.write(`\r  downloaded ${fetched}, placed ${placed}`);
    }
  }
  process.stdout.write("\n");
  console.log(`done: ${OUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
