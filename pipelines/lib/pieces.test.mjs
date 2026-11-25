import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { clipOnDisk, clipsOnDisk, onDiskAsPieces, piecesFile, readPieceLengths, writePieceLengths } from "./pieces.mjs";

function sounds() {
  const dir = mkdtempSync(join(tmpdir(), "pieces-"));
  mkdirSync(join(dir, "1411", "razor-hill"), { recursive: true });
  writeFileSync(join(dir, "1411", "razor-hill", "01.ogg"), "");
  writeFileSync(join(dir, "1411", "razor-hill", "02.ogg"), "");
  writeFileSync(join(dir, "1411", "zone.ogg"), "");
  return dir;
}

test("a folder of pieces is the one clip it plays, beside clips kept whole", async () => {
  const dir = sounds();
  try {
    assert.deepEqual((await clipsOnDisk(dir)).sort(), ["1411/razor-hill", "1411/zone"]);
    assert.equal(onDiskAsPieces(dir, "1411/razor-hill"), true);
    assert.equal(onDiskAsPieces(dir, "1411/zone"), false);
    assert.equal(clipOnDisk(dir, "1411/razor-hill") && clipOnDisk(dir, "1411/zone"), true);
    assert.equal(clipOnDisk(dir, "1411/gone"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("piece lengths go beside the pack, packed as word times, and go away with none", async () => {
  const lang = `xx${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
  await writePieceLengths("places", lang, { "1411/razor-hill": [3.441, 0.5, 12] });
  assert.deepEqual(readPieceLengths("places", lang), { "1411/razor-hill": "3.44 .5 12" });
  await writePieceLengths("places", lang, {});
  assert.equal(existsSync(piecesFile("places", lang)), false);
  assert.deepEqual(readPieceLengths("places", lang), {});
});
