/**
 * Accepting a correction: a quest line or book page the corpus has, sent back by a player's client with
 * different text (known.ts's "changed"), taken as what the line now speaks.
 *
 * Not resolve's accept: that writes a line that is missing (accept.ts), and this line is not. It
 * writes a new version of the original text, in any language, and marks the contribution
 * accepted. A team's override stays above it, flagged as drifted. The printed text the
 * correction was compared on (originalText, localeText) is left as the extract had it: it is
 * what names the file and what the addon matches on. The row stays on the corrections tab,
 * accepted (known.ts's tabOf).
 *
 * Both writes say where the text came from: the activity log names the contribution, and the
 * version carries it in its note.
 *
 * The English text is the template made spoken (tokens.ts), as accept.ts writes a contributed
 * line; another language keeps its $N, $C and $R, as accept does, for player-words.ts
 * to speak in that language. A template that branches on the player's gender is two lines in
 * either language: saveQuestText splits a translation, and correctEnglish an English line.
 *
 * A book page is written as an editor's save of that language's text (a new 'edited' version).
 * Unlike a quest line, its text is what the row is compared on, so once accepted the row is
 * known, and tabOf lists it with the accepted contributions.
 *
 * Not one transaction with the status flip: the two writers own theirs, and both are
 * idempotent -- the same text again spends no version and logs nothing -- so an accept that
 * fails after the text is written is simply sent again. A book page so written already reads
 * as known; its current version carrying this contribution's note is what lets the resend
 * flip the status alone.
 *
 * A correction that is not a fix but another wording of the moment -- another giver's, or the
 * same NPC's to another player -- is accepted with acceptAsWording, which writes beside the
 * line instead of over it.
 */
import "server-only";

import { normaliseText } from "@readables-tools/lib/text.mjs";

import { recordActivity } from "@/lib/activity/store";
import { BookConflict, BookMissing, saveBookText } from "@/lib/readables/text";
import { db } from "@/lib/db";
import { withTextTeam } from "@/lib/teams/store";
import { BASE_LANG, isLang, type Lang } from "@/lib/lang";
import { branchesOnPlayerGender, playerTokenCounts } from "@/lib/player-words";
import { momentLines, writeEnglishOriginal } from "@/lib/quests/moment-rewrite";
import { OverrideError } from "@/lib/quests/override";
import { QuestTextConflict, QuestTextMissing, saveQuestText } from "@/lib/quests/text";

import { writeWording } from "./accept";
import { genderSplit, readable } from "./compare";
import type { ReaderGender } from "./gender";
import { MAX_BYTES } from "./envelope";
import { lineStates, type CorpusText, type LineState } from "./known";
import { baseLineId, momentOf } from "./naming";
import { CONTRIBUTION_COLUMNS, rewriteWaitingTexts, type Contribution } from "./store";
import { correctionNote } from "./notes";
import { writtenFromTemplate } from "./tokens";

export type CorrectionOutcome =
  | { ok: true; contribution: Contribution }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "not-a-correction" | "malformed" | "needs-speaker"; message: string };

/** One of a quest moment's wordings (known.ts LineState), as the corrections tab names it. */
export type WordingPick = Pick<CorpusText, "lineId" | "variant">;

/**
 * `pick` is the wording the correction fixes, where the moderator chose one; otherwise it is
 * the one closest to the player's text. `against` is the moment's wordings when the caller
 * compared on something other than the printed text: a report's text is compared on what the
 * line speaks (reports/contribute.ts).
 *
 * `split` keeps both instead, one per player gender: the player's text for `split`, the line's
 * current text for the other, as one `$G` template (compare.ts genderSplit), which splits the
 * moment. Built here from the line as it now stands, so an edit since the page loaded is kept.
 */
