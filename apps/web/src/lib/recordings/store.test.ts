/**
 * Storing and removing recordings, against a real Postgres, a real directory and real audio,
 * for the reasons takes/commit.test.ts gives: what is promised is about the schema and the
 * disk. Skipped where ffmpeg is missing, since the probe has to see real audio.
 *
 * Needs DATABASE_URL and migrations applied:
 *   deploy/web/bin/migrate.sh "$PWD/apps/web"
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "recordings-int-"));
process.env.SPOKEN_QUESTS_AUDIO_HISTORY = path.join(root, "audio-history");

const { closeDb, db } = await import("@/lib/db");
const { commitRecording, listRecordings, liveRecordings, recordingPath, removeRecording } = await import("./store");
const { memoryBlobs, sha256Of, useArchiveForTests } = await import("@/lib/blobs/store");
const { teamOf } = await import("@/lib/teams/store");

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

function tone(seconds: number, codec: string[], ext: string): Buffer {
  const out = path.join(root, `tone-${seconds}.${ext}`);
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `sine=duration=${seconds}`, ...codec, "-y", out]);
  return fs.readFileSync(out);
}

const ACTOR = "recording-test-actor";
const OTHER = "recording-test-other";
const lang = "deDE";
let file: string;
let mp3: Buffer;
let ogg: Buffer;

function upload(data: Buffer, createdBy = ACTOR) {
  return commitRecording({
    source: "quests",
    lang,
    file,
    lineId: "q:1:accept",
    data,
    originalName: "1-accept.x",
    credit: createdBy === ACTOR ? "Actor One" : "Actor Two",
    createdBy,
  });
}

beforeAll(async () => {
  if (!hasFfmpeg) return;
  mp3 = tone(1, ["-c:a", "libmp3lame"], "mp3");
  ogg = tone(2, ["-ac", "2", "-c:a", "vorbis", "-strict", "-2"], "ogg");
  for (const id of [ACTOR, OTHER]) {
    await db().query(
      `insert into "user" ("id", "name", "email", "emailVerified") values ($1, $1, $2, false)
       on conflict do nothing`,
      [id, `${id}@example.invalid`],
    );
  }
});

beforeEach(() => {
  file = `quests/${Math.random().toString(16).slice(2, 10)}-recording.mp3`;
});

afterEach(async () => {
  await db().query(`delete from "recording" where "file" = $1`, [file]);
  await db().query(`delete from "activity" where "subject" = $1`, [file]);
});

afterAll(async () => {
  await db().query(`delete from "user" where "id" = any($1)`, [[ACTOR, OTHER]]);
  fs.rmSync(root, { recursive: true, force: true });
  await closeDb();
});

describe.skipIf(!hasFfmpeg)("a recording", () => {
  it("is stored as uploaded, under recorded/<lang>/, and goes live", async () => {
    const result = await upload(ogg);
    expect(result).toMatchObject({ recording: { version: 1, format: "ogg", credit: "Actor One" } });

    const found = await recordingPath("quests", lang, file, 1);
    if (found.kind !== "file") throw new Error(`no file for v1: ${found.kind}`);
    expect(found.path.startsWith(path.join(root, "audio-history", "recorded", lang, "quests"))).toBe(true);
    expect(found.path.endsWith(".ogg")).toBe(true);
    expect(fs.readFileSync(found.path).equals(ogg)).toBe(true);
    const live = (await liveRecordings("quests", lang)).get(file);
    expect(live).toMatchObject({ version: 1 });
    expect(live?.durationSec).toBeCloseTo(2, 1);
  });

  it("is refused, and nothing kept, when it is not audio a pack can carry", async () => {
    expect(await upload(Buffer.from("not audio"))).toHaveProperty("error");
    expect(await listRecordings("quests", lang, file)).toEqual([]);
    expect(fs.existsSync(path.join(root, "audio-history", "recorded", lang, "quests", path.basename(file, ".mp3")))).toBe(false);
  });

  it("is replaced by anybody's newer one, and comes back when that one is removed", async () => {
    await upload(mp3);
    await upload(ogg, OTHER);
    expect((await liveRecordings("quests", lang)).get(file)).toMatchObject({ version: 2, credit: "Actor Two" });

    expect(
      await removeRecording({ source: "quests", lang, file, version: 2, by: OTHER, mayRemoveAny: false }),
    ).toBe(true);
    expect((await liveRecordings("quests", lang)).get(file)).toMatchObject({ version: 1, credit: "Actor One" });
    // Removed, not gone: the history still lists it.
    expect((await listRecordings("quests", lang, file)).map((r) => [r.version, !!r.deletedAt])).toEqual([
      [2, true],
      [1, false],
    ]);
  });

  it("can be removed by its author or an admin, and nobody else", async () => {
    await upload(mp3);
    const remove = (by: string, mayRemoveAny: boolean) =>
      removeRecording({ source: "quests", lang, file, version: 1, by, mayRemoveAny });
    expect(await remove(OTHER, false)).toBe(false);
    expect(await remove(OTHER, true)).toBe(true);
    expect(await remove(ACTOR, true)).toBe(false);
  });

  it("numbers concurrent uploads of one file apart", async () => {
    const results = await Promise.all([upload(mp3), upload(ogg, OTHER), upload(mp3)]);
    expect(results.map((r) => ("recording" in r ? r.recording.version : 0)).sort()).toEqual([1, 2, 3]);
  });

  it("records a hash only for a recording the bucket holds, and its name in every mode", async () => {
    const stored = async () =>
      (
        await db().query<{ archiveFile: string; sha256: string | null }>(
          `select "archiveFile", "sha256" from "recording" where "file" = $1 order by "version" desc limit 1`,
          [file],
        )
      ).rows[0];

    await upload(mp3);
    expect((await stored()).sha256).toBeNull();
    const first = await recordingPath("quests", lang, file, 1);
    if (first.kind !== "file") throw new Error(`no file for v1: ${first.kind}`);

    const bucket = memoryBlobs();
    const restore = useArchiveForTests(bucket, "r2");
    try {
      await upload(ogg);
      const sha = sha256Of(ogg);
      const row = await stored();
      expect(row.sha256).toBe(sha);
      expect(row.archiveFile).toMatch(/^v2-.*\.ogg$/);
      expect(bucket.objects.get(`recordings/${sha}`)?.contentType).toBe("audio/ogg");
      expect(fs.readdirSync(path.dirname(first.path))).toEqual([path.basename(first.path)]);
      expect(await recordingPath("quests", lang, file, 2)).toEqual({ kind: "blob", key: `recordings/${sha}` });
    } finally {
      restore();
    }
  });

  it("leaves the generated takes alone, and is logged", async () => {
    await upload(mp3);
    const { rows: takes } = await db().query(`select 1 from "take" where "file" = $1`, [file]);
    expect(takes).toEqual([]);
    const { rows } = await db().query(`select "kind", "lineId", "actorId" from "activity" where "subject" = $1`, [file]);
    expect(rows).toEqual([{ kind: "recording.uploaded", lineId: "q:1:accept", actorId: ACTOR }]);
  });

  it("is kept, with its log row, as the language's team", async () => {
    await upload(mp3);
    const team = await teamOf(lang);
    const { rows: kept } = await db().query(`select "teamId" from "recording" where "file" = $1`, [file]);
    const { rows: log } = await db().query(`select "teamId" from "activity" where "subject" = $1`, [file]);
    expect(kept).toEqual([{ teamId: team }]);
    expect(log).toEqual([{ teamId: team }]);
  });
});
