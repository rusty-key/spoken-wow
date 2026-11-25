/** Runs real ffmpeg and oggenc, which is where this goes wrong; skipped without them. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

const has = (tool: string, flag: string) => {
  try {
    execFileSync(tool, [flag], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const tools = has("ffmpeg", "-version") && has("oggenc", "--version");

const { db, closeDb } = await import("@/lib/db");
const { memoryBlobs, sha256Of, useArchiveForTests } = await import("@/lib/blobs/store");
const { cutArchivedForPack, cutForPack, cutMissingForPack, cutPieces, wavDurationSec } = await import("./pieces");
const { commitTake } = await import("./commit");
const { asSystem } = await import("@/lib/teams/testing");

const english = async (): Promise<string> =>
  (await asSystem.query(`select team_of_lang('enUS') as "team"`)).rows[0].team;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pieces-test-"));

/**
 * Three sentences of a 3 s tone, each followed by 0.6 s of silence but the last: 10.2 s, its
 * pauses at 3 to 3.6 s and 6.6 to 7.2 s. `seconds` alone, one sentence with none.
 */
function sentences(seconds = 10.2): string {
  const out = path.join(dir, `said-${seconds}.mp3`);
  const wave = `aevalsrc=if(lt(mod(t\\,3.6)\\,3)\\,0.5*sin(2*PI*440*t)\\,0):d=${seconds}:s=44100`;
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", wave, "-b:a", "128k", out]);
  return out;
}

const SAID = "One two three. Four five six. Seven eight nine.";
const SAID_TIMES = [0, 1, 2, 3.6, 4.6, 5.6, 7.2, 8.2, 9.2];

afterAll(async () => {
  fs.rmSync(dir, { recursive: true, force: true });
  await closeDb();
});

describe("wavDurationSec", () => {
  it("reads a WAV's length off its data chunk", () => {
    const header = Buffer.alloc(44);
    header.write("RIFF", 0, "latin1");
    header.write("WAVE", 8, "latin1");
    header.write("fmt ", 12, "latin1");
    header.writeUInt32LE(16, 16);
    header.writeUInt32LE(88_200, 28);
    header.write("data", 36, "latin1");
    header.writeUInt32LE(88_200 * 2, 40);
    expect(wavDurationSec(Buffer.concat([header, Buffer.alloc(88_200 * 2)]))).toBe(2);
  });

  it("refuses what is not a WAV", () => {
    expect(() => wavDurationSec(Buffer.from("OggS and more"))).toThrow(/not a WAV/);
  });
});

describe.skipIf(!tools)("cutPieces", () => {
  it("cuts a take with word times at its sentences", async () => {
    const { method, oggs } = await cutPieces(sentences(), { shownText: SAID, wordTimes: SAID_TIMES });
    expect(method).toBe("times");
    expect(oggs).toHaveLength(3);
    for (const ogg of oggs) expect(ogg.subarray(0, 4).toString()).toBe("OggS");
  });

  it("moves a cut its word times put in a word into the pause beside it", async () => {
    // The times put "Four" and "Seven" 0.25 s early, so the cuts would fall in the tone before
    // each pause, at 2.85 and 6.45 s; the pauses start at 3 and 6.6 s.
    const early = [0, 1, 2, 3.1, 4.1, 5.1, 6.7, 7.7, 8.7];
    const { method, oggs } = await cutPieces(sentences(), { shownText: SAID, wordTimes: early });
    expect(method).toBe("times");
    const { oggDurationSec } = await import("./encode");
    expect(oggDurationSec(oggs[0])).toBeGreaterThanOrEqual(3.02);
    expect(oggDurationSec(oggs[0]) + oggDurationSec(oggs[1])).toBeGreaterThanOrEqual(6.62);
  });

  it("measures the pauses of a take without them", async () => {
    const { method, oggs } = await cutPieces(sentences(), {});
    expect(method).toBe("pauses");
    expect(oggs).toHaveLength(3);
  });

  it("measures a take whose times do not fit its words", async () => {
    const { method } = await cutPieces(sentences(), { shownText: SAID, wordTimes: SAID_TIMES.slice(1) });
    expect(method).toBe("pauses");
  });

  it("keeps a take with no pause long enough whole", async () => {
    expect(await cutPieces(sentences(3), {})).toEqual({ method: "whole", oggs: [] });
  });
});

