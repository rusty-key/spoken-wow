// The Ogg every sound pack ships: ffmpeg decodes to mono, oggenc -q 0 encodes (ogg-q0-44k).
// The site's encoder (apps/web/src/lib/takes/encode.ts) uses the same two settings, so a clip
// encoded here sounds the same as the site's; the bytes differ, as oggenc's do every run.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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
  // Unique, so two encodes of one clip, in this build or another sharing the cache, never write
  // into the same scratch file.
  const part = `${to}.${randomUUID()}.part`;
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

// Encodes running in this process, by cache file.
const encoding = new Map();

/**
 * `master` encoded, from `cache` when it was encoded before. Keyed by the master's SHA-256 (the
 * take's own hash when the caller has it), so a re-cut line misses rather than reusing a stale
 * encode. Returns the cached file.
 */
export async function cachedOgg(master, cache, sha256 = null) {
  const cached = join(cache, `${sha256 || (await sha256Of(master))}.ogg`);
  // Two live takes can share a master, and so a cache entry: the second waits for the first's encode.
  if (!encoding.has(cached)) {
    encoding.set(cached, stat(cached).catch(() => encodeOgg(master, cached)).finally(() => encoding.delete(cached)));
  }
  await encoding.get(cached);
  return cached;
}

/** Whether both encoders are on PATH, so a build can say so before it starts. */
export async function haveEncoders() {
  const found = (tool) =>
    run(spawn(tool, [tool === "ffmpeg" ? "-version" : "--version"], { stdio: "ignore" }), tool).then(() => true, () => false);
  return (await found("ffmpeg")) && (await found("oggenc"));
}
