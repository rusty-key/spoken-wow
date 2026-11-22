/**
 * The picker submits the selected label as the rejection reason (contribution.rejectReason).
 *
 * CLIENT-SAFE.
 */

export function lineDropReasons(language: string): string[] {
  return [`Not in ${language}`, "Cut off", "Name, class or gender spelled out", "Placeholder I can't fix", "Same as what we have"];
}

export function correctionDropReasons(language: string): string[] {
  return ["Our text is right", `Not in ${language}`, "Cut off", "Name, class or gender spelled out", "Placeholder lost"];
}
