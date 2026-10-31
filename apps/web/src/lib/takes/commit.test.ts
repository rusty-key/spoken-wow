/**
 * Committing a take: against a real Postgres and a real directory, deliberately.
 *
 * What commitTake promises is about things outside the code -- that a file once written is
 * never changed, and that the schema's one-live-take index holds -- so a mock would test
 * that the code calls what the code calls.
 *
 * Quests paths are used because they can be pointed at a temporary directory; the function
 * takes the section as an argument and nothing in it depends on which.
 *
 * Needs DATABASE_URL and migrations applied:
 *   deploy/web/bin/migrate.sh "$PWD/apps/web"
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "takes-commit-int-"));
process.env.SPOKEN_QUESTS_AUDIO_HISTORY = path.join(root, "audio-history");

const { closeDb, db } = await import("@/lib/db");
const { commitTake } = await import("./commit");
const { archiveName } = await import("./bytes");
const { listTakes, livePath, takePath } = await import("./store");
const { memoryBlobs, sha256Of, useArchiveForTests } = await import("@/lib/blobs/store");

/** A file no other run will collide with, so this can share a database with anything else. */
let file: string;

const history = () =>
  path.join(root, "audio-history", path.dirname(file), path.basename(file, ".mp3"));

function take(text: string, fields: Partial<Parameters<typeof commitTake>[3]> = {}) {
  return commitTake("quests", file, Buffer.from(text), {
    lineId: "g:commit-test",
    voice: "dwarf-male",
    modelId: "eleven_v3",
    seed: 7,
    characters: text.length,
    credits: 3,
    settings: { stability: 0.5 },
    ...fields,
  });
}

/** Every name in the file's history directory, sorted. */
function archived(): string[] {
  return fs.existsSync(history()) ? fs.readdirSync(history()).sort() : [];
}

beforeAll(async () => {
  try {
    await db().query(`select "archiveFile" from take limit 1`);
  } catch (error) {
    throw new Error(
      'commit.test.ts needs a migrated database. Run: deploy/web/bin/migrate.sh "$PWD/apps/web"\n' +
        String(error),
    );
  }
});

beforeEach(() => {
  file = `gossip/${Math.random().toString(16).slice(2).padEnd(12, "0")}commit.mp3`;
});

afterEach(async () => {
  await db().query(`delete from "take" where "file" = $1`, [file]);
});

afterAll(async () => {
  fs.rmSync(root, { recursive: true, force: true });
  await closeDb();
});

describe("the first take of a line", () => {
  it("is version 1, archived under a name carrying its hash, and live", async () => {
    const committed = await take("first");

    expect(committed.version).toBe(1);
    expect(committed.archiveFile).toBe(archiveName(1, Buffer.from("first")));
    expect(archived()).toEqual([committed.archiveFile]);

    const [row] = await listTakes("quests", file);
    expect(row).toMatchObject({ version: 1, isCurrent: true, origin: "generated" });
    expect(row.archiveFile).toBe(committed.archiveFile);
  });

  it("records what the take was made with, so it can be reproduced", async () => {
    await take("first");

    const { rows } = await db().query(
      `select "voice", "modelId", "seed"::int, "characters", "credits", "settings"
         from "take" where "file" = $1`,
      [file],
    );
    expect(rows[0]).toEqual({
      voice: "dwarf-male",
      modelId: "eleven_v3",
      seed: 7,
      characters: 5,
      credits: 3,
      settings: { stability: 0.5 },
    });
  });

  it("keeps its word times, and none when the generator gave none", async () => {
    await take("timed", { wordTimes: [0, 0.31, 1.025] });
    await take("untimed");

    const { rows } = await db().query(
      `select "wordTimes" from "take" where "file" = $1 order by "version"`,
      [file],
    );
    expect(rows.map((row) => row.wordTimes)).toEqual([[0, 0.31, 1.025], null]);
  });
});

describe("the activity log", () => {
  it("records the take in the same commit, under the batch that cut it", async () => {
    await commitTake("quests", file, Buffer.from("queued"), { lineId: "g:commit-test", credits: 3 }, {
      batchId: "00000000-0000-4000-8000-000000000001",
    });
    const { rows } = await db().query(
      `select "kind", "lang", "source", "lineId", "detail" from "activity" where "subject" = $1`,
      [file],
    );
    expect(rows).toEqual([
      {
        kind: "take.generated",
        lang: "enUS",
        source: "quests",
        lineId: "g:commit-test",
        detail: {
          version: 1,
          provider: "elevenlabs",
          credits: 3,
          costUsd: null,
          batchId: "00000000-0000-4000-8000-000000000001",
        },
      },
    ]);
  });
});

describe("a take's provider", () => {
  it("is ElevenLabs unless it says otherwise, with no dollars", async () => {
    await take("first");
    const [row] = await listTakes("quests", file);
    expect(row).toMatchObject({ provider: "elevenlabs", credits: 3, costUsd: null });
  });

  it("is recorded for fish.audio with its dollars, and no credits", async () => {
    await take("first", { provider: "fish", credits: null, costUsd: 0.0042 });
    const [row] = await listTakes("quests", file);
    expect(row).toMatchObject({ provider: "fish", credits: null });
    expect(row.costUsd).toBeCloseTo(0.0042);
  });
});

