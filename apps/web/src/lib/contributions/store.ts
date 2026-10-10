/**
 * The only module that knows the contribution table's column names, as lib/reports/store.ts is
 * for reports.
 *
 * The insert is an upsert on "dedup", which is where "count" comes from: the same text from a
 * fourth player is not a fourth row to read, it is the number that says read this one first.
 *
 * countRecentContributions counts in Postgres for the reason its report-side twin gives -- a
 * limit held in process memory is a limit that resets at the moment a flood would get through.
 * It is a separate count from the reports one: a person filing ten reports and pasting ten
 * envelopes has done two different things, and neither should silence the other.
 */
import { recordActivity } from "@/lib/activity/store";
import { db } from "@/lib/db";
import { isLang } from "@/lib/lang";
import type { NpcKind } from "@/lib/npc/npc";

import type { ContributionStatus, Submission } from "./contributions";
import type { EnvelopeSource } from "./envelope";
import { DEFAULT_SORT, type ContributionSort, type SortColumn } from "./query";

/** Exported for accept.ts, whose row lock reads the same shape inside its own transaction. */
export const CONTRIBUTION_COLUMNS = `"id", "source", "key", "locale", "build", "text", "meta", "raw", "count",
                 "status", "body", "name", "email", "userId", "createdAt"::text,
                 "updatedAt"::text, "resolvedBy", "npcKind", "npcId", "npcName", "pageId"`;
const COLUMNS = CONTRIBUTION_COLUMNS;

export type Contribution = {
  id: number;
  source: EnvelopeSource;
  key: string;
  locale: string;
  build: string;
  text: string | null;
  meta: Record<string, string>;
  raw: string;
  count: number;
  status: ContributionStatus;
  body: string | null;
  name: string | null;
  email: string | null;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedBy: string | null;
  /** The kind a moderator chose for a kind-less envelope's NPC (migration 0033); null otherwise. */
  npcKind: NpcKind | null;
  /** The NPC a moderator named for an envelope that named none (migration 0048); null otherwise. */
  npcId: number | null;
  npcName: string | null;
  /** The English page a moderator matched a books contribution to (migration 0059); null until then. */
  pageId: number | null;
};

/**
 * The fields observedFrom reads, off a stored row: `meta` as the client sent it, plus the things
 * kept in columns of their own -- `build` (split out at intake), and a moderator-chosen `kind`
 * and NPC, which only ever fill in for an envelope that carried none.
 */
export function observationMeta(
  row: Pick<Contribution, "meta" | "build" | "npcKind" | "npcId" | "npcName">,
): Record<string, string> {
  const meta: Record<string, string> = { ...row.meta, build: row.build };
  if (!meta.kind && row.npcKind) meta.kind = row.npcKind;
  // In observedFrom's own "<id> <name>" shape, so nothing downstream knows where it came from.
  if (!meta.npc && row.npcId !== null && row.npcName) meta.npc = `${row.npcId} ${row.npcName}`;
  return meta;
}

/**
 * Record which NPC speaks a quest contribution whose envelope named none. A no-op, returning
 * null, for a row whose envelope already named one -- the client's own observation stands -- and
 * for a zones or books row, which never has an NPC to name. Returns the updated row.
 *
 * `by` is who answered, for the activity log: the row keeps the answer but not whose it was.
 */
export async function setContributionNpc(
  id: number,
  npc: { npcKind: NpcKind; npcId: number; npcName: string },
  by: string | null,
): Promise<Contribution | null> {
  const { rows } = await db().query<Contribution>(
    `update "contribution"
        set "npcKind" = case when coalesce("meta"->>'kind', '') = '' then $2 else "npcKind" end,
            "npcId" = $3, "npcName" = $4, "updatedAt" = now()
      where "id" = $1 and "source" = 'quests' and coalesce("meta"->>'npc', '') = ''
      returning ${COLUMNS}`,
    [id, npc.npcKind, npc.npcId, npc.npcName],
  );
  const row = rows[0];
  if (!row) return null;
  // The kind as stored, not as asked: the update keeps an envelope's own kind over the answer's.
  await recordActivity({
    kind: "contribution.edited",
    lang: isLang(row.locale) ? row.locale : null,
    source: row.source,
    subject: String(id),
    actorId: by,
    detail: { field: "npc", value: { npcKind: row.npcKind, npcId: row.npcId, npcName: row.npcName } },
  });
  return row;
}

/**
 * Record which English page a books contribution's text is, or clear it with null. A no-op,
 * returning null, for a row that is not books or whose page accept has already written: the
 * written page is one-way (accept.ts), and moving the match under it would leave the two
 * disagreeing. The page is the caller's to check exists. Returns the updated row.
 *
 * `by` is who answered, for the activity log, as for setContributionNpc.
 */
