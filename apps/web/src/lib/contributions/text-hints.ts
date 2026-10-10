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
import { speakPlayerTokens } from "@/lib/player-words";
import { hasInvalidChars } from "@/lib/text-gate";

import { spokenFromTemplate } from "./tokens";

// Up to the next space, so a lost `;` names the branch rather than the rest of the line.
const LEFTOVER = /\$\S{0,30}/g;
// Blizzard's English writes "Hmm. . .it says", German "Hm ... vielleicht": an ellipsis, not a gap.
const SPACED_ELLIPSIS = /\.(?:[ \u00a0]?\.){2,}/g;
// Not "!", "?" or ":": French spaces before those.
const GAP = /[ \u00a0][.,]/;
// Not after a sentence's end: Blizzard's own text double-spaces there, in a third of the
// English lines. The no-break space is what Wowhead leaves in an empty branch.
const DOUBLE_SPACE = /[^\s.!?…][ \u00a0]{2,}\S/;

export function textHints(text: string, locale: string): string[] {
  const lang = clientLang(locale) ?? BASE_LANG;
  // Spoken as the accepted line will be: English through the extract's table, which also
  // turns $B into a line break, any other language through its own words.
  const spoken = lang === BASE_LANG ? spokenFromTemplate(text) : speakPlayerTokens(text, lang);
  const leftovers = hasInvalidChars(spoken) ? (spoken.match(LEFTOVER) ?? []) : [];
  const hints = new Set(leftovers.map((token) => `unspoken token ${token} — won't be voiced`));
  if (GAP.test(text.replace(SPACED_ELLIPSIS, "…"))) hints.add("gap before punctuation — a gender branch may be missing");
  if (DOUBLE_SPACE.test(text)) hints.add("double space — a gender branch may be missing");
  return [...hints];
}
