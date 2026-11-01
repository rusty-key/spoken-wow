// A small file standing where a clip goes, naming the archive object that clip is. A Manager pack
// can be built from these, because the packaging only moves clips around, and scripts/manager/publish.mjs
// copies the real bytes across for the ones the channel lacks. Never for a zip: it would ship these.
import { readFile, stat, writeFile } from "node:fs/promises";

import { archiveBase, eachParallel, fetchRetrying } from "./download.mjs";

const MAGIC = "spoken-clip-pointer";
const MAX_SIZE = 200;
const LINE = new RegExp(`^${MAGIC} takes/([0-9a-f]{64}) (\\d+)\\n$`);

export const pointerText = (sha256, size) => `${MAGIC} takes/${sha256} ${size}\n`;

/** { sha256, size, key }, or null for a file that is really a clip. */
export async function readPointer(file) {
  if ((await stat(file)).size > MAX_SIZE) return null;
  const match = LINE.exec(await readFile(file, "latin1"));
  return match && { sha256: match[1], size: Number(match[2]), key: `takes/${match[1]}` };
}

/**
 * Writes each take's pointer, asking the archive for its size. Returns the paths it could not, as
 * { target, reason }: a take with no object in the archive would be a line that ships silent.
 */
export async function writePointers(takes, base, { fetchImpl = fetch, log = console.log } = {}) {
  const missing = [];
  let done = 0;
  await eachParallel(takes, async ({ sha256, target }) => {
    const url = `${archiveBase(base)}takes/${sha256}`;
    const res = await fetchRetrying(url, (u) => fetchImpl(u, { method: "HEAD" }));
    const size = Number(res.headers.get("content-length"));
    if (res.ok && size > 0) await writeFile(target, pointerText(sha256, size));
    else missing.push({ target, reason: res.ok ? "the archive gave no size" : `HTTP ${res.status}` });
    if (++done % 500 === 0) log(`  ${done}/${takes.length} clips`);
  });
  return missing;
}
