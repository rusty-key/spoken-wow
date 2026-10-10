/**
 * Which quests files hold audio that predates a pronunciation change.
 *
 * The sibling of staleness.ts and the question it cannot answer: `spokenHash` moves with the
 * text and stands still with the dictionary, so a lexicon edit -- the one kind of change
 * that alters how a line SOUNDS without altering a character of it -- is invisible to every
 * comparison that module makes.
 *
 * The rule itself is lib/generation/dirty.ts, shared with zones and books. This is the
 * quests-shaped half: the corpus is a file index rather than a table, and the text that
 * matters is the text that would be SENT, overrides and regex rules applied, because that is
 * the string the dictionary is applied to.
 */
import { BASE_LANG, type Lang } from "../lang";
import { fileIndex } from "../audio";
import { db } from "../db";
import { dirtyFiles, loadDirtyContext } from "../generation/dirty";
import { sentText } from "../generation/files";
import { overrideOf } from "./override";
import { readOverrides } from "./overrides";

/**
 * Of these files, the ones a pronunciation change has overtaken.
 *
 * Takes the files rather than reading them all, for staleness.ts's reason: the row-level
 * question is asked for a page of results, and the corpus-wide one only for the filter that
 * needs it. Unlike staleness this costs no hashing - a take older than no change at all is
 * answered without its text being read - so the wide call is the cheap one of the pair.
 */
export async function dirtyQuestFiles(
  files?: string[],
  lang: Lang = BASE_LANG,
): Promise<Set<string>> {
  if (files?.length === 0) return new Set();

  const [{ rows }, context, overrides] = await Promise.all([
    files
      ? db().query<{ file: string; generatedAt: Date | null }>(
          `select "file", "createdAt" as "generatedAt" from "take"
            where "source" = 'quests' and "lang" = $2 and "isCurrent"
              and "file" = any($1::text[])`,
          [files, lang],
        )
      : db().query<{ file: string; generatedAt: Date | null }>(
          `select "file", "createdAt" as "generatedAt" from "take"
            where "source" = 'quests' and "lang" = $1 and "isCurrent"`,
          [lang],
        ),
    loadDirtyContext("quests", lang),
    // In the same round as the rest: memoised behind a stamp, so this is a timestamp check
    // rather than a table read, but it is still a round trip to sit behind the others.
    // English's alone: overrides rewrite the English corpus.
    readOverrides(lang),
  ]);

  if (!context.changes.length) return new Set();

  const lines = await fileIndex(lang);

  const takes = [];
  for (const row of rows) {
    const line = lines.get(row.file);
    if (!line) continue;
    const text = overrideOf(overrides, row.file)?.text ?? line.text;
    takes.push({
      file: row.file,
      // The regex rules, as regenerate.ts applies them: a rule that rewrites a name before
      // the request is sent changes which lexicon entries the text can still match.
      text: sentText(text, lang, line.playerGender),
      generatedAt: row.generatedAt?.getTime() ?? null,
    });
  }

  return dirtyFiles(takes, context);
}