describe("re-rolling", () => {
  it("keeps every take in the archive, each under its own name", async () => {
    for (const text of ["one", "two", "three"]) await take(text);

    expect(archived()).toEqual(
      [archiveName(1, Buffer.from("one")), archiveName(2, Buffer.from("two")),
        archiveName(3, Buffer.from("three"))].sort(),
    );

    const takes = await listTakes("quests", file);
    expect(takes.map((t) => t.version)).toEqual([3, 2, 1]);
    expect(takes.filter((t) => t.isCurrent).map((t) => t.version)).toEqual([3]);
  });

  it("never collides, even when two takes sound identical", async () => {
    // Same bytes, same content id -- but the version in the name keeps them apart, and the
    // first take's file is never rewritten with anything but what it already holds.
    await take("same");
    await take("same");

    expect(archived()).toEqual(
      [archiveName(1, Buffer.from("same")), archiveName(2, Buffer.from("same"))].sort(),
    );
  });
});

describe("files already written", () => {
  it("are never changed by the takes that follow", async () => {
    await take("one");
    const first = path.join(history(), archiveName(1, Buffer.from("one")));
    const before = fs.statSync(first);

    await take("two");
    await take("three");

    const after = fs.statSync(first);
    expect(fs.readFileSync(first, "utf8")).toBe("one");
    expect([after.ino, after.mtimeMs]).toEqual([before.ino, before.mtimeMs]);
  });
});

describe("a take in another language", () => {
  // Version numbers count per language, so an English v1 and a Portuguese v1 of one file are
  // both real. What keeps them apart on disk is the language directory; English stays where
  // it has always been, since the archive is irreplaceable and nothing moves a path in it.
  it("is archived under its language, beside the English take and not over it", async () => {
    const english = await take("english");
    const portuguese = await commitTake("quests", file, Buffer.from("portugues"), {
      lineId: "g:commit-test",
    }, { lang: "ptBR" });

    expect(english.version).toBe(1);
    expect(portuguese.version).toBe(1);

    const ptHistory = path.join(
      root, "audio-history", "ptBR", path.dirname(file), path.basename(file, ".mp3"),
    );
    expect(archived()).toEqual([english.archiveFile]);
    expect(fs.readdirSync(ptHistory)).toEqual([portuguese.archiveFile]);

    const enLive = await livePath("quests", file);
    const ptLive = await livePath("quests", file, "ptBR");
    expect(enLive).toEqual({ kind: "file", path: path.join(history(), english.archiveFile!), prefix: "takes" });
    expect(ptLive).toEqual({ kind: "file", path: path.join(ptHistory, portuguese.archiveFile!), prefix: "takes" });
  });

  it("does not take the live flag from the English take", async () => {
    await take("english");
    await commitTake("quests", file, Buffer.from("portugues"), { lineId: "g:commit-test" }, {
      lang: "ptBR",
    });

    expect((await listTakes("quests", file)).map((t) => [t.version, t.isCurrent])).toEqual([
      [1, true],
    ]);
    expect((await listTakes("quests", file, "ptBR")).map((t) => [t.version, t.isCurrent])).toEqual([
      [1, true],
    ]);
  });
});

describe("with the archive in a bucket", () => {
  let restore: () => void = () => {};
  afterEach(() => restore());

  const rowHash = async () =>
    (await db().query<{ sha256: string | null }>(`select "sha256" from "take" where "file" = $1`, [file])).rows[0].sha256;

  it("records no hash in disk mode, so the backfill finds the row", async () => {
    const committed = await take("disk only");
    expect(committed.sha256).toBeNull();
    expect(await rowHash()).toBeNull();
  });

  it("still commits from the volume when the bucket refuses, in dual mode, and leaves the hash for the backfill", async () => {
    restore = useArchiveForTests(memoryBlobs({ refusePut: true }), "dual");

    const committed = await take("bucket down");
    expect(committed.sha256).toBeNull();
    expect(await rowHash()).toBeNull();
    expect(archived()).toEqual([committed.archiveFile]);
    expect((await livePath("quests", file)).kind).toBe("file");
  });

  it("fails when the bucket refuses in r2 mode, where it is the only store", async () => {
    restore = useArchiveForTests(memoryBlobs({ refusePut: true }), "r2");

    await expect(take("bucket down")).rejects.toThrow("HTTP 503");
    expect(await listTakes("quests", file)).toEqual([]);
  });

  it("puts the bytes under their hash and keeps the volume as well, in dual mode", async () => {
    const bucket = memoryBlobs();
    restore = useArchiveForTests(bucket, "dual");

    const committed = await take("dual write");
    const sha = sha256Of(Buffer.from("dual write"));

    expect(committed.sha256).toBe(sha);
    expect(await rowHash()).toBe(sha);
    expect(bucket.objects.get(`takes/${sha}`)?.data.toString()).toBe("dual write");
    expect(archived()).toEqual([committed.archiveFile]);
    // Reads stay on the volume until the backfill is done.
    expect((await livePath("quests", file)).kind).toBe("file");
  });

  it("writes nothing to the volume and answers with the object's address, in r2 mode", async () => {
    const bucket = memoryBlobs();
    restore = useArchiveForTests(bucket, "r2");

    const measured: string[] = [];
    const committed = await commitTake(
      "quests",
      file,
      Buffer.from("bucket only"),
      { lineId: "g:commit-test" },
      { measure: async (clip) => (measured.push(fs.readFileSync(clip, "utf8")), 1.5) },
    );
    const sha = sha256Of(Buffer.from("bucket only"));

    expect(committed.archiveFile).toBeNull();
    expect(committed.sha256).toBe(sha);
    expect(committed.durationSec).toBe(1.5);
    // The measure saw the bytes, from a temporary copy that is gone again.
    expect(measured).toEqual(["bucket only"]);
    expect(archived()).toEqual([]);
    const live = await livePath("quests", file);
    expect(live).toEqual({ kind: "blob", key: `takes/${sha}` });
    expect(await takePath("quests", file, committed.version)).toEqual(live);
  });
});
