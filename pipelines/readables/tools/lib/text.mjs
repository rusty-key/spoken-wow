// Page text as it comes out of vmangos, and as it goes to a narrator.
//
// Two forms, deliberately: `normaliseText` is stored and shown, so it keeps the shape of
// the page -- a letter's paragraphs are part of reading it. `spokenText` is what would be
// sent to ElevenLabs, where a newline buys nothing.
//
// No dependencies, so `node tools/extract.mjs` runs on a clone with nothing installed.

/** Pages whose text is a maintenance placeholder rather than anything a player reads. */
const PLACEHOLDERS = new Set(["missing text", "texto ausente", "test", "placeholder"]);

/** What the game substitutes at runtime and a recording cannot: $N, $C, $R, $Gx:y;. */
const SUBSTITUTION = /\$[a-zA-Z]/;

/**
 * The tags the signed pages are written in, and nothing else in angle brackets.
 *
 * Every other bracket is the book talking: `<The rest of the book is blank>`,
 * `<illegible text>`. A pattern for any tag would delete those as well.
 */
const MARKUP = /<\/?(?:html|body|h[1-6]|p|br|img|a|span|b)(?![\w])[^>]*>/gi;
const SIGNED = new RegExp(MARKUP.source, "i");

/** Where the client breaks a line inside a signed page. */
const LINE_BREAK = /<br(?![\w])[^>]*>|<\/(?:p|h[1-6])(?![\w])[^>]*>/gi;

// Keep WoW's explicit `$B` break distinct from source newlines while signed HTML is laid out:
// source newlines are HTML whitespace, but `$B` is a line the client actually draws.
const PAGE_BREAK = "\u0000";

/**
 * The entities the signed pages carry. `&lt;` and `&gt;` stay escaped in storage: decoded,
 * they could form a tag, and a second pass would strip it and change the checksum.
 */
const STORED_ENTITIES = { amp: "&", quot: '"', apos: "'", nbsp: " " };
const STORED_ENTITY = /&(amp|quot|apos|nbsp);/g;

/**
 * Storage form: real newlines, no trailing spaces, no runs of blank lines, no markup.
 *
 * `$B` is WoW's newline token and appears in both cases in the same table, so matching
 * only the documented upper case leaves a literal "$b" in the middle of a sentence.
 *
 * A signed page (A Treatise on Military Ranks, the tombstones) is HTML in page_text. It is
 * stored as the lines the client draws, so the site shows words rather than tags. The
 * addon's Normalise in Checksum.lua does the same to what the client hands it, so the
 * checksum still agrees; it is ASCII whitespace only on both sides for that reason.
 */
export function normaliseText(raw) {
  const text = String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\$[Bb]/g, PAGE_BREAK)
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (SIGNED.test(text)) return unmark(text);
  return text.replaceAll(PAGE_BREAK, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * A signed page's markup laid out as lines. Source newlines inside it are whitespace, as in
 * any HTML, or every paragraph would gain a blank line under it.
 */
function unmark(text) {
  return text
    .replace(/[ \t\n\r\f\v]+/g, " ")
    .replaceAll(PAGE_BREAK, "\n")
    .replace(LINE_BREAK, "\n")
    .replace(MARKUP, "")
    .replace(STORED_ENTITY, (_, name) => STORED_ENTITIES[name])
    .split("\n")
    .map((line) => line.replace(/ +/g, " ").replace(/^ | $/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
}

/** Entities as the characters the game draws, in a title or wherever storage left them. */
const ENTITIES = { ...STORED_ENTITIES, lt: "<", gt: ">" };

/** Whatever sits in brackets once the markup is gone. */
const ASIDE = /<([^<>]+)>/g;

/**
 * esMX writes the player's name as `<nombre>` on three pages. Read aloud it would be the
 * word "nombre", so it goes, as it did before asides were read.
 */
const NAME_PLACEHOLDER = /<nombre>/gi;

/**
 * Narration form: one flowing paragraph, asides read.
 *
 * An aside is read, as a quest's stage direction is, between two line breaks: they are a
 * pause on ElevenLabs and a split on fish.audio, so "The Venture Company <illegible text> It
 * would" is not run together as one sentence. Entities become their characters last, so an
 * escaped "&lt;" is never taken for an aside, and a title's "&amp;" is read as "&".
 */
export function spokenText(text) {
  return normaliseText(text)
    .replace(NAME_PLACEHOLDER, " ")
    .replace(/\s+/g, " ")
    .replace(ASIDE, "\n$1\n")
    .replace(/\s*\n\s*/g, "\n")
    .trim()
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name) => ENTITIES[name]);
}

/**
 * Whether this page can be voiced, and if not, why.
 *
 * Mirrors the quests corpus's `generatable`/`skipReason` pair: a page that cannot be
 * spoken is kept and labelled rather than dropped, so the explorer can show that the game
 * has a page and say why it is silent.
 */
export function isGeneratable(text) {
  const spoken = spokenText(text);
  if (spoken === "") return { generatable: false, skipReason: "empty" };
  if (PLACEHOLDERS.has(spoken.toLowerCase())) return { generatable: false, skipReason: "placeholder" };
  if (SUBSTITUTION.test(spoken)) return { generatable: false, skipReason: "substitution" };
  return { generatable: true, skipReason: null };
}

/** Where a title already closes a sentence, and a second stop would be read as a pause. */
const SENTENCE_END = /[.!?…。！？]$/;

/** Letters and digits only, for asking whether a page opens with its own title. */
function wordsOf(text) {
  return spokenText(text).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * A book's first page as a narrator reads it: the title, a full stop and a line break, then
 * the page -- in spoken form, so the result is what is sent and not something to flatten.
 *
 * The client shows the title above every page and never says it, so a book that does not
 * name itself in its own words starts mid-thought. Only the narration takes it -- the page's
 * stored text, and the checksum the addon finds it by, are of the words on the page alone.
 *
 * The break is a newline, as an aside's are. A full stop alone runs the title into the
 * first sentence; the newline is a longer pause on ElevenLabs, and on fish.audio a silence of
 * its own, because SHAPE.fish splits the line there rather than sending the break.
 *
 * A page that already opens with its title (a gravestone's name, a treatise's <H1>) is left
 * as it is: prepending would read the same words twice in a row.
 */
export function spokenWithTitle(title, text) {
  const heading = spokenText(title);
  const page = spokenText(text);
  if (wordsOf(page).startsWith(wordsOf(heading))) return page;
  return `${heading}${SENTENCE_END.test(heading) ? "" : "."}\n${page}`;
}
