// Every archive object is named by its SHA-256. A download is checked against that name before
// it is renamed into place: a pack built from a truncated clip would ship it to every player.
import { createHash } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const PARALLEL = 16;

export const archiveBase = (url) => (url.endsWith("/") ? url : `${url}/`);

const RETRIES = 5;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The archive's CDN answers 429 to a burst, so one refused clip must not fail a whole pack's build.
export async function fetchRetrying(url, fetchImpl = fetch, wait = sleep) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url);
    if ((res.status !== 429 && res.status < 500) || attempt === RETRIES) return res;
    const after = Number(res.headers?.get("retry-after"));
    await wait((after > 0 ? after : 2 ** attempt) * 1000);
  }
}

export async function downloadVerified(url, sha256, target, fetchImpl = fetch, wait = sleep) {
  try {
    const res = await fetchRetrying(url, fetchImpl, wait);
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

export async function eachParallel(items, work, parallel = PARALLEL) {
  const queue = [...items];
  const worker = async () => {
    while (queue.length) await work(queue.shift());
  };
  await Promise.all(Array.from({ length: parallel }, worker));
}
