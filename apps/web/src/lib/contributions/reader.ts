/**
 * The reader taken back out of a line the addon sent as the client showed it.
 *
 * The client writes the reader's name, class and race into a line where the template has `$N`,
 * `$C` and `$R`, and a line voiced from that would greet every player by one player's name. An
 * addon that marks its envelope `shown=1` sends the text as shown, with the reader's facts beside
 * it (Spoken's Contribute.lua, ReaderFields), and the tokens go back here, where a better rule
 * reaches every row without waiting on players to update. An envelope without the mark comes from
 * an older addon, which put the tokens back itself, and is read as it is.
 *
 * The name is the one fact the site does not keep. `nameless` swaps it for `$N` and drops it from
 * the fields, and is what is stored as a contribution's `raw` and a report's context. Class and
 * race stay as shown there, so the rule for them can be run again; `detemplated` swaps them too,
 * for the row's text.
 *
 * Node-free: a report's context is read in the browser too.
 */
import type { Envelope } from "./envelope";

const NAME = "reader";

function isShown(envelope: Envelope): boolean {
  return envelope.fields.shown === "1";
}

type Swap = { word: string; token: string; strict?: boolean };

type Range = readonly [number, number];

const HANGUL: readonly Range[] = [[0x1100, 0x11ff], [0x3130, 0x318f], [0xac00, 0xd7af]];

/** Han, which Chinese writes a class or race word in and which glues to its neighbours. */
const HAN: readonly Range[] = [[0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xf900, 0xfaff]];

/**
 * The code points past ASCII that end a word, as Spoken's Contribute.lua lists them: Latin-1 and
 * general punctuation, symbols, emoji, and Hangul, kana and Han, which put no space between a name
 * and the next word ("홍길동님"). Hangul ends one only on the right.
 */
const SEPARATORS: readonly Range[] = [
  [0x80, 0xa9], [0xab, 0xb4], [0xb6, 0xb9], [0xbb, 0xbf], [0xd7, 0xd7], [0xf7, 0xf7],
  [0x2000, 0x206f], [0x20a0, 0x20cf], [0x2190, 0x23ff], [0x2500, 0x27bf], [0x2e00, 0x2e7f],
  [0x3000, 0x3004], [0x3008, 0x3020], [0x3030, 0x3030], [0x303d, 0x303f],
  [0xfe30, 0xfe6f], [0xff00, 0xff0f], [0xff1a, 0xff20], [0xff3b, 0xff40], [0xff5b, 0xff65],
  [0xffe0, 0xffee], [0x1f000, 0x1faff],
  [0x3040, 0x30ff],
  ...HAN,
  ...HANGUL,
];

function inRanges(point: number, ranges: readonly Range[]): boolean {
  return ranges.some(([first, last]) => point >= first && point <= last);
}

/**
 * ASCII letters and digits only, so "Tester's" and "Tester-like" still hold the name.
 *
 * `strict` is for a Chinese class or race word on a page. Chinese writes one word for a noun, an
 * adjective and an address alike -- 资深德鲁伊 / 德鲁伊咒语 / 我的德鲁伊之力 are all "德鲁伊" -- so
 * Han counts as part of the word there and only a pause ends it. A name never takes it: a Chinese
 * name is Han itself and sits straight against the words around it, so a strict boundary would
 * leave the player's own name in the text.
 */
function isWordPoint(point: number | undefined, strict = false): boolean {
  if (point === undefined) return false;
  if (point < 0x80) return /[0-9A-Za-z]/.test(String.fromCodePoint(point));
  if (strict && inRanges(point, HAN)) return true;
  return !inRanges(point, SEPARATORS);
}

function isHangul(point: number | undefined): boolean {
  return point !== undefined && inRanges(point, HANGUL);
}

/**
 * Hangul ends a word on the right, where a particle follows a name with no space, but not on the
 * left: nothing comes straight before a Korean name, and a reader named "서" would otherwise take "어서".
 */
function isWholeWord(before: number | undefined, after: number | undefined, strict = false): boolean {
  return !isWordPoint(before, strict) && !isHangul(before) && !isWordPoint(after, strict);
}

function pointBefore(text: string, index: number): number | undefined {
  if (index === 0) return undefined;
  const unit = text.charCodeAt(index - 1);
  return unit >= 0xdc00 && unit <= 0xdfff && index >= 2 ? text.codePointAt(index - 2) : unit;
}

/**
 * Every whole-word occurrence of each swap's word replaced by its token, in one pass over the
 * text, longest word first at each place. One pass, so a part of the name inside a longer class
 * ("Hunter" in "Demon Hunter") cannot take it before the class does.
 */
