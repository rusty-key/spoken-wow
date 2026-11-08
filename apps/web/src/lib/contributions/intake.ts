/**
 * What both contribution routes do once an envelope has passed its checks: store it, and work
 * out who is speaking. Shared so that "a batch is checked and stored exactly as a single one
 * is" stays true by construction rather than by two copies kept in step.
 *
 * Server-side only: it writes.
 */
import { lineStates } from "@/lib/contributions/known";
import { createContribution } from "@/lib/contributions/store";
import type { Submission } from "@/lib/contributions/contributions";
import { isLang, type Lang } from "@/lib/lang";
import { type Observed, observedFrom, resolveNpc } from "@/lib/npc/resolve";

/**
 * One allowance for both routes, counted in the same hits table: a batch is one deliberate
 * act, and a separate allowance would be a second way round the first. Deliberately not
 * configurable, as the reports limit is not: a knob nobody turns is set wrong.
 */
export const CONTRIBUTIONS_PER_HOUR = 10;
export const CONTRIBUTION_WINDOW_MS = 60 * 60 * 1000;

export type Identity = {
  body: string | null;
  name: string | null;
  email: string | null;
  userId: string | null;
  ip: string | null;
};

export function stringOrNull(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * Which submissions say what the corpus already says, in the order given: those are dropped
 * rather than stored (known.ts). The addon gathers every line a player sees, so this is most of
 * what a gathered file holds, and a row for each would bury the lines that are missing.
 */
export async function knownSubmissions(submissions: readonly Submission[]): Promise<boolean[]> {
  return (await lineStates(submissions)).map((state) => state.kind === "known");
}

export async function storeSubmission(submission: Submission, identity: Identity): Promise<void> {
  await createContribution({ ...submission, ...identity });
  await resolveSpeakers(speakersOf([submission]));
}

/** Each NPC once: a gathered file holds every stage and gossip line of each NPC it met. */
export function speakersOf(submissions: readonly Submission[]) {
  const speakers = new Map<string, { observed: Observed; lang: Lang | null }>();
  for (const submission of submissions) {
    // submissionFrom moves build out of meta, and observedFrom reads it from there.
    const observed = observedFrom({ ...submission.meta, build: submission.build });
    const key = JSON.stringify(observed);
    if (!speakers.has(key)) speakers.set(key, { observed, lang: isLang(submission.locale) ? submission.locale : null });
  }
  return [...speakers.values()];
}

export async function resolveSpeakers(speakers: ReturnType<typeof speakersOf>): Promise<void> {
  for (const { observed, lang } of speakers) {
    try {
      await resolveNpc(observed, lang);
    } catch (error) {
      // The text is what is worth keeping, and an unresolved NPC is a row a moderator can fix.
      console.error("contribution stored but npc resolution failed", error);
    }
  }
}
