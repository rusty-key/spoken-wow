/**
 * What a reviewer should know about a contribution before keeping it, read against the English
 * line it translates: which group the review page puts it in, why, and the fix where there is
 * exactly one.
 *
 * The checks follow what a maintainer otherwise does by hand: is it in the page's language, is it
 * whole, does it keep the placeholders the game fills in per player. `$G`/`$U` are left out on
 * purpose: a player's client has already picked one side of a gender branch, so a contribution
 * is one plain line (docs/quests/README.md) and a missing `$G` is no fault of the sender.
 *
 * CLIENT-SAFE: no database, no server-only imports. The page computes it on the server and the
 * table renders what it found.
 */
import { BASE_LANG, clientLang } from "@/lib/lang";

import { textHints } from "./text-hints";

/** Where the review page puts a line. */
export type Verdict = "clean" | "fix" | "drop" | "look";

export type Finding = {
  /** "fix": keep it after an edit. "drop": probably not worth keeping. "info": worth a look. */
  tone: "fix" | "drop" | "info";
  message: string;
};

export type LineCheck = {
  verdict: Verdict;
  findings: Finding[];
  /** The one change that settles the findings, where there is exactly one. */
  fix?: { removed: string; added: string; text: string };
};

/** The placeholders compared: name, class, race. */
type Slot = "N" | "C" | "R";

const SLOT_WORDS: Record<Slot, string> = { N: "name", C: "class", R: "race" };

// `$N`, `$$N` (TBC and Forever double it), and the genitive `$Ns`, in either case.
const SLOT = /\$\$?([NnCcRr])s?(?![A-Za-z])/g;

/** The placeholders a line holds, by slot, each as first written. */
function slotsOf(text: string): Map<Slot, string[]> {
  const found = new Map<Slot, string[]>();
  for (const match of text.matchAll(SLOT)) {
    const slot = match[1].toUpperCase() as Slot;
    found.set(slot, [...(found.get(slot) ?? []), match[0]]);
  }
  return found;
}

const count = (slots: Map<Slot, string[]>, slot: Slot) => slots.get(slot)?.length ?? 0;

const SLOTS: readonly Slot[] = ["N", "C", "R"];

// Words that are English and nothing else in the site's languages; a line mostly made of them was not
// translated. Not "was", "will", "not", "die" or "also" (German), "has" (Spanish).
const ENGLISH_WORDS = new Set(
  "the and you your have are were that this with for but what would there their they them been from".split(" "),
);

/**
 * Whether a line in another language reads as English: mostly English words, or the English line's
 * own words with at least one of them. A name alone ("Thrall") is the same in every language.
 */
