import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { pointerText, readPointer } from "./clip-pointer.mjs";

const dir = () => mkdtempSync(join(tmpdir(), "pointers-"));
const SHA = "a".repeat(64);

test("a pointer reads back as the object it names", async () => {
  const file = join(dir(), "1.mp3");
  writeFileSync(file, pointerText(SHA, 123));
  assert.deepEqual(await readPointer(file), { sha256: SHA, size: 123, key: `takes/${SHA}` });
});

test("a pointer can name a take's encoding", async () => {
  const file = join(dir(), "1.ogg");
  writeFileSync(file, pointerText(SHA, 123, "encodings"));
  assert.deepEqual(await readPointer(file), { sha256: SHA, size: 123, key: `encodings/${SHA}` });
});

test("a real clip is not a pointer, however small", async () => {
  const file = join(dir(), "1.mp3");
  writeFileSync(file, "ID3 and not much else");
  assert.equal(await readPointer(file), null);
  writeFileSync(file, Buffer.alloc(5000, "x"));
  assert.equal(await readPointer(file), null);
});
