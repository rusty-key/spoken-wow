// What a re-import does to a line that already exists.
//
// The rule lore_line's recordScrape follows, for the same reason: an import that could
// overwrite a correction is an import nobody dares run, and an import nobody runs means
// the corpus quietly stops tracking the dump. Recording without promoting keeps upstream
// movement visible in the history, where somebody can promote it deliberately.

/**
 * @param current the live row, or null if the line is new
 * @param incoming the extracted entry
 */
export function decideImport(current, incoming) {
  if (!current) return { action: "promote" };
  if (current.text === incoming.text) return { action: "skip" };
  // A name a translator kept from a player's client ('observed') is newer than any dump.
  return { action: current.origin === "edited" || current.origin === "observed" ? "record" : "promote" };
}
