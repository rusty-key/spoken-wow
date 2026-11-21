// The area a point stands in, read from a TrinityCore server's extracted .map files.
//
// Each file is one 533.33-yard tile of a map, named {map:04}_{gx:02}_{gy:02}.map, and its AREA
// chunk holds a 16x16 grid of AreaTable ids: the same grid the server answers "which zone am I
// in" from. A zone's UiMapAssignment rectangle is only its bounding box, and those overlap along
// every border, so a town at a zone's edge (Darkshire, Ratchet) fell into its neighbour.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const GRID = 533.3333333;
// map_fileheader: mapMagic, versionMagic, buildMagic, areaMapOffset, areaMapSize, ...
const AREA_OFFSET = 12;
// map_areaHeader.flags: the whole tile is one area, held in the header, with no grid after it.
const NO_AREA_GRID = 0x0001;

// What one tile file holds: a single area id, or the 256 of its grid.
export function readTile(buffer) {
  const offset = buffer.readUInt32LE(AREA_OFFSET);
  if (buffer.toString("latin1", offset, offset + 4) !== "AREA") throw new Error("no AREA chunk");
  const flags = buffer.readUInt16LE(offset + 4);
  const gridArea = buffer.readUInt16LE(offset + 6);
  if (flags & NO_AREA_GRID) return gridArea;
  const grid = new Array(256);
  for (let i = 0; i < 256; i++) grid[i] = buffer.readUInt16LE(offset + 8 + i * 2);
  return grid;
}

// The tile a point is on, and its cell inside that tile, as the server computes them
// (GridMap::getArea).
export function cellOf(x, y) {
  const gx = 63 - Math.floor(x / GRID + 32);
  const gy = 63 - Math.floor(y / GRID + 32);
  const cx = Math.floor(16 * (32 - x / GRID)) & 15;
  const cy = Math.floor(16 * (32 - y / GRID)) & 15;
  return { gx, gy, cell: cx * 16 + cy };
}

// areaAt(map, x, y) -> the AreaTable id there, or undefined where no tile was extracted.
export function areaReader(dir) {
  if (!existsSync(dir)) throw new Error(`no map files at ${dir} (set PLACES_MAPS to the server's maps folder)`);
  const tiles = new Map();
  return function areaAt(map, x, y) {
    const { gx, gy, cell } = cellOf(x, y);
    const name = `${String(map).padStart(4, "0")}_${String(gx).padStart(2, "0")}_${String(gy).padStart(2, "0")}.map`;
    if (!tiles.has(name)) {
      const file = join(dir, name);
      tiles.set(name, existsSync(file) ? readTile(readFileSync(file)) : null);
    }
    const tile = tiles.get(name);
    if (tile === null) return undefined;
    const area = typeof tile === "number" ? tile : tile[cell];
    return area || undefined;
  };
}
