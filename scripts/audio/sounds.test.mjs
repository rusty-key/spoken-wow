// Needs DATABASE_URL naming a migrated test database (spoken_ci_pin), as an owner that bypasses
// row-level security; skipped without one.
//
// A language with two teams, each holding a live take of the same line: a release's listing
// holds its own team's take alone, and a build outside a release the plain packs' team's.
import { execFile, execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmdirSync, rmSync } from "node:fs";
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
const OGG_SHA = "e".repeat(64);
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

/** The Ogg a release ships for a take, as the site records it when the take is committed. */
function encoded(source, sha256) {
  seed.sql(`insert into "take_encoding" ("source", "sha256", "profile", "encodedSha256", "bytes", "durationSec")
       values (${seed.lit(source)}, ${seed.lit(sha256)}, 'ogg-q0-44k', ${seed.lit(OGG_SHA)}, 7, 1.4)
       on conflict do nothing`);
  seed.onCleanup(`delete from "take_encoding" where "source" = ${seed.lit(source)} and "sha256" = ${seed.lit(sha256)}`);
}

function removeBuild(section) {
  rmSync(join(ROOT, "build", section, lang), { recursive: true, force: true });
  // And the folders above it, when this made them.
  for (const dir of [join(ROOT, "build", section), join(ROOT, "build")]) {
    try {
      rmdirSync(dir);
    } catch {
      break;
    }
  }
}

function listing(section, team) {
  const env = { PATH: process.env.PATH, LOCAL_DB: seed.url, SPOKEN_ARCHIVE_URL: "https://archive.invalid/" };
  if (team) env.SPOKEN_RELEASE_TEAM = team.id;
  return execFileSync(process.execPath, [SOUNDS, "--list", `--lang=${lang}`, section], { env, encoding: "utf8" }).trim().split("\n");
}

for (const section of ["readables", "quests", "bosses"]) {
  test(`a slug team's ${section} release lists its own take, not the plain team's`, { skip }, () => {
    assert.deepEqual(listing(section, b), [`blobs/takes/${B_SHA}`]);
  });

  test(`a ${section} build outside a release lists the plain team's take`, { skip }, () => {
    assert.deepEqual(listing(section, null), [`blobs/takes/${A_SHA}`]);
  });
}

test("a release's pointers record the takes they hold, by version and hash", { skip }, async () => {
  // The archive's address, answering every take's size, as the bucket would.
  const archive = createServer((_request, response) => response.writeHead(200, { "content-length": "10" }).end());
  await new Promise((resolve) => archive.listen(0, "127.0.0.1", resolve));
  const selected = join(mkdtempSync(join(tmpdir(), "selected-")), "takes.json");
  seed.take({ source: "readables", lang, file: "b-2", lineId: "b:2", team: b.id, sha256: C_SHA, version: 4 });
  encoded("readables", B_SHA);
  encoded("readables", C_SHA);
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
    // The pack ships the take's Ogg, and nothing beside the clips that would ship with them.
    const sounds = join(ROOT, "build", "readables", lang, "Sounds");
    assert.equal(readFileSync(join(sounds, "b-1.ogg"), "utf8"), `spoken-clip-pointer encodings/${OGG_SHA} 7\n`);
    assert.deepEqual(readdirSync(sounds).sort(), [".from-takes", "b-1.ogg", "b-2.ogg"]);
  } finally {
    archive.close();
    seed.sql(`delete from "take" where "lang" = ${seed.lit(lang)} and "file" = 'b-2'`);
    removeBuild("readables");
  }
});

