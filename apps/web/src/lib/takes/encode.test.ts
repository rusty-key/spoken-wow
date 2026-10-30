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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "encode-test-"));

/** `data` in a file of its own, as commitTake hands the encoder its archived take. */
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
      expect(first!.durationSec).toBeCloseTo(1, 1);

      bucket.objects.clear();
      expect(await encodeForPack("quests", sha, master)).toEqual(first);
      // Recorded, so the second commit of the same bytes encodes nothing.
      expect(bucket.objects.size).toBe(0);
    } finally {
      restore();
      await db().query(`delete from "take_encoding" where "sha256" = $1`, [sha]);
    }
  });

  it("does nothing for a section whose packs ship the take itself, or with no bucket", async () => {
    const data = Buffer.from("not audio");
    const master = clip("not-audio.mp3", data);
    expect(await encodeForPack("places", sha256Of(data), master)).toBeNull();
    expect(await encodeForPack("quests", sha256Of(data), master)).toBeNull();
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
