import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { areaReader, cellOf, readTile } from "./area.mjs";

// A tile as the extractor writes it: a header whose fourth word points at the AREA chunk.
function tile({ flags = 0, gridArea = 0, grid = [] } = {}) {
  const areaOffset = 40;
  const size = areaOffset + 8 + (flags & 1 ? 0 : 512);
  const buffer = Buffer.alloc(size);
  buffer.write("MAPS", 0, "latin1");
  buffer.writeUInt32LE(areaOffset, 12);
  buffer.write("AREA", areaOffset, "latin1");
  buffer.writeUInt16LE(flags, areaOffset + 4);
  buffer.writeUInt16LE(gridArea, areaOffset + 6);
  if (!(flags & 1)) grid.forEach((area, i) => buffer.writeUInt16LE(area, areaOffset + 8 + i * 2));
  return buffer;
}

test("a tile that is all one area holds it in the header", () => {
  assert.equal(readTile(tile({ flags: 1, gridArea: 42 })), 42);
});

test("a tile with a grid holds 256 cells", () => {
  const grid = Array.from({ length: 256 }, (_, i) => i + 1);
  assert.deepEqual(readTile(tile({ grid })), grid);
});

test("a point's tile and cell are the server's", () => {
  // Darkshire's square in Duskwood; the tile the server files it under is 0000_51_34.map.
  const { gx, gy, cell } = cellOf(-10567, -1170);
  assert.deepEqual([gx, gy], [51, 34]);
  assert.ok(cell >= 0 && cell < 256);
});

test("areaAt reads the cell the point is in, and nothing where no tile was extracted", () => {
  const dir = mkdtempSync(join(tmpdir(), "maps-"));
  const { gx, gy, cell } = cellOf(-10567, -1170);
  const grid = new Array(256).fill(10);
  grid[cell] = 42;
  writeFileSync(join(dir, `0000_${gx}_${gy}.map`), tile({ grid }));
  const areaAt = areaReader(dir);
  assert.equal(areaAt(0, -10567, -1170), 42);
  assert.equal(areaAt(1, -10567, -1170), undefined);
});

test("a missing maps folder is an error, not an empty answer", () => {
  assert.throws(() => areaReader(join(tmpdir(), "no-such-maps-folder")), /PLACES_MAPS/);
});
