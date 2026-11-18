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

// Words that are English and rarely anything else; a line mostly made of them was not translated.
const ENGLISH_WORDS = new Set(
  "the and you your have has are is was were of to that this with for but not what will would there their they them been from".split(
    " ",
  ),
);

/** Whether a line in another language reads as English: the same words, or mostly English ones. */
function readsAsEnglish(text: string, english: string | null): boolean {
  const flat = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  if (english && flat(text) === flat(english)) return true;
  const words = text.toLowerCase().match(/[a-zà-ÿ']+/g) ?? [];
  if (words.length < 4) return false;
  return words.filter((word) => ENGLISH_WORDS.has(word)).length / words.length >= 0.3;
}

const ELLIPSIS_END = /(?:\.\.\.|…)\s*$/;
const paragraphs = (value: string) => value.split(/\n\s*\n/).filter((part) => part.trim() && !/^\s*(?:\.\.\.|…)\s*$/.test(part));

/** Whether the sent line stops where the English one goes on. */
function cutOff(text: string, english: string | null): boolean {
  if (!english) return false;
  if (ELLIPSIS_END.test(text) && !ELLIPSIS_END.test(english)) return true;
  return paragraphs(english).length > paragraphs(text).length && /\n\s*\n\s*(?:\.\.\.|…)?\s*$/.test(text);
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
  if (cutOff(text, english)) {
    findings.push({ tone: "drop", message: 'Looks cut off: it stops in "..." where the English line goes on.' });
  }

  let fix: LineCheck["fix"];
  if (english) {
    const want = slotsOf(english);
    const have = slotsOf(text);
    const missing = (["N", "C", "R"] as Slot[]).filter((slot) => count(have, slot) < count(want, slot));
    const extra = (["N", "C", "R"] as Slot[]).filter((slot) => count(have, slot) > count(want, slot));
    if (missing.length === 1 && extra.length === 1) {
      const removed = have.get(extra[0])![0];
      const added = want.get(missing[0])![0].replace("$$", "$");
      fix = { removed, added, text: text.replace(removed, added) };
      findings.push({
        tone: "fix",
        message: `English has the player's ${SLOT_WORDS[missing[0]]} (${added}); this line has their ${SLOT_WORDS[extra[0]]} (${removed}).`,
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
      : unread
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
