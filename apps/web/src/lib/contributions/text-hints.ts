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

// Up to the next space, so a lost `;` names the branch rather than the rest of the line.
const LEFTOVER = /\$\S{0,30}/g;
// Not "!", "?" or ":": French spaces before those. Not " ...": German spaces before an
// ellipsis ("Hm ... vielleicht").
const GAP = /[ \u00a0][.,](?!\.)/;
// The no-break space is what Wowhead leaves in an empty branch.
const DOUBLE_SPACE = /\S[ \u00a0]{2,}\S/;

export function textHints(text: string, locale: string): string[] {
  const spoken = speakPlayerTokens(text, clientLang(locale) ?? BASE_LANG);
  const hints = (spoken.match(LEFTOVER) ?? []).map((token) => `unspoken token ${token} — won't be voiced`);
  if (GAP.test(text)) hints.push("gap before punctuation — a gender branch may be missing");
  if (DOUBLE_SPACE.test(text)) hints.push("double space — a gender branch may be missing");
  return hints;
}
