/**
 * Which gossip line a contribution is, in any language.
 *
 * The client says who is speaking and shows the words, never the BroadcastText id. So a
 * contribution is matched in three steps, strongest first:
 *
 *   1. by its own words: a line this language already has with the same text, in the same
 *      voice (English asks the catalogue, as it always has);
 *   2. by BroadcastText: the id whose text in this language reads the same, in the form the
 *      speaker's sex shows, and the line of that id in the same voice (gossip_broadcast);
 *   3. failing both, a new line: `g:b{id}-{voice}` when the id is known, else `g:{md5}` in
 *      English and `g:{lang}-{md5}` in another language (naming.ts).
 *
 * A line found in step 2 may have no row in the contribution's language yet, and that row is
 * what accepting writes: a translation of its English, or, for a line English lacks, a row of
 * the language's own. Lines are never renamed: a moment minted twice before its id was known
 * is tied together by GossipAliases (tts_cli/gossip_text.py).
 */
import type { PoolClient } from "pg";

import { db } from "@/lib/db";
import { BASE_LANG, type Lang } from "@/lib/lang";

import {
  broadcastGossipStem,
  gossipHash,
  gossipLineId,
  gossipStemRank,
  localizedGossipStem,
  momentOf,
  type LineIdentity,
} from "./naming";

type Queryable = Pick<PoolClient, "query">;

/**
 * `race` and `gender` are the ones the speaker's voice's files are named by, not its NPC's type:
 * a gossip file is md5(text + race + gender), so a re-typed NPC keeps finding its lines.
 */
export type GossipSpeaker = {
  npcId: number;
  npcType: string;
  race: string;
  gender: string;
  voice: string;
};

/** A line of one moment, as resolution sees it. */
export type MomentLine = {
  lineId: string;
  hasEnglish: boolean;
  hasLang: boolean;
  /** Whether this NPC already speaks it, in any language. */
  speaks: boolean;
  /** Where the line's speakers live: English, or the language it was written in. */
  speakerLang: Lang;
};

/** What accepting a gossip contribution writes. */
export type GossipPlan =
  | { kind: "exists"; lineId: string; broadcastTextId: number | null }
  | { kind: "speaker"; lineId: string; lang: Lang; broadcastTextId: number | null }
  | { kind: "translation"; lineId: string; addSpeaker: boolean; broadcastTextId: number | null }
  | { kind: "line"; identity: LineIdentity; broadcastTextId: number | null };

/** The one-off's normalisation (fill-gossip-broadcast.py): case and runs of whitespace aside. */
const norm = (sql: string) => `lower(regexp_replace(btrim(${sql}), '\\s+', ' ', 'g'))`;

/** A `$g male:female;` branch, either side: the client shows the one the player's sex picks. */
const branch = (sql: string, side: 1 | 2) => `regexp_replace(${sql}, '\\$g([^:;]*):([^;]*);', '\\${side}', 'gi')`;

/**
 * The lowest BroadcastText id whose text in `lang` reads as `text` does, in the form a speaker of
 * this sex shows. One text can sit under several ids, and they read alike.
 */
export async function broadcastIdFor(
  q: Queryable,
  lang: Lang,
  text: string,
  gender: string,
): Promise<number | null> {
  const form = `case when $3 = 'female' then coalesce(nullif(b."text1", ''), b."text")
                     else coalesce(nullif(b."text", ''), b."text1") end`;
  const { rows } = await q.query<{ id: number }>(
    `select b."broadcastTextId" as "id"
       from "broadcast_text" b
      where b."lang" = $1
        and $2 in (${norm(branch(form, 1))}, ${norm(branch(form, 2))})
      order by 1
      limit 1`,
    [lang, normalised(text), gender],
  );
  return rows[0]?.id ?? null;
}

