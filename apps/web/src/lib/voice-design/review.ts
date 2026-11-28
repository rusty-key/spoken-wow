/** A verdict as the page sends it, checked before it is kept. */
import { DesignError } from "./access";
import type { NewReview } from "./store";
import { JUDGES, type ClipMark, type Design, type Judge, type Observation, type PlayerNote } from "./types";

export const MAX_NOTE = 2000;

/** What's different's notes are under 80 characters; this leaves room and refuses a pasted essay. */
const MAX_OBSERVATION = 500;
const MAX_OBSERVATIONS = 12;
const MAX_FIXES = 6;

/** The What's different findings a reviewer added, checked; kept apart from the note so revise never reads them as wishes. */
function parseObservations(value: unknown): Observation[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_OBSERVATIONS) throw new DesignError(`at most ${MAX_OBSERVATIONS} observations`, 400);
  return value.map((item) => {
    const { by, note, fixes } = (item ?? {}) as Record<string, unknown>;
    if (!JUDGES.includes(by as Judge)) throw new DesignError("an observation is by gemini or claude", 400);
    // Cut, not refused: the models ignore "under 80 characters" at times, and refusing would lose the verdict.
    if (typeof note !== "string" || !note.trim()) throw new DesignError("an observation has a note", 400);
    const kept = Array.isArray(fixes)
      ? fixes.filter((fix): fix is string => typeof fix === "string" && fix.trim() !== "").slice(0, MAX_FIXES).map((fix) => fix.trim().slice(0, MAX_OBSERVATION))
      : [];
    return { by: by as Judge, note: note.trim().slice(0, MAX_OBSERVATION), ...(kept.length ? { fixes: kept } : {}) };
  });
}

export function parseReview(body: unknown, design: Pick<Design, "previews" | "samples" | "showings">, userId: string): NewReview {
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
  // Copied as they read now: a note hidden or changed later still says what this verdict acted on.
  const players: PlayerNote[] = [];
  for (const pick of Array.isArray(input.players) ? (input.players as { showingId?: unknown; voter?: unknown }[]) : []) {
    const found = design.showings.find((showing) => showing.id === pick?.showingId)?.notes.find((note) => note.voter === pick?.voter);
    // Hidden since it was ticked, by this reviewer or another: the verdict still stands without it.
    if (!found) continue;
    players.push({ verdict: found.verdict, note: found.note });
  }
  const observations = parseObservations(input.observations);
  return { status: input.status, note, bestPreview: (best as number | null | undefined) ?? null, clips, players, observations, userId };
}
