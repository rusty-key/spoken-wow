/**
 * The broadcast_text tables (migration 0066): BroadcastText rows per language, and who
 * uploaded them.
 */
import { query } from "@/lib/db";
import { BASE_LANG, type Lang } from "@/lib/lang";

import type { BroadcastStatus } from "./status";

export type BroadcastRow = { id: number; text: string; text1: string };

export type RecordedTexts = { texts: number; added: number; changed: number };

/** One row per id, the last copy winning: Postgres refuses an upsert that touches a row twice. */
export function uniqueById(rows: BroadcastRow[]): BroadcastRow[] {
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

/**
 * Write one upload's rows for a language, and log the upload.
 *
 * A row's text is replaced only by one from the same or a newer build: a hotfix rewrites a
 * row in place, and an upload of an old cache must not undo it. Every copy counts as an
 * observation, whichever text it carried.
 *
 * One statement: `prior` reads the rows as they were before the upsert, which is what the
 * counts are taken against. `rows` must already be unique by id.
 */
export async function recordUpload(
  userId: string,
  lang: Lang,
  build: number | null,
  rows: BroadcastRow[],
): Promise<RecordedTexts> {
  const newer = (existing: string) => `($2::int is not null and (${existing} is null or $2 >= ${existing}))`;
  const [counts] = await query<RecordedTexts>(
    `with incoming as (
       select * from unnest($3::int[], $4::text[], $5::text[]) as t("id", "text", "text1")
     ),
     prior as (
       select b.* from "broadcast_text" b join incoming i on b."broadcastTextId" = i."id" where b."lang" = $1
     ),
     upserted as (
       insert into "broadcast_text" ("lang", "broadcastTextId", "text", "text1", "build")
       select $1, i."id", i."text", i."text1", $2 from incoming i
       on conflict ("lang", "broadcastTextId") do update set
         "observations" = "broadcast_text"."observations" + 1,
         "text"   = case when ${newer(`"broadcast_text"."build"`)} then excluded."text"  else "broadcast_text"."text"  end,
         "text1"  = case when ${newer(`"broadcast_text"."build"`)} then excluded."text1" else "broadcast_text"."text1" end,
         "build"  = case when ${newer(`"broadcast_text"."build"`)} then excluded."build" else "broadcast_text"."build" end,
         "updatedAt" = now()
       returning 1
     ),
     counted as (
       select (select count(*) from upserted)::int as "texts",
              (select count(*) from incoming i
                where not exists (select 1 from prior p where p."broadcastTextId" = i."id"))::int as "added",
              (select count(*) from incoming i join prior p on p."broadcastTextId" = i."id"
                where ${newer(`p."build"`)} and (p."text", p."text1") is distinct from (i."text", i."text1"))::int as "changed"
     ),
     logged as (
       insert into "broadcast_text_upload" ("userId", "lang", "build", "texts", "added", "changed")
       select $6, $1, $2, "texts", "added", "changed" from counted
     )
     select * from counted`,
    [lang, build, rows.map((r) => r.id), rows.map((r) => r.text), rows.map((r) => r.text1), userId],
  );
  return counts;
}

/** A BroadcastText id a gossip line speaks, and how it was found (migration 0067). */
export type LineBroadcast = { id: number; matchedBy: "extract" | "text" };

/** The ids each of these lines speaks, lowest first. Lines with none are absent. */
export async function broadcastIdsFor(lineIds: string[]): Promise<Map<string, LineBroadcast[]>> {
  const rows = await query<{ lineId: string; id: number; matchedBy: LineBroadcast["matchedBy"] }>(
    `select "lineId", "broadcastTextId" as "id", "matchedBy" from "gossip_broadcast"
      where "lineId" = any($1) order by "lineId", "broadcastTextId"`,
    [lineIds],
  );
  const byLine = new Map<string, LineBroadcast[]>();
  for (const { lineId, id, matchedBy } of rows) byLine.set(lineId, [...(byLine.get(lineId) ?? []), { id, matchedBy }]);
  return byLine;
}

/**
 * The other current lines of each line's moment: lines sharing one of its ids, spoken by the
 * same race and gender, and not its own player-gender rows. Lines merged into it are not
 * listed: they are no longer lines anyone browses.
 */
export async function momentSiblingsFor(lineIds: string[]): Promise<Map<string, string[]>> {
  const rows = await query<{ lineId: string; siblings: string[] }>(
    `select a."lineId", array_agg(distinct b."lineId" order by b."lineId") as "siblings"
       from "gossip_broadcast" a
       join "gossip_broadcast" b
         on b."broadcastTextId" = a."broadcastTextId"
        and regexp_replace(b."lineId", ':[mf]$', '') <> regexp_replace(a."lineId", ':[mf]$', '')
      where a."lineId" = any($1)
        and exists (select 1 from "quest_line" l where l."lineId" = b."lineId" and l."isCurrent")
        and exists (select 1 from "quest_line_speaker" sa join "quest_line_speaker" sb
                       on sb."race" = sa."race" and sb."gender" = sa."gender"
                     where sa."lineId" = a."lineId" and sb."lineId" = b."lineId")
      group by a."lineId"`,
    [lineIds],
  );
  return new Map(rows.map(({ lineId, siblings }) => [lineId, siblings]));
}

/** The line a merged gossip line went into (migration 0068), or null. */
export async function mergedInto(lineId: string): Promise<string | null> {
  const [row] = await query<{ mergedInto: string }>(
    `select "mergedInto" from "gossip_merge" where "lineId" = $1`,
    [lineId],
  );
  return row?.mergedInto ?? null;
}

/**
 * Each gossip line with an id, and whether the world database named one (extract) or only its
 * English text matched (text). A line absent from the map has none.
 */
export async function broadcastStatuses(): Promise<Map<string, Exclude<BroadcastStatus, "none">>> {
  const rows = await query<{ lineId: string; extract: boolean }>(
    `select "lineId", bool_or("matchedBy" = 'extract') as "extract" from "gossip_broadcast" group by "lineId"`,
  );
  return new Map(rows.map(({ lineId, extract }) => [lineId, extract ? "extract" : "text"]));
}

/**
 * How many of these rows say exactly what English says under the same id.
 *
 * A cache is per client language, and the folder it sits in is the only sign of which; an
 * English cache sent as German would file English text as German's. Rows that read
 * identically in both languages are rare outside names and punctuation.
 */
export async function sameAsEnglish(rows: BroadcastRow[]): Promise<{ compared: number; same: number }> {
  const found = await query<{ compared: number; same: number }>(
    `select count(*)::int as "compared",
            count(*) filter (where e."text" = t."text" and e."text1" = t."text1")::int as "same"
       from unnest($1::int[], $2::text[], $3::text[]) as t("id", "text", "text1")
       join "broadcast_text" e on e."lang" = $4 and e."broadcastTextId" = t."id"`,
    [rows.map((r) => r.id), rows.map((r) => r.text), rows.map((r) => r.text1), BASE_LANG],
  );
  return found[0] ?? { compared: 0, same: 0 };
}
