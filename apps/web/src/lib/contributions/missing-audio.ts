/**
 * Lines the corpus has but a player's pack could not voice.
 *
 * The addon gathers a line exactly when the installed pack has no sound for it, so a gathered
 * envelope the corpus already knows is one a player heard in silence. The /contribute page
 * drops those (there is nothing to triage); the Spoken Manager, when its player turned Sharing
 * on, sends the same file with a random install id, and each such line is counted here once
 * per line, pack language and install. Ranked by installs, that is which lines to voice next,
 * and which players are only behind on their pack.
 *
 * Server-side only: it writes.
 */
import { ALL_TEAMS, db, queryIn } from "@/lib/db";
import { BASE_LANG, isLang, type Lang } from "@/lib/lang";
import { teamLangs } from "@/lib/teams/store";

import type { Submission } from "./contributions";

/** Per install, beside the per-IP allowance; the manager backs off on a 429 from either. */
export const INSTALL_UPLOADS_PER_HOUR = 4;

export type MissingAudioHit = { lineId: string; packLang: string; packVersion: string | null };

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The install id a manager sent, or null: a bad one is ignored, never a reason to refuse the file. */
export function installIdFrom(value: unknown): string | null {
  return typeof value === "string" && UUID_V4.test(value) ? value.toLowerCase() : null;
}

/**
 * The hit a known submission counts as, or null when it names no pack language the site serves.
 * `pack` is the language the player hears (BaseFields in each module's Contribute.lua),
 * `packVersion` that pack's .toc version or "none".
 */
export function hitFrom(submission: Submission, lineId: string): MissingAudioHit | null {
  const packLang = submission.meta.pack;
  if (!isLang(packLang)) return null;
  const version = submission.meta.packVersion;
  const packVersion = version && /^[\w.+-]{1,32}$/.test(version) ? version : null;
  return { lineId, packLang, packVersion };
}

/** One row per line, language and install; a repeat moves lastSeen and takes the newer version. */
export async function recordMissingAudio(installId: string, hits: readonly MissingAudioHit[]): Promise<void> {
  // Deduped first: one statement may not touch the same row twice.
  const unique = new Map<string, MissingAudioHit>();
  for (const hit of hits) unique.set(`${hit.lineId}\u0000${hit.packLang}`, hit);
  if (unique.size === 0) return;
  const rows = [...unique.values()];
  await db().query(
    `insert into "missing_audio_hit" ("lineId", "packLang", "packVersion", "installId")
     select h."lineId", h."packLang", h."packVersion", $4::uuid
       from unnest($1::text[], $2::text[], $3::text[]) as h ("lineId", "packLang", "packVersion")
     on conflict ("packLang", "lineId", "installId")
     do update set "lastSeen" = now(), "packVersion" = excluded."packVersion"`,
    [rows.map((row) => row.lineId), rows.map((row) => row.packLang), rows.map((row) => row.packVersion), installId],
  );
}

export type MissingAudioRow = {
  lineId: string;
  installs: number;
  lastSeen: string;
  /** Every version the players reported; "none" is a player with no pack for the language. */
  packVersions: string[];
  /** The line's words, in the pack's language where the corpus has them, else English. */
  text: string | null;
  /** A current take exists in that language: the players' packs are what is behind. */
  voiced: boolean;
};

/** Rows the page shows: the head of the list is what to voice next, the tail can wait. */
const RANKING_LIMIT = 200;

/** The lines of one pack language, most players first. */
export async function missingAudioRanking(packLang: string): Promise<MissingAudioRow[]> {
  // As the language's team, for the take "voiced" asks after; the hits themselves are shared,
  // so a language nobody owns still lists them, all unvoiced, as ALL_TEAMS.
  return queryIn<MissingAudioRow>(
    (await teamLangs()).get(packLang as Lang) ?? ALL_TEAMS,
    `with ranked as (
       select "lineId", count(*)::int as "installs", max("lastSeen") as "lastSeen",
              array_remove(array_agg(distinct "packVersion"), null) as "packVersions"
         from "missing_audio_hit"
        where "packLang" = $1
        group by "lineId"
        order by count(*) desc, max("lastSeen") desc, "lineId"
        limit $2
     )
     select r."lineId", r."installs", r."lastSeen"::text as "lastSeen", r."packVersions",
            coalesce(
              (select coalesce(q."localeText", q."text") from "quest_line" q
                where q."lineId" = r."lineId" and q."isCurrent" and q."lang" in ($1, $3)
                order by q."lang" = $1 desc, q."variant" limit 1),
              (select b."text" from "book_line" b
                where b."lineId" = r."lineId" and b."isCurrent" and b."lang" in ($1, $3)
                order by b."lang" = $1 desc limit 1)
            ) as "text",
            -- "source" first, so take_line_idx is used; gossip lines are takes of quests.
            exists (select 1 from "take" t
                     where t."source" in ('quests', 'readables') and t."lang" = $1
                       and t."lineId" = r."lineId" and t."isCurrent") as "voiced"
       from ranked r
      order by r."installs" desc, r."lastSeen" desc, r."lineId"`,
    [packLang, RANKING_LIMIT, BASE_LANG],
  );
}
