/**
 * Quests whose text names a class as a word of its own (migration 0105): "There's a priest out
 * in the mountains" is about a priest whoever reads it. The addon cannot tell that word from the
 * reader's class, so a priest reading it sends `$c` (Contribute.lua, Detemplate), and accepting
 * that would have every player hear "adventurer".
 *
 * A moderator marks the quest once from the corrections tab. From then on intake puts the word
 * back from the corpus line before the text is stored or deduplicated (compare.ts
 * restoreClassWords), so a priest's paste and a mage's are the same row. Marking also puts it
 * back in the quest's rows still waiting on triage.
 */
import "server-only";

import { recordActivity } from "@/lib/activity/store";
import { db } from "@/lib/db";
import { isLang } from "@/lib/lang";

import { hasClassSlot, restoreClassWords } from "./compare";
import type { Submission } from "./contributions";
import { closestOf, momentNamed, momentTexts, oneLineEach } from "./known";
import { CONTRIBUTION_COLUMNS, rewriteWaitingTexts, type Contribution } from "./store";
import { dedupOf } from "./submission";

type Row = Pick<Submission, "source" | "locale" | "text" | "meta">;

/** The quest a quests row names, or null for a greeting or an id no column could hold. */
export function questIdOf(row: Pick<Submission, "source" | "meta">): number | null {
  const quest = row.meta.quest;
  if (row.source !== "quests" || !quest || !/^\d+$/.test(quest)) return null;
  const id = Number(quest);
  return id > 0 && id <= 2_147_483_647 ? id : null;
}

/** Which of `questIds` are marked. */
export async function classWordQuests(questIds: readonly number[]): Promise<Set<number>> {
  if (questIds.length === 0) return new Set();
  const { rows } = await db().query<{ questId: number }>(
    `select "questId" from "quest_class_word" where "questId" = any($1::int[])`,
    [[...new Set(questIds)]],
  );
  return new Set(rows.map((row) => row.questId));
}

/** Each row's text with its class slots put back where its quest is marked; null where none changed. */
async function restoredTexts(rows: readonly Row[]): Promise<(string | null)[]> {
  const slotted = rows.map((row) => (row.text && hasClassSlot(row.text) ? questIdOf(row) : null));
  const marked = await classWordQuests(slotted.filter((id): id is number => id !== null));
  if (marked.size === 0) return rows.map(() => null);

  const moments = rows.map((row, index) => {
    const questId = slotted[index];
    return questId !== null && marked.has(questId) ? momentNamed(row) : null;
  });
  const byMoment = await momentTexts(
    rows.flatMap((row, index) => (moments[index] ? [{ locale: row.locale, moment: moments[index] }] : [])),
  );
  return rows.map((row, index) => {
    const lines = oneLineEach(byMoment.get(`${row.locale}|${moments[index]}`) ?? []);
    if (!moments[index] || !row.text || lines.length === 0) return null;
    const restored = restoreClassWords(row.text, lines[closestOf(lines, row.text)].text);
    return restored === row.text ? null : restored;
  });
}

/** Submissions as intake should store them: class slots put back on marked quests, and deduplicated on that text. */
export async function keepClassWords(submissions: Submission[]): Promise<Submission[]> {
  const restored = await restoredTexts(submissions);
  return submissions.map((submission, index) => {
    const text = restored[index];
    if (text === null) return submission;
    return { ...submission, text, dedup: dedupOf(submission.source, submission.key, submission.locale, text) };
  });
}

export type ClassWordOutcome = { ok: true; questId: number; texts: Record<number, string> } | { ok: false };

/**
 * Marks or unmarks the quest contribution `id` names; not ok for one that names none. Marking
 * also puts the word back in that quest's rows waiting on triage, and answers with their new
 * texts by id.
 */
export async function markClassWord(id: number, kept: boolean, userId: string): Promise<ClassWordOutcome> {
  const { rows } = await db().query<Contribution>(`select ${CONTRIBUTION_COLUMNS} from "contribution" where "id" = $1`, [id]);
  const contribution = rows[0];
  const questId = contribution ? questIdOf(contribution) : null;
  if (!contribution || questId === null) return { ok: false };

  if (kept) {
    await db().query(
      `insert into "quest_class_word" ("questId", "markedBy") values ($1, $2) on conflict ("questId") do nothing`,
      [questId, userId],
    );
  } else {
    await db().query(`delete from "quest_class_word" where "questId" = $1`, [questId]);
  }
  if (isLang(contribution.locale)) {
    await recordActivity({
      kind: "contribution.edited",
      lang: contribution.locale,
      source: contribution.source,
      subject: String(id),
      actorId: userId,
      detail: { field: "class word", value: kept },
    });
  }
  if (!kept) return { ok: true, questId, texts: {} };

  // Loose on purpose: hasClassSlot decides, on the few rows this finds.
  const waiting = await db().query<Contribution>(
    `select ${CONTRIBUTION_COLUMNS} from "contribution"
      where "source" = 'quests' and "status" = 'new' and "meta"->>'quest' = $1 and "text" ~ '\\$[cC]'`,
    [String(questId)],
  );
  const restored = await restoredTexts(waiting.rows);
  const changes = waiting.rows.flatMap((row, index) => {
    const text = restored[index];
    return text === null ? [] : [{ id: row.id, text }];
  });
  const changed = new Set((await rewriteWaitingTexts(changes)).map((row) => row.id));
  return { ok: true, questId, texts: Object.fromEntries(changes.filter((each) => changed.has(each.id)).map((each) => [each.id, each.text])) };
}
