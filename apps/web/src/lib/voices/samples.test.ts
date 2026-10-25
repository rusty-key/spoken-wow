import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

// paths.ts reads the env at import time, so the temp directory has to be in place before
// the module graph is loaded.
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "voiceover-samples-"));
  process.env.SPOKEN_QUESTS_VOICE_SAMPLES = dir;
  vi.resetModules();
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  delete process.env.SPOKEN_QUESTS_VOICE_SAMPLES;
});

async function load() {
  return import("./samples");
}

describe("storedNameFor", () => {
  it("keeps the extension and a readable remnant of the original name", async () => {
    const { storedNameFor } = await load();
    expect(storedNameFor("orc greeting 1.mp3")).toMatch(/^[0-9a-f]{8}-orc-greeting-1\.mp3$/);
  });

  it("is unique, so identically named clips do not collide", async () => {
    const { storedNameFor } = await load();
    expect(storedNameFor("greeting.mp3")).not.toBe(storedNameFor("greeting.mp3"));
  });

  // The client's filename reaches the filesystem only through here, so separators and
  // traversal must not survive it.
  it("strips anything meaningful to a filesystem", async () => {
    const { storedNameFor, isStoredSampleName } = await load();
    for (const hostile of ["../../etc/passwd.mp3", "a/b/c.mp3", "...mp3", "  .mp3"]) {
      const stored = storedNameFor(hostile);
      expect(stored).not.toContain("/");
      expect(stored).not.toContain("..");
      expect(isStoredSampleName(stored)).toBe(true);
    }
  });
});

describe("isStoredSampleName", () => {
  it("refuses names it did not generate", async () => {
    const { isStoredSampleName } = await load();
    expect(isStoredSampleName("greeting.mp3")).toBe(false);
    expect(isStoredSampleName("../secrets.mp3")).toBe(false);
    expect(isStoredSampleName("deadbeef-clip.exe")).toBe(false);
    expect(isStoredSampleName(".deadbeef-clip.mp3.part")).toBe(false);
  });
});

describe("samplePath", () => {
  it("refuses an unknown voice slot", async () => {
    const { samplePath } = await load();
    await expect(samplePath("murloc-male", "deadbeef-a.mp3")).rejects.toThrow(
      /unknown voice slot/,
    );
  });

  it("refuses a name it did not generate", async () => {
    const { samplePath } = await load();
    await expect(samplePath("orc-male-standard", "../../etc/passwd")).rejects.toThrow(
      /unsafe sample name/,
    );
  });
});

describe("storeSample and listSamples", () => {
  it("returns no clips for a voice that has none", async () => {
    const { listSamples } = await load();
    expect(await listSamples("orc-male-standard")).toEqual([]);
  });

  it("writes a clip and lists it back", async () => {
    const { storeSample, listSamples } = await load();
    const stored = await storeSample("orc-male-standard", "greeting.mp3", Buffer.from("audio-bytes"));

    const listed = await listSamples("orc-male-standard");
    expect(listed).toHaveLength(1);
    expect(listed[0].file).toBe(stored.file);
    expect(listed[0].bytes).toBe(11);
  });

  it("keeps voices separate", async () => {
    const { storeSample, listSamples } = await load();
    await storeSample("orc-male-standard", "a.mp3", Buffer.from("x"));
    expect(await listSamples("tauren-male-warrior")).toEqual([]);
  });

  // A .part left by an interrupted write must never be offered as a clip, or a truncated
  // file would be sent to ElevenLabs as training audio.
  it("ignores partial writes left in the directory", async () => {
    const { storeSample, listSamples } = await load();
    await storeSample("orc-male-standard", "good.mp3", Buffer.from("x"));
    await fs.writeFile(path.join(dir, "orc-male-standard", ".deadbeef-half.mp3.part"), "truncated");

    const listed = await listSamples("orc-male-standard");
    expect(listed).toHaveLength(1);
    expect(listed[0].file).not.toContain(".part");
  });

  it("deletes a clip", async () => {
    const { storeSample, deleteSample, listSamples } = await load();
    const stored = await storeSample("orc-male-standard", "a.mp3", Buffer.from("x"));

    expect(await deleteSample("orc-male-standard", stored.file)).toBe(true);
    expect(await listSamples("orc-male-standard")).toEqual([]);
    expect(await deleteSample("orc-male-standard", stored.file)).toBe(false);
  });
});

