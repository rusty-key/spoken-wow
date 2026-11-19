/**
 * Which player genders have been shown a quest line's current text: `quest_line.readerGenders`.
 *
 * A player's client takes one side of every `$G`, so a plain line a client sent may be one side of
 * a branch the corpus lost. Every copy intake finds the same as a line (known.ts) says one reader's
 * gender saw that text, from an addon that sends it (`readerSex`). Most lines gather both. A line
 * only one gender has seen, and a correction from the other, is the other side of that branch: the
 * corrections tab offers to split it (compare.ts readerSide).
 *
 * Kept on the line's current version, so a new text starts with none.
 */
import "server-only";

import { db } from "@/lib/db";
import { isSex } from "@/lib/npc/npc";

import type { Submission } from "./contributions";
import type { ReaderGender } from "./gender";
import type { LineState } from "./known";

/** UnitSex("player") as the addon sends it, as quest_line's playerGender writes it. */
export function readerGenderOf(meta: Record<string, string>): ReaderGender | null {
  const sex = Number(meta.readerSex);
  return isSex(sex) ? (sex === 2 ? "m" : "f") : null;
}

/**
 * Marks each known quest line with its reader's gender, one statement for the lot. Readables pages
 * and rows that say no gender are left out.
 */
export async function recordReaders(
  submissions: readonly Pick<Submission, "source" | "locale" | "meta">[],
  states: readonly LineState[],
): Promise<void> {
  const seen = submissions.flatMap((submission, index) => {
    const state = states[index];
    const gender = readerGenderOf(submission.meta);
    return submission.source === "quests" && state?.kind === "known" && gender
      ? [{ lineId: state.lineId, variant: state.variant, lang: submission.locale, gender }]
      : [];
  });
  if (seen.length === 0) return;
  await db().query(
    `update "quest_line" l
        set "readerGenders" = array(select distinct g from unnest(l."readerGenders" || c."genders") g order by g)
       from (select "lineId", "variant", "lang", array_agg(distinct "gender") as "genders"
               from unnest($1::text[], $2::int[], $3::text[], $4::text[]) as s ("lineId", "variant", "lang", "gender")
              group by 1, 2, 3) c
      where l."lineId" = c."lineId" and l."variant" = c."variant" and l."lang" = c."lang" and l."isCurrent"
        and not c."genders" <@ l."readerGenders"`,
    [seen.map((s) => s.lineId), seen.map((s) => s.variant), seen.map((s) => s.lang), seen.map((s) => s.gender)],
  );
}

type ReadersOf = (lang: string, lineId: string, variant: number) => ReaderGender[];

/** The genders each of `lines` has been shown to, for the corrections tab: none for a line not found. */
export async function readersOf(lines: readonly { lineId: string; variant: number; lang: string }[]): Promise<ReadersOf> {
  const found = new Map<string, ReaderGender[]>();
  const key = (lang: string, lineId: string, variant: number) => `${lang}|${lineId}|${variant}`;
  const lookup: ReadersOf = (lang, lineId, variant) => found.get(key(lang, lineId, variant)) ?? [];
  if (lines.length === 0) return lookup;
  const { rows } = await db().query<{ lineId: string; variant: number; lang: string; readerGenders: ReaderGender[] }>(
    `select l."lineId", l."variant", l."lang", l."readerGenders"
       from unnest($1::text[], $2::int[], $3::text[]) as w ("lineId", "variant", "lang")
       join "quest_line" l on l."lineId" = w."lineId" and l."variant" = w."variant" and l."lang" = w."lang" and l."isCurrent"`,
    [lines.map((l) => l.lineId), lines.map((l) => l.variant), lines.map((l) => l.lang)],
  );
  for (const row of rows) found.set(key(row.lang, row.lineId, row.variant), row.readerGenders);
  return lookup;
}
