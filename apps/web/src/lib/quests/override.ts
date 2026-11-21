/**
 * A line's spoken text, rewritten by hand.
 *
 * Shapes and validation only, no node imports: the dialog checks a draft before sending it so
 * the message lands next to the field, and the route checks the copy that counts.
 *
 * An override replaces what is *spoken*. It cannot touch originalText, which is what names
 * the file and what the addon matches on - see the header of migration 0012.
 */
import { BASE_LANG, type Lang } from "../lang";
import { branchesOnPlayerGender, playerGenderSides, speakPlayerTokens } from "../player-words";
import { INVALID_CHARS, hasInvalidChars } from "../text-gate";

export type LineOverride = {
  file: string;
  lineId: string;
  text: string;
  updatedAt: string;
  updatedBy: string | null;
  /** The original's hash at the last save. Absent or null never counts as changed. */
  originalHash?: string | null;
};

export class OverrideError extends Error {}

/**
 * The longest line in the corpus is 529 characters. The ceiling is well clear of that and is
 * here to stop a paste, not to shape an edit: every character is billed, and a line long
 * enough to matter is a line that should have been split.
 */
export const MAX_OVERRIDE_LENGTH = 2000;

/**
 * What the dialog sends: an override's shape, whose text may also hold `$G` branches, which the
 * route writes to the moment's lines (quests/moment-rewrite.ts) rather than to this file.
 */
export function validateRewrite(input: unknown, lang: Lang): { file: string; lineId: string; text: string } {
  if (!input || typeof input !== "object") throw new OverrideError("expected an override object");
  const body = input as Record<string, unknown>;

  const file = body.file;
  if (typeof file !== "string" || !file.trim()) throw new OverrideError("file is required");

  const lineId = body.lineId;
  if (typeof lineId !== "string" || !lineId.trim()) throw new OverrideError("lineId is required");

  const text = body.text;
  if (typeof text !== "string") throw new OverrideError("text must be a string");
  const trimmed = text.trim();
  if (!trimmed) throw new OverrideError("text cannot be empty - remove the override instead");
  if (trimmed.length > MAX_OVERRIDE_LENGTH) {
    throw new OverrideError(`text is too long (${MAX_OVERRIDE_LENGTH} characters)`);
  }
  // The whole point of an override is to get a line past this gate, so letting one
  // reintroduce the characters it exists to remove would be a trap rather than a freedom.
  if (rewriteHasInvalidChars(trimmed, lang)) {
    throw new OverrideError(
      `text cannot contain any of ${INVALID_CHARS} outside a $g branch such as $glad:lass; - those are what make a line unvoiceable`,
    );
  }

  return { file: file.trim(), lineId: lineId.trim(), text: trimmed };
}

/** One file's override: a rewrite whose text is what that file says, with no `$G` left in it. */
export function validateOverride(input: unknown, lang: Lang): { file: string; lineId: string; text: string } {
  const draft = validateRewrite(input, lang);
  if (branchesOnPlayerGender(draft.text)) {
    throw new OverrideError(`text cannot contain any of ${INVALID_CHARS} - those are what make a line unvoiceable`);
  }
  return draft;
}

/**
 * Whether either reader's side of the text's `$G` branches holds what cannot be voiced. A
 * translation keeps its tokens for player-words.ts, so a voice maintainer starts from a line holding
 * a `$N`. English text has none left, so one typed there is a mistake.
 */
export function rewriteHasInvalidChars(text: string, lang: Lang): boolean {
  return playerGenderSides(text).some((side) =>
    hasInvalidChars(lang === BASE_LANG ? side : speakPlayerTokens(side, lang)),
  );
}

/** A voice's name as migration 0071's voice table allows it, or a model slot's. */
const VOICE_SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * A file's override, or for a voice's file (`{file}-{voice}`, naming.ts variantFileName) its
 * line's: a voice's line shares its line's text, and an override is saved against the line's file.
 *
 * The shortest stem with an override wins, which is the longest voice: a voice is never
 * mistaken for the tail of a longer one. By shape rather than by the roster, so a voice an
 * admin adds needs no reload here and every caller stays synchronous.
 */
export function overrideOf(overrides: Map<string, LineOverride>, file: string): LineOverride | undefined {
  const own = overrides.get(file);
  if (own) return own;
  const stem = file.replace(/\.mp3$/, "");
  for (let at = stem.indexOf("-"); at > 0; at = stem.indexOf("-", at + 1)) {
    if (!VOICE_SHAPE.test(stem.slice(at + 1))) continue;
    const line = overrides.get(`${stem.slice(0, at)}.mp3`);
    if (line) return line;
  }
  return undefined;
}
