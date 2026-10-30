// Downloads from the public archive bucket, where every object is named by its SHA-256.
//
// One rule for fetch-blobs.mjs (the masters) and fetch-encodings.mjs (their pack encodings):
// a download is checked against its name and written beside its target as .part before it is
// renamed into place, so a truncated or wrong file never sits where a build will read it.
import { createHash } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const PARALLEL = 16;

// SPOKEN_ARCHIVE_URL with the trailing slash the object paths are appended to.
export const archiveBase = (url) => (url.endsWith("/") ? url : `${url}/`);

export async function downloadVerified(url, sha256, target, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = Buffer.from(await res.arrayBuffer());
    const got = createHash("sha256").update(data).digest("hex");
    if (got !== sha256) throw new Error(`got bytes hashing to ${got}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(`${target}.part`, data);
    await rename(`${target}.part`, target);
  } catch (error) {
    await rm(`${target}.part`, { force: true });
    throw error;
  }
}

// Runs work(item) for every item, `parallel` at a time.
export async function eachParallel(items, work, parallel = PARALLEL) {
  const queue = [...items];
  const worker = async () => {
    while (queue.length) await work(queue.shift());
  };
  await Promise.all(Array.from({ length: parallel }, worker));
}
