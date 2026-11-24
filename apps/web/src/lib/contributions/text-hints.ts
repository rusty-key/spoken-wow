/**
 * What triage should see about a contribution's text before accepting it.
 *
 * A token the gate cannot speak ("$einen würdigen Schüler:…" with its `g` lost, a `$g` with no
 * closing `;`) makes the accepted line `invalid-chars`, and nothing says so until someone wonders
 * why it never gets voiced. A client that resolved a gender branch to nothing leaves no `$` at
 * all, only the gap where the words were ("danken kann, .").
 *
 * CLIENT-SAFE: ContributionTable renders these.
 */
import { BASE_LANG, clientLang } from "@/lib/lang";
import { speakQuestTokens } from "@/lib/player-words";
import { CLIENT_ESCAPE, DECLENSION, withoutDirections } from "@/lib/text-gate";

import { writtenFromTemplate } from "./tokens";

// Up to the next space, so a lost `;` names the branch rather than the rest of the line. Not
// inside a declension escape, which gets its own hint.
const LEFTOVER = new RegExp(String.raw`(?<!${DECLENSION.source})\$\S{0,30}`, "g");
const DECLINED = new RegExp(String.raw`${DECLENSION.source}[^)]{0,30}\)?`, "g");
// Any other client escape, up to the next space: `|1이여;여;`, `|2`, `|n`.
const ESCAPE = new RegExp(String.raw`(?!${DECLENSION.source})${CLIENT_ESCAPE.source}\S{0,30}`, "g");
// Blizzard's English writes "Hmm. . .it says", German "Hm ... vielleicht": an ellipsis, not a gap.
const SPACED_ELLIPSIS = /\.(?:[ \u00a0]?\.){2,}/g;
// Not "!", "?" or ":": French spaces before those.
const GAP = /[ \u00a0][.,]/;
// Not after a sentence's end, its closing quote or a colon: Blizzard's own text double-spaces
// there, in a third of the English lines. The no-break space is what Wowhead leaves in an
// empty branch.
const DOUBLE_SPACE = /(?<=[^\s.!?…:])(?<![.!?…]["'“”»])[ \u00a0]{2,}\S/;

export function textHints(text: string, locale: string): string[] {
  const lang = clientLang(locale) ?? BASE_LANG;
  // Spoken as the gate will speak the accepted line: English is stored as the extract writes it,
  // which turns $B into a line break.
  const spoken = speakQuestTokens(lang === BASE_LANG ? writtenFromTemplate(text) : text, lang);
  const judged = withoutDirections(spoken);
  const hints = new Set<string>();
  for (const token of judged.match(LEFTOVER) ?? []) hints.add(`unspoken token ${token} — won't be voiced`);
  for (const escape of judged.match(DECLINED) ?? []) {
    // Only a token inside is declined; a word inside is the contributor's own class or race.
    hints.add(
      escape.includes("($")
        ? `undeclined ${escape} — won't be voiced until Player words has its case`
        : `client-filled ${escape} — won't be voiced; put $c, $n or $r back inside`,
    );
  }
  for (const escape of judged.match(ESCAPE) ?? []) hints.add(`client escape ${escape} — won't be voiced`);
  // Named even beside a token: fixing only the token would still leave the line refused.
  if (/[<>]/.test(judged)) hints.add("unspeakable < or > — won't be voiced");
  // A direction is never spoken, so its own spacing is no gap.
  const said = withoutDirections(text, true);
  if (GAP.test(said.replace(SPACED_ELLIPSIS, "…"))) hints.add("gap before punctuation — a gender branch may be missing");
  if (DOUBLE_SPACE.test(said)) hints.add("double space — a gender branch may be missing");
  return [...hints];
}
