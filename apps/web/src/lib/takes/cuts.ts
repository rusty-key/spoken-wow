/**
 * Where a take is cut into sentence pieces, so a paused line can resume from its sentence.
 *
 * The client can start a sound only from its beginning, so a line kept as pieces played back to
 * back is the only way to resume part-way (addons/Spoken/SoundQueue.lua). A take with word times
 * is cut just before the first word of each sentence, read off the times. One without them, or
 * whose times do not fit its text, is cut in the middle of its pauses: full stops measured 0.5 to
 * 0.7 s and commas about 0.26 s, so `minPause` takes the first and leaves the second. Either way a
 * piece still longer than `maxPiece` is cut again, at a clause or a shorter pause.
 *
 * Pure: ./pieces measures and cuts the audio.
 */

export type CutSettings = {
  /** Seconds of quiet that count as the end of a sentence. */
  minPause: number;
  /** A shorter piece is merged into the next: a resume that backs up less gains nothing. */
  minPiece: number;
  /** A shorter tail stays on the piece before it, so a line never ends on a scrap. */
  minTail: number;
  /** Longer than this, a piece is cut again: a resume should not back up most of a line. */
  maxPiece: number;
  /** The shortest pause that second cut may use. 0 turns it off. */
  fallbackPause: number;
};

export const CUTS: CutSettings = { minPause: 0.45, minPiece: 2, minTail: 1.5, maxPiece: 12, fallbackPause: 0.25 };

/** Quieter than this is a pause. The takes are normalised speech, so a fixed level holds. */
export const NOISE_DB = -35;

/**
 * A timed cut goes this long before the first word of its sentence, inside the pause before it.
 * Measured on 789-accept, each full stop's pause ended 0.04 to 0.09 s before the word's time and
 * began 0.6 s or more before it, so this lands near the middle of each.
 */
export const WORD_LEAD = 0.25;

