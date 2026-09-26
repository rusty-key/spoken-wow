/**
 * Writing and reading the activity log (migration 0050).
 *
 * WRITE INSIDE THE ACT'S TRANSACTION when it has one: pass its client, and the event
 * commits or rolls back with the change it describes. A write with no transaction to join
 * -- a file on disk, a one-statement upsert -- is recorded after the act succeeds, never
 * before, so the log does not claim things that failed.
 *
 * NEVER LET THE LOG BREAK THE ACT. Outside a transaction, a failure to record is logged and
 * swallowed: somebody regenerating a line should get their take whether or not the audit
 * row landed. Inside one, the error propagates like any other statement's, because
 * swallowing it would leave the transaction aborted anyway.
 */
import "server-only";

import type { PoolClient } from "pg";

import { db } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import type { Source } from "@/lib/sections";

import { prefixesOf, type ActivityDetail, type ActivityKind, type Category } from "./kinds";

export type ActivityEvent<K extends ActivityKind = ActivityKind> = {
  kind: K;
  /** Null for an act that applies to every language. */
  lang: Lang | null;
  /** Null for the app itself, or a pipeline run with no user. */
  actorId: string | null;
  source?: Source | null;
  subject?: string | null;
  lineId?: string | null;
  detail: ActivityDetail[K];
};

const INSERT = `insert into "activity" ("lang", "kind", "source", "subject", "lineId", "detail", "actorId")
                select "lang", "kind", "source", "subject", "lineId", coalesce("detail", '{}'), "actorId"
                  from jsonb_to_recordset($1::jsonb) as r("lang" text, "kind" text, "source" text,
                       "subject" text, "lineId" text, "detail" jsonb, "actorId" text)`;

/** Record one act, as part of `client`'s transaction when given. */
export async function recordActivity<K extends ActivityKind>(
  event: ActivityEvent<K>,
  client?: Pick<PoolClient, "query">,
): Promise<void> {
  await recordActivities([event], client);
}

/**
 * Record many acts in one statement: clearing a search's worth of dirty takes is one click
 * and can be a thousand files, which as a thousand inserts would hold the request open.
 */
export async function recordActivities(
  events: ActivityEvent[],
  client?: Pick<PoolClient, "query">,
): Promise<void> {
  if (!events.length) return;
  const rows = JSON.stringify(
    events.map((event) => ({
      lang: event.lang,
      kind: event.kind,
      source: event.source ?? null,
      subject: event.subject ?? null,
      lineId: event.lineId ?? null,
      detail: event.detail,
      actorId: event.actorId,
    })),
  );
  if (client) {
    await client.query(INSERT, [rows]);
    return;
  }
  try {
    await db().query(INSERT, [rows]);
  } catch (error) {
    console.error(`activity: could not record ${events.length} ${events[0].kind}`, error);
  }
}

export type ActivityRow = {
  id: string;
  at: string;
  lang: Lang | null;
  kind: ActivityKind;
  source: Source | null;
  subject: string | null;
  lineId: string | null;
  detail: Record<string, unknown>;
  actorId: string | null;
  actorName: string | null;
  /** For a grant: the name of whoever received it, since the subject is only their id. */
  subjectName: string | null;
  /** For a queued batch: how many of its takes have been cut so far. */
  takes?: number;
};

/**
 * Where the next page starts. "at" is Postgres' own text for the timestamp, not a JS Date's:
 * a Date keeps milliseconds and the column keeps microseconds, so a cursor rounded through
 * one would skip every row in the same millisecond as the last one shown.
 */
export type Cursor = { at: string; id: string };

/**
 * A calendar day as the page's filters write it, "2026-03-10". A real date, not only its
 * shape: "2026-02-30" passes a pattern and then fails the ::date cast, which is a 500 for a
 * hand-edited link rather than the filter being ignored.
 */
