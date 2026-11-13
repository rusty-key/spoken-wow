import { mkdirSync, mkdtempSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildManifest, caseDuplicate, diffFiles, hashFolder, isSafePath, revOf } from "./manifest.mjs";

function folder(files) {
  const dir = mkdtempSync(join(tmpdir(), "manifest-"));
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(dir, ...p.split("/").slice(0, -1)), { recursive: true });
    writeFileSync(join(dir, ...p.split("/")), text);
  }
  return dir;
}

test("hashFolder lists every file by its / path, sorted, and skips dotfiles", async () => {
  const dir = folder({ "b.toc": "toc", "generated/sounds/1.ogg": "abc", ".DS_Store": "x" });
  const files = await hashFolder(dir, new Map());
  assert.deepEqual(files.map((f) => f.path), ["b.toc", "generated/sounds/1.ogg"]);
  assert.equal(files[1].sha256, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(files[1].size, 3);
});

test("hashFolder trusts the cache when size, mtime and ctime match", async () => {
  const dir = folder({ "a.ogg": "abc" });
  const cache = new Map();
  await hashFolder(dir, cache);
  const [key, hit] = [...cache][0];
  cache.set(key, { ...hit, sha256: "f".repeat(64) });
  assert.equal((await hashFolder(dir, cache))[0].sha256, "f".repeat(64));
});

test("hashFolder reads a file again whose content changed under a restored mtime", async () => {
  const dir = folder({ "a.ogg": "abc" });
  const cache = new Map();
  await hashFolder(dir, cache);
  const file = join(dir, "a.ogg");
  const { mtime } = statSync(file);
  await new Promise((r) => setTimeout(r, 20));
  writeFileSync(file, "xyz");
  utimesSync(file, mtime, mtime);
  assert.equal((await hashFolder(dir, cache))[0].sha256, "3608bca1e44ea6c4d268eb6db02260269892c0b42b86bbf1e77a6fa16c3c9282");
});

test("unsafe paths are refused", () => {
  for (const p of ["", "/a", "C:/a", "a/../b", "..", "a\\b", "a/b.", "a/ b ", "a//b", "CON", "con.ogg", "a/NUL.txt", "Sounds/com1.ogg", "lpt9"]) assert.equal(isSafePath(p), false, p);
  for (const p of ["a.ogg", "generated/sounds/quests/20-accept.ogg", "x~Voice.ogg", "console.ogg", "COM0.ogg", "a/com10.ogg"]) assert.equal(isSafePath(p), true, p);
});

test("buildManifest totals the files", () => {
  const m = buildManifest({ packId: "P", rev: "20261018T000000Z", requires: { Spoken: ">=3.0.0" },
    files: [{ path: "a", sha256: "1", size: 2 }, { path: "b", sha256: "2", size: 3 }] });
  assert.equal(m.fileCount, 2);
  assert.equal(m.totalSize, 5);
});

test("diffFiles counts added, changed and removed paths", () => {
  const before = [{ path: "a", sha256: "1" }, { path: "b", sha256: "2" }];
  const after = [{ path: "a", sha256: "1" }, { path: "b", sha256: "3" }, { path: "c", sha256: "4" }];
  assert.deepEqual(diffFiles(before, after), { added: 1, changed: 1, removed: 0, same: false });
  assert.equal(diffFiles(before, before).same, true);
});

test("revOf is UTC to the second", () => {
  assert.equal(revOf(new Date("2026-10-18T14:22:33.456Z")), "20261018T142233Z");
});

test("a path repeated apart from case is found", () => {
  assert.equal(caseDuplicate([{ path: "a/x.ogg" }, { path: "b.ogg" }, { path: "A/X.ogg" }]), "A/X.ogg");
  assert.equal(caseDuplicate([{ path: "a.ogg" }, { path: "b.ogg" }]), null);
});
