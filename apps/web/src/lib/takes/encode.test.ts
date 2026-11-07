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
const { encodeArchivedForPack, encodeForPack, encodeMissingForPack, encodeOgg, oggDurationSec } = await import("./encode");
const { commitTake } = await import("./commit");
const { asSystem } = await import("@/lib/teams/testing");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "encode-test-"));

function clip(name: string, data: Buffer): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, data);
  return file;
}

function tone(): string {
  const out = path.join(dir, "tone.mp3");
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-b:a", "128k", out]);
  return out;
}

afterAll(async () => {
  fs.rmSync(dir, { recursive: true, force: true });
  await closeDb();
});

describe.skipIf(!tools)("encodeForPack", () => {
  it("encodes a quests take once, puts it in the bucket and records it", async () => {
    const bucket = memoryBlobs();
    const restore = useArchiveForTests(bucket, "dual");
    const master = tone();
    const sha = sha256Of(fs.readFileSync(master));
    try {
      await db().query(`delete from "take_encoding" where "sha256" = $1`, [sha]);
      const first = await encodeForPack("quests", sha, master);
      expect(first).not.toBeNull();
      const object = bucket.objects.get(`encodings/${first!.encodedSha256}`);
      expect(object?.contentType).toBe("audio/ogg");
      expect(object?.data.subarray(0, 4).toString()).toBe("OggS");
      expect(first!.durationSec).toBe(oggDurationSec(object!.data));
      expect(first!.durationSec).toBeGreaterThan(0.9);
      expect(first!.durationSec).toBeLessThan(1.2);

      bucket.objects.clear();
      expect(await encodeForPack("quests", sha, master)).toEqual(first);
      // Recorded, so the second commit of the same bytes encodes nothing.
      expect(bucket.objects.size).toBe(0);
    } finally {
      restore();
      await db().query(`delete from "take_encoding" where "sha256" = $1`, [sha]);
    }
  });

  it("does nothing for a section whose packs ship the take itself", async () => {
    const data = Buffer.from("not audio");
    expect(await encodeForPack("places", sha256Of(data), clip("not-audio.mp3", data))).toBeNull();
  });

  it("encodes a take put back live from the archive, once", async () => {
    const bucket = memoryBlobs();
    const restore = useArchiveForTests(bucket, "r2");
    const master = fs.readFileSync(tone());
    const sha = sha256Of(master);
    try {
      await db().query(`delete from "take_encoding" where "sha256" = $1`, [sha]);
      await bucket.put(`takes/${sha}`, master, "audio/mpeg");
      await encodeArchivedForPack("quests", sha);
      const encodings = [...bucket.objects.keys()].filter((key) => key.startsWith("encodings/"));
      expect(encodings).toHaveLength(1);

      await encodeArchivedForPack("quests", sha);
      expect([...bucket.objects.keys()].filter((key) => key.startsWith("encodings/"))).toEqual(encodings);
    } finally {
      restore();
      await db().query(`delete from "take_encoding" where "sha256" = $1`, [sha]);
    }
  });

  it("encodes a live take whose encoding failed at commit, before a release", async () => {
    const bucket = memoryBlobs();
    const restore = useArchiveForTests(bucket, "r2");
    const master = fs.readFileSync(tone());
    const sha = sha256Of(master);
    const file = `gossip/${Math.random().toString(16).slice(2)}encode-missing.mp3`;
    const encoded = async () =>
      (await db().query(`select 1 from "take_encoding" where "source" = 'quests' and "sha256" = $1`, [sha])).rowCount;
    try {
      await commitTake("quests", file, master, { lineId: "g:encode-missing" });
      await db().query(`delete from "take_encoding" where "sha256" = $1`, [sha]);
      expect(await encoded()).toBe(0);

      await encodeMissingForPack("quests", "enUS");
      expect(await encoded()).toBe(1);
    } finally {
      restore();
      await db().query(`delete from "take_encoding" where "sha256" = $1`, [sha]);
      await asSystem.query(`delete from "take" where "file" = $1`, [file]);
    }
  });

  it.each([null, 0])("replaces an encoding whose duration is %s, which a release stops on", async (duration) => {
    const bucket = memoryBlobs();
    const restore = useArchiveForTests(bucket, "r2");
    const master = fs.readFileSync(tone());
    const sha = sha256Of(master);
    const file = `gossip/${Math.random().toString(16).slice(2)}encode-missing.mp3`;
    try {
      await commitTake("quests", file, master, { lineId: "g:encode-missing" });
      await db().query(`update "take_encoding" set "durationSec" = $2 where "sha256" = $1`, [sha, duration]);

      await encodeMissingForPack("quests", "enUS");
      const { rows } = await db().query(`select "durationSec"::float8 as "d" from "take_encoding" where "sha256" = $1`, [sha]);
      expect(rows).toHaveLength(1);
      expect(rows[0].d).toBeGreaterThan(0.9);
    } finally {
      restore();
      await db().query(`delete from "take_encoding" where "sha256" = $1`, [sha]);
      await asSystem.query(`delete from "take" where "file" = $1`, [file]);
    }
  });

  it("encodes nothing once its time is spent, so the request that starts a release stays short", async () => {
    const bucket = memoryBlobs();
    const restore = useArchiveForTests(bucket, "r2");
    const master = fs.readFileSync(tone());
    const sha = sha256Of(master);
    const file = `gossip/${Math.random().toString(16).slice(2)}encode-missing.mp3`;
    try {
      await commitTake("quests", file, master, { lineId: "g:encode-missing" });
      await db().query(`delete from "take_encoding" where "sha256" = $1`, [sha]);

      await encodeMissingForPack("quests", "enUS", 0);
      expect((await db().query(`select 1 from "take_encoding" where "sha256" = $1`, [sha])).rowCount).toBe(0);
    } finally {
      restore();
      await asSystem.query(`delete from "take" where "file" = $1`, [file]);
    }
  });

  it("puts a failed encode in the language's activity log, where an admin can read why", async () => {
    const restore = useArchiveForTests(memoryBlobs(), "r2");
    const file = `gossip/${Math.random().toString(16).slice(2)}encode-missing.mp3`;
    try {
      await commitTake("quests", file, Buffer.from("not audio"), { lineId: "g:encode-missing" });
      const { rows } = await asSystem.query(
        `select "lang", "source", "lineId", "detail" from "activity" where "kind" = 'take.encode_failed' and "subject" = $1`,
        [file],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ lang: "enUS", source: "quests", lineId: "g:encode-missing", detail: { version: 1 } });
      expect(rows[0].detail.error).toMatch(/ffmpeg exited/);
      expect(rows[0].detail.error).not.toContain(os.tmpdir());

      // A press that fails on it again says nothing new, so the log keeps the one row.
      await encodeMissingForPack("quests", "enUS");
      const { rowCount } = await asSystem.query(
        `select 1 from "activity" where "kind" = 'take.encode_failed' and "subject" = $1`,
        [file],
      );
      expect(rowCount).toBe(1);
    } finally {
      restore();
      await asSystem.query(`delete from "activity" where "subject" = $1`, [file]);
      await asSystem.query(`delete from "take" where "file" = $1`, [file]);
    }
  });

  it("logs and gives up on a clip it cannot decode", async () => {
    const restore = useArchiveForTests(memoryBlobs(), "r2");
    try {
      const data = Buffer.from("not audio");
      expect(await encodeForPack("quests", sha256Of(data), clip("not-audio.mp3", data))).toBeNull();
    } finally {
      restore();
    }
  });
});