export async function acceptCorrection(
  id: number,
  userId: string,
  pick?: WordingPick,
  against?: Extract<LineState, { kind: "changed" }>,
  split?: ReaderGender,
): Promise<CorrectionOutcome> {
  const { rows } = await db().query<Contribution>(
    `select ${CONTRIBUTION_COLUMNS} from "contribution" where "id" = $1`,
    [id],
  );
  const contribution = rows[0];
  if (!contribution) return { ok: false, reason: "not-found" };
  const lang = contribution.locale;
  if ((contribution.source !== "quests" && contribution.source !== "readables") || !contribution.text || !isLang(lang)) {
    return {
      ok: false,
      reason: "not-a-correction",
      message: "Only a quest line or a book page sent in a site language is a correction.",
    };
  }

  const [state] = against ? [against] : await lineStates([contribution]);
  if (state.kind === "known" && contribution.source === "readables" && contribution.status !== "accepted"
      && (await bookCorrectionWritten(id, lang))) {
    return markAccepted(contribution, lang, userId);
  }
  if (state.kind !== "changed") {
    return {
      ok: false,
      reason: "not-a-correction",
      message: "The corpus no longer has a different text for this line -- nothing to correct.",
    };
  }
  const target = pick
    ? state.wordings.find((line) => line.lineId === pick.lineId && line.variant === pick.variant)
    : state.wordings[state.closest];
  if (!target) {
    return {
      ok: false,
      reason: "not-a-correction",
      message: "That is not a wording this moment has any more -- reload to see its wordings.",
    };
  }

  let text = contribution.text;
  if (split) {
    const plain = contribution.source === "quests" && momentOf(target.lineId) === target.lineId;
    const template = plain ? genderSplit(readable(target.text), contribution.text, split) : null;
    if (!template) {
      return {
        ok: false,
        reason: "not-a-correction",
        message: "This line cannot be split by gender with the player's text: it is split already, or they differ in nothing a branch can hold.",
      };
    }
    text = template;
  }

  const dropped = await droppedTokens(contribution.source, lang, target, text);
  if (dropped.length > 0) {
    return {
      ok: false,
      reason: "malformed",
      message: `The correction has fewer ${dropped.join(", ")} than the line it replaces. Put them back in the explorer before accepting it.`,
    };
  }

  try {
    if (contribution.source === "readables") {
      await saveBookText({ lineId: target.lineId, text, note: correctionNote(id), editedBy: userId, lang });
    } else if (lang === BASE_LANG) {
      const refusal = await correctEnglish(momentOf(target.lineId), target.variant, text, id, userId);
      if (refusal) return refusal;
    } else {
      await saveQuestText({
        lineId: target.lineId,
        variant: target.variant,
        lang,
        text,
        note: correctionNote(id),
        editedBy: userId,
        contribution: id,
      });
    }
  } catch (error) {
    if (
      error instanceof OverrideError ||
      error instanceof QuestTextMissing ||
      error instanceof QuestTextConflict ||
      error instanceof BookMissing ||
      error instanceof BookConflict
    ) {
      return { ok: false, reason: "malformed", message: error.message };
    }
    throw error;
  }

  return markAccepted(contribution, lang, userId, split ? { split } : {});
}

/**
 * Accepting a correction as another wording of its moment rather than a fix of it: both texts
 * are the game's, shown to different players or by different givers. The corpus line is left
 * alone and the player's text is written beside it (accept.ts writeWording). Once written the
 * row reads as known, so a resend that finds its wording only flips the status.
 */
export async function acceptAsWording(id: number, userId: string): Promise<CorrectionOutcome> {
  const { rows } = await db().query<Contribution>(
    `select ${CONTRIBUTION_COLUMNS} from "contribution" where "id" = $1`,
    [id],
  );
  const contribution = rows[0];
  if (!contribution) return { ok: false, reason: "not-found" };
  const lang = contribution.locale;
  if (contribution.source !== "quests" || !contribution.text || !isLang(lang)) {
    return {
      ok: false,
      reason: "not-a-correction",
      message: "Only a quest line sent in a site language can be another wording.",
    };
  }
  // Whether the text is already a wording is writeWording's to say, under the moment's lock.
  const [state] = await lineStates([contribution]);
  if (state.kind === "missing") {
    return {
      ok: false,
      reason: "not-a-correction",
      message: "The corpus has no line for this moment yet -- accept it on the contributions tab.",
    };
  }
  const written = await writeWording(contribution, userId);
  if (!written.ok) return written;
  return markAccepted(contribution, lang, userId, { wording: written.lineId });
}

/**
 * A moderator's fix to the player's text before it is accepted: what the client sent is mostly
 * right and one word is not, and the explorer is a page away. Only a row still waiting is
 * edited (rewriteWaitingTexts), and under the cap a paste has. Answers the text it replaced, for
 * the caller to put back if the accept after it is refused; null where nothing changed.
 */
export async function editCorrectionText(
  id: number,
  text: string,
  userId: string,
): Promise<{ ok: true; previous: string | null } | { ok: false; reason: "malformed"; message: string }> {
  const normalised = normaliseText(text);
  if (!normalised) return { ok: false, reason: "malformed", message: "The text is empty." };
  if (new TextEncoder().encode(normalised).length > MAX_BYTES) {
    return { ok: false, reason: "malformed", message: "The text is longer than any line the addon sends." };
  }
  const [changed] = await rewriteWaitingTexts([{ id, text: normalised }]);
  if (!changed) return { ok: true, previous: null };
  if (isLang(changed.locale)) {
    await recordActivity({
      kind: "contribution.edited",
      lang: changed.locale,
      source: changed.source,
      subject: String(id),
      actorId: userId,
      detail: { field: "text" },
    });
  }
  return { ok: true, previous: changed.previous };
}

