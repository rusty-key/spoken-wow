/**
 * Upgrading gossip lines as BroadcastText rows arrive.
 *
 * A line minted before its id was known has no gossip_broadcast row, and a moment minted twice
 * (a Portuguese line, then the English one) is two lines. Relinking does two things:
 *
 *   1. gives each line without an id the lowest id whose text in one of the line's languages
 *      reads the same, in the form its speakers' sex shows (contributions/gossip.ts's rule);
 *   2. merges duplicates: lines that speak one id, have the same speakers, and read the same in
 *      every language both have. The preferred line stays (named by id, then English, then a
 *      language's own; then the older), takes the other's languages it lacks, and the other's
 *      rows stop being current (migration 0068). Nothing is renamed: the merged line's file
 *      keeps playing through GossipAliases, and its takes stay where they are.
 *
 * Lines of one moment that differ are left as they are, tied together by GossipAliases.
 */
import type { PoolClient } from "pg";

import { db } from "@/lib/db";
import { BASE_LANG } from "@/lib/lang";
import { gossipStemRank } from "@/lib/contributions/naming";

const NORM = (sql: string) => `lower(regexp_replace(btrim(${sql}), '\\s+', ' ', 'g'))`;
const BRANCH = (sql: string, side: 1 | 2) =>
  `regexp_replace(${sql}, '\\$g([^:;]*):([^;]*);', '\\${side}', 'gi')`;
/** The text a client in the row's language shows: English's own, another language's localeText. */
const SHOWN = `case when l."lang" = '${BASE_LANG}' then l."originalText" else l."localeText" end`;

/** `merges` is [merged line, the line it went into]. */
export type Relinked = { linked: number; merges: [string, string][] };

/**
 * `dryRun` rolls back, for a report of what relinking would do. `lineIds` limits it to those
 * lines, for a test that must not touch the rest. `lang` is what one cache upload can have
 * changed: it links only by that language's text, at a ninth of the cost, and merges only the
 * lines it linked, since only a new id can make two lines one moment.
 */
