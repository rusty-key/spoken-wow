/** A verdict as the page sends it, checked before it is kept. */
import { DesignError } from "./access";
import type { NewReview } from "./store";
import type { ClipMark, Design } from "./types";

export const MAX_NOTE = 2000;

export function parseReview(body: unknown, design: Pick<Design, "previews" | "samples">, userId: string): NewReview {
  const input = (body ?? {}) as Record<string, unknown>;
  if (input.status !== "good" && input.status !== "needs-work") throw new DesignError("a verdict is good or needs-work", 400);
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > MAX_NOTE) throw new DesignError(`a note is at most ${MAX_NOTE} characters`, 400);

  const best = input.bestPreview;
  if (best !== null && best !== undefined && !(Number.isInteger(best) && (best as number) >= 0 && (best as number) < design.previews.length)) {
    throw new DesignError("no such preview", 400);
  }

  const clips: Record<string, ClipMark> = {};
  for (const [key, mark] of Object.entries((input.clips ?? {}) as Record<string, unknown>)) {
    const match = /^(sample|preview):(\d+)$/.exec(key);
    const count = match?.[1] === "sample" ? design.samples.length : design.previews.length;
    if (!match || Number(match[2]) >= count || (mark !== "good" && mark !== "off")) throw new DesignError(`no clip ${key} to mark`, 400);
    clips[key] = mark;
  }
  return { status: input.status, note, bestPreview: (best as number | null | undefined) ?? null, clips, userId };
}
