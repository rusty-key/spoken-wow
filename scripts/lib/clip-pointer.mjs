// A small file standing where a clip goes, naming the archive object that clip is. A Manager pack
// can be built from these, because the packaging only moves clips around, and scripts/manager/publish.mjs
// copies the real bytes across for the ones the channel lacks. Never for a zip: it would ship these.
import { readFile, stat } from "node:fs/promises";

const MAGIC = "spoken-clip-pointer";
const MAX_SIZE = 200;
const LINE = new RegExp(`^${MAGIC} (takes|encodings)/([0-9a-f]{64}) (\\d+)\\n$`);

export const pointerText = (sha256, size, prefix = "takes") => `${MAGIC} ${prefix}/${sha256} ${size}\n`;

/** { sha256, size, key }, or null for a file that is really a clip. */
export async function readPointer(file) {
  if ((await stat(file)).size > MAX_SIZE) return null;
  const match = LINE.exec(await readFile(file, "latin1"));
  return match && { sha256: match[2], size: Number(match[3]), key: `${match[1]}/${match[2]}` };
}