describe("oggDurationSec", () => {
  const page = (flags: number, granule: bigint, serial: number, body: Buffer) => {
    const header = Buffer.alloc(27);
    header.write("OggS", 0, "latin1");
    header[5] = flags;
    header.writeBigInt64LE(granule, 6);
    header.writeUInt32LE(serial, 14);
    return Buffer.concat([header, body]);
  };
  const identification = Buffer.alloc(30);
  identification.writeUInt32LE(44100, 13);

  it("is the last page's granule over the sample rate", () => {
    const ogg = Buffer.concat([page(2, 0n, 7, identification), page(4, 88200n, 7, Buffer.from("audio"))]);
    expect(oggDurationSec(ogg)).toBe(2);
  });

  it("is not fooled by audio that happens to spell a page's capture pattern", () => {
    const ogg = Buffer.concat([page(2, 0n, 7, identification), page(4, 44100n, 7, Buffer.from("OggS and more"))]);
    expect(oggDurationSec(ogg)).toBe(1);
  });

  it("refuses what is not an Ogg", () => {
    expect(() => oggDurationSec(Buffer.from("not audio"))).toThrow("not an Ogg");
  });
});

describe("encodeOgg", () => {
  it("rejects, rather than crashing the server, when neither encoder exists", async () => {
    const master = clip("missing-tools.mp3", Buffer.from("not audio"));
    await expect(encodeOgg(master, { ffmpeg: "/nonexistent/ffmpeg", oggenc: "/nonexistent/oggenc" })).rejects.toThrow(
      /ENOENT/,
    );
  });

  it.skipIf(!has("ffmpeg", "-version"))("rejects when the encoder is missing or quits while ffmpeg writes to it", async () => {
    const master = tone();
    await expect(encodeOgg(master, { ffmpeg: "ffmpeg", oggenc: "/nonexistent/oggenc" })).rejects.toThrow();
    await expect(encodeOgg(master, { ffmpeg: "ffmpeg", oggenc: "false" })).rejects.toThrow();
  });
});
