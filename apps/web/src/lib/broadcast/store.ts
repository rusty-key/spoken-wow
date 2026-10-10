/**
 * The broadcast_text tables (migration 0066): BroadcastText rows per language, and who
 * uploaded them.
 */
import { query } from "@/lib/db";
import { BASE_LANG, type Lang } from "@/lib/lang";

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
