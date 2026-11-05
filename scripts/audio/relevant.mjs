// Which quests audio a pack carries: a file a current line of its language names, or one of
// that file in another voice (`{fileName}-{voice}`, naming.py variant_file_name).
//
// A take stays live when its line stops being current, as when a language's own text makes one
// line of a moment it had as `m-`/`f-` lines. Shipped, those would still play: the addon tries the
// player's `m-`/`f-` file before the plain one.

import { speakPlayerTokens } from "../../pipelines/lib/player-words.mjs";

/** A predicate over take stems ('quests/m-5-accept-human-male-warrior'), given the named stems. */
export function namedBy(stems) {
  const named = new Set(stems);
  return (stem) => {
    const parts = stem.split("-");
    for (let k = parts.length; k > 0; k--) {
      if (named.has(parts.slice(0, k).join("-"))) return true;
    }
    return false;
  };
}

/** psql's query for those stems: each current line's subfolder and file. */
export const NAMED_QUESTS_SQL = `select distinct case split_part("lineId", ':', 1)
                  when 'q' then 'quests' when 'g' then 'gossip' when 'f' then 'followup' end
                || '/' || "fileName"
           from "quest_line" where "lang" = :'lang' and "isCurrent"`;

/**
 * psql's query for each current line's stem, words and side: what a take with no saved words ships.
 * JSON, because a raw tab or newline in a line would shift every row after it. Ordered so a file
 * two lines name always gives the same words. Never line_override: a rewrite can hold respellings.
 */
export const CURRENT_TEXT_SQL = `select case split_part("lineId", ':', 1)
                  when 'q' then 'quests' when 'g' then 'gossip' when 'f' then 'followup' end
                || '/' || "fileName",
                to_json("text")::text, coalesce("playerGender", '')
           from "quest_line" where "lang" = :'lang' and "isCurrent"
          order by "lineId", "variant"`;

/**
 * A take stem's current words as the voice says them, given CURRENT_TEXT_SQL's rows. Finds the file
 * as namedBy does, so a file in another voice has its line's words.
 */
export function currentTextFor(rows, lang) {
  const byStem = new Map();
  for (const { stem, text, playerGender } of rows) {
    if (!byStem.has(stem)) byStem.set(stem, { text, playerGender: playerGender || null });
  }
  return (stem) => {
    const parts = stem.split("-");
    for (let k = parts.length; k > 0; k--) {
      const line = byStem.get(parts.slice(0, k).join("-"));
      if (line) return speakPlayerTokens(line.text, lang, line.playerGender);
    }
    return undefined;
  };
}