const encoders = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("oggenc", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

test("a build outside a release encodes each readables master into the pack's Ogg", { skip: skip || (!encoders && "needs ffmpeg and oggenc") }, async () => {
  const history = mkdtempSync(join(tmpdir(), "history-"));
  const master = join(history, "blobs", "takes", A_SHA);
  mkdirSync(dirname(master), { recursive: true });
  execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-f", "mp3", master]);
  const cached = join(ROOT, "pipelines", "readables", "audio-transcoded", "ogg-q0-44k", `${A_SHA}.ogg`);
  try {
    const env = {
      PATH: process.env.PATH, HOME: process.env.HOME, LOCAL_DB: seed.url, SPOKEN_ARCHIVE_URL: "https://archive.invalid/",
      SPOKEN_READABLES_AUDIO_HISTORY: history,
    };
    await promisify(execFile)(process.execPath, [SOUNDS, `--lang=${lang}`, "readables"], { env });
    const clip = readFileSync(join(ROOT, "build", "readables", lang, "Sounds", "b-1.ogg"));
    assert.equal(clip.subarray(0, 4).toString("latin1"), "OggS");
    assert.deepEqual(readFileSync(cached), clip);
  } finally {
    rmSync(history, { recursive: true, force: true });
    rmSync(cached, { force: true });
    removeBuild("readables");
  }
});

for (const section of ["readables", "bosses"]) {
  test(`a ${section} release stops on a live take that has no Ogg`, { skip }, async () => {
    const env = {
      PATH: process.env.PATH, LOCAL_DB: seed.url, SPOKEN_CLIP_POINTERS: "1", SPOKEN_RELEASE_TEAM: a.id,
      SPOKEN_ARCHIVE_URL: "https://archive.invalid/",
    };
    try {
      await assert.rejects(
        promisify(execFile)(process.execPath, [SOUNDS, `--lang=${lang}`, section], { env }),
        (error) => /live takes have no Ogg in take_encoding/.test(error.stderr),
      );
    } finally {
      removeBuild(section);
    }
  });
}

test("a release whose takes are in a team's own bucket needs a site's archive route", { skip }, async () => {
  const { sql, lit } = seed;
  const [backend] = sql(`insert into "storage_backend" ("teamId", "label", "provider", "endpoint", "bucket", "accessKeyId", "secretSealed")
    values (${lit(b.id)}, 'test', 'r2', 'https://bucket.invalid', 'team-test', 'key', 'sealed') returning "id"`)[0];
  sql(`insert into "archive_object" ("prefix", "sha256", "backendId", "teamId") values ('takes', ${lit(B_SHA)}, ${lit(backend)}, ${lit(b.id)})`);
  const archive = createServer((_request, response) => response.writeHead(200, { "content-length": "10" }).end());
  await new Promise((resolve) => archive.listen(0, "127.0.0.1", resolve));
  encoded("readables", B_SHA);
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
    removeBuild("readables");
  }
});

test("with SPOKEN_PIECES, a release ships a quests line cut into pieces as a folder of pointers", { skip }, async () => {
  const { sql, lit } = seed;
  const encoded = "d".repeat(64);
  const [first, second] = ["e".repeat(64), "f".repeat(64)];
  sql(`insert into "take_encoding" ("source", "sha256", "profile", "encodedSha256", "bytes", "durationSec")
       values ('quests', ${lit(B_SHA)}, 'ogg-q0-44k', ${lit(encoded)}, 10, 9)`);
  sql(`insert into "take_pieces" ("source", "sha256", "profile", "method", "encodedSha256s", "bytes", "lengthsSec")
       values ('quests', ${lit(B_SHA)}, 'ogg-q0-44k', 'times', array[${lit(first)}, ${lit(second)}], '{6, 4}', '{5.25, 3.75}')`);
  const archive = createServer((_request, response) => response.writeHead(200, { "content-length": "10" }).end());
  await new Promise((resolve) => archive.listen(0, "127.0.0.1", resolve));
  const out = join(ROOT, "build", "quests", lang, "audio");
  const build = (pieces) => {
    const env = {
      PATH: process.env.PATH, LOCAL_DB: seed.url, SPOKEN_CLIP_POINTERS: "1", SPOKEN_RELEASE_TEAM: b.id,
      SPOKEN_ARCHIVE_URL: `http://127.0.0.1:${archive.address().port}/`, ...(pieces ? { SPOKEN_PIECES: "1" } : {}),
    };
    return promisify(execFile)(process.execPath, [SOUNDS, `--lang=${lang}`, "quests"], { env });
  };
  try {
    await build(false);
    const [stem] = Object.keys(JSON.parse(readFileSync(join(out, "durations.json"), "utf8")));
    assert.match(readFileSync(join(out, `${stem}.ogg`), "utf8"), new RegExp(`encodings/${encoded} 10`));
    assert.throws(() => readFileSync(join(out, "pieces.json")), "no pieces unless asked for");

    await build(true);
    assert.throws(() => readFileSync(join(out, `${stem}.ogg`)), "the line's file is a folder");
    assert.match(readFileSync(join(out, stem, "01.ogg"), "utf8"), new RegExp(`encodings/${first} 6`));
    assert.match(readFileSync(join(out, stem, "02.ogg"), "utf8"), new RegExp(`encodings/${second} 4`));
    assert.deepEqual(JSON.parse(readFileSync(join(out, "pieces.json"), "utf8")), { [stem]: "5.25 3.75" });
    assert.deepEqual(JSON.parse(readFileSync(join(out, "durations.json"), "utf8")), { [stem]: 9 });
  } finally {
    archive.close();
    sql(`delete from "take_pieces" where "sha256" = ${lit(B_SHA)}`);
    sql(`delete from "take_encoding" where "sha256" = ${lit(B_SHA)}`);
    rmSync(join(ROOT, "build", "quests", lang), { recursive: true, force: true });
    for (const dir of [join(ROOT, "build", "quests"), join(ROOT, "build")]) {
      try {
        rmdirSync(dir);
      } catch {
        break;
      }
    }
  }
});
