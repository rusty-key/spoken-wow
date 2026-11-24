// The Ogg every sound pack ships: ffmpeg decodes to mono, oggenc -q 0 encodes (ogg-q0-44k).
// The site encodes each take the same way when it is committed (apps/web/src/lib/takes/encode.ts),
// so a clip encoded here and one the site encoded play the same.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

function run(child, what) {
  return new Promise((done, fail) => {
    child.on("error", fail);
    child.on("close", (code) => (code === 0 ? done() : fail(new Error(`${what} exited ${code}`))));
  });
}

/** `from` (any format ffmpeg reads) encoded into `to`, which only appears once it is complete. */
export async function encodeOgg(from, to) {
  await mkdir(dirname(to), { recursive: true });
  // The pid too, so two builds sharing a cache cannot write into each other's scratch file.
  const part = `${to}.${process.pid}.part`;
  const ffmpeg = spawn("ffmpeg", ["-nostdin", "-loglevel", "error", "-i", from, "-ac", "1", "-map_metadata", "-1", "-bitexact", "-f", "wav", "-"], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const oggenc = spawn("oggenc", ["-Q", "-q", "0", "-o", part, "-"], { stdio: ["pipe", "inherit", "inherit"] });
  // Piped here rather than handed over as oggenc's stdin: a stream given as another child's
  // stdio is not a handle Node waits on, and the build exited with every encode unfinished.
  ffmpeg.stdout.pipe(oggenc.stdin);
  try {
    await Promise.all([run(ffmpeg, `ffmpeg on ${from}`), run(oggenc, `oggenc for ${to}`)]);
    await rename(part, to);
  } catch (error) {
    ffmpeg.kill();
    oggenc.kill();
    await rm(part, { force: true });
    throw error;
  }
}

async function sha256Of(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/**
 * `master` encoded, from `cache` when it was encoded before. Keyed by the master's SHA-256 (the
 * take's own hash when the caller has it), so a re-cut line misses rather than reusing a stale
 * encode. Returns the cached file.
 */
export async function cachedOgg(master, cache, sha256 = null) {
  const cached = join(cache, `${sha256 || (await sha256Of(master))}.ogg`);
  try {
    await stat(cached);
  } catch {
    await encodeOgg(master, cached);
  }
  return cached;
}

/** Whether both encoders are on PATH, so a build can say so before it starts. */
export async function haveEncoders() {
  const found = (tool) =>
    run(spawn(tool, [tool === "ffmpeg" ? "-version" : "--version"], { stdio: "ignore" }), tool).then(() => true, () => false);
  return (await found("ffmpeg")) && (await found("oggenc"));
}
