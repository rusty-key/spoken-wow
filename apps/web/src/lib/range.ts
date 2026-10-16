/**
 * Serving mp3s: the audio archive and the voice clips.
 *
 * Range support is a requirement, not an optimisation: Safari opens audio with
 * `Range: bytes=0-1` and refuses to play a resource that answers 200, so a naive
 * whole-file response works in Chrome and silently fails in Safari.
 */

/** A file in the quests archive, including the player's combat reactions. */
const SAFE_PATH = /^(quests|gossip|followup|combat)\/[^/\\]+\.mp3$/;

export function isSafeAudioPath(rel: string): boolean {
  return SAFE_PATH.test(rel) && !rel.includes("..");
}

export type Range = { start: number; end: number };

/**
 * Parse a single-range `bytes=` header against a known file size.
 *
 * Returns null when there is no range to honour, and "unsatisfiable" when the client
 * asked for something outside the file - which must answer 416, not 206.
 */
export function parseRange(header: string | null, size: number): Range | null | "unsatisfiable" {
  if (!header) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;

  let start: number;
  let end: number;
  if (rawStart === "") {
    // Suffix form: the last N bytes.
    const length = Number(rawEnd);
    if (length === 0) return "unsatisfiable";
    start = Math.max(0, size - length);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }

  if (start > end || start >= size) return "unsatisfiable";
  return { start, end };
}