export async function setContributionPage(
  id: number,
  pageId: number | null,
  by: string | null,
): Promise<Contribution | null> {
  const { rows } = await db().query<Contribution>(
    `update "contribution"
        set "pageId" = $2, "updatedAt" = now()
      where "id" = $1 and "source" = 'books'
        and not exists (select 1 from "book_line" b
                         where b."origin" = 'contributed'
                           and b."note" = 'contribution #' || "contribution"."id")
      returning ${COLUMNS}`,
    [id, pageId],
  );
  const row = rows[0];
  if (!row) return null;
  await recordActivity({
    kind: "contribution.edited",
    lang: isLang(row.locale) ? row.locale : null,
    source: row.source,
    subject: String(id),
    actorId: by,
    detail: { field: "pageId", value: pageId },
  });
  return row;
}

/**
 * Record which kind a kind-less contribution's NPC is. A no-op, returning false, for a row whose
 * envelope already carried a kind: that is the client's own observation and is not overridden.
 *
 * `by` is who answered, for the activity log, as for setContributionNpc.
 */
export async function setContributionNpcKind(
  id: number,
  npcKind: NpcKind,
  by: string | null,
): Promise<boolean> {
  const { rows } = await db().query<Pick<Contribution, "locale" | "source">>(
    `update "contribution" set "npcKind" = $2, "updatedAt" = now()
     where "id" = $1 and coalesce("meta"->>'kind', '') = ''
     returning "locale", "source"`,
    [id, npcKind],
  );
  const row = rows[0];
  if (!row) return false;
  await recordActivity({
    kind: "contribution.edited",
    lang: isLang(row.locale) ? row.locale : null,
    source: row.source,
    subject: String(id),
    actorId: by,
    detail: { field: "npcKind", value: npcKind },
  });
  return true;
}

/**
 * The same line sent again, now naming its speaker, fills in the speaker the first copy lacked.
 *
 * The triage key is quest and moment, not NPC, so an envelope from an addon that could not see
 * the NPC and a later one that could hash to the same "dedup" -- and without this the second is
 * only a count, its NPC dropped on the floor. Only ever fills: a row whose envelope already
 * named an NPC keeps it, the client's own observation standing as it does in
 * setContributionNpc. `meta || excluded.meta` rather than a replace, so nothing the first copy
 * carried is lost; the text is the same by construction (it is in the hash).
 *
 * Written against an `excluded`-shaped source so the upsert below and fillContributionNpcs share
 * one rule; the latter aliases its unnested parameters as `excluded`.
 */
const FILL_NPC_WHEN = `coalesce("contribution"."meta"->>'npc', '') = ''
             and coalesce(excluded."meta"->>'npc', '') <> ''`;
const FILL_NPC_SET = `"meta" = case when ${FILL_NPC_WHEN}
                        then "contribution"."meta" || excluded."meta"
                        else "contribution"."meta" end,
           "raw" = case when ${FILL_NPC_WHEN} then excluded."raw" else "contribution"."raw" end`;

/**
 * Fill in the speaker of already-stored lines from resends that name one, without counting a
 * resend as another player: what scripts/backfill-contribution-npcs.mts does with a file a
 * contributor re-gathered after an addon update. One statement for the lot, since the script
 * may run over a tunnel where a round trip per line is minutes. Returns the dedups it changed.
 */
export async function fillContributionNpcs(
  inputs: Pick<Submission, "dedup" | "meta" | "raw">[],
): Promise<string[]> {
  if (inputs.length === 0) return [];
  const { rows } = await db().query<{ dedup: string }>(
    `update "contribution"
        set ${FILL_NPC_SET}, "updatedAt" = now()
       from unnest($1::text[], $2::jsonb[], $3::text[]) as excluded ("dedup", "meta", "raw")
      where "contribution"."dedup" = excluded."dedup" and ${FILL_NPC_WHEN}
      returning "contribution"."dedup"`,
    [
      inputs.map((input) => input.dedup),
      inputs.map((input) => JSON.stringify(input.meta)),
      inputs.map((input) => input.raw),
    ],
  );
  return rows.map((row) => row.dedup);
}

export async function createContribution(
  input: Submission & {
    body: string | null;
    name: string | null;
    email: string | null;
    userId: string | null;
    ip: string | null;
  },
): Promise<void> {
  // Returns nothing, as createReport does: the sender cannot read their submission back.
  // A copy from somebody signed in or named is recorded beside the count (migration 0065).
  await db().query(
    `with "stored" as (
       insert into "contribution"
         ("source", "key", "locale", "build", "text", "meta", "raw", "dedup",
          "body", "name", "email", "userId", "ip")
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13)
       on conflict ("dedup") do update
         set "count" = "contribution"."count" + 1,
             ${FILL_NPC_SET},
             "updatedAt" = now()
       returning "id"
     )
     insert into "contribution_sender" ("contributionId", "userId", "name")
     select "id", $12::text, $10::text from "stored"
      where $12::text is not null or $10::text is not null`,
    [
      input.source,
      input.key,
      input.locale,
      input.build,
      input.text,
      JSON.stringify(input.meta),
      input.raw,
      input.dedup,
      input.body,
      input.name,
      input.email,
      input.userId,
      input.ip,
    ],
  );
}

