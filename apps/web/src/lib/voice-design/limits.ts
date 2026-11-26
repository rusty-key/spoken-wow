/** What both the page and the server need to know about Voice Design. No server imports. */

/** ElevenLabs' limits: what Voice Design rejects, refused before anything is spent. */
export const DESIGN_LIMITS = { promptMin: 20, promptMax: 1000, textMin: 100, textMax: 1000 } as const;

/** Voice Design makes this many previews per request. */
export const PREVIEWS_PER_DESIGN = 3;

/** The account name of a version's voice: one name per attempt, so the account shows which is which. */
export function designName(design: { slot: string; version: number }): string {
  return `design-${design.slot}-v${design.version}`;
}

/**
 * Every prompt ends with this. Round two measured why: the old "dry close-mic studio recording"
 * ending and any wording about consonants gave designed voices s sounds four times harsher than
 * the live takes; this ending brought them below the live takes.
 */
export const PROMPT_ENDING =
  "Soft, gentle s sounds. Clean professional audiobook recording, close to a warm studio microphone, natural and full-bodied, no harshness, no room echo.";

/** Wording that makes s sounds harsh, or asks Voice Design for effects it renders badly. */
export const HARSH_WORDS = ["crisp", "sharp", "hissing", "sibilant", "snappy consonants", "reverb", "echo", "pitch shift"] as const;

const OLD_ENDING = /\s*Perfect audio quality[^]*$/i;

/** The prompt with the required ending, replacing the old studio sentence where a draft still has it. */
export function withEnding(prompt: string): string {
  const body = prompt.trim().replace(OLD_ENDING, "");
  return body.endsWith(PROMPT_ENDING) ? body : `${body.replace(PROMPT_ENDING, "").trim()} ${PROMPT_ENDING}`;
}

export function promptProblems(prompt: string): { missingEnding: boolean; words: string[] } {
  const trimmed = prompt.trim();
  const body = trimmed.replace(PROMPT_ENDING, "").toLowerCase();
  return {
    missingEnding: !trimmed.endsWith(PROMPT_ENDING),
    words: HARSH_WORDS.filter((word) => new RegExp(`\\b${word}`).test(body)),
  };
}

/** What a preview was measured at: s-level (`ess`), room tail (`decay`, dB) and speech level (dBFS). */
export type PreviewMetrics = { ess?: number; decay?: number; level?: number };

/** A room tail above this sounds like a hall; a preview this far below the loudest is mumbled. */
export const ROOM_LIMIT_DB = -17;
export const LEVEL_SPREAD_DB = 6;

/**
 * The preview to save: the softest s among those without a long room tail and not much quieter
 * than the loudest, else the softest s. One design's previews ranged from 0.18 to 0.74.
 */
export function recommendedPreview(previews: readonly (PreviewMetrics | null)[]): number | null {
  const measured = previews.flatMap((p, index) =>
    p && p.ess !== undefined && p.decay !== undefined && p.level !== undefined
      ? [{ index, ess: p.ess, decay: p.decay, level: p.level }]
      : [],
  );
  if (measured.length === 0) return null;
  const loudest = Math.max(...measured.map((p) => p.level));
  const passing = measured.filter((p) => p.decay <= ROOM_LIMIT_DB && p.level >= loudest - LEVEL_SPREAD_DB);
  return (passing.length > 0 ? passing : measured).reduce((best, p) => (p.ess < best.ess ? p : best)).index;
}
