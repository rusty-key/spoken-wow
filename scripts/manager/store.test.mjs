import { test } from "node:test";
import assert from "node:assert/strict";

import { ConflictError, memoryStore, r2Store, strongEtag } from "./store.mjs";

test("memoryStore honours If-Match and If-None-Match", async () => {
  const s = memoryStore();
  await s.put("k", "a", { ifNoneMatch: "*" });
  await assert.rejects(s.put("k", "b", { ifNoneMatch: "*" }), ConflictError);
  const { etag } = await s.head("k");
  await assert.rejects(s.put("k", "b", { ifMatch: '"nope"' }), ConflictError);
  await s.put("k", "b", { ifMatch: etag });
  assert.equal((await s.get("k")).body.toString(), "b");
});

test("memoryStore lists by prefix and deletes", async () => {
  const s = memoryStore();
  await s.put("blobs/1", "x");
  await s.put("packs/P/1.json", "y");
  assert.deepEqual((await s.list("blobs/")).map((o) => o.key), ["blobs/1"]);
  await s.delete("blobs/1");
  assert.equal(await s.head("blobs/1"), null);
});

test("r2Store names every missing variable", () => {
  assert.throws(() => r2Store({ R2_BUCKET: "b" }), /R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY/);
});

test("r2Store survives a dropped connection", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    if (++calls === 1) throw new TypeError("fetch failed");
    return new Response(null, { status: 200, headers: { etag: '"abc"' } });
  });
  const store = r2Store(
    { R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "b" },
    { wait: async () => {} },
  );
  assert.deepEqual(await store.head("blobs/1"), { etag: '"abc"' });
  assert.equal(calls, 2);
});

test("strongEtag drops the weak prefix R2 puts on compressed JSON", () => {
  assert.equal(strongEtag('W/"abc"'), '"abc"');
  assert.equal(strongEtag('"abc"'), '"abc"');
  assert.equal(strongEtag(null), null);
});
