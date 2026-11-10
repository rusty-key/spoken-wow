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

import { closeness, restoreClassWords } from "./compare";
import type { Submission } from "./contributions";
import { momentTexts, oneLineEach } from "./known";
import { CONTRIBUTION_COLUMNS, type Contribution } from "./store";
import { dedupOf } from "./submission";

const CLASS_SLOT = /\$[cC](?![\p{L}\p{N}\p{M}])/u;

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
  const candidates = rows.map((row) => {
    const questId = questIdOf(row);
    return questId !== null && row.meta.event && row.text && CLASS_SLOT.test(row.text) ? questId : null;
  });
  const marked = await classWordQuests(candidates.filter((id): id is number => id !== null));
  if (marked.size === 0) return rows.map(() => null);

  const pairs = rows.flatMap((row, index) => {
    const questId = candidates[index];
    return questId !== null && marked.has(questId) ? [{ locale: row.locale, moment: `q:${questId}:${row.meta.event}` }] : [];
  });
  const byMoment = await momentTexts(pairs);
  return rows.map((row, index) => {
    const questId = candidates[index];
    if (questId === null || !marked.has(questId) || !row.text) return null;
    const lines = oneLineEach(byMoment.get(`${row.locale}|q:${questId}:${row.meta.event}`) ?? []);
    if (lines.length === 0) return null;
    const text = row.text;
    const closest = lines.reduce((best, line) => (closeness(line.text, text) > closeness(best.text, text) ? line : best));
    const restored = restoreClassWords(text, closest.text);
    return restored === text ? null : restored;
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

export type ClassWordOutcome =
  | { ok: true; questId: number; texts: Record<number, string> }
  | { ok: false; reason: "not-found" | "no-quest" };

/**
 * Marks or unmarks the quest contribution `id` names. Marking also puts the word back in that
 * quest's rows waiting on triage, and answers with their new texts by id. Their dedup is left
 * as the paste had it, so another copy of that paste still counts on the row.
 */
export async function markClassWord(id: number, kept: boolean, userId: string): Promise<ClassWordOutcome> {
  const { rows } = await db().query<Contribution>(`select ${CONTRIBUTION_COLUMNS} from "contribution" where "id" = $1`, [id]);
  const contribution = rows[0];
  if (!contribution) return { ok: false, reason: "not-found" };
  const questId = questIdOf(contribution);
  if (questId === null) return { ok: false, reason: "no-quest" };

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

  const waiting = await db().query<Contribution>(
    `select ${CONTRIBUTION_COLUMNS} from "contribution"
      where "source" = 'quests' and "status" = 'new' and "meta"->>'quest' = $1 and "text" ~ '\\$[cC]'`,
    [String(questId)],
  );
  const restored = await restoredTexts(waiting.rows);
  const texts: Record<number, string> = {};
  for (const [index, row] of waiting.rows.entries()) {
    const text = restored[index];
    if (text === null) continue;
    await db().query(`update "contribution" set "text" = $2, "updatedAt" = now() where "id" = $1 and "status" = 'new'`, [
      row.id,
      text,
    ]);
    texts[row.id] = text;
  }
  return { ok: true, questId, texts };
}
