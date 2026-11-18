/**
 * What a reviewer may say when dropping a line, as one click each. The Rejected tab shows the one
 * picked (contribution.rejectReason). Named in the page's language, since every client language
 * has a review page of its own.
 *
 * CLIENT-SAFE.
 */

/** For a line the corpus does not have yet. */
export function lineDropReasons(language: string): string[] {
  return [`Not in ${language}`, "Cut off", "Name, class or gender spelled out", "Placeholder I can't fix", "Same as what we have"];
}

/** For a correction to a line the corpus has. */
export function correctionDropReasons(language: string): string[] {
  return ["Our text is right", `Not in ${language}`, "Cut off", "Name, class or gender spelled out", "Placeholder lost"];
}
