import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { measureAudio, measureFiles } = await import("./measure");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "voice-measure-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const MEASURES = {
  f0Hz: 98,
  f0RangeSt: 3,
  hnrDb: 5,
  jitter: 0.02,
  shimmerDb: 1.2,
  alphaRatioDb: -12,
  hammarbergDb: 20,
  h1h2Db: 2,
  loudness: 0.8,
  voicedPerSec: 2.5,
};

/** An interpreter that ignores the script and answers every path it is given with MEASURES. */
function fakePython(body: string): string {
  const file = path.join(root, `python-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
}

const echoing = () =>
  fakePython(
    `shift; out="{"; sep=""; for f in "$@"; do out="$out$sep\\"$f\\": ${JSON.stringify(MEASURES).replace(/"/g, '\\"')}"; sep=","; done; echo "$out}"`,
  );

describe("measureFiles", () => {
  it("measures nothing when the site has no openSMILE", async () => {
    expect(await measureFiles(["/a.mp3"], { python: undefined })).toBeNull();
  });

  it("reads the helper's JSON", async () => {
    const result = await measureFiles(["/a.mp3", "/b.mp3"], { python: echoing(), script: "/x.py" });
    expect(result?.get("/a.mp3")).toEqual(MEASURES);
    expect(result?.get("/b.mp3")).toEqual(MEASURES);
  });

  it("reads a failed run as no measurements, not an error", async () => {
    expect(await measureFiles(["/a.mp3"], { python: fakePython("exit 1"), script: "/x.py" })).toBeNull();
    expect(await measureFiles(["/a.mp3"], { python: fakePython("echo nonsense"), script: "/x.py" })).toBeNull();
  });

  it("keeps what part of a file was measured", async () => {
    const python = fakePython(`echo '{"/a.mp3": {"ess": 0.05, "decay": -20.1, "level": -13.2}}'`);
    expect((await measureFiles(["/a.mp3"], { python, script: "/x.py" }))?.get("/a.mp3")).toEqual({ ess: 0.05, decay: -20.1, level: -13.2 });
  });

  it("leaves out a file the helper could not read", async () => {
    const python = fakePython(`echo '{"/a.mp3": {"error": "bad"}}'`);
    expect((await measureFiles(["/a.mp3"], { python, script: "/x.py" }))?.has("/a.mp3")).toBe(false);
  });
});

describe("measureAudio", () => {
  it("measures buffers in the order given", async () => {
    const result = await measureAudio([Buffer.from("a"), Buffer.from("b")], { python: echoing(), script: "/x.py" });
    expect(result).toEqual([MEASURES, MEASURES]);
  });
});