/** Words ending in a full stop that do not end a sentence. */
const ABBREVIATIONS = new Set([
  "mr.", "mrs.", "ms.", "dr.", "st.", "mt.", "lt.", "sgt.", "capt.", "col.", "gen.", "cmdr.", "vs.", "jr.", "sr.",
]);
const SENTENCE_END = /[.!?…]["'”’)\]]*$/;
const CLAUSE_END = /[,;:—–]["'”’)\]]*$/;
const OPENING = /^["'“‘([]+/;

const round3 = (seconds: number) => Math.round(seconds * 1000) / 1000;

function isAbbreviation(word: string): boolean {
  const bare = word.replace(OPENING, "").toLowerCase();
  return ABBREVIATIONS.has(bare) || /^[a-z]\.$/.test(bare);
}

function isLower(char: string): boolean {
  return char !== "" && char === char.toLowerCase() && char !== char.toUpperCase();
}

/**
 * The words of `text`, split at whitespace as word times are, that start a sentence after the
 * first, and those that start a clause, as indices. A word starts a sentence after a full stop,
 * question or exclamation mark, or ellipsis, unless it is lower case (an ellipsis inside a
 * sentence) or the stop ends an abbreviation; and after a line break, as each paragraph does. A word
 * after a comma, semicolon, colon or dash starts a clause.
 */
export function sentenceStarts(text: string): { sentences: number[]; clauses: number[] } {
  const tokens = [...text.matchAll(/\S+/g)];
  const sentences: number[] = [];
  const clauses: number[] = [];
  for (let i = 1; i < tokens.length; i++) {
    const before = tokens[i - 1][0];
    const word = tokens[i][0];
    const gap = text.slice(tokens[i - 1].index! + before.length, tokens[i].index);
    if (gap.includes("\n")) {
      sentences.push(i);
    } else if (SENTENCE_END.test(before) && !isAbbreviation(before) && !isLower(word.replace(OPENING, "").charAt(0))) {
      sentences.push(i);
    } else if (CLAUSE_END.test(before)) {
      clauses.push(i);
    }
  }
  return { sentences, clauses };
}

/**
 * Cuts at `firsts`, the sentence ends, in order, where each leaves both sides long enough; then a
 * piece longer than `maxPiece` is cut at the strongest of `spares`, [seconds, strength], that fits,
 * the one nearest its middle among equals.
 */
function choose(firsts: number[], spares: [number, number][], duration: number, s: CutSettings): number[] {
  let cuts: number[] = [];
  let last = 0;
  for (const at of firsts) {
    if (at - last >= s.minPiece && duration - at >= s.minTail) {
      cuts.push(round3(at));
      last = at;
    }
  }
  if (!s.maxPiece || spares.length === 0) return cuts;
  let spare = spares
    .map(([at, strength]): [number, number] => [round3(at), strength])
    .filter(([at]) => !cuts.includes(at))
    .sort((a, b) => a[0] - b[0]);
  for (let changed = true; changed; ) {
    changed = false;
    const bounds = [0, ...cuts, duration];
    for (let i = 0; i + 1 < bounds.length; i++) {
      const [a, b] = [bounds[i], bounds[i + 1]];
      if (b - a <= s.maxPiece) continue;
      let best: { strength: number; nearness: number; at: number } | null = null;
      for (const [at, strength] of spare) {
        if (at - a < s.minPiece || b - at < (b === duration ? s.minTail : s.minPiece)) continue;
        const nearness = -Math.abs(at - (a + b) / 2);
        if (!best || strength > best.strength || (strength === best.strength && nearness > best.nearness)
          || (strength === best.strength && nearness === best.nearness && at > best.at)) {
          best = { strength, nearness, at };
        }
      }
      if (best) {
        const at = best.at;
        cuts = [...cuts, at].sort((x, y) => x - y);
        spare = spare.filter(([t]) => t !== at);
        changed = true;
        break;
      }
    }
  }
  return cuts;
}

/**
 * The times to cut a line at, from its pauses as [start, end] seconds, in order. Pauses at least
 * `minPause` long are sentence ends and are cut first, in their middle; a piece still too long is
 * cut at the longest of its pauses at least `fallbackPause` long.
 */
export function chooseCuts(silences: [number, number][], duration: number, s: CutSettings = CUTS): number[] {
  const firsts = silences.filter(([start, end]) => end - start >= s.minPause).map(([start, end]) => (start + end) / 2);
  const spares = s.fallbackPause
    ? silences
        .filter(([start, end]) => end - start >= s.fallbackPause)
        .map(([start, end]): [number, number] => [(start + end) / 2, end - start])
    : [];
  return choose(firsts, spares, duration, s);
}

/**
 * The times to cut a line at from the start of each of its words, or null where the times do not
 * fit its text (another count, out of order, or past its end), so the line is measured instead.
 * A cut goes WORD_LEAD before the first word of each sentence, never nearer the word before than
 * the middle of the two: that word must be heard whole. A piece still too long is cut at a clause,
 * the one whose words are furthest apart first.
 */
export function chooseTimedCuts(
  text: string,
  times: readonly number[],
  duration: number,
  s: CutSettings = CUTS,
): number[] | null {
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words === 0 || times.length !== words || times.some((t, i) => i > 0 && t < times[i - 1])
    || times[times.length - 1] >= duration) {
    return null;
  }
  const { sentences, clauses } = sentenceStarts(text);
  const at = (i: number) => Math.max(times[i] - WORD_LEAD, (times[i - 1] + times[i]) / 2);
  const firsts = sentences.map(at);
  const spares: [number, number][] = sentences.map((i): [number, number] => [at(i), Infinity]);
  if (s.fallbackPause) spares.push(...clauses.map((i): [number, number] => [at(i), times[i] - times[i - 1]]));
  return choose(firsts, spares, duration, s);
}

/**
 * How far a timed cut may move to reach a pause. Word times run up to about 0.2 s off where a
 * narrator's stage direction meets the NPC's words, which the site joins from separate requests:
 * on 400 English quest takes every cut that fell in sound had a pause within 0.19 s.
 */
export const SNAP_REACH = 0.3;
/** The shortest quiet a timed cut can sit in: between two sentences, never inside a word. */
export const SNAP_PAUSE = 0.05;
/**
 * How far inside a pause a cut goes, so it does not sit on a word's first or last sound: at 0.03 s
 * seven of those 400 takes' cuts still caught a breath of the next word, at 0.06 s none did.
 */
const SNAP_EDGE = 0.06;

/**
 * `cuts` moved into the nearest of `silences` within SNAP_REACH, and dropped where none is, so no
 * join falls inside a word. A cut already in a pause stays, kept off its edges. A cut that would then
 * leave a piece shorter than the settings allow is dropped too.
 */
export function snapToPauses(
  cuts: readonly number[],
  silences: readonly [number, number][],
  duration: number,
  s: CutSettings = CUTS,
): number[] {
  const placed: number[] = [];
  for (const at of cuts) {
    let best: { distance: number; to: number } | null = null;
    for (const [start, end] of silences) {
      const middle = (start + end) / 2;
      const low = Math.min(start + SNAP_EDGE, middle);
      const high = Math.max(end - SNAP_EDGE, middle);
      const distance = at < start ? start - at : at > end ? at - end : 0;
      const to = Math.min(Math.max(at, low), high);
      if (distance <= SNAP_REACH && (!best || distance < best.distance)) best = { distance, to };
    }
    if (best) placed.push(round3(best.to));
  }
  const kept: number[] = [];
  let last = 0;
  for (const at of [...new Set(placed)].sort((a, b) => a - b)) {
    if (at - last >= s.minPiece && duration - at >= s.minTail) {
      kept.push(at);
      last = at;
    }
  }
  return kept;
}

/** silencedetect's start and end lines, paired; a pause still open at the end is dropped. */
export function parseSilences(ffmpegLog: string): [number, number][] {
  const starts = [...ffmpegLog.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...ffmpegLog.matchAll(/silence_end: (-?[\d.]+)/g)].map((m) => Number(m[1]));
  return ends.map((end, i): [number, number] => [Math.max(0, starts[i]), end]).filter(([start]) => Number.isFinite(start));
}