export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  // setUTCFullYear rather than Date.UTC, which reads years 0-99 as 1900-1999.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  // Postgres has no year 0, and toISOString writes years past 9999 with a sign.
  return year >= 1 && date.toISOString().slice(0, 10) === value;
}

export type ActivityFilter = {
  lang: Lang;
  category?: Category;
  actorId?: string;
  source?: Source;
  /** Inclusive, ISO dates. */
  from?: string;
  to?: string;
  before?: Cursor;
  limit?: number;
  /** Whether the viewer is a global admin, the only one who sees account events (user.*). */
  global?: boolean;
};

const COLUMNS = `a."id"::text as "id", a."at", a."lang", a."kind", a."source", a."subject",
                 a."lineId", a."detail", a."actorId", u."name" as "actorName",
                 s."name" as "subjectName", a."at"::text as "cursorAt"`;

const JOINS = `left join "user" u on u."id" = a."actorId"
               left join "user" s on (a."kind" like 'grant.%' or a."kind" like 'user.%')
                                 and s."id" = a."subject"`;

/**
 * How far before a `from` day a batch can have been queued and still be found by the takes
 * it cut in range. The queue's own retention (lib/generation/queue.ts): a batch older than
 * that is gone, so nothing it cut is still coming. Bounding it keeps "at" a range the index
 * can read rather than every row the language has.
 */
const BATCH_REACH = "30 days";

/** The rows a group row folds away: a batch's takes, and the marks one click cleared. */
const FOLDED = `(a."kind" = 'take.generated' and a."detail" ? 'batchId')
                or (a."kind" = 'take.acked' and a."detail" ? 'groupId')`;

type Row = Omit<ActivityRow, "at"> & { at: Date; cursorAt: string };

/**
 * One page of a language's log, newest first, with the rows that belong to every language
 * merged in.
 *
 * TAKES A BATCH CUT ARE LEFT OUT and counted on the batch's row instead. A batch of three
 * hundred lines would otherwise be three hundred rows, pushing everything else that
 * happened that day off the page; groupRows lists them when the row is opened. Marks
 * cleared together are folded under their click's row the same way, for the same reason.
 *
 * A batch keeps the time it was queued, so a day filter that finds it by a take cut that
 * day still sorts it under the day it was queued: moving it would break the keyset order.
 *
 * Keyset rather than offset: rows are added at the top while somebody pages down, and an
 * offset would show them the same rows twice.
 */