/** norm() on this side, so the parameter compares equal to the column's form. */
function normalised(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * A line in a broadcast form is one voice's, flavor included; any other line is a race and
 * gender's, whatever flavor its speakers agreed on.
 */
function sameVoice(lineId: string, voice: string): boolean {
  const stem = lineId.slice(2).replace(/:[mf]$/, "");
  if (gossipStemRank(stem) !== 0) return true;
  return stem.slice(stem.indexOf("-") + 1) === voice;
}

/**
 * The lines `candidates` (a query yielding "lineId") names that this speaker's race and gender
 * say, preferred first: broadcast, English, localized.
 */
async function momentLines(
  q: Queryable,
  candidates: string,
  params: unknown[],
  lang: Lang,
  speaker: GossipSpeaker,
): Promise<MomentLine[]> {
  const at = params.length;
  const { rows } = await q.query<MomentLine & { langs: Lang[] }>(
    `with c as (${candidates})
     select c."lineId",
            exists (select 1 from "quest_line" e
                     where e."lineId" = c."lineId" and e."lang" = '${BASE_LANG}' and e."isCurrent") as "hasEnglish",
            exists (select 1 from "quest_line" t
                     where t."lineId" = c."lineId" and t."lang" = $${at + 1} and t."isCurrent") as "hasLang",
            bool_or(s."npcType" = $${at + 2} and s."npcId" = $${at + 3}) as "speaks",
            array_agg(distinct s."lang") as "langs"
       from (select distinct "lineId" from c) c
       join "quest_line_speaker" s on s."lineId" = c."lineId"
      where s."race" = $${at + 4} and s."gender" = $${at + 5}
      group by c."lineId"`,
    [...params, lang, speaker.npcType, speaker.npcId, speaker.race, speaker.gender],
  );
  return rows
    .filter((row) => sameVoice(row.lineId, speaker.voice))
    .map(({ langs, ...row }) => ({
      ...row,
      speakerLang: row.hasEnglish ? BASE_LANG : (langs.includes(lang) ? lang : langs[0]),
    }))
    .sort(
      (a, b) =>
        gossipStemRank(a.lineId.slice(2)) - gossipStemRank(b.lineId.slice(2)) ||
        a.lineId.localeCompare(b.lineId),
    );
}

/** Lines whose text in `lang` (localeText: what that client shows) reads as `text`. */
export function linesByText(q: Queryable, lang: Lang, text: string, speaker: GossipSpeaker) {
  return momentLines(
    q,
    `select "lineId" from "quest_line"
      where "lang" = $1 and "source" = 'gossip' and ${norm(`coalesce("localeText", '')`)} = $2`,
    [lang, normalised(text)],
    lang,
    speaker,
  );
}

/** Lines that speak a BroadcastText id. */
export function linesByBroadcast(q: Queryable, broadcastTextId: number, lang: Lang, speaker: GossipSpeaker) {
  return momentLines(
    q,
    `select "lineId" from "gossip_broadcast" where "broadcastTextId" = $1`,
    [broadcastTextId],
    lang,
    speaker,
  );
}

/** What a contribution in `lang` writes onto a line of its moment. */
export function planFor(line: MomentLine, lang: Lang, broadcastTextId: number | null): GossipPlan {
  const { lineId } = line;
  if (lang === BASE_LANG || line.hasLang) {
    if (lang === BASE_LANG && !line.hasEnglish) {
      return { kind: "line", identity: gossipIdentity(lineId), broadcastTextId };
    }
    return line.speaks
      ? { kind: "exists", lineId, broadcastTextId }
      : { kind: "speaker", lineId, lang: line.speakerLang, broadcastTextId };
  }
  if (line.hasEnglish) return { kind: "translation", lineId, addSpeaker: !line.speaks, broadcastTextId };
  return { kind: "line", identity: gossipIdentity(lineId), broadcastTextId };
}

/** The moment a greeting's line is one of, under the plain id and file. */
export function gossipIdentity(lineId: string): LineIdentity {
  const moment = momentOf(lineId);
  return { source: "gossip", lineId: moment, fileName: moment.slice(2), questId: null, questTitle: null };
}

/** A new line's identity: by id when it is known, else by its own text. */
export function mintedIdentity(
  lang: Lang,
  text: string,
  speaker: GossipSpeaker,
  broadcastTextId: number | null,
): LineIdentity {
  const hash = gossipHash(text, speaker.race, speaker.gender);
  const stem =
    broadcastTextId !== null
      ? broadcastGossipStem(broadcastTextId, speaker.voice)
      : lang === BASE_LANG
        ? hash
        : localizedGossipStem(lang, hash);
  return { source: "gossip", lineId: gossipLineId(stem), fileName: stem, questId: null, questTitle: null };
}

/**
 * Steps 2 and 3 for any language, and step 1 for one other than English (English's is the
 * catalogue's, in accept.ts). Read-only: what it says is written by accept.ts.
 */
export async function resolveGossip(
  lang: Lang,
  text: string,
  speaker: GossipSpeaker,
  options: { client?: Queryable; skipText?: boolean } = {},
): Promise<GossipPlan> {
  const q = options.client ?? db();
  if (!options.skipText) {
    const [same] = await linesByText(q, lang, text, speaker);
    if (same) return planFor(same, lang, null);
  }
  const broadcastTextId = await broadcastIdFor(q, lang, text, speaker.gender);
  if (broadcastTextId !== null) {
    const [line] = await linesByBroadcast(q, broadcastTextId, lang, speaker);
    if (line) return planFor(line, lang, broadcastTextId);
  }
  return { kind: "line", identity: mintedIdentity(lang, text, speaker, broadcastTextId), broadcastTextId };
}

/** Record that a line speaks an id, found by its words. */
export async function recordBroadcast(q: Queryable, lineId: string, broadcastTextId: number | null): Promise<void> {
  if (broadcastTextId === null) return;
  await q.query(
    `insert into "gossip_broadcast" ("lineId", "broadcastTextId", "matchedBy")
     values ($1, $2, 'text') on conflict do nothing`,
    [lineId, broadcastTextId],
  );
}
