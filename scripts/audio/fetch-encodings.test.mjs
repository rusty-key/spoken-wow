import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { seedDatabase } from "../../pipelines/lib/test-db.mjs";
import { cacheDir, fillCache, liveEncodings } from "./fetch-encodings.mjs";

const hash = (algorithm, text) => createHash(algorithm).update(text).digest("hex");

test("names the cache the way package-audio.sh does", () => {
  assert.equal(cacheDir("enUS", "/c"), "/c/ogg-q0-44k");
  assert.equal(cacheDir("deDE", "/c"), "/c/deDE-ogg-q0-44k");
});

test("lays each encoding under its master's md5, and skips what it cannot place", async () => {
  const archive = mkdtempSync(join(tmpdir(), "enc-archive-"));
  const cache = join(mkdtempSync(join(tmpdir(), "enc-cache-")), "ogg-q0-44k");
  mkdirSync(join(archive, "blobs/takes"), { recursive: true });
  writeFileSync(join(archive, "blobs/takes", hash("sha256", "master")), "master");
  const rows = [
    { sha256: hash("sha256", "master"), encodedSha256: hash("sha256", "ogg") },
    { sha256: hash("sha256", "absent"), encodedSha256: hash("sha256", "other") },
  ];

  const tally = await fillCache(rows, { archive, cache, base: "https://archive.test/", fetchImpl: async () => new Response("ogg") });

  assert.deepEqual({ ...tally, failed: tally.failed.length }, { fetched: 1, cached: 0, noMaster: 1, failed: 0 });
  assert.equal(readFileSync(join(cache, `${hash("md5", "master")}.ogg`), "utf8"), "ogg");

  const again = await fillCache(rows.slice(0, 1), { archive, cache, base: "https://archive.test/", fetchImpl: async () => new Response("x") });
  assert.equal(again.cached, 1);
  assert.equal(existsSync(join(cache, `${hash("md5", "master")}.ogg.part`)), false);
});

// Needs DATABASE_URL naming a migrated test database, as an owner that bypasses row-level
// security; skipped without one.
const seed = seedDatabase();
after(() => seed?.cleanup());

test("reads the takes of the team it names, else of the team with plain packs", { skip: seed ? false : "DATABASE_URL is not set" }, () => {
  const lang = seed.language();
  const plain = seed.team(lang);
  const other = seed.team(lang, { packName: "slug" });
  const shas = [];
  for (const team of [plain, other]) {
    const sha256 = `eq-${team.slug}`;
    shas.push(sha256);
    seed.take({ team: team.id, source: "quests", lang, file: `${team.slug}.mp3`, lineId: team.slug, sha256 });
    seed.sql(`insert into "take_encoding" ("source", "sha256", "profile", "encodedSha256", "bytes")
              values ('quests', ${seed.lit(sha256)}, 'ogg-q0-44k', ${seed.lit(`enc-${team.slug}`)}, 1)`);
  }
  seed.onCleanup(`delete from "take_encoding" where "sha256" in (${shas.map(seed.lit).join(", ")})`);
  assert.deepEqual(liveEncodings(seed.url, lang), [{ sha256: `eq-${plain.slug}`, encodedSha256: `enc-${plain.slug}` }]);
  assert.deepEqual(liveEncodings(seed.url, lang, other.slug), [{ sha256: `eq-${other.slug}`, encodedSha256: `enc-${other.slug}` }]);
});