function swapWords(text: string, swaps: readonly Swap[]): string {
  // Most lines hold none of the reader's words, and a batch upload is hundreds of lines.
  const present = swaps.filter(({ word }) => text.includes(word));
  if (present.length === 0) return text;
  let out = "";
  let kept = 0;
  let index = 0;
  next: while (index < text.length) {
    for (const { word, token, strict } of present) {
      const end = index + word.length;
      if (text.startsWith(word, index) && isWholeWord(pointBefore(text, index), text.codePointAt(end), strict)) {
        out += text.slice(kept, index) + token;
        index = kept = end;
        continue next;
      }
    }
    index += 1;
  }
  return out + text.slice(kept);
}

/**
 * Longer than any name, class or race the game has: the envelope is a public paste, and a field of
 * thousands of words would be thousands of swaps tried at every letter of the text.
 */
const READER_MAX = 64;

/** A reader fact `fields` holds, or nothing for one too long to be what the game says. */
function readerFact(fields: Record<string, string>, key: string): string | undefined {
  const value = fields[key];
  return value && value.length <= READER_MAX ? value : undefined;
}

/** The name whole and by any one part ("Valaas Dawnsight" is greeted "Valaas"), as written and in capitals. */
function nameWords(name: string | undefined): string[] {
  if (!name) return [];
  return [name, name.toUpperCase()].flatMap((form) => {
    const parts = form.split(/\s+/).filter((part) => part && part !== form);
    return [form, ...parts];
  });
}

/** Whether the quest is one only the reader's class can take: there the class is the quest's own word. */
function isClassQuest(fields: Record<string, string>): boolean {
  const id = Number(fields.readerClassID);
  return Number.isInteger(id) && id > 0 && Number(fields.questClasses) === 2 ** (id - 1);
}

/**
 * Whether a class or race word takes the strict boundary: a page's text, in Chinese.
 *
 * A page is prose, and English pages almost never carry a class token at all, so a word of it is
 * far more often a noun or an adjective than the reader. Chinese writes one word for all three --
 * 资深德鲁伊 / 德鲁伊咒语 / 我的德鲁伊之力 are all "德鲁伊" -- so only a pause ends it there.
 *
 * A quest's text keeps the loose boundary, which is the opposite trade: Blizzard's own Chinese
 * puts the address straight after an adjective in about a quarter of its class lines (尊贵的$c,
 * 勇敢的$C), where a strict boundary would miss the reader. Gossip keeps it too, being an NPC
 * talking to the reader.
 *
 * Only Chinese: Korean and Japanese glue particles to a word, and Latin writes spaces.
 */
function strictClass(envelope: Envelope): boolean {
  if (envelope.source !== "readables") return false;
  const locale = envelope.fields.locale ?? "";
  return locale === "zhCN" || locale === "zhTW";
}

/**
 * The swaps for the reader `fields` describe, longest first; class and race kept as written unless
 * `tokens`. A word kept as written is still a swap, so a part of the name inside it ("Hunter" in
 * "Demon Hunter") cannot take it.
 */
function swapsOf(fields: Record<string, string>, tokens: boolean, strict = false): Swap[] {
  const swaps: Swap[] = [];
  const addCased = (word: string | undefined, upper: string, lower: string, swapped: boolean) => {
    if (!word) return;
    swaps.push({ word, token: swapped ? upper : word, strict: swapped && strict });
    const lowered = word.toLowerCase();
    if (lowered !== word) swaps.push({ word: lowered, token: swapped ? lower : lowered, strict: swapped && strict });
  };
  for (const word of nameWords(readerFact(fields, NAME))) swaps.push({ word, token: "$N" });
  // A locale that names a class by gender ("Kriegerin") may write the other form.
  const classSwapped = tokens && !isClassQuest(fields);
  for (const key of ["readerClass", "readerClassMale", "readerClassFemale"]) {
    addCased(readerFact(fields, key), "$C", "$c", classSwapped);
  }
  addCased(readerFact(fields, "readerRace"), "$R", "$r", tokens);
  // Each word once, the first swap given for it kept: a name part said twice is one swap.
  const seen = new Set<string>();
  const unique = swaps.filter(({ word }) => !seen.has(word) && Boolean(seen.add(word)));
  return unique.sort((a, b) => b.word.length - a.word.length);
}

/**
 * The envelope with the reader's name out of its text and fields; any other envelope as it is. Taken
 * out wherever a name is given, whether or not the text is marked as shown.
 */
export function nameless<S extends string>(envelope: Envelope<S>): Envelope<S> {
  if (!(NAME in envelope.fields)) return envelope;
  const { [NAME]: _name, ...fields } = envelope.fields;
  const text = envelope.text === null ? null : swapWords(envelope.text, swapsOf(envelope.fields, false));
  return { ...envelope, fields, text };
}

/** The envelope's text with the reader's name, class and race as `$N`, `$C` and `$R`. */
export function detemplated(envelope: Envelope): string | null {
  if (!isShown(envelope) || envelope.text === null) return envelope.text;
  return swapWords(envelope.text, swapsOf(envelope.fields, true, strictClass(envelope)));
}
