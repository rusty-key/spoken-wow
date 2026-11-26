import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/blobs/keep", async () => {
  const fsp = await import("node:fs/promises");
  const nodePath = await import("node:path");
  return {
    keep: async (_prefix: string, data: Buffer, _type: string, file: string) => {
      await fsp.mkdir(nodePath.dirname(file), { recursive: true });
      await fsp.writeFile(file, data);
      return null;
    },
  };
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), "voice-designs-"));
process.env.SPOKEN_QUESTS_VOICE_DESIGNS = root;
const { designClip, keepDesignAudio } = await import("./audio");

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("design audio", () => {
  it("is named by its hash even when the archive is the volume", async () => {
    const sha = await keepDesignAudio(Buffer.from("preview"), "enUS");
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    const clip = designClip(sha, "enUS");
    expect(clip).toMatchObject({ kind: "file", path: path.join(root, `${sha}.mp3`) });
    expect(fs.readFileSync(path.join(root, `${sha}.mp3`), "utf8")).toBe("preview");
  });
});
