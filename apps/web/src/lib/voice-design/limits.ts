/** What both the page and the server need to know about Voice Design. No server imports. */

/** ElevenLabs' limits: what Voice Design rejects, refused before anything is spent. */
export const DESIGN_LIMITS = { promptMin: 20, promptMax: 1000, textMin: 100, textMax: 1000 } as const;

/** Voice Design makes this many previews per request. */
export const PREVIEWS_PER_DESIGN = 3;

/** The account name of a version's voice: one name per attempt, so the account shows which is which. */
export function designName(design: { slot: string; version: number }): string {
  return `design-${design.slot}-v${design.version}`;
}
