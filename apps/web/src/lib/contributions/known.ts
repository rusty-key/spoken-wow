/**
 * What the quest tables already hold for a quests contribution: nothing (a missing line, what
 * the triage queue is for), the same line (a contribution nobody needs), or a different text
 * under the same quest and moment (a correction, for the corrections tab).
 *
 * The addon gathers every quest panel and greeting a player sees, not only the ones the corpus
 * lacks -- it cannot know which those are. So most of what arrives is a line already on file,
 * and comparing is the server's job: intake drops what is "known" before it is stored, and the
 * triage page splits what is left into "missing" and "changed".
 *
 * Compared in the contribution's own language, against the current version of each line:
 * `localeText` for a translation, the English template (`originalText`) otherwise. compare.ts
 * says what counts as the same.
 *
 * A quest moment is matched as accept.ts's answersQuestMoment matches it -- the bare id or a
 * `:m`/`:f` variant -- and is "known" when any of them says the same. A greeting has no id to
 * match on (its id hashes the English text and the speaker's voice), so it is only ever known
 * or missing: known when the NPC that sent it already speaks a line saying it. A different
 * greeting from the same NPC is another line, never a correction of one.
 *
 * Zones and books are not compared here: a zone has no text to compare, and the table already
 * shows a book page's corpus text beside the contribution (page.tsx's existingTextFor).
 */
import { db } from "@/lib/db";
import { BASE_LANG } from "@/lib/lang";

import { sameLine } from "./compare";
import type { ContributionStatus, Submission } from "./contributions";
import { answersQuestMomentSql } from "./naming";

export type LineState =
  | { kind: "missing" }
  | { kind: "known" }
  /** `current` is the corpus's text of `lineId` and `variant`, in the contribution's language. */
  | { kind: "changed"; lineId: string; variant: number; current: string };

type Comparable = Pick<Submission, "source" | "locale" | "text" | "meta">;

const MISSING: LineState = { kind: "missing" };

/** The quest moment a contribution names, `q:{quest}:{event}`, or null for a greeting. */
function momentOf(row: Comparable): string | null {
  const { quest, event } = row.meta;
  return quest && event && /^\d+$/.test(quest) ? `q:${quest}:${event}` : null;
}

/** The NPC id a greeting names, from the envelope's `"<id> <name>"`. */
function npcOf(row: Comparable): number | null {
  const id = row.meta.npc?.match(/^(\d+)(?:\s|$)/)?.[1];
  // Past the integer ceiling it is not an id quest_line_speaker could hold (resolve.ts says why).
  return id && Number(id) <= 2_147_483_647 ? Number(id) : null;
}

type CorpusText = { lineId: string; variant: number; text: string };

/** Every current line answering each (language, moment), in one query. */
async function momentTexts(pairs: { locale: string; moment: string }[]): Promise<Map<string, CorpusText[]>> {
  const found = new Map<string, CorpusText[]>();
  if (pairs.length === 0) return found;
  const { rows } = await db().query<{ locale: string; moment: string; lineId: string; variant: number; text: string }>(
    `select m."locale", m."moment", l."lineId", l."variant",
            coalesce(case when l."lang" = $3 then l."originalText" else l."localeText" end, l."text") as "text"
       from unnest($1::text[], $2::text[]) as m ("locale", "moment")
       join "quest_line" l
         on l."lang" = m."locale" and l."isCurrent"
        and ${answersQuestMomentSql(`l."lineId"`, `m."moment"`)}
      order by l."lineId", l."variant"`,
    [pairs.map((p) => p.locale), pairs.map((p) => p.moment), BASE_LANG],
  );
  for (const row of rows) {
    const key = `${row.locale}|${row.moment}`;
    const group = found.get(key);
    const text = { lineId: row.lineId, variant: row.variant, text: row.text };
    if (group) group.push(text);
    else found.set(key, [text]);
  }
  return found;
}

/** Every current greeting each (language, NPC) speaks, in one query. */
async function greetingTexts(pairs: { locale: string; npcId: number }[]): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  if (pairs.length === 0) return found;
  // Speakers are kept once, in English, for every language's version of the line.
  const { rows } = await db().query<{ locale: string; npcId: number; text: string }>(
    `select distinct m."locale", m."npcId",
            coalesce(case when l."lang" = $3 then l."originalText" else l."localeText" end, l."text") as "text"
       from unnest($1::text[], $2::int[]) as m ("locale", "npcId")
       join "quest_line_speaker" s on s."npcId" = m."npcId" and s."lang" = $3
       join "quest_line" l
         on l."lineId" = s."lineId" and l."variant" = s."variant"
        and l."lang" = m."locale" and l."isCurrent" and l."source" = 'gossip'`,
    [pairs.map((p) => p.locale), pairs.map((p) => p.npcId), BASE_LANG],
  );
  for (const row of rows) {
    const key = `${row.locale}|${row.npcId}`;
    const group = found.get(key);
    if (group) group.push(row.text);
    else found.set(key, [row.text]);
  }
  return found;
}

/** Each contribution's LineState, in the order given: two queries for the lot. */
export async function lineStates(rows: readonly Comparable[]): Promise<LineState[]> {
  const moments: { locale: string; moment: string }[] = [];
  const greetings: { locale: string; npcId: number }[] = [];
  for (const row of rows) {
    if (row.source !== "quests" || !row.text) continue;
    const moment = momentOf(row);
    const npcId = moment ? null : npcOf(row);
    if (moment) moments.push({ locale: row.locale, moment });
    else if (npcId !== null) greetings.push({ locale: row.locale, npcId });
  }
  const [byMoment, byNpc] = await Promise.all([momentTexts(moments), greetingTexts(greetings)]);

  return rows.map((row) => {
    if (row.source !== "quests" || !row.text) return MISSING;
    const text = row.text;
    const moment = momentOf(row);
    if (moment) {
      const lines = byMoment.get(`${row.locale}|${moment}`);
      if (!lines?.length) return MISSING;
      if (lines.some((line) => sameLine(line.text, text))) return { kind: "known" };
      return { kind: "changed", lineId: lines[0].lineId, variant: lines[0].variant, current: lines[0].text };
    }
    const npcId = npcOf(row);
    const spoken = npcId === null ? undefined : byNpc.get(`${row.locale}|${npcId}`);
    return spoken?.some((line) => sameLine(line, text)) ? { kind: "known" } : MISSING;
  });
}

export type ContributionTab = "contributions" | "corrections";

/**
 * Which tab of /contributions a stored row is listed on, or null for none.
 *
 * A "changed" row is a correction, accepted or not: accepting one rewrites what the line
 * speaks (correction.ts), never the printed text it is compared on, so an accepted correction
 * still differs and is still listed there. A "known" row still waiting on triage is on neither
 * -- it is one intake would now drop, kept only because it was stored first or the corpus
 * caught up since (scripts/drop-known-contributions.mts clears them). Any other accepted row
 * stays where it was accepted from, whatever the corpus says now: an accepted line is usually
 * known precisely because accepting it wrote it.
 */
export function tabOf(status: ContributionStatus, state: LineState): ContributionTab | null {
  if (state.kind === "changed") return "corrections";
  if (status === "accepted") return "contributions";
  if (state.kind === "known" && status === "new") return null;
  return "contributions";
}