describe("rejectUpload", () => {
  it("accepts a normal upload", async () => {
    const { rejectUpload } = await load();
    expect(rejectUpload([{ name: "a.mp3", size: 1_000_000 }], [])).toBeNull();
  });

  it("refuses an unsupported format, naming it", async () => {
    const { rejectUpload } = await load();
    expect(rejectUpload([{ name: "a.txt", size: 10 }], [])).toMatch(/\.txt is not/);
    expect(rejectUpload([{ name: "noext", size: 10 }], [])).toMatch(/without an extension/);
  });

  it("refuses an empty file", async () => {
    const { rejectUpload } = await load();
    expect(rejectUpload([{ name: "a.mp3", size: 0 }], [])).toMatch(/is empty/);
  });

  it("refuses a file over the per-file limit", async () => {
    const { rejectUpload, MAX_FILE_BYTES } = await load();
    expect(rejectUpload([{ name: "a.mp3", size: MAX_FILE_BYTES + 1 }], [])).toMatch(/per file/);
  });

  // The aggregate limits count what is already stored, so an upload cannot slip past by
  // arriving one file at a time.
  it("counts existing clips toward the count limit", async () => {
    const { rejectUpload, MAX_FILES_PER_VOICE } = await load();
    const existing = Array.from({ length: MAX_FILES_PER_VOICE }, (_, i) => ({
      file: `f${i}.mp3`,
      bytes: 1,
      uploadedAt: "",
    }));
    expect(rejectUpload([{ name: "a.mp3", size: 1 }], existing)).toMatch(/the limit is 25/);
  });

  it("counts existing clips toward the size limit", async () => {
    const { rejectUpload, MAX_TOTAL_BYTES } = await load();
    const existing = [{ file: "a.mp3", bytes: MAX_TOTAL_BYTES - 10, uploadedAt: "" }];
    expect(rejectUpload([{ name: "b.mp3", size: 1000 }], existing)).toMatch(/per voice/);
  });

  it("refuses an upload with no files", async () => {
    const { rejectUpload } = await load();
    expect(rejectUpload([], [])).toMatch(/no files/);
  });
});

describe("with clips in the bucket", () => {
  it("stores, lists, reads and removes a clip without touching the volume", async () => {
    const { storeSample, listSamples, readSample, sampleUrl, deleteSample } = await load();
    const { memoryBlobs, sha256Of, useArchiveForTests } = await import("@/lib/blobs/store");
    const { query } = await import("@/lib/db");
    const bucket = memoryBlobs("https://archive.test/");
    const restore = useArchiveForTests(bucket, "r2");
    const clone = "orc-male-standard@deDE";
    try {
      await query(`delete from "voice_sample" where "clone" = $1`, [clone]);
      const stored = await storeSample(clone, "greeting.mp3", Buffer.from("guten tag"));
      const sha = sha256Of(Buffer.from("guten tag"));

      expect(bucket.objects.get(`samples/${sha}`)?.contentType).toBe("audio/mpeg");
      expect((await listSamples(clone)).map((s) => [s.file, s.bytes])).toEqual([[stored.file, 9]]);
      expect((await readSample(clone, stored.file))?.toString()).toBe("guten tag");
      expect(await sampleUrl(clone, stored.file)).toBe(`https://archive.test/samples/${sha}`);
      expect(await fs.readdir(dir)).toEqual([]);

      expect(await deleteSample(clone, stored.file)).toBe(true);
      expect(await listSamples(clone)).toEqual([]);
      expect(await sampleUrl(clone, stored.file)).toBeNull();
    } finally {
      restore();
      await query(`delete from "voice_sample" where "clone" = $1`, [clone]);
    }
  });
});
