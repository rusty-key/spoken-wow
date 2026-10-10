#!/usr/bin/env node
// Writes tools/seed/zone-regions.json from the Classic Era client's map tables.
//
//   node tools/fetch-zone-regions.mjs                     # pinned build
//   node tools/fetch-zone-regions.mjs --build 1.15.9.69109
//
// What lib/zone-at.mjs places a spawn with, because the server leaves its zone columns at 0:
// the rectangle each zone's map covers in world coordinates, and the explored-area overlays
// drawn on it, each under the zone its area belongs to. The rectangles are map frames and
// overlap heavily (the Crossroads is inside Durotar's), so the overlays are what decides.
// Committed, so the site answers "which zone?" offline.

import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { fetchTable, PINNED_BUILD } from "./lib/db2.mjs";
import { ROOT } from "./lib/wiki.mjs";

const SEED = join(ROOT, "pipelines/zones/tools/seed/zone-regions.json");
const ZONE = "3"; // UiMap.Type: continents and the world map would contain every zone

const argv = process.argv.slice(2);
const build = argv.includes("--build") ? argv[argv.indexOf("--build") + 1] : PINNED_BUILD;

async function main() {
  console.log(`fetching the map tables for ${build}`);
  const table = (name) => fetchTable(name, { build });
  const maps = new Map((await table("UiMap")).map((row) => [row.ID, row]));
  const assignments = (await table("UiMapAssignment")).filter((row) => maps.get(row.UiMapID)?.Type === ZONE);

  // A subzone's area is under its zone's: ParentAreaID, up to one a zone map is assigned to.
  const areaZone = new Map(assignments.filter((row) => Number(row.AreaID) > 0).map((row) => [row.AreaID, Number(row.UiMapID)]));
  const parent = new Map((await table("AreaTable")).map((row) => [row.ID, row.ParentAreaID]));
  const zoneOfArea = (area) => {
    for (let a = area, hops = 0; a && a !== "0" && hops < 5; a = parent.get(a), hops++) {
      if (areaZone.has(a)) return areaZone.get(a);
    }
    return undefined;
  };

  const artZone = new Map((await table("UiMapXMapArt")).map((row) => [row.UiMapArtID, row.UiMapID]));
  const artStyle = new Map((await table("UiMapArt")).map((row) => [row.ID, row.UiMapArtStyleID]));
  const styleSize = new Map(
    (await table("UiMapArtStyleLayer")).map((row) => [row.UiMapArtStyleID, [Number(row.LayerWidth), Number(row.LayerHeight)]]),
  );
  const canvas = new Map([...artZone].map(([art, uiMap]) => [uiMap, styleSize.get(artStyle.get(art))]));
  const overlays = new Map();
  for (const row of await table("WorldMapOverlay")) {
    const uiMap = artZone.get(row.UiMapArtID);
    const zone = zoneOfArea(row.AreaID_0);
    if (!uiMap || !zone) continue;
    const list = overlays.get(uiMap) ?? [];
    list.push({
      zone,
      left: Number(row.OffsetX),
      top: Number(row.OffsetY),
      width: Number(row.TextureWidth),
      height: Number(row.TextureHeight),
    });
    overlays.set(uiMap, list);
  }

  const regions = [];
  for (const row of assignments) {
    const [x0, y0, x1, y1] = [row.Region_0, row.Region_1, row.Region_3, row.Region_4].map(Number);
    const size = canvas.get(row.UiMapID);
    if (!size) throw new Error(`no map art size for ${row.UiMapID}`);
    regions.push({
      uiMapID: Number(row.UiMapID),
      name: maps.get(row.UiMapID).Name_lang,
      mapID: Number(row.MapID),
      x: [Math.min(x0, x1), Math.max(x0, x1)],
      y: [Math.min(y0, y1), Math.max(y0, y1)],
      canvas: size,
      overlays: overlays.get(row.UiMapID) ?? [],
    });
  }
  if (regions.length === 0) throw new Error("no zone regions: did the UiMap format change?");
  regions.sort((a, b) => a.uiMapID - b.uiMapID);

  const seed = {
    _comment: [
      "Each zone map's rectangle in world coordinates, and the explored-area overlays drawn",
      "on it in canvas pixels, each under the zone its area belongs to. From the client's",
      "UiMap, UiMapAssignment, WorldMapOverlay and AreaTable via wago.tools. What",
      "lib/zone-at.mjs places a spawn with. Regenerate with:  node tools/fetch-zone-regions.mjs",
    ],
    build,
    regions,
  };
  // An overlay or a coordinate pair to a line, so a rebuild's diff reads per overlay.
  const json = JSON.stringify(seed, null, 2).replace(/[[{][^[\]{}]*[\]}]/g, (flat) => flat.replace(/\s*\n\s*/g, " "));
  await writeFile(SEED, json + "\n");
  console.log(`wrote ${SEED}: ${regions.length} zone regions from build ${build}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
