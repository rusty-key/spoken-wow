// Display text -> spoken text.
//
// The single rule that is not cosmetic: **no square brackets may survive**.
// Eleven v3 reads bracketed text as an audio tag -- a performance directive --
// so "[Deviate Fish]" would be acted rather than spoken. The lore carries 163
// bracketed spans, so this is load-bearing, and validate.mjs asserts it.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ROOT } from "../lib/loredata.mjs";

// Authored config that ships with the release, like config.json beside it: nothing
// writes it at runtime any more (the editor moved to wow-voiceover), so it needs no
// shared copy on the droplet and no override of its own -- it moves with SPOKEN_PLACES_ROOT
// like the corpus does. A rule is a reviewable diff in git.
export const PRONUNCIATION_PATH = join(ROOT, "pipelines/places/tools/voice/pronunciation.json");

// IPA blocks such as "Kalimdor [ˈkælɪmdɔɹ]" are a pronunciation guide for
// readers, not something to read out. Detected by the phonetic characters
// themselves rather than by position, since they appear mid-sentence.
const IPA = /[ˈˌːɪɛæɑɔəʊʌɹʃʒθðŋçɸβɣʁʔˑ]/;

// "[1-30]", "[90W]" -- level ranges and map coordinates lifted from the wiki.
const BRACKET_NOISE = /^[\d\s\-–—+()/,.]*[A-Za-z]?$/;

export async function loadPronunciation() {
  let raw;
  try {
    raw = JSON.parse(await readFile(PRONUNCIATION_PATH, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
  // Keys beginning with _ are commentary. JSON has nowhere else to put it, and a
  // stray "_comment" rule would otherwise be a substitution like any other.
  return Object.fromEntries(
    Object.entries(raw).filter(([key]) => !key.startsWith("_")),
  );
}

// Writes the rules back, preserving the "_" commentary keys loadPronunciation drops.
//
// The file stays the source of truth rather than moving into Postgres, because
// toSpokenText builds the spoken text from it and textHash hashes that -- so the
// staleness calculation the addon build depends on would otherwise need a database.
// It is authored config, and git is a better home for it than a table: a rule change
// lands as a reviewable diff, and every rule is a claim that the model mispronounces
// a word.
export async function savePronunciation(rules) {
  let existing = {};
  try {
    existing = JSON.parse(await readFile(PRONUNCIATION_PATH, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  const comments = Object.fromEntries(
    Object.entries(existing).filter(([key]) => key.startsWith("_")),
  );
  const ordered = Object.fromEntries(
    Object.entries(rules)
      .filter(([key]) => !key.startsWith("_"))
      .sort(([a], [b]) => a.localeCompare(b)),
  );

  await writeFile(
    PRONUNCIATION_PATH,
    JSON.stringify({ ...comments, ...ordered }, null, 2) + "\n",
  );
}

function stripBrackets(text) {
  return text.replace(/\[([^\]]*)\]/g, (_, inner) => {
    if (IPA.test(inner)) return "";        // pronunciation guide: drop entirely
    if (BRACKET_NOISE.test(inner)) return ""; // level range or coordinate
    return inner;                           // item or place name: keep the words
  });
}

export function toSpokenText(text, rules = {}) {
  let out = stripBrackets(text);

  for (const [from, to] of Object.entries(rules)) {
    // Whole words only, so a rule for "Hm" cannot rewrite "Hmm" or "Chm".
    out = out.replace(new RegExp(`\\b${escapeRegExp(from)}\\b`, "g"), to);
  }

  // Paragraph breaks become a sentence pause. A literal newline in the payload
  // reads as nothing at all, running two paragraphs together mid-breath.
  out = out.replace(/\n{2,}/g, " ");
  out = out.replace(/\n/g, " ");

  // Parentheses survive as text but add nothing spoken; the words inside stay.
  out = out.replace(/[()]/g, "");

  return out.replace(/\s{2,}/g, " ").trim();
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Used by validate.mjs and by the generator's own pre-flight.
export function hasBrackets(text) {
  return /[[\]]/.test(text);
}
