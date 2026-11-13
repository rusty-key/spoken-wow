/**
 * Reading BroadcastText rows out of a WoW client's DBCache.bin.
 *
 * A gossip window's text arrives from the server as a BroadcastText row, and the client keeps
 * the rows it was sent in `Cache/ADB/<locale>/DBCache.bin` (and in `DBCache.bin<n>.tmp` while
 * it runs). That is the only place a gossip text's id is written down: no Lua API returns it.
 *
 * Parsed in the browser, so only the rows travel to the server rather than the file.
 *
 * The file is a 44-byte header (`XFTH`, u32 version, u32 build, 32-byte hash), then records of
 * a 32-byte header -- `XFTH`, i32 region, i32 pushId, u32 uniqueId, u32 tableHash, u32 recordId,
 * u32 size, u32 status -- and `size` bytes of row. A BroadcastText row starts with its two
 * strings, Text and Text1, each NUL-terminated; the record id is the row's id. Status 1 is a
 * live row; anything else marks one the server withdrew.
 *
 * Free of imports on purpose: the upload page is a client component and reads it.
 */
export type CachedBroadcastText = { id: number; text: string; text1: string };
export type BroadcastCache = { build: number; texts: CachedBroadcastText[] };

const MAGIC = 0x48544658; // "XFTH" read as a little-endian u32
const FILE_HEADER = 44;
const RECORD_HEADER = 32;
const BROADCAST_TEXT = 0x021826bb;
const LIVE = 1;

export function parseBroadcastCache(buffer: ArrayBuffer): BroadcastCache {
  const view = new DataView(buffer);
  if (buffer.byteLength < FILE_HEADER || view.getUint32(0, true) !== MAGIC) {
    throw new Error("not a DBCache file -- pick DBCache.bin from the Cache/ADB folder");
  }
  const build = view.getUint32(8, true);
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder("utf-8");

  const texts = new Map<number, CachedBroadcastText>();
  let pos = FILE_HEADER;
  while (pos + RECORD_HEADER <= buffer.byteLength) {
    // A file the client was still writing can end mid-record; what came before it is whole.
    if (view.getUint32(pos, true) !== MAGIC) break;
    const tableHash = view.getUint32(pos + 16, true);
    const id = view.getUint32(pos + 20, true);
    const size = view.getUint32(pos + 24, true);
    const status = view.getUint32(pos + 28, true);
    const start = pos + RECORD_HEADER;
    pos = start + size;
    if (pos > buffer.byteLength) break;
    if (tableHash !== BROADCAST_TEXT || status !== LIVE) continue;

    const textEnd = bytes.indexOf(0, start);
    if (textEnd < 0 || textEnd >= pos) continue;
    const text1End = bytes.indexOf(0, textEnd + 1);
    if (text1End < 0 || text1End >= pos) continue;
    const text = decoder.decode(bytes.subarray(start, textEnd));
    const text1 = decoder.decode(bytes.subarray(textEnd + 1, text1End));
    if (text || text1) texts.set(id, { id, text, text1 });
  }
  return { build, texts: [...texts.values()] };
}
