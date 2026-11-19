// Needs DATABASE_URL naming a migrated test database (spoken_ci_pin), as an owner that bypasses
// row-level security; skipped without one.
//
// A language with two teams, each holding a live take of the same line: a release's listing
// holds its own team's take alone, and a build outside a release the privileged team's.
import { execFile, execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdtempSync, readFileSync, rmdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import { seedDatabase } from "../../pipelines/lib/test-db.mjs";

const SOUNDS = join(dirname(fileURLToPath(import.meta.url)), "sounds.mjs");
const seed = seedDatabase();
const skip = seed ? false : "DATABASE_URL is not set";
const A_SHA = "a".repeat(64);
const B_SHA = "b".repeat(64);
const C_SHA = "c".repeat(64);
const ROOT = join(dirname(SOUNDS), "../..");
let lang;
let a;
let b;

before(() => {
  if (!seed) return;
  const { sql, lit } = seed;
  lang = seed.language();
  a = seed.team(lang);
  b = seed.team(lang, { packName: "slug" });
  seed.onCleanup(`delete from "entity_name" where "lang" = ${lit(lang)}`);
  seed.onCleanup(`delete from "quest_line" where "lang" = ${lit(lang)}`);

  const both = (take) => {
    seed.take({ ...take, team: a.id, sha256: A_SHA });
    seed.take({ ...take, team: b.id, sha256: B_SHA });
  };
  both({ source: "readables", lang, file: "b-1", lineId: "b:1" });

  // A quests take ships only when a current line names its file.
  const fileName = `xq-${randomInt(1e9)}`;
  sql(`insert into "quest_line" ("lineId", "lang", "version", "isCurrent", "origin", "source", "fileName", "text", "originalText")
       values ('q:1:accept', ${lit(lang)}, 1, true, 'extracted', 'quest', ${lit(fileName)}, 'Hi.', 'Hi.')`);
  both({ source: "quests", lang, file: `quests/${fileName}.mp3`, lineId: "q:1:accept" });

  // A boss take ships only for a boss that is not retired.
  const map = 900_000_000 + randomInt(1e8);
  sql(`insert into "boss_instance" ("map", "kind", "zone", "position") values (${map}, 'dungeon', 1, 1)`);
  sql(`insert into "boss" ("id", "map", "key", "position", "encounterIds") values (${map}, ${map}, 'boss', 1, '{}')`);
  seed.onCleanup(`delete from "boss_instance" where "map" = ${map}`);
  seed.onCleanup(`delete from "boss" where "map" = ${map}`);
  both({ source: "bosses", lang, file: `boss-${map}`, lineId: `boss:${map}:boss` });
});

after(() => seed?.cleanup());

function listing(section, team) {
  const env = { PATH: process.env.PATH, LOCAL_DB: seed.url, SPOKEN_ARCHIVE_URL: "https://archive.invalid/" };
  if (team) env.SPOKEN_RELEASE_TEAM = team.id;
  return execFileSync(process.execPath, [SOUNDS, "--list", `--lang=${lang}`, section], { env, encoding: "utf8" }).trim().split("\n");
}

for (const section of ["readables", "quests", "bosses"]) {
  test(`a second team's ${section} release lists its own take, not the privileged team's`, { skip }, () => {
    assert.deepEqual(listing(section, b), [`blobs/takes/${B_SHA}`]);
  });

  test(`a ${section} build outside a release lists the privileged team's take`, { skip }, () => {
    assert.deepEqual(listing(section, null), [`blobs/takes/${A_SHA}`]);
  });
}

test("a release's pointers record the takes they hold, by version and hash", { skip }, async () => {
  // The archive's address, answering every take's size, as the bucket would.
  const archive = createServer((_request, response) => response.writeHead(200, { "content-length": "10" }).end());
  await new Promise((resolve) => archive.listen(0, "127.0.0.1", resolve));
  const selected = join(mkdtempSync(join(tmpdir(), "selected-")), "takes.json");
  seed.take({ source: "readables", lang, file: "b-2", lineId: "b:2", team: b.id, sha256: C_SHA, version: 4 });
  try {
    const env = {
      PATH: process.env.PATH, LOCAL_DB: seed.url, SPOKEN_CLIP_POINTERS: "1", SPOKEN_RELEASE_TEAM: b.id,
      SPOKEN_ARCHIVE_URL: `http://127.0.0.1:${archive.address().port}/`, SPOKEN_SELECTED_TAKES: selected,
    };
    await promisify(execFile)(process.execPath, [SOUNDS, `--lang=${lang}`, "readables"], { env });
    assert.deepEqual(JSON.parse(readFileSync(selected, "utf8")), {
      "b-1": { version: 1, sha256: B_SHA },
      "b-2": { version: 4, sha256: C_SHA },
    });
  } finally {
    archive.close();
    seed.sql(`delete from "take" where "lang" = ${seed.lit(lang)} and "file" = 'b-2'`);
    rmSync(join(ROOT, "build", "readables", lang), { recursive: true, force: true });
    // And the folders above it, when this made them.
    for (const dir of [join(ROOT, "build", "readables"), join(ROOT, "build")]) {
      try {
        rmdirSync(dir);
      } catch {
        break;
      }
    }
  }
});

test("a release whose takes are in a team's own bucket needs a site's archive route", { skip }, async () => {
  const { sql, lit } = seed;
  const [backend] = sql(`insert into "storage_backend" ("teamId", "label", "provider", "endpoint", "bucket", "accessKeyId", "secretSealed")
    values (${lit(b.id)}, 'test', 'r2', 'https://bucket.invalid', 'team-test', 'key', 'sealed') returning "id"`)[0];
  sql(`insert into "archive_object" ("prefix", "sha256", "backendId", "teamId") values ('takes', ${lit(B_SHA)}, ${lit(backend)}, ${lit(b.id)})`);
  const archive = createServer((_request, response) => response.writeHead(200, { "content-length": "10" }).end());
  await new Promise((resolve) => archive.listen(0, "127.0.0.1", resolve));
  const build = (base) => {
    const env = {
      PATH: process.env.PATH, LOCAL_DB: seed.url, SPOKEN_CLIP_POINTERS: "1", SPOKEN_RELEASE_TEAM: b.id, SPOKEN_ARCHIVE_URL: base,
    };
    return promisify(execFile)(process.execPath, [SOUNDS, `--lang=${lang}`, "readables"], { env });
  };
  try {
    const site = `http://127.0.0.1:${archive.address().port}`;
    await assert.rejects(build(`${site}/`), (error) => /kept in their team's own bucket.*\/api\/archive\//s.test(error.stderr));
    await build(`${site}/api/archive/`);
  } finally {
    archive.close();
    sql(`delete from "archive_object" where "backendId" = ${lit(backend)}`);
    sql(`delete from "storage_backend" where "id" = ${lit(backend)}`);
    rmSync(join(ROOT, "build", "readables", lang), { recursive: true, force: true });
    for (const dir of [join(ROOT, "build", "readables"), join(ROOT, "build")]) {
      try {
        rmdirSync(dir);
      } catch {
        break;
      }
    }
  }
});
