// Needs DATABASE_URL naming a migrated test database (spoken_ci_pin), as an owner that bypasses
// row-level security; skipped without one.
//
// A language with two teams, each holding a live take of the same line: a release's listing
// holds its own team's take alone, and a build outside a release the privileged team's.
import { execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import { seedDatabase } from "../../pipelines/lib/test-db.mjs";

const SOUNDS = join(dirname(fileURLToPath(import.meta.url)), "sounds.mjs");
const seed = seedDatabase();
const skip = seed ? false : "DATABASE_URL is not set";
const A_SHA = "a".repeat(64);
const B_SHA = "b".repeat(64);
let lang;
let a;
let b;

before(() => {
  if (!seed) return;
  const { sql, lit } = seed;
  lang = seed.language();
  a = seed.team(lang, { privileged: true });
  b = seed.team(lang, { privileged: false });
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
