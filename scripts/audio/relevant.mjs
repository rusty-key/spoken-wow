// Which quests audio a pack carries: a file a current line of its language names, or one of
// that file in another voice (`{fileName}-{voice}`, naming.py variant_file_name).
//
// A take stays live when its line stops being current, as when a language's own text makes one
// line of a moment it had as `m-`/`f-` lines. Shipped, those would still play: the addon tries the
// player's `m-`/`f-` file before the plain one.

import { speakPlayerTokens } from "../../pipelines/lib/player-words.mjs";

// A shipped clip and the words it shows must agree on which file a stem belongs to.
function namedFile(stem, has) {
  const parts = stem.split("-");
  for (let k = parts.length; k > 0; k--) {
    const file = parts.slice(0, k).join("-");
    if (has(file)) return file;
  }
  return undefined;
}

/** A predicate over take stems ('quests/m-5-accept-human-male-warrior'), given the named stems. */
export function namedBy(stems) {
  const named = new Set(stems);
  return (stem) => namedFile(stem, (file) => named.has(file)) !== undefined;
}

const LINE_STEM = `case split_part("lineId", ':', 1)
                  when 'q' then 'quests' when 'g' then 'gossip' when 'f' then 'followup' end
                || '/' || "fileName"`;

/** psql's query for those stems: each current line's subfolder and file. */
export const NAMED_QUESTS_SQL = `select distinct ${LINE_STEM}
           from "quest_line" where "lang" = :'lang' and "isCurrent"`;

/**
 * What a take with no saved words ships. JSON, because a raw tab or newline in a line would shift every row after it. Ordered so a file
 * two lines name always gives the same words. Never line_override: a rewrite can hold respellings.
 */
export const CURRENT_TEXT_SQL = `select ${LINE_STEM},
                to_json("text")::text, coalesce("playerGender", '')
           from "quest_line" where "lang" = :'lang' and "isCurrent"
          order by "lineId", "variant"`;

export function currentTextFor(rows, lang) {
  const byStem = new Map();
  for (const { stem, text, playerGender } of rows) {
    if (!byStem.has(stem)) byStem.set(stem, { text, playerGender: playerGender || null });
  }
  return (stem) => {
    const line = byStem.get(namedFile(stem, (file) => byStem.has(file)));
    return line && speakPlayerTokens(line.text, lang, line.playerGender);
  };
}
