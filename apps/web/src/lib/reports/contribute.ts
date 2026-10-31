/**
 * A report's text as a contribution: what the reporter's addon sent with the report (its
 * context), handled as the same text sent from /contribute would be.
 *
 * The context is the contribute envelope with its checksum and fences dropped, so it is written
 * back out (formatEnvelope) and goes through the contribute route's own submission and the
 * contributions page's own accepts. Which accept is the corpus's answer, as it is for a stored
 * row (known.ts): a moment or greeting the corpus lacks is a contribution, accepted as the
 * contributions tab accepts one (accept.ts); a moment it has with other text is a correction,
 * accepted as the corrections tab does (correction.ts) -- as a fix of one of the moment's
 * wordings, or beside them as another; text it already has is neither, and intake would have
 * dropped it.
 *
 * A quest moment is compared on what its wordings speak, not on the printed text a stored row is
 * compared on: a report is about what was heard, and a line whose printed text is the game's can
 * still speak an old rewrite (an override) or an extract with its narration dropped. So text the
 * printed line already has is still a correction when the line speaks otherwise.
 *
 * Nothing is stored until an accept is pressed. The contribution then keeps the reporter's
 * identity and complaint, and the report is answered Fixed once its text is written. A refused
 * accept leaves the contribution stored and new, on the contributions page, where whatever
 * refused it -- a speaker to pick, a side for each player gender -- is answered.
 */
import "server-only";

import { resolveContribution } from "@/lib/contributions/accept";
import { closeness, readable, sameLine } from "@/lib/contributions/compare";
import type { ContributionStatus, Submission } from "@/lib/contributions/contributions";
import { acceptAsWording, acceptCorrection, type WordingPick } from "@/lib/contributions/correction";
import { formatEnvelope, isEnvelopeSource } from "@/lib/contributions/envelope";
import { storeSubmission } from "@/lib/contributions/intake";
import { lineStates, oneLineEach, type LineState } from "@/lib/contributions/known";
import { wordingsOfMomentSql } from "@/lib/contributions/naming";
import { contributionByDedup, type Contribution } from "@/lib/contributions/store";
import { submissionFrom } from "@/lib/contributions/submission";
import { db } from "@/lib/db";
import { BASE_LANG } from "@/lib/lang";

import type { Report } from "./reports";
import { setStatus } from "./store";

/** Which tab the text would be on, as known.ts's LineState names it. */
export type ReportContribution = {
  /** The language the text is written into: the reporter's client's, which may not be the report's. */
  locale: string;
  text: string;
  state:
    | { kind: "missing" }
    | { kind: "known" }
    /**
     * Each wording's `before` is what it speaks now, or a book page's text, its `$B` breaks made
     * line breaks. `closest` indexes the one nearest the report's text.
     */
    | { kind: "changed"; wordings: { lineId: string; variant: number; before: string }[]; closest: number };
  /** The contribution this text is already stored as, from this report or sent on its own. */
  stored: { id: number; status: ContributionStatus } | null;
};

/** How a correction is accepted: as a fix of a wording (the closest, unless one is picked), or as another wording. */
export type CorrectionAccept = { as: "wording" } | { pick?: WordingPick };

export type ContributeOutcome =
  | { ok: true; report: Report; contribution: Contribution }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "refused"; message: string };

/** The submission a report's context makes, or why it makes none. */
export function reportSubmission(report: Report): Submission | string {
  const { context } = report;
  const { source } = report;
  if (source === "places" || !isEnvelopeSource(source) || !context?.text?.trim()) {
    return "This report carries no text from the game.";
  }
  const envelope = { source, fields: context.fields, text: context.text };
  return (
    submissionFrom(envelope, formatEnvelope(envelope), report.body) ??
    "The addon did not say which line this text is."
  );
}

/** What the report's text is to the corpus, and whether it is stored yet. */
export async function reportContribution(submission: Submission): Promise<ReportContribution> {
  const [state, stored] = await Promise.all([reportState(submission), contributionByDedup(submission.dedup)]);
  return {
    locale: submission.locale,
    text: submission.text ?? "",
    state:
      state.kind === "changed"
        ? {
            kind: "changed",
            wordings: state.wordings.map(({ lineId, variant, text }) => ({ lineId, variant, before: readable(text) })),
            closest: state.closest,
          }
        : state,
    stored,
  };
}

/**
 * Store the report's text and accept it as the corpus's answer says: a correction where the
 * moment has other text, the contributions tab's accept where the corpus lacks it.
 */
export async function contributeReport(
  report: Report,
  submission: Submission,
  userId: string,
  accept: CorrectionAccept = {},
): Promise<ContributeOutcome> {
  const state = await reportState(submission);
  if (state.kind === "known") {
    return { ok: false, reason: "refused", message: "The line already speaks this text, so it is not a contribution." };
  }

  await storeSubmission(submission, {
    body: report.body,
    name: report.name,
    email: report.email,
    userId: report.userId,
    ip: null,
  });
  const stored = await contributionByDedup(submission.dedup);
  if (!stored) return { ok: false, reason: "not-found" };

  const outcome =
    state.kind === "missing"
      ? await resolveContribution(stored.id, "accepted", userId)
      : "as" in accept
        ? await acceptAsWording(stored.id, userId)
        : await acceptCorrection(stored.id, userId, accept.pick, state);
  if (!outcome.ok) {
    if (outcome.reason === "not-found") return outcome;
    return {
      ok: false,
      reason: "refused",
      message: `${outcome.message} It is stored as contribution #${stored.id}, waiting on the contributions page.`,
    };
  }

  const fixed = await setStatus(report.id, "fixed", userId);
  if (!fixed) return { ok: false, reason: "not-found" };
  return { ok: true, report: fixed, contribution: outcome.contribution };
}

/**
 * The report's text against the corpus: known.ts's answer, except that a quest moment's wordings
 * are compared on what they speak -- the English override where one is set, else the line's own
 * text -- in the order and shape known.ts lists them.
 */
async function reportState(submission: Submission): Promise<LineState> {
  const [state] = await lineStates([submission]);
  const { quest, event } = submission.meta;
  if (state.kind === "missing" || submission.source !== "quests" || !quest || !event || !submission.text) return state;

  const { rows } = await db().query<{ lineId: string; variant: number; text: string }>(
    `select l."lineId", l."variant", coalesce(o."text", l."text") as "text"
       from "quest_line" l
       left join "line_override" o on o."lineId" = l."lineId" and l."lang" = $3
      where l."lang" = $2 and l."isCurrent" and ${wordingsOfMomentSql(`l."questId"`, `l."source"`, "$1")}
      order by l."lineId" ~ ':w[0-9]+(:[mf])?$', l."lineId", l."variant"`,
    [`q:${quest}:${event}`, submission.locale, BASE_LANG],
  );
  const text = submission.text;
  if (rows.length === 0) return state;
  const same = rows.find((row) => sameLine(row.text, text));
  if (same) return { kind: "known", lineId: same.lineId };
  const wordings = oneLineEach(rows);
  const scores = wordings.map((line) => closeness(line.text, text));
  return { kind: "changed", wordings, closest: scores.indexOf(Math.max(...scores)) };
}