function readsAsEnglish(text: string, english: string | null): boolean {
  const flat = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  const words = text.toLowerCase().match(/[a-zà-ÿ']+/g) ?? [];
  const englishWords = words.filter((word) => ENGLISH_WORDS.has(word)).length;
  if (english && flat(text) === flat(english)) return englishWords > 0;
  if (words.length < 4) return false;
  return englishWords / words.length >= 0.3;
}

const ELLIPSIS_END = /(?:\.\.\.|…)\s*$/;
const paragraphs = (value: string) => value.split(/\n\s*\n/).filter((part) => part.trim() && !/^\s*(?:\.\.\.|…)\s*$/.test(part));

/**
 * Whether the sent line stops where the English one goes on: "lost" when whole paragraphs are
 * missing behind a break, "maybe" when it only ends in an ellipsis the English line lacks, which a
 * translation may simply prefer.
 */
function cutOff(text: string, english: string | null): "lost" | "maybe" | null {
  if (!english) return null;
  if (paragraphs(english).length > paragraphs(text).length && /\n\s*\n\s*(?:\.\.\.|…)?\s*$/.test(text)) return "lost";
  return ELLIPSIS_END.test(text) && !ELLIPSIS_END.test(english) ? "maybe" : null;
}

/** The English line as a player of each gender sees it: every `$G` branch resolved one way. */
function genderSides(english: string): [string, string] {
  const branch = /\$[GgUu]([^:;]*):([^;]*);/g;
  return [english.replace(branch, (_, male: string) => male), english.replace(branch, (_, _male: string, female: string) => female)];
}

export function checkLine({
  text,
  english,
  locale,
}: {
  text: string | null;
  /** The English line this one translates, or null where none was found. */
  english: string | null;
  locale: string;
}): LineCheck {
  if (!text?.trim()) return { verdict: "drop", findings: [{ tone: "drop", message: "No text was sent." }] };
  const findings: Finding[] = [];
  const translated = (clientLang(locale) ?? BASE_LANG) !== BASE_LANG;

  if (translated && readsAsEnglish(text, english)) {
    findings.push({ tone: "drop", message: "Reads as English: the line was not translated." });
  }
  const cut = cutOff(text, english);
  if (cut === "lost") {
    findings.push({ tone: "drop", message: 'Looks cut off: it stops in "..." where the English line goes on.' });
  } else if (cut === "maybe") {
    findings.push({ tone: "info", message: 'Ends in "..." where the English line does not: check nothing is missing.' });
  }

  let fix: LineCheck["fix"];
  if (english) {
    const have = slotsOf(text);
    // A gender branch can hold a placeholder on one side only: the sent line, one side already
    // picked, matches if it matches either.
    const sides = genderSides(english).map(slotsOf);
    const want = sides.find((side) => SLOTS.every((slot) => count(side, slot) === count(have, slot))) ?? sides[0];
    const sidesAgree = SLOTS.every((slot) => count(sides[0], slot) === count(sides[1], slot));
    const missing = SLOTS.filter((slot) => count(have, slot) < count(want, slot));
    const extra = SLOTS.filter((slot) => count(have, slot) > count(want, slot));
    const swap =
      missing.length === 1 &&
      extra.length === 1 &&
      count(want, missing[0]) - count(have, missing[0]) === 1 &&
      count(have, extra[0]) - count(want, extra[0]) === 1;
    if (swap) {
      const removed = have.get(extra[0])![0];
      // The submitted token's genitive stays: `$Cs` becomes `$Ns`. `$R` has no genitive.
      const genitive = /s$/.test(removed);
      const added = `$${missing[0]}${genitive ? "s" : ""}`;
      // Offered only when the token to change is the one of its kind in the line, the English
      // line reads the same for both genders, and the genitive survives the change.
      const unique = count(have, extra[0]) === 1;
      if (unique && sidesAgree && !(genitive && missing[0] === "R")) fix = { removed, added, text: text.replace(removed, added) };
      findings.push({
        tone: "fix",
        message: `English has the player's ${SLOT_WORDS[missing[0]]} ($${missing[0]}); this line has their ${SLOT_WORDS[extra[0]]} (${removed}).`,
      });
    } else {
      for (const slot of missing) {
        findings.push({
          tone: "fix",
          message: `English has the player's ${SLOT_WORDS[slot]} ($${slot}); this line has none, so it may be spelled out for the player who sent it.`,
        });
      }
      for (const slot of extra) {
        findings.push({ tone: "fix", message: `This line has $${slot}, which the English line does not.` });
      }
    }
  }

  for (const hint of textHints(text, locale)) findings.push({ tone: "fix", message: sentence(hint) });

  // An English contribution has no English original to read against; only another language misses one.
  const unread = translated && !english;
  if (unread && findings.length === 0) {
    findings.push({ tone: "info", message: "No English line was found to compare it with." });
  }

  const verdict: Verdict = findings.some((finding) => finding.tone === "drop")
    ? "drop"
    : findings.some((finding) => finding.tone === "fix")
      ? "fix"
      : findings.some((finding) => finding.tone === "info")
        ? "look"
        : "clean";
  // Offered only when it is the whole story: a fix beside another problem would not settle the line.
  return { verdict, findings, fix: verdict === "fix" && findings.length === 1 ? fix : undefined };
}

/** A text hint as a sentence: capitalised, with its dash turned into a colon. */
function sentence(hint: string): string {
  const said = hint.replace(" — ", ": ");
  return `${said.charAt(0).toUpperCase()}${said.slice(1)}.`;
}