export async function relinkGossip({
  dryRun = false,
  lineIds = null,
  lang = null,
}: { dryRun?: boolean; lineIds?: string[] | null; lang?: string | null } = {}): Promise<Relinked> {
  const client = await db().connect();
  try {
    await client.query("begin");
    // One relink at a time: two would both find the same duplicates.
    await client.query(`select pg_advisory_xact_lock(hashtext('relink_gossip'))`);
    const linked = await linkByText(client, lineIds, lang);
    const scope = lang === null ? lineIds : linked;
    const merges: [string, string][] = [];
    while (scope === null || scope.length) {
      const found = await mergeDuplicates(client, scope);
      if (!found.length) break;
      merges.push(...found);
    }
    await client.query(dryRun ? "rollback" : "commit");
    return { linked: linked.length, merges };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** The lines linked. */
async function linkByText(client: PoolClient, lineIds: string[] | null, lang: string | null): Promise<string[]> {
  // Each id's text in both forms and on both sides of a `$g` branch, so the join is on plain
  // values: an expression over both sides would compare every line with every row.
  const forms = (gender: string, column: string) =>
    [1, 2].map(
      (side) =>
        `select b."lang", b."broadcastTextId", '${gender}' as "gender", ${NORM(BRANCH(column, side as 1 | 2))} as "shown"
           from "broadcast_text" b where b."lang" in (select "lang" from line)`,
    );
  const { rows } = await client.query<{ lineId: string }>(
    `with line as materialized (
       select l."lineId", l."lang", ${NORM(SHOWN)} as "shown",
              (select s."gender" from "quest_line_speaker" s where s."lineId" = l."lineId" limit 1) as "gender"
         from "quest_line" l
        where l."isCurrent" and l."source" = 'gossip' and coalesce(${SHOWN}, '') <> ''
          and ($1::text[] is null or l."lineId" = any($1))
          and ($2::text is null or l."lang" = $2)
          and not exists (select 1 from "gossip_broadcast" g where g."lineId" = l."lineId")
     ),
     shown as materialized (
       ${[
         ...forms("male", `coalesce(nullif(b."text", ''), b."text1")`),
         ...forms("female", `coalesce(nullif(b."text1", ''), b."text")`),
       ].join("\n       union all\n       ")}
     )
     insert into "gossip_broadcast" ("lineId", "broadcastTextId", "matchedBy")
     select distinct on (line."lineId") line."lineId", f."broadcastTextId", 'text'
       from line
       join shown f on f."lang" = line."lang" and f."shown" = line."shown"
                   and f."gender" = case when line."gender" = 'female' then 'female' else 'male' end
      order by line."lineId", f."broadcastTextId"
     on conflict do nothing
     returning "lineId"`,
    [lineIds, lang],
  );
  return rows.map((row) => row.lineId);
}

type Pair = { a: string; b: string; aCreated: Date; bCreated: Date };

/** One round of merges, each line at most once; the caller repeats until a round finds none. */
async function mergeDuplicates(client: PoolClient, lineIds: string[] | null): Promise<[string, string][]> {
  const { rows } = await client.query<Pair>(
    `with cur as materialized (
       select l."lineId", l."lang", ${NORM(`coalesce(${SHOWN}, '')`)} as "shown"
         from "quest_line" l
        where l."isCurrent" and l."source" = 'gossip' and l."variant" = 0
     ),
     voices as materialized (
       select s."lineId",
              string_agg(distinct s."npcType" || ':' || s."npcId" || ':' || s."race" || ':' || s."gender", ',') as "sig"
         from "quest_line_speaker" s
        where s."lineId" in (select "lineId" from "gossip_broadcast")
        group by 1
     ),
     keyed as materialized (
       select g."broadcastTextId", v."sig", g."lineId"
         from "gossip_broadcast" g join voices v using ("lineId")
        where exists (select 1 from cur c where c."lineId" = g."lineId")
     ),
     pairs as (
       -- Not a line's own player-gender rows (<id>:m, <id>:f): those are one line.
       select distinct x."lineId" as "a", y."lineId" as "b"
         from keyed x
         join keyed y on y."broadcastTextId" = x."broadcastTextId" and y."sig" = x."sig" and y."lineId" > x."lineId"
        where ($1::text[] is null or x."lineId" = any($1) or y."lineId" = any($1))
          and regexp_replace(x."lineId", ':[mf]$', '') <> regexp_replace(y."lineId", ':[mf]$', '')
     ),
     same as (
       select p."a", p."b"
         from pairs p
         join cur ca on ca."lineId" = p."a"
         join cur cb on cb."lineId" = p."b" and cb."lang" = ca."lang"
        group by 1, 2
       having bool_and(ca."shown" = cb."shown")
     )
     select s."a", s."b",
            (select min("createdAt") from "quest_line" where "lineId" = s."a") as "aCreated",
            (select min("createdAt") from "quest_line" where "lineId" = s."b") as "bCreated"
       from same s
      order by 1, 2`,
    [lineIds],
  );

  const touched = new Set<string>();
  const merged: [string, string][] = [];
  for (const pair of rows) {
    if (touched.has(pair.a) || touched.has(pair.b)) continue;
    const [survivor, loser] = preferred(pair) ? [pair.a, pair.b] : [pair.b, pair.a];
    await merge(client, survivor, loser);
    touched.add(pair.a);
    touched.add(pair.b);
    merged.push([loser, survivor]);
  }
  return merged;
}

/** Whether `a` is the line that stays: named by id, then English, then a language's own; then the older. */
function preferred({ a, b, aCreated, bCreated }: Pair): boolean {
  const rank = (lineId: string) => gossipStemRank(lineId.slice(2).replace(/:[mf]$/, ""));
  if (rank(a) !== rank(b)) return rank(a) < rank(b);
  if (aCreated.getTime() !== bCreated.getTime()) return aCreated < bCreated;
  return a < b;
}

async function merge(client: PoolClient, survivor: string, loser: string): Promise<void> {
  // The languages only the merged line has: its rows, over the survivor's id and file, with its
  // speakers in that language when the survivor has none there.
  const stem = survivor.slice(2).replace(/:[mf]$/, "");
  const { rows: copied } = await client.query<{ lang: string }>(
    `insert into "quest_line"
       ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId",
        "questTitle", "playerGender", "fileName", "text", "originalText", "localeText",
        "generatable", "skipReason", "editedBy", "note")
     select $1, l."variant", l."lang",
            coalesce((select max(v."version") from "quest_line" v
                       where v."lineId" = $1 and v."variant" = l."variant" and v."lang" = l."lang"), 0) + 1,
            true, l."origin", l."source", l."questId", l."questTitle", l."playerGender",
            case when l."playerGender" is null then $3 else l."playerGender" || '-' || $3 end,
            l."text", l."originalText", l."localeText", l."generatable", l."skipReason",
            l."editedBy", l."note"
       from "quest_line" l
      where l."lineId" = $2 and l."isCurrent"
        and not exists (select 1 from "quest_line" t
                         where t."lineId" = $1 and t."variant" = l."variant" and t."lang" = l."lang" and t."isCurrent")
     returning "lang"`,
    [survivor, loser, stem],
  );
  const langs = [...new Set(copied.map((row) => row.lang))];
  if (langs.length) {
    await client.query(`select pg_advisory_xact_lock(hashtext('quest_line_speaker.contributed_ord'))`);
    await client.query(
      `insert into "quest_line_speaker"
         ("lineId", "variant", "lang", "ord", "npcType", "npcId", "npcName", "race", "gender",
          "flavor", "voice", "contributionId")
       select $1, s."variant", s."lang",
              (select coalesce(max(o."ord"), 0) from "quest_line_speaker" o where o."lang" = s."lang")
                + row_number() over (partition by s."lang" order by s."ord"),
              s."npcType", s."npcId", s."npcName", s."race", s."gender", s."flavor", s."voice", s."contributionId"
         from "quest_line_speaker" s
        where s."lineId" = $2 and s."lang" = any($3::text[])
          and not exists (select 1 from "quest_line_speaker" t where t."lineId" = $1 and t."lang" = s."lang")`,
      [survivor, loser, langs],
    );
  }
  await client.query(`update "quest_line" set "isCurrent" = false where "lineId" = $1 and "isCurrent"`, [loser]);
  await client.query(
    `insert into "gossip_broadcast" ("lineId", "broadcastTextId", "matchedBy")
     select $1, "broadcastTextId", "matchedBy" from "gossip_broadcast" where "lineId" = $2
     on conflict do nothing`,
    [survivor, loser],
  );
  await client.query(
    `insert into "gossip_merge" ("lineId", "mergedInto") values ($1, $2)
     on conflict ("lineId") do update set "mergedInto" = excluded."mergedInto", "mergedAt" = now()`,
    [loser, survivor],
  );
  // A line merged earlier into the one merged now follows it.
  await client.query(`update "gossip_merge" set "mergedInto" = $1 where "mergedInto" = $2`, [survivor, loser]);
}