/**
 * Whether this contribution's correction is already the page's current text in its language:
 * the text was saved and the status flip after it failed, so the row now reads as known.
 */
async function bookCorrectionWritten(id: number, lang: string): Promise<boolean> {
  const { rowCount } = await db().query(
    `select 1 from "book_line" where "note" = $1 and "lang" = $2 and "isCurrent"`,
    [correctionNote(id), lang],
  );
  return (rowCount ?? 0) > 0;
}

async function markAccepted(
  contribution: Contribution,
  lang: Lang,
  userId: string,
  extra: Record<string, unknown> = {},
): Promise<CorrectionOutcome> {
  const { id } = contribution;
  return withTextTeam(lang, async (client, team) => {
    const updated = await client.query<Contribution>(
      `update "contribution"
          set "status" = 'accepted', "resolvedBy" = $2, "updatedAt" = now()
        where "id" = $1
        returning ${CONTRIBUTION_COLUMNS}`,
      [id, userId],
    );
    await recordActivity(
      {
        team,
        kind: "contribution.resolved",
        lang,
        source: contribution.source,
        subject: String(id),
        actorId: userId,
        detail: { status: "accepted", key: contribution.key, correction: true, ...extra },
      },
      client,
    );
    return { ok: true, contribution: updated.rows[0] };
  });
}

type ReadLine = { text: string; playerGender: ReaderGender | null };

/**
 * The player tokens (`$N`, `$C`, `$R`, `$G`) `text` has fewer of than a line it replaces, on the
 * sides that line's readers take. The client fills each in for its own reader, so a text without
 * them would greet every player as that one. English quest lines store spoken text, not the
 * template: correctEnglish checks those.
 */
async function droppedTokens(source: string, lang: Lang, target: CorpusText, text: string): Promise<string[]> {
  if (source === "quests" && lang === BASE_LANG) return [];
  const replaced: ReadLine[] =
    source === "quests" ? await questLinesReplaced(lang, target, text) : [{ text: target.text, playerGender: null }];
  const after = playerTokenCounts(text, lang);
  const dropped = new Set<string>();
  for (const line of replaced) {
    const before = playerTokenCounts(line.text, lang);
    const sides = line.playerGender ? [line.playerGender] : (["m", "f"] as const);
    for (const token of ["N", "C", "R"] as const) {
      if (sides.some((side) => after[side][token] < before[side][token])) dropped.add(`$${token}`);
    }
    // A side line's branch is only ever read one way, so losing it there loses nothing.
    if (!line.playerGender && after.G < before.G) dropped.add("$G");
  }
  return [...dropped];
}

/**
 * The lines saveQuestText overwrites with `text`, as stored: every line of the moment, except a
 * side of a split moment edited alone by a text without `$G`. Stored rather than the game's print
 * `target` carries, since a translator's token in the stored text is what the write would lose.
 */
async function questLinesReplaced(lang: Lang, target: CorpusText, text: string): Promise<ReadLine[]> {
  const rows = await momentLines(lang, target.lineId, target.variant);
  const own = rows.find((row) => row.lineId === baseLineId(target.lineId));
  if (own?.playerGender && !branchesOnPlayerGender(text)) return [own];
  return rows.length > 0 ? rows : [{ text: target.text, playerGender: null }];
}

/**
 * An English correction, written to every line the moment has.
 *
 * A template without `$G` for a moment split by player gender is refused: the client resolves
 * `$G` before sending, so the text is one side's words. A newer addon's `readerSex` says which,
 * which the corrections tab uses to split a plain line (readers.ts), not a split one.
 */
async function correctEnglish(
  moment: string,
  variant: number,
  template: string,
  contributionId: number,
  userId: string,
): Promise<Extract<CorrectionOutcome, { ok: false }> | null> {
  const rows = await momentLines(BASE_LANG, moment, variant);
  if (rows.length === 0) {
    return { ok: false, reason: "not-a-correction", message: `${moment} is not a line the corpus has` };
  }

  const text = writtenFromTemplate(template);
  if (rows.some((row) => row.playerGender !== null) && !branchesOnPlayerGender(text)) {
    return {
      ok: false,
      reason: "malformed",
      message: "This line has a side for each player gender, and the correction is one player's words. Edit it in the explorer.",
    };
  }
  await writeEnglishOriginal(rows, variant, text, userId, {
    originalText: template,
    contributionId,
    note: correctionNote(contributionId),
  });
  return null;
}
