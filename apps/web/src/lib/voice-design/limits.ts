/** What both the page and the server need to know about Voice Design. No server imports. */

/** ElevenLabs' limits: what Voice Design rejects, refused before anything is spent. */
export const DESIGN_LIMITS = { promptMin: 20, promptMax: 1000, textMin: 100, textMax: 1000 } as const;

/**
 * Voice Remix's settings, each with the range ElevenLabs takes. Unset ones take its own defaults.
 * Prompt strength: 0 keeps the voice, 1 follows the changes. Guidance: lower is freer, high can
 * sound artificial. Loudness: -1 quietest to 1 loudest.
 */
export const REMIX_SETTINGS = {
  promptStrength: { min: 0, max: 1, step: 0.05, initial: 0.5 },
  guidanceScale: { min: 0, max: 20, step: 0.5, initial: 2 },
  loudness: { min: -1, max: 1, step: 0.05, initial: 0.5 },
} as const;
export const REMIX_CHANGES_MAX = 500;
/** ElevenLabs refuses a seed past an unsigned 32-bit integer. */
export const REMIX_SEED_MAX = 4294967295;

/** Voice Remix's settings as the page starts them: ElevenLabs' defaults, and a fresh voice each time. */
export const REMIX_DEFAULTS = {
  promptStrength: REMIX_SETTINGS.promptStrength.initial,
  guidanceScale: REMIX_SETTINGS.guidanceScale.initial,
  loudness: REMIX_SETTINGS.loudness.initial,
  seed: null,
} as const;

export type RemixSettings = { promptStrength: number | null; guidanceScale: number | null; loudness: number | null; seed: number | null };

/** The settings as sent, or what is wrong with them. */
export function parseRemixSettings(input: unknown): RemixSettings | string {
  const raw = (input ?? {}) as Record<string, unknown>;
  const settings: RemixSettings = { promptStrength: null, guidanceScale: null, loudness: null, seed: null };
  for (const key of ["promptStrength", "guidanceScale", "loudness"] as const) {
    const value = raw[key];
    if (value === null || value === undefined) continue;
    const { min, max } = REMIX_SETTINGS[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) return `${key} must be ${min} to ${max}`;
    settings[key] = value;
  }
  const seed = raw.seed;
  if (seed !== null && seed !== undefined) {
    if (typeof seed !== "number" || !Number.isInteger(seed) || seed < 0 || seed > REMIX_SEED_MAX) return `seed must be a whole number, 0 to ${REMIX_SEED_MAX}`;
    settings.seed = seed;
  }
  return settings;
}

/** Voice Design makes this many previews per request. */
export const PREVIEWS_PER_DESIGN = 3;

export function previewTextProblem(text: string): string | null {
  const { textMin, textMax } = DESIGN_LIMITS;
  const length = text.trim().length;
  return length < textMin || length > textMax ? `the preview text must be ${textMin} to ${textMax} characters` : null;
}

/** The account name of a version's voice: one name per attempt, so the account shows which is which. */
export function designName(design: { slot: string; version: number }): string {
  return `design-${design.slot}-v${design.version}`;
}

/**
 * Every prompt ends with this. Measured on 45 slots: with the old "dry close-mic studio recording"
 * ending and consonant wording, s sounds were four times harsher than the live takes; with this
 * ending, softer than them.
 */
export const PROMPT_ENDING =
  "Soft, gentle s sounds. Clean professional audiobook recording, close to a warm studio microphone, natural and full-bodied, no harshness, no room echo.";

/** Wording that makes s sounds harsh. */
export const SIBILANT_WORDS = ["crisp", "sharp", "hissing", "sibilant", "snappy consonants"] as const;
/** Effects Voice Design renders badly: a clean voice is designed, not a processed one. */
export const EFFECT_WORDS = ["reverb", "echo", "pitch shift"] as const;
const HARSH_WORDS = [...SIBILANT_WORDS, ...EFFECT_WORDS];

/** The ending round one used, which made s sounds harsh: replaced wherever a draft still has it. */
const OLD_ENDING = "Perfect audio quality, dry close-mic studio recording, no reverb or effects.";

/** The prompt with the required ending, replacing the old studio sentence where a draft still has it. */
export function withEnding(prompt: string): string {
  const body = prompt.replace(OLD_ENDING, " ").replace(/\s+/g, " ").trim();
  if (!body.replace(PROMPT_ENDING, "").trim()) return body;
  return body.endsWith(PROMPT_ENDING) ? body : `${body.replace(PROMPT_ENDING, "").trim()} ${PROMPT_ENDING}`;
}

/**
 * Why Voice Design would refuse the prompt, or null. The minimum is on what was written, since the
 * ending alone would pass it; the maximum is on what is sent, ending included.
 */
export function promptLengthProblem(prompt: string): string | null {
  const { promptMin, promptMax } = DESIGN_LIMITS;
  const written = withEnding(prompt).replace(PROMPT_ENDING, "").trim().length;
  const sent = withEnding(prompt).length;
  if (written < promptMin) return `the prompt needs at least ${promptMin} characters of description`;
  if (sent > promptMax) return `the prompt is ${sent} characters with its ending; the limit is ${promptMax}`;
  return null;
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
const ROOM_LIMIT_DB = -17;
const LEVEL_SPREAD_DB = 6;

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
