// The zone a point in the world stands in, as a uiMapID.
//
// From seed/zone-regions.json, because the server leaves its zone columns at 0. The zone
// maps' rectangles overlap heavily (the Crossroads is inside Durotar's), so where several
// hold the point a city's wins, then whichever zone owns most of the explored-area overlays
// drawn under it, the smaller subzone on a tie. A heuristic: the client keeps the true area
// of a point only in its terrain.

import seed from "../seed/zone-regions.json" with { type: "json" };

// A dungeon or hall is its own map with no zone rectangle: under the zone its entrance is in.
export const INSTANCE_ZONE = {
  33: 1421, // Shadowfang Keep: Silverpine Forest
  34: 1453, // The Stockade: Stormwind City
  36: 1436, // The Deadmines: Westfall
  43: 1413, // Wailing Caverns: The Barrens
  47: 1413, // Razorfen Kraul: The Barrens
  48: 1440, // Blackfathom Deeps: Ashenvale
  70: 1418, // Uldaman: Badlands
  90: 1426, // Gnomeregan: Dun Morogh
  109: 1435, // The Temple of Atal'Hakkar: Swamp of Sorrows
  129: 1413, // Razorfen Downs: The Barrens
  189: 1420, // Scarlet Monastery: Tirisfal Glades
  209: 1446, // Zul'Farrak: Tanaris
  229: 1427, // Blackrock Spire: Searing Gorge
  230: 1427, // Blackrock Depths: Searing Gorge
  249: 1445, // Onyxia's Lair: Dustwallow Marsh
  289: 1422, // Scholomance: Western Plaguelands
  309: 1434, // Zul'Gurub: Stranglethorn Vale
  329: 1423, // Stratholme: Eastern Plaguelands
  349: 1443, // Maraudon: Desolace
  389: 1454, // Ragefire Chasm: Orgrimmar
  409: 1427, // Molten Core: Searing Gorge
  429: 1444, // Dire Maul: Feralas
  449: 1453, // Champion's Hall: Stormwind City
  450: 1454, // Hall of Legends: Orgrimmar
  469: 1427, // Blackwing Lair: Searing Gorge
  509: 1451, // Ruins of Ahn'Qiraj: Silithus
  531: 1451, // Temple of Ahn'Qiraj: Silithus
  533: 1423, // Naxxramas: Eastern Plaguelands
};

/** Every zone with a rectangle: { uiMapID, name, mapID, x, y, canvas, overlays }. */
export const ZONE_REGIONS = seed.regions;

const area = (region) => (region.x[1] - region.x[0]) * (region.y[1] - region.y[0]);
const smallest = (regions) => regions.reduce((best, region) => (area(region) < area(best) ? region : best));

/** The overlays of a region's map that cover the point, as the zones they belong to. */
function overlaysAt(region, x, y) {
  // North is +x and west is +y, so the map's left edge is the largest y and its top the largest x.
  const px = ((region.y[1] - y) / (region.y[1] - region.y[0])) * region.canvas[0];
  const py = ((region.x[1] - x) / (region.x[1] - region.x[0])) * region.canvas[1];
  return region.overlays.filter((o) => px >= o.left && px <= o.left + o.width && py >= o.top && py <= o.top + o.height);
}

/** The uiMapID at (map, x, y), or undefined where no zone covers it. */
export function zoneAt(map, x, y) {
  if (INSTANCE_ZONE[map]) return INSTANCE_ZONE[map];
  const holding = ZONE_REGIONS.filter(
    (r) => r.mapID === map && x >= r.x[0] && x <= r.x[1] && y >= r.y[0] && y <= r.y[1],
  );
  if (holding.length <= 1) return holding[0]?.uiMapID;
  // A city's map has no overlays, and lies inside the zone around it.
  const cities = holding.filter((r) => r.overlays.length === 0);
  if (cities.length) return smallest(cities).uiMapID;

  // zone -> how many overlays under the point name it, and the smallest of them in world units
  const votes = new Map();
  for (const region of holding) {
    const scale = area(region) / (region.canvas[0] * region.canvas[1]);
    for (const overlay of overlaysAt(region, x, y)) {
      const size = overlay.width * overlay.height * scale;
      const vote = votes.get(overlay.zone) ?? { count: 0, size };
      votes.set(overlay.zone, { count: vote.count + 1, size: Math.min(vote.size, size) });
    }
  }
  if (votes.size === 0) return smallest(holding).uiMapID;
  // An even count goes to the smaller subzone: a few zones are one overlay the size of the map.
  return [...votes].sort(([, a], [, b]) => b.count - a.count || a.size - b.size)[0][0];
}
