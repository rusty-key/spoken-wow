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
 * says what counts as the same. Every wording of the moment (naming.py's `:w{n}`) counts; a
 * "changed" row carries them all, and is set against the one closest to the player's text
 * (compare.ts closeness), the first on a tie.
 *
 * A quest moment is matched as accept.ts's answersQuestMoment matches it -- the bare id or a
 * `:m`/`:f` variant -- and is "known" when any of them says the same. A greeting has no id to
 * match on (its id hashes the English text and the speaker's voice), so it is only ever known
 * or missing: known when the NPC that sent it already speaks a line saying it. A different
 * greeting from the same NPC is another line, never a correction of one. Spoken by an NPC drawn
 * as a body its voice is not, it is missing until the NPC is split by body: the voice the site
 * has is the wrong one, and storing the row is what splits it.
 *
 * A readables row is compared through the readables matcher (book-match.ts): the same words on the page
 * it matches (the page a moderator named, if one did) are known, other words a correction. A zone has no text to compare.
 */
import type { PoolClient } from "pg";

import { db } from "@/lib/db";
import { BASE_LANG } from "@/lib/lang";
import { raceOfModel } from "@/lib/npc/models";
import { bodyName, isSex, SEX_GENDER } from "@/lib/npc/npc";
import { splitBody } from "@/lib/npc/store";

import type { Contribution } from "./store";
import { loadBookCorpus, matchBook } from "./book-match";
import { closeness, sameLine } from "./compare";
import type { ContributionStatus, Submission } from "./contributions";
import { momentOf, wordingsOfMomentSql } from "./naming";

export type CorpusText = { lineId: string; variant: number; text: string };

export type LineState =
  | { kind: "missing" }
  /** `lineId` is the corpus line it matched: what a missing-audio hit is counted against. */
  | { kind: "known"; lineId: string }
  /**
   * The corpus's texts in the contribution's language: a quest moment's every wording, in
   * order, one line apiece (a split wording by its first side), or a book page alone.
   * `closest` indexes the one nearest the contribution's text.
   */
  | { kind: "changed"; wordings: CorpusText[]; closest: number };

/** A stored row also carries a moderator's readables answer; an intake submission has none. */
type Comparable = Pick<Submission, "source" | "locale" | "text" | "meta"> &
  Partial<Pick<Contribution, "matchLineId" | "matchBookId" | "matchPageNumber" | "matchNewBook">>;

const MISSING: LineState = { kind: "missing" };

/**
 * The quest moment a contribution names, `q:{quest}:{event}`, or null for a greeting. Past the
 * integer ceiling the quest is no id quest_line could hold, and names no moment.
 */
function momentNamed(row: Comparable): string | null {
  const { quest, event } = row.meta;
  return quest && event && /^\d+$/.test(quest) && Number(quest) <= 2_147_483_647 ? `q:${quest}:${event}` : null;
}

/** The NPC id a greeting names, from the envelope's `"<id> <name>"`. */
function npcOf(row: Comparable): number | null {
  const id = row.meta.npc?.match(/^(\d+)(?:\s|$)/)?.[1];
  // Past the integer ceiling it is not an id quest_line_speaker could hold (resolve.ts says why).
  return id && Number(id) <= 2_147_483_647 ? Number(id) : null;
}

/** The sex a creature's greeting was seen drawn as, or null for none reported. */
function seenSex(row: Comparable): number | null {
  const seen = Number(row.meta.sex);
  return row.meta.kind !== "gameobject" && isSex(seen) ? seen : null;
}

/**
 * Whether a creature's greeting was seen drawn as a body it is not voiced as. The model names
 * the race where the map knows it; otherwise only the sex can be compared.
 */
function otherBody(row: Comparable, voiced: VoicedBodies | undefined): boolean {
  const sex = seenSex(row);
  if (!voiced || sex === null) return false;
  const gender = SEX_GENDER[sex as 2 | 3];
  const race = raceOfModel(Number(row.meta.model), gender);
  if (race) return !voiced.bodies.has(bodyName(race, gender));
  return !voiced.sexes.has(sex);
}

/** A moment's wordings against a player's text: the one it matches, or the one it is closest to. */
export function stateOfMoment(lines: CorpusText[], text: string): LineState {
  const same = lines.find((line) => sameLine(line.text, text));
  if (same) return { kind: "known", lineId: same.lineId };
  const wordings = oneLineEach(lines);
  const scores = wordings.map((line) => closeness(line.text, text));
  return { kind: "changed", wordings, closest: scores.indexOf(Math.max(...scores)) };
}

/**
 * Every current line answering each (language, moment), in one query, keyed `locale|moment`.
 * `client` reads inside a transaction (accept.ts writeWording, under the moment's lock).
 */
export async function momentTexts(
  pairs: { locale: string; moment: string }[],
  client?: PoolClient,
): Promise<Map<string, CorpusText[]>> {
  const found = new Map<string, CorpusText[]>();
  if (pairs.length === 0) return found;
  const { rows } = await (client ?? db()).query<{ locale: string; moment: string; lineId: string; variant: number; text: string }>(
    `select m."locale", m."moment", l."lineId", l."variant",
            coalesce(case when l."lang" = $3 then l."originalText" else l."localeText" end, l."text") as "text"
       from unnest($1::text[], $2::text[]) as m ("locale", "moment")
       join "quest_line" l
         on l."lang" = m."locale" and l."isCurrent"
        and ${wordingsOfMomentSql(`l."questId"`, `l."source"`, `m."moment"`)}
      order by l."lineId" ~ ':w[0-9]+(:[mf])?$', l."lineId", l."variant"`,
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

/** A moment's lines, one per wording and variant: the first of a wording split by player gender. */
export function oneLineEach(lines: CorpusText[]): CorpusText[] {
  const seen = new Set<string>();
  return lines.filter((line) => {
    const key = `${momentOf(line.lineId)}|${line.variant}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Every current greeting each (language, NPC) speaks, in one query. */
async function greetingTexts(pairs: { locale: string; npcId: number }[]): Promise<Map<string, CorpusText[]>> {
  const found = new Map<string, CorpusText[]>();
  if (pairs.length === 0) return found;
  // A line's speakers voice it in every language, whichever language wrote them.
  const { rows } = await db().query<{ locale: string; npcId: number; lineId: string; variant: number; text: string }>(
    `select distinct m."locale", m."npcId", l."lineId", l."variant",
            coalesce(case when l."lang" = $3 then l."originalText" else l."localeText" end, l."text") as "text"
       from unnest($1::text[], $2::int[]) as m ("locale", "npcId")
       join "quest_line_speaker" s on s."npcId" = m."npcId"
       join "quest_line" l
         on l."lineId" = s."lineId" and l."variant" = s."variant"
        and l."lang" = m."locale" and l."isCurrent" and l."source" = 'gossip'`,
    [pairs.map((p) => p.locale), pairs.map((p) => p.npcId), BASE_LANG],
  );
  for (const row of rows) {
    const key = `${row.locale}|${row.npcId}`;
    const group = found.get(key);
    const text = { lineId: row.lineId, variant: row.variant, text: row.text };
    if (group) group.push(text);
    else found.set(key, [text]);
  }
  return found;
}

type VoicedBodies = { bodies: Set<string>; sexes: Set<number> };

/**
 * The bodies each creature among `npcIds` is voiced as: its npc row's where it is not split, each
 * of its npc_body rows where it is (migration 0075: two or more rows). A creature with no race or gender is not
 * listed, and is never seen as another body.
 */
async function voicedBodies(npcIds: number[]): Promise<Map<number, VoicedBodies>> {
  if (npcIds.length === 0) return new Map();
  const { rows } = await db().query<{ npcId: number; race: string; gender: "male" | "female"; sex: number }>(
    `select x."npcId", x."race", x."gender", x."sex"::int as "sex"
       from "npc_body" x
      where x."npcKind" = 'creature' and x."npcId" = any($1::int[]) and ${splitBody("x")}
     union all
     select n."npcId", n."race", n."gender", case n."gender" when 'male' then 2 else 3 end
       from "npc" n
      where n."npcKind" = 'creature' and n."npcId" = any($1::int[]) and n."gender" in ('male', 'female')
        and n."race" is not null and n."provenance" <> 'none'
        and not exists (select 1 from "npc_body" x
                         where x."npcKind" = n."npcKind" and x."npcId" = n."npcId" and ${splitBody("x")})`,
    [npcIds],
  );
  const voiced = new Map<number, VoicedBodies>();
  for (const row of rows) {
    const entry = voiced.get(row.npcId) ?? { bodies: new Set<string>(), sexes: new Set<number>() };
    entry.bodies.add(bodyName(row.race, row.gender));
    entry.sexes.add(row.sex);
    voiced.set(row.npcId, entry);
  }
  return voiced;
}

/** Each contribution's LineState, in the order given: three queries for the lot, and the readables corpus when a readables row is in it. */
export async function lineStates(rows: readonly Comparable[]): Promise<LineState[]> {
  const books = rows.some((row) => row.source === "readables" && row.text) ? await loadBookCorpus() : null;
  const moments: { locale: string; moment: string }[] = [];
  const greetings: { locale: string; npcId: number }[] = [];
  // Only a greeting that reports a sex can be seen as another body, as only such a row splits.
  const sexed = new Set<number>();
  for (const row of rows) {
    if (row.source !== "quests" || !row.text) continue;
    const moment = momentNamed(row);
    const npcId = moment ? null : npcOf(row);
    if (moment) moments.push({ locale: row.locale, moment });
    else if (npcId !== null) {
      greetings.push({ locale: row.locale, npcId });
      if (seenSex(row) !== null) sexed.add(npcId);
    }
  }
  const [byMoment, byNpc, bodies] = await Promise.all([
    momentTexts(moments),
    greetingTexts(greetings),
    voicedBodies([...sexed]),
  ]);

  return rows.map((row) => {
    if (row.source === "readables") {
      if (!books || !row.text) return MISSING;
      // A moderator's stored answer overrides the matcher, as it does when the row is accepted.
      const match = matchBook(
        {
          locale: row.locale,
          text: row.text,
          meta: row.meta,
          matchLineId: row.matchLineId ?? null,
          matchBookId: row.matchBookId ?? null,
          matchPageNumber: row.matchPageNumber ?? null,
          matchNewBook: row.matchNewBook ?? false,
        },
        books,
      );
      if (match.kind === "known") return { kind: "known", lineId: match.lineId };
      if (match.kind === "correction") {
        return { kind: "changed", wordings: [{ lineId: match.lineId, variant: 0, text: match.current }], closest: 0 };
      }
      return MISSING;
    }
    if (row.source !== "quests" || !row.text) return MISSING;
    const text = row.text;
    const moment = momentNamed(row);
    if (moment) {
      const lines = byMoment.get(`${row.locale}|${moment}`);
      if (!lines?.length) return MISSING;
      return stateOfMoment(lines, text);
    }
    const npcId = npcOf(row);
    const spoken = npcId === null ? undefined : byNpc.get(`${row.locale}|${npcId}`);
    if (npcId !== null && otherBody(row, bodies.get(npcId))) return MISSING;
    const same = spoken?.find((line) => sameLine(line.text, text));
    return same ? { kind: "known", lineId: same.lineId } : MISSING;
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
