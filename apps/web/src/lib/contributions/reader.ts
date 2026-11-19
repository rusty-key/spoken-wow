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

type Swap = { word: string; token: string };

/**
 * The code points past ASCII that end a word, as Spoken's Contribute.lua lists them: Latin-1 and
 * general punctuation, symbols, emoji, and Hangul, kana and Han, which put no space between a name
 * and the next word ("홍길동님").
 */
const SEPARATORS: readonly (readonly [number, number])[] = [
  [0x80, 0xa9], [0xab, 0xb4], [0xb6, 0xb9], [0xbb, 0xbf], [0xd7, 0xd7], [0xf7, 0xf7],
  [0x2000, 0x206f], [0x20a0, 0x20cf], [0x2190, 0x23ff], [0x2500, 0x27bf], [0x2e00, 0x2e7f],
  [0x3000, 0x3004], [0x3008, 0x3020], [0x3030, 0x3030], [0x303d, 0x303f],
  [0xfe30, 0xfe6f], [0xff00, 0xff0f], [0xff1a, 0xff20], [0xff3b, 0xff40], [0xff5b, 0xff65],
  [0xffe0, 0xffee], [0x1f000, 0x1faff],
  [0x1100, 0x11ff], [0x3040, 0x30ff], [0x3130, 0x318f], [0x3400, 0x4dbf], [0x4e00, 0x9fff],
  [0xac00, 0xd7af], [0xf900, 0xfaff],
];

/** ASCII letters and digits only, so "Tester's" and "Tester-like" still hold the name. */
function isWordPoint(point: number | undefined): boolean {
  if (point === undefined) return false;
  if (point < 0x80) return /[0-9A-Za-z]/.test(String.fromCodePoint(point));
  return !SEPARATORS.some(([first, last]) => point >= first && point <= last);
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
    for (const { word, token } of present) {
      const end = index + word.length;
      if (text.startsWith(word, index) && !isWordPoint(pointBefore(text, index)) && !isWordPoint(text.codePointAt(end))) {
        out += text.slice(kept, index) + token;
        index = kept = end;
        continue next;
      }
    }
    index += 1;
  }
  return out + text.slice(kept);
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
 * The swaps for the reader `fields` describe, longest first; class and race kept as written unless
 * `tokens`. A word kept as written is still a swap, so a part of the name inside it ("Hunter" in
 * "Demon Hunter") cannot take it.
 */
function swapsOf(fields: Record<string, string>, tokens: boolean): Swap[] {
  const swaps: Swap[] = [];
  const addCased = (word: string | undefined, upper: string, lower: string, swapped: boolean) => {
    if (!word) return;
    swaps.push({ word, token: swapped ? upper : word });
    const lowered = word.toLowerCase();
    if (lowered !== word) swaps.push({ word: lowered, token: swapped ? lower : lowered });
  };
  for (const word of nameWords(fields[NAME])) swaps.push({ word, token: "$N" });
  // A locale that names a class by gender ("Kriegerin") may write the other form.
  const classSwapped = tokens && !isClassQuest(fields);
  for (const name of [fields.readerClass, fields.readerClassMale, fields.readerClassFemale]) {
    addCased(name, "$C", "$c", classSwapped);
  }
  addCased(fields.readerRace, "$R", "$r", tokens);
  return swaps.sort((a, b) => b.word.length - a.word.length);
}

/**
 * The envelope with the reader's name out of its text and fields; any other envelope as it is. Taken
 * out wherever a name is given, whether or not the text is marked as shown.
 */
export function nameless(envelope: Envelope): Envelope {
  if (!(NAME in envelope.fields)) return envelope;
  const { [NAME]: _name, ...fields } = envelope.fields;
  const text = envelope.text === null ? null : swapWords(envelope.text, swapsOf(envelope.fields, false));
  return { ...envelope, fields, text };
}

/** The envelope's text with the reader's name, class and race as `$N`, `$C` and `$R`. */
export function detemplated(envelope: Envelope): string | null {
  if (!isShown(envelope) || envelope.text === null) return envelope.text;
  return swapWords(envelope.text, swapsOf(envelope.fields, true));
}
