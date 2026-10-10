// Which quests audio a pack carries: a file a current line of its language names, or one of
// that file in another voice (`{fileName}-{voice}`, naming.py variant_file_name).
//
// A take stays live when its line stops being current, as when a language's own text makes one
// line of a moment it had as `m-`/`f-` lines. Shipped, those would still play: the addon tries the
// player's `m-`/`f-` file before the plain one.

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