describe.skipIf(!tools)("cutForPack", () => {
  it("cuts a take once, puts its pieces in the bucket and records them in order", async () => {
    const bucket = memoryBlobs();
    const restore = useArchiveForTests(bucket, "dual");
    const master = sentences();
    const sha = sha256Of(fs.readFileSync(master));
    try {
      await db().query(`delete from "take_pieces" where "sha256" = $1`, [sha]);
      const first = await cutForPack("quests", sha, master, {
        lang: "enUS",
        file: "quests/1-accept.mp3",
        version: 1,
        shownText: SAID,
        wordTimes: SAID_TIMES,
      });
      expect(first?.method).toBe("times");
      expect(first?.pieces).toHaveLength(3);
      for (const piece of first!.pieces) {
        expect(bucket.objects.get(`encodings/${piece.encodedSha256}`)?.contentType).toBe("audio/ogg");
      }
      // Cut just before "Four" and "Seven": 3.35 and 6.95 s.
      const [a, b, c] = first!.pieces.map((piece) => piece.lengthSec);
      expect(a).toBeCloseTo(3.35, 1);
      expect(b).toBeCloseTo(3.6, 1);
      expect(a + b + c).toBeCloseTo(10.2, 1);

      bucket.objects.clear();
      expect(await cutForPack("quests", sha, master)).toEqual(first);
      // Recorded, so the second commit of the same bytes cuts nothing.
      expect(bucket.objects.size).toBe(0);
    } finally {
      restore();
      await db().query(`delete from "take_pieces" where "sha256" = $1`, [sha]);
    }
  });

  it("records a take it finds no cut in as whole, so it is not tried again", async () => {
    const restore = useArchiveForTests(memoryBlobs(), "dual");
    const master = sentences(3);
    const sha = sha256Of(fs.readFileSync(master));
    try {
      await db().query(`delete from "take_pieces" where "sha256" = $1`, [sha]);
      expect(await cutForPack("places", sha, master)).toEqual({ method: "whole", pieces: [] });
      const { rows } = await db().query(`select "method" from "take_pieces" where "sha256" = $1`, [sha]);
      expect(rows).toEqual([{ method: "whole" }]);
    } finally {
      restore();
      await db().query(`delete from "take_pieces" where "sha256" = $1`, [sha]);
    }
  });

  it("gives up without throwing on a clip it cannot decode", async () => {
    const restore = useArchiveForTests(memoryBlobs(), "dual");
    const file = path.join(dir, "not-audio.mp3");
    fs.writeFileSync(file, "not audio");
    try {
      expect(await cutForPack("quests", sha256Of(Buffer.from("not audio")), file)).toBeNull();
    } finally {
      restore();
    }
  });

  it("cuts a take put back live from the archive", async () => {
    const bucket = memoryBlobs();
    const restore = useArchiveForTests(bucket, "r2");
    const master = fs.readFileSync(sentences());
    const sha = sha256Of(master);
    try {
      await db().query(`delete from "take_pieces" where "sha256" = $1`, [sha]);
      await bucket.put(`takes/${sha}`, master, "audio/mpeg");
      await cutArchivedForPack("quests", sha, { lang: "enUS", file: "quests/1-accept.mp3", version: 2 });
      const { rows } = await db().query(`select "method" from "take_pieces" where "sha256" = $1`, [sha]);
      expect(rows).toEqual([{ method: "pauses" }]);
    } finally {
      restore();
      await db().query(`delete from "take_pieces" where "sha256" = $1`, [sha]);
    }
  });
});

