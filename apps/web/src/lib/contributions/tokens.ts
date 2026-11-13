/**
 * The spoken form of a contributed line's template tokens -- REPLACE_DICT in
 * pipelines/quests/tts_cli/tts_utils.py, which is what the extract does to every line it reads.
 *
 * A contribution arrives with the reader's name, class and race already put back as `$N`, `$C`
 * and `$R` (addons/Spoken_Quests/Contribute.lua, Detemplate), so it is the same kind of text the
 * extract starts from: the template is the line's `originalText`, and this is its `text`. Left
 * as tokens, `text` would be refused as `invalid-chars` (text-gate.ts) and never voiced.
 *
 * Kept as the Python's table, entry for entry and in its order, so the two can be diffed by
 * eye: a contributed line that said "Traveler" where an extracted one says "Adventurer" would
 * be the same corpus speaking two ways.
 */
const REPLACE: readonly (readonly [string, string])[] = [
  ["$b", "\n"],
  ["$B", "\n"],
  ["$n", "adventurer"],
  ["$N", "Adventurer"],
  ["$C", "Adventurer"],
  ["$c", "adventurer"],
  ["$R", "Traveler"],
  ["$r", "traveler"],
];

export function spokenFromTemplate(template: string): string {
  return REPLACE.reduce((text, [token, word]) => text.replaceAll(token, word), template);
}
