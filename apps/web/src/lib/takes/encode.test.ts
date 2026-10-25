/**
 * The pack's encoding of a take, made at commit. Against real ffmpeg and oggenc, which is the
 * whole of what can go wrong here; skipped on a machine without them.
 */
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
const { encodeForPack } = await import("./encode");

function tone(): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "encode-test-"));
  const out = path.join(dir, "tone.mp3");
  execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-b:a", "128k", out]);
  const data = fs.readFileSync(out);
  fs.rmSync(dir, { recursive: true, force: true });
  return data;
}

afterAll(async () => {
  await closeDb();
});

describe.skipIf(!tools)("encodeForPack", () => {
  it("encodes a quests take once, puts it in the bucket and records it", async () => {
    const bucket = memoryBlobs();
    const restore = useArchiveForTests(bucket, "dual");
    const data = tone();
    const sha = sha256Of(data);
    try {
      await db().query(`delete from "take_encoding" where "sha256" = $1`, [sha]);
      const first = await encodeForPack("quests", sha, data);
      expect(first).not.toBeNull();
      const object = bucket.objects.get(`encodings/${first!.encodedSha256}`);
      expect(object?.contentType).toBe("audio/ogg");
      expect(object?.data.subarray(0, 4).toString()).toBe("OggS");
      expect(first!.durationSec).toBeCloseTo(1, 1);

      bucket.objects.clear();
      expect(await encodeForPack("quests", sha, data)).toEqual(first);
      // Recorded, so the second commit of the same bytes encodes nothing.
      expect(bucket.objects.size).toBe(0);
    } finally {
      restore();
      await db().query(`delete from "take_encoding" where "sha256" = $1`, [sha]);
    }
  });

  it("does nothing for a section whose packs ship the take itself, or with no bucket", async () => {
    const data = Buffer.from("not audio");
    expect(await encodeForPack("places", sha256Of(data), data)).toBeNull();
    expect(await encodeForPack("quests", sha256Of(data), data)).toBeNull();
  });

  it("logs and gives up on a clip it cannot decode", async () => {
    const restore = useArchiveForTests(memoryBlobs(), "r2");
    try {
      const data = Buffer.from("not audio");
      expect(await encodeForPack("quests", sha256Of(data), data)).toBeNull();
    } finally {
      restore();
    }
  });
});