describe.skipIf(!tools)("cutting at commit, and the backfill", () => {
  it("cuts a committed take at its word times", async () => {
    const restore = useArchiveForTests(memoryBlobs(), "r2");
    const master = fs.readFileSync(sentences());
    const sha = sha256Of(master);
    const file = `gossip/${Math.random().toString(16).slice(2)}pieces-commit.mp3`;
    try {
      await db().query(`delete from "take_pieces" where "sha256" = $1`, [sha]);
      await commitTake("quests", file, master, { lineId: "g:pieces-commit", shownText: SAID, wordTimes: SAID_TIMES });
      const { rows } = await db().query(
        `select "method", cardinality("encodedSha256s") as "count" from "take_pieces" where "sha256" = $1`,
        [sha],
      );
      expect(rows).toEqual([{ method: "times", count: 3 }]);
    } finally {
      restore();
      await db().query(`delete from "take_pieces" where "sha256" = $1`, [sha]);
      await db().query(`delete from "take_encoding" where "sha256" = $1`, [sha]);
      await asSystem.query(`delete from "take" where "file" = $1`, [file]);
    }
  });

  it("times an older take with no shown text by its line's current text", async () => {
    const restore = useArchiveForTests(memoryBlobs(), "r2");
    const master = fs.readFileSync(sentences());
    const sha = sha256Of(master);
    const stem = `${Math.random().toString(16).slice(2)}-accept`;
    const file = `quests/${stem}.mp3`;
    try {
      await asSystem.query(
        `insert into "quest_line" ("lineId", "lang", "version", "isCurrent", "origin", "source", "fileName", "text", "originalText")
         values ($1, 'enUS', 1, true, 'extracted', 'quest', $2, $3, $3)`,
        [`q:${stem}:accept`, stem, SAID],
      );
      await commitTake("quests", file, master, { lineId: `q:${stem}:accept`, wordTimes: SAID_TIMES });
      await db().query(`delete from "take_pieces" where "sha256" = $1`, [sha]);

      await cutMissingForPack("quests", "enUS", await english(), 60_000);
      const { rows } = await db().query(`select "method" from "take_pieces" where "sha256" = $1`, [sha]);
      expect(rows).toEqual([{ method: "times" }]);
    } finally {
      restore();
      await db().query(`delete from "take_pieces" where "sha256" = $1`, [sha]);
      await db().query(`delete from "take_encoding" where "sha256" = $1`, [sha]);
      await asSystem.query(`delete from "take" where "file" = $1`, [file]);
      await asSystem.query(`delete from "quest_line" where "fileName" = $1`, [stem]);
    }
  });

  it("cuts a live take with no pieces, with its word times where it has them", async () => {
    const restore = useArchiveForTests(memoryBlobs(), "r2");
    const master = fs.readFileSync(sentences());
    const sha = sha256Of(master);
    const file = `gossip/${Math.random().toString(16).slice(2)}pieces-backfill.mp3`;
    const method = async () =>
      (await db().query(`select "method" from "take_pieces" where "sha256" = $1`, [sha])).rows[0]?.method;
    try {
      await commitTake("quests", file, master, { lineId: "g:pieces-backfill", shownText: SAID, wordTimes: SAID_TIMES });
      await db().query(`delete from "take_pieces" where "sha256" = $1`, [sha]);
      expect(await method()).toBeUndefined();

      expect(await cutMissingForPack("quests", "enUS", await english(), 0)).toEqual({ cut: 0, tried: 0 });
      const { cut } = await cutMissingForPack("quests", "enUS", await english(), 60_000);
      expect(cut).toBeGreaterThanOrEqual(1);
      expect(await method()).toBe("times");
    } finally {
      restore();
      await db().query(`delete from "take_pieces" where "sha256" = $1`, [sha]);
      await db().query(`delete from "take_encoding" where "sha256" = $1`, [sha]);
      await asSystem.query(`delete from "take" where "file" = $1`, [file]);
    }
  });
});
