/**
 * Serving mp3s: the audio archive and the voice clips.
 *
 * Range support is a requirement, not an optimisation: Safari opens audio with
 * `Range: bytes=0-1` and refuses to play a resource that answers 200, so a naive
 * whole-file response works in Chrome and silently fails in Safari.
 */

/** A quests file as the addon names it: {quests,gossip,followup}/<name>.mp3, nothing else. */
const SAFE_PATH = /^(quests|gossip|followup)\/[^/\\]+\.mp3$/;

export function isSafeAudioPath(rel: string): boolean {
  return SAFE_PATH.test(rel) && !rel.includes("..");
}

export type Range = { start: number; end: number };

/** What a single-range `bytes=` header asks for, before the size is known. */
export type RangeRequest = { start: number; end: number | null } | { suffix: number };

/** Null when there is no range to honour. */
export function requestedRange(header: string | null): RangeRequest | null {
  if (!header) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;
  if (rawStart === "") return { suffix: Number(rawEnd) };
  return { start: Number(rawStart), end: rawEnd === "" ? null : Number(rawEnd) };
}

/** "unsatisfiable" for a range outside the file, which must answer 416, not 206. */
export function resolveRange(wanted: RangeRequest, size: number): Range | "unsatisfiable" {
  let start: number;
  let end: number;
  if ("suffix" in wanted) {
    if (wanted.suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - wanted.suffix);
    end = size - 1;
  } else {
    start = wanted.start;
    end = wanted.end === null ? size - 1 : Math.min(wanted.end, size - 1);
  }

  if (start > end || start >= size) return "unsatisfiable";
  return { start, end };
}

/** A `bytes=` header against a known size: requestedRange, then resolveRange. */
export function parseRange(header: string | null, size: number): Range | null | "unsatisfiable" {
  const wanted = requestedRange(header);
  return wanted ? resolveRange(wanted, size) : null;
}