/** Signed-in senders appear under their account's name. Never an email. */
export async function contributionSenders(
  id: number,
): Promise<{ senders: { name: string; count: number }[]; anonymous: number } | null> {
  const { rows: found } = await db().query<{ count: number }>(
    `select "count" from "contribution" where "id" = $1`,
    [id],
  );
  if (found.length === 0) return null;
  const { rows } = await db().query<{ name: string; count: number }>(
    `select coalesce(u."name", s."name", 'deleted account') as "name", count(*)::int as "count"
       from "contribution_sender" s
       left join "user" u on u."id" = s."userId"
      where s."contributionId" = $1
      group by s."userId", coalesce(u."name", s."name", 'deleted account')
      order by count(*) desc, min(s."createdAt")`,
    [id],
  );
  const named = rows.reduce((sum, row) => sum + row.count, 0);
  return { senders: rows, anonymous: Math.max(0, found[0].count - named) };
}

export async function recordContributionHit(ip: string | null): Promise<void> {
  await db().query(`insert into "contribution_hit" ("ip") values ($1)`, [ip]);
}

export async function countRecentContributions(ip: string, withinMs: number): Promise<number> {
  // Counts hits, not rows: the upsert above collapses identical text, and a person who pasted
  // the same envelope ten times has still pasted ten times.
  const { rows } = await db().query<{ count: string }>(
    `select count(*)::text as count
       from "contribution_hit"
      where "ip" = $1
        and "createdAt" > now() - ($2::bigint * interval '1 millisecond')`,
    [ip, withinMs],
  );
  return Number(rows[0]?.count ?? 0);
}

/** Each sortable column's own name, spelled out rather than interpolated from the caller's string. */
const SORT_EXPRESSIONS: Record<SortColumn, string> = {
  filed: `"createdAt"`,
  count: `"count"`,
};

/** Ties fall back to most sent, then newest, then id -- the default order, made total so a page cut is stable. */
function orderBy(sort: ContributionSort): string {
  const direction = sort.direction === "asc" ? "asc" : "desc";
  return `${SORT_EXPRESSIONS[sort.column]} ${direction}, "count" desc, "createdAt" desc, "id" desc`;
}

/**
 * `locale`, when given, is one language's: the contributions page lists the ones sent in
 * the language it is shown in, since accepting one writes that language's text.
 */
export async function listContributions(
  status: ContributionStatus | "all",
  locale?: string,
  sort: ContributionSort = DEFAULT_SORT,
  source?: EnvelopeSource,
): Promise<Contribution[]> {
  const { rows } = await db().query<Contribution>(
    `select ${COLUMNS} from "contribution"
      where ($1 = 'all' or "status" = $1) and ($2::text is null or "locale" = $2)
        and ($3::text is null or "source" = $3)
      order by ${orderBy(sort)}`,
    [status, locale ?? null, source ?? null],
  );
  return rows;
}

export async function setContributionStatus(
  id: number,
  status: ContributionStatus,
  userId: string,
): Promise<Contribution | null> {
  const { rows } = await db().query<Contribution>(
    `update "contribution"
        set "status" = $2, "resolvedBy" = $3, "updatedAt" = now()
      where "id" = $1
      returning ${COLUMNS}`,
    [id, status, userId],
  );
  return rows[0] ?? null;
}

export async function acceptedContributions(): Promise<Contribution[]> {
  const { rows } = await db().query<Contribution>(
    `select ${COLUMNS} from "contribution"
      where "status" = 'accepted'
      order by "source", "key"`,
  );
  return rows;
}

/**
 * The language a contribution was sent in -- the pack the player was using -- or null for
 * one that does not exist. Asked before resolving it, since who may resolve it is whoever
 * may edit that language.
 */
export async function contributionLocale(id: number): Promise<string | null> {
  const { rows } = await db().query<{ locale: string }>(
    `select "locale" from "contribution" where "id" = $1`,
    [id],
  );
  return rows[0]?.locale ?? null;
}

/** contributionLocale for many ids in one query. An id that is not there is left out. */
export async function contributionLocales(ids: readonly number[]): Promise<Map<number, string>> {
  const { rows } = await db().query<{ id: number; locale: string }>(
    `select "id", "locale" from "contribution" where "id" = any($1::int[])`,
    [ids],
  );
  return new Map(rows.map((row) => [row.id, row.locale]));
}
