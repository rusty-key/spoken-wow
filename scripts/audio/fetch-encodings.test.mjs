import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

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

// Needs a migrated database (TEAMS_TEST_DB, e.g. postgres:///spoken_ci_pin); skipped without one.
test("reads only the privileged team's takes of the language", { skip: !process.env.TEAMS_TEST_DB }, () => {
  const database = process.env.TEAMS_TEST_DB;
  const psql = (sql) => execFileSync("psql", [database, "-tA", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: sql, encoding: "utf8" });
  const lang = "qaQA";
  const clean = `delete from "take" where "lang" = '${lang}';
                 delete from "take_encoding" where "sha256" like 'teamtest-%';
                 delete from "team" where "slug" in ('teamtest-owner', 'teamtest-other');`;
  psql(clean);
  try {
    psql(`insert into "team" ("slug", "name") values ('teamtest-owner', 'Owner'), ('teamtest-other', 'Other');
          insert into "team_language" ("teamId", "lang", "privileged")
            select "id", '${lang}', "slug" = 'teamtest-owner' from "team" where "slug" like 'teamtest-%';
          insert into "take" ("source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes", "sha256", "teamId")
            select 'quests', '${lang}', t."slug" || '.mp3', t."slug", 1, true, 'generated', 1, 'teamtest-' || t."slug", t."id"
              from "team" t where t."slug" like 'teamtest-%';
          insert into "take_encoding" ("source", "sha256", "profile", "encodedSha256", "bytes")
            select 'quests', 'teamtest-' || "slug", 'ogg-q0-44k', 'enc-' || "slug", 1 from "team" where "slug" like 'teamtest-%';`);
    assert.deepEqual(liveEncodings(database, lang), [{ sha256: "teamtest-teamtest-owner", encodedSha256: "enc-teamtest-owner" }]);
  } finally {
    psql(clean.replace(/delete from "team" where.*$/s, `delete from "team_language" where "lang" = '${lang}';
      delete from "team" where "slug" in ('teamtest-owner', 'teamtest-other');`));
  }
});
