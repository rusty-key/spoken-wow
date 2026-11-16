/**
 * Quests whose text names a class as a word of its own (migration 0105): "There's a priest out
 * in the mountains" is about a priest whoever reads it. The addon cannot tell that word from the
 * reader's class, so a priest reading it sends `$c` (Contribute.lua, Detemplate), and accepting
 * that would have every player hear "adventurer".
 *
 * A language's text maintainer marks the quest from the corrections tab, for that language. From
 * then on intake puts the word back from the corpus line before the text is stored or
 * deduplicated (compare.ts restoreClassWords), so a priest's paste and a mage's are the same row.
 * Marking also puts it back in the quest's rows in that language still waiting on triage.
 */
import "server-only";

import { recordActivity } from "@/lib/activity/store";
import { db } from "@/lib/db";
import { isLang } from "@/lib/lang";

import { hasClassSlot, restoreClassWords } from "./compare";
import type { Submission } from "./contributions";
import { closestOf, momentNamed, momentTexts, oneLineEach, questIdOf } from "./known";
import { CONTRIBUTION_COLUMNS, rewriteWaitingTexts, type Contribution } from "./store";
import { dedupOf } from "./submission";

type Row = Pick<Submission, "source" | "key" | "locale" | "text" | "meta">;

/** The quest a quests row names; null for any other row. */
const questOf = (row: Pick<Row, "source" | "meta">) => (row.source === "quests" ? questIdOf(row) : null);
const markKey = (lang: string, questId: number) => `${lang}|${questId}`;

/** Whether a row's quest is marked in its language, among the marks `classWordMarks` read. */
export function isMarked(marks: Set<string>, row: Pick<Row, "source" | "locale" | "meta">): boolean {
  const questId = questOf(row);
  return questId !== null && marks.has(markKey(row.locale, questId));
}

/** The marks on the quests `rows` name, each in the row's language, for isMarked. */
export async function classWordMarks(rows: readonly Pick<Row, "source" | "locale" | "meta">[]): Promise<Set<string>> {
  const pairs = rows.flatMap((row) => {
    const questId = questOf(row);
    return questId === null ? [] : [{ lang: row.locale, questId }];
  });
  if (pairs.length === 0) return new Set();
  const { rows: marked } = await db().query<{ lang: string; questId: number }>(
    `select distinct q."lang", q."questId"
       from unnest($1::text[], $2::int[]) as m ("lang", "questId")
       join "quest_class_word" q on q."lang" = m."lang" and q."questId" = m."questId"`,
    [pairs.map((pair) => pair.lang), pairs.map((pair) => pair.questId)],
  );
  return new Set(marked.map((mark) => markKey(mark.lang, mark.questId)));
}

/** Each row's text with its class slots put back where its quest is marked; null where none changed. */
async function restoredTexts(rows: readonly Row[]): Promise<(string | null)[]> {
  const slotted = rows.filter((row) => row.text && hasClassSlot(row.text));
  const marks = await classWordMarks(slotted);
  const restoring = new Set(slotted.filter((row) => isMarked(marks, row) && momentNamed(row)));
  if (restoring.size === 0) return rows.map(() => null);

  const byMoment = await momentTexts([...restoring].map((row) => ({ locale: row.locale, moment: momentNamed(row)! })));
  return rows.map((row) => {
    if (!restoring.has(row) || !row.text) return null;
    const lines = oneLineEach(byMoment.get(`${row.locale}|${momentNamed(row)}`) ?? []);
    if (lines.length === 0) return null;
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
 * Marks or unmarks, in its language, the quest contribution `id` names; not ok for one that
 * names none. Marking also puts the word back in that quest's rows in that language waiting on
 * triage, and answers with their new texts by id. Each is deduplicated on its new text, as intake
 * now files the same paste, unless a row already holds that text.
 */
export async function markClassWord(id: number, kept: boolean, userId: string): Promise<ClassWordOutcome> {
  const { rows } = await db().query<Contribution>(`select ${CONTRIBUTION_COLUMNS} from "contribution" where "id" = $1`, [id]);
  const contribution = rows[0];
  const questId = contribution ? questOf(contribution) : null;
  if (!contribution || questId === null || !isLang(contribution.locale)) return { ok: false };
  const lang = contribution.locale;

  if (kept) {
    await db().query(
      `insert into "quest_class_word" ("questId", "lang", "markedBy") values ($1, $2, $3) on conflict do nothing`,
      [questId, lang, userId],
    );
  } else {
    await db().query(`delete from "quest_class_word" where "questId" = $1 and "lang" = $2`, [questId, lang]);
  }
  const logged = recordActivity({
    kind: "contribution.edited",
    lang,
    source: contribution.source,
    subject: String(id),
    actorId: userId,
    detail: { field: "class word", value: kept },
  });
  if (!kept) {
    await logged;
    return { ok: true, questId, texts: {} };
  }

  // Loose on purpose: hasClassSlot decides, on the few rows this finds.
  const [waiting] = await Promise.all([
    db().query<Contribution>(
      `select ${CONTRIBUTION_COLUMNS} from "contribution"
        where "source" = 'quests' and "status" = 'new' and "locale" = $2
          and "meta"->>'quest' = $1 and "text" ~ '\\$[cC]'`,
      [String(questId), lang],
    ),
    logged,
  ]);
  const restored = await restoredTexts(waiting.rows);
  const changes = waiting.rows.flatMap((row, index) => {
    const text = restored[index];
    return text === null ? [] : [{ id: row.id, text, dedup: dedupOf(row.source, row.key, row.locale, text) }];
  });
  const rewritten = await rewriteWaitingTexts(changes);
  return { ok: true, questId, texts: Object.fromEntries(rewritten.map((row) => [row.id, row.text ?? ""])) };
}
