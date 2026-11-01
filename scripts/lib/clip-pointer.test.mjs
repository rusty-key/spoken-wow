import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { pointerText, readPointer, writePointers } from "./clip-pointer.mjs";

const dir = () => mkdtempSync(join(tmpdir(), "pointers-"));
const SHA = "a".repeat(64);
const head = (status, length) => async () => new Response(null, { status, headers: length ? { "content-length": String(length) } : {} });

test("a pointer reads back as the object it names", async () => {
  const file = join(dir(), "1.mp3");
  writeFileSync(file, pointerText(SHA, 123));
  assert.deepEqual(await readPointer(file), { sha256: SHA, size: 123, key: `takes/${SHA}` });
});

test("a real clip is not a pointer, however small", async () => {
  const file = join(dir(), "1.mp3");
  writeFileSync(file, "ID3 and not much else");
  assert.equal(await readPointer(file), null);
  writeFileSync(file, Buffer.alloc(5000, "x"));
  assert.equal(await readPointer(file), null);
});

test("writePointers records each clip's size from the archive", async () => {
  const target = join(dir(), "1.mp3");
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push([url, init.method]);
    return head(200, 77)();
  };
  const missing = await writePointers([{ sha256: SHA, target }], "https://archive.example", { fetchImpl, log: () => {} });
  assert.deepEqual(missing, []);
  assert.deepEqual(urls, [[`https://archive.example/takes/${SHA}`, "HEAD"]]);
  assert.equal(readFileSync(target, "utf8"), pointerText(SHA, 77));
});

test("writePointers reports a clip the archive does not have, and writes nothing for it", async () => {
  const target = join(dir(), "1.mp3");
  const missing = await writePointers([{ sha256: SHA, target }], "https://archive.example/", { fetchImpl: head(404), log: () => {} });
  assert.deepEqual(missing, [{ target, reason: "HTTP 404" }]);
  await assert.rejects(readPointer(target));
});

test("writePointers will not record a clip of unknown size", async () => {
  const target = join(dir(), "1.mp3");
  const missing = await writePointers([{ sha256: SHA, target }], "https://archive.example/", { fetchImpl: head(200), log: () => {} });
  assert.deepEqual(missing, [{ target, reason: "the archive gave no size" }]);
});
