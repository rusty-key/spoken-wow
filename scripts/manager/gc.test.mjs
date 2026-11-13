import { test } from "node:test";
import assert from "node:assert/strict";

import { generateKeys, sealJson, sha256Text } from "./sign.mjs";
import { memoryStore } from "./store.mjs";
import { gc, revTime } from "./gc.mjs";

const keys = generateKeys();
const quiet = () => {};
const DAY = 86400000;

// Twelve revs of one pack, a month apart, each with its own blob; the index points at the newest.
async function history() {
  const store = memoryStore();
  const revs = [];
  for (let i = 0; i < 12; i++) {
    const rev = `2025${String(i + 1).padStart(2, "0")}01T000000Z`;
    revs.push(rev);
    const blob = `blob-${i}`;
    await store.put(`blobs/${sha256Text(blob)}`, blob);
    const sealed = sealJson({ packId: "P", rev, files: [{ path: "a", sha256: sha256Text(blob), size: blob.length }] }, keys.privateKey);
    await store.put(`packs/P/${rev}.json`, sealed.text);
  }
  const last = revs.at(-1);
  await store.put("index.json", sealJson({ generatedAt: "", packs: { P: { rev: last } } }, keys.privateKey).text);
  for (const o of store.objects.values()) o.lastModified = new Date(0);
  return { store, revs };
}

test("revTime reads a rev as UTC", () => {
  assert.equal(revTime("20261018T142233Z"), Date.UTC(2026, 9, 18, 14, 22, 33));
});

test("keeps the last ten revs and their blobs; drops the rest", async () => {
  const { store, revs } = await history();
  const { deleted } = await gc({ store, signingKey: keys.privateKey, now: new Date("2027-01-01T00:00:00Z"), log: quiet });
  assert.deepEqual(deleted.sort(), [
    `blobs/${sha256Text("blob-0")}`, `blobs/${sha256Text("blob-1")}`,
    `packs/P/${revs[0]}.json`, `packs/P/${revs[1]}.json`,
  ].sort());
  assert.ok(store.objects.has(`packs/P/${revs[2]}.json`));
});

test("keeps every rev younger than ninety days", async () => {
  const { store } = await history();
  const { deleted } = await gc({ store, signingKey: keys.privateKey, now: new Date("2025-03-01T00:00:00Z"), log: quiet });
  assert.deepEqual(deleted, []);
});

test("never deletes a blob younger than a day, even unreferenced", async () => {
  const { store } = await history();
  await store.put("blobs/fresh", "uploading");
  const { deleted } = await gc({ store, signingKey: keys.privateKey, now: new Date(Date.now() + DAY / 2), log: quiet });
  assert.ok(!deleted.includes("blobs/fresh"));
});

test("a dry run deletes nothing", async () => {
  const { store } = await history();
  const before = store.objects.size;
  const { deleted } = await gc({ store, signingKey: keys.privateKey, now: new Date("2027-01-01T00:00:00Z"), dryRun: true, log: quiet });
  assert.equal(deleted.length, 4);
  assert.equal(store.objects.size, before);
});