export async function listActivity(
  filter: ActivityFilter,
): Promise<{ rows: ActivityRow[]; next: Cursor | null }> {
  const limit = filter.limit ?? 50;
  const where = [`not (${FOLDED})`];
  const values: unknown[] = [filter.lang];
  const param = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (!filter.global) where.push(`a."kind" not like 'user.%'`);
  if (filter.category) {
    where.push(`split_part(a."kind", '.', 1) = any(${param(prefixesOf(filter.category))}::text[])`);
  }
  if (filter.actorId) where.push(`a."actorId" = ${param(filter.actorId)}`);
  if (filter.source) where.push(`a."source" = ${param(filter.source)}`);

  const from = filter.from ? `${param(filter.from)}::date` : null;
  // The whole of the last day, not its first instant.
  const to = filter.to ? `${param(filter.to)}::date + 1` : null;
  const cut = (row: string) =>
    [from && `${row}."at" >= ${from}`, to && `${row}."at" < ${to}`].filter(Boolean).join(" and ");
  if (to) where.push(`a."at" < ${to}`);
  if (from) {
    // A batch queued before `from` still belongs to the range when it cut a take there:
    // a night's queue is that morning's audio. The first bound is implied by the second and
    // stays apart from the OR so that the index still reads only a range of "at".
    where.push(`a."at" >= ${from} - interval '${BATCH_REACH}'`);
    where.push(`(a."at" >= ${from} or (a."kind" = 'batch.queued'
                  and exists (select 1 from "activity" t
                               where t."kind" = 'take.generated'
                                 and t."detail"->>'batchId' = a."detail"->>'batchId'
                                 and t."lang" is not distinct from a."lang"
                                 and ${cut("t")})))`);
  }
  if (filter.before) {
    const at = param(filter.before.at);
    const id = param(filter.before.id);
    where.push(`(a."at", a."id") < (${at}::timestamptz, ${id}::bigint)`);
  }
  const n = param(limit + 1);

  // The language's rows and the every-language rows as two branches, each newest first
  // under its own index and stopping at a page, merged afterwards. One `lang = $1 or lang
  // is null` reads as neither index, and Postgres sorts the language's whole history to
  // show fifty rows of it.
  const branch = (lang: string) => `(
      select a.* from "activity" a
       where ${lang} and ${where.join(" and ")}
       order by a."at" desc, a."id" desc
       limit ${n})`;

  // A batch's count is of the takes in the range, so that it matches what opening it lists.
  const { rows } = await db().query<Row>(
    `select ${COLUMNS},
            case when a."kind" = 'batch.queued' then (
              select count(*)::int from "activity" t
               where t."kind" = 'take.generated' and t."detail"->>'batchId' = a."detail"->>'batchId'
                 ${from || to ? `and ${cut("t")}` : ""}
            ) end as "takes"
       from (${branch(`a."lang" = $1`)} union all ${branch(`a."lang" is null`)}) a
       ${JOINS}
      order by a."at" desc, a."id" desc
      limit ${n}`,
    values,
  );

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    rows: page.map(serialise),
    next: rows.length > limit && last ? { at: last.cursorAt, id: last.id } : null,
  };
}

/** The two kinds of row that open onto others, and the rows each one folds away. */
export const GROUPS = {
  batch: { kind: "take.generated", key: "batchId" },
  marks: { kind: "take.acked", key: "groupId" },
} as const;
export type Group = keyof typeof GROUPS;

/**
 * What one group row lists when opened, newest first: a queue batch's takes, or the marks
 * one click cleared. Given the page's day range, only what happened in it, which is what
 * the row counted.
 */
export async function groupRows(
  lang: Lang,
  group: Group,
  id: string,
  range: { from?: string; to?: string } = {},
): Promise<ActivityRow[]> {
  const { kind, key } = GROUPS[group];
  const values: unknown[] = [lang, kind, id];
  const where = [`a."lang" = $1`, `a."kind" = $2`, `a."detail"->>'${key}' = $3`];
  if (range.from) {
    values.push(range.from);
    where.push(`a."at" >= $${values.length}::date`);
  }
  if (range.to) {
    values.push(range.to);
    where.push(`a."at" < $${values.length}::date + 1`);
  }
  const { rows } = await db().query<Row>(
    `select ${COLUMNS}
       from "activity" a
       ${JOINS}
      where ${where.join(" and ")}
      order by a."at" desc, a."id" desc`,
    values,
  );
  return rows.map(serialise);
}

/**
 * Everybody who has done anything in a language, for the person filter. Without `global`,
 * not somebody whose only acts were on accounts: listing them would say an event exists
 * that this viewer is not shown.
 */
export async function activityActors(
  lang: Lang,
  global = false,
): Promise<{ id: string; name: string }[]> {
  const { rows } = await db().query<{ id: string; name: string }>(
    `select u."id", u."name" from "user" u
      where exists (select 1 from "activity" a
                     where a."actorId" = u."id" and (a."lang" = $1 or a."lang" is null)
                       and ($2 or a."kind" not like 'user.%'))
      order by u."name"`,
    [lang, global],
  );
  return rows;
}

function serialise(row: Row): ActivityRow {
  const { takes, cursorAt: _, ...rest } = row;
  return {
    ...rest,
    at: row.at.toISOString(),
    ...(takes === null || takes === undefined ? {} : { takes }),
  };
}
