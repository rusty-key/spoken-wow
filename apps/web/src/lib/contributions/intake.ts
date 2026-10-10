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
import { isLang } from "@/lib/lang";
import { observedFrom, resolveNpc } from "@/lib/npc/resolve";

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

/**
 * Store one submission and resolve its speaker.
 *
 * `resolved` is for a batch: the same NPC observed the same way needs resolving once, and a
 * gathered file holds every stage and every gossip line of each NPC it met. Resolution reads
 * the whole corpus, so repeating it per line is most of what a batch would otherwise cost.
 */
export async function storeSubmission(
  submission: Submission,
  identity: Identity,
  resolved?: Set<string>,
): Promise<void> {
  await createContribution({ ...submission, ...identity });

  // Who is speaking, worked out now rather than at triage: it costs a corpus lookup and one
  // upsert, it reaches no network, and it means the queue never shows a blank where a name
  // should be. A failure here must not fail the contribution -- the text is the thing worth
  // keeping, and an unresolved NPC is a row a moderator can fix.
  //
  // build is not in submission.meta -- submissionFrom destructures it out into its own column
  // (the spec, migration 0030 and the README all promise it survives), so it has to be put
  // back here or observedFrom reads meta.build as undefined and every resolution loses it.
  const observed = observedFrom({ ...submission.meta, build: submission.build });
  const key = JSON.stringify(observed);
  if (resolved?.has(key)) return;
  resolved?.add(key);
  try {
    await resolveNpc(observed, isLang(submission.locale) ? submission.locale : null);
  } catch (error) {
    console.error("contribution stored but npc resolution failed", error);
  }
}
