/** A person's own batches in one language, read through a token: what became of what they queued. */
import "server-only";

import type { Lang } from "@/lib/lang";
import type { Source } from "@/lib/sections";
import { queryAs } from "@/lib/teams/store";
import type { TokenContext } from "@/lib/text-api/guard";
import { isUuid } from "@/lib/uuid";

import type { JobState } from "./queue";

export type BatchStatus = {
  batchId: string;
  label: string;
  section: Source;
  createdAt: string;
  stoppedAt: string | null;
  stoppedBecause: string | null;
  counts: Record<JobState, number>;
  credits: number;
  costUsd: number;
  /** No job pending or running. */
  finished: boolean;
};

type Row = {
  id: string;
  label: string;
  source: Source;
  createdAt: Date;
  stoppedAt: Date | null;
  stoppedBecause: string | null;
  pending: number;
  running: number;
  done: number;
  failed: number;
  cancelled: number;
  credits: number;
  costUsd: string | number;
};

const BATCH = `b."id", b."label", b."source", b."createdAt", b."stoppedAt", b."stoppedBecause"`;
/** One row per batch `b`, with no job too. */
const COUNTS = `
  cross join lateral (
    select count(*) filter (where "state" = 'pending')::int   as "pending",
           count(*) filter (where "state" = 'running')::int   as "running",
           count(*) filter (where "state" = 'done')::int      as "done",
           count(*) filter (where "state" = 'failed')::int    as "failed",
           count(*) filter (where "state" = 'cancelled')::int as "cancelled",
           coalesce(sum("credits"), 0)::int                   as "credits",
           coalesce(sum("costUsd"), 0)                        as "costUsd"
      from "regeneration_job" where "batchId" = b."id"
  ) j`;
const OWN = `b."createdBy" = $1 and b."lang" = $2`;

function toStatus(row: Row): BatchStatus {
  const counts = {
    pending: row.pending,
    running: row.running,
    done: row.done,
    failed: row.failed,
    cancelled: row.cancelled,
  };
  return {
    batchId: row.id,
    label: row.label,
    section: row.source,
    createdAt: row.createdAt.toISOString(),
    stoppedAt: row.stoppedAt?.toISOString() ?? null,
    stoppedBecause: row.stoppedBecause,
    counts,
    credits: row.credits,
    costUsd: Number(row.costUsd),
    finished: counts.pending + counts.running === 0,
  };
}

export async function listOwnBatches(userId: string, lang: Lang): Promise<BatchStatus[]> {
  // The 50 newest first, so only their jobs are counted.
  const { rows } = await queryAs<Row>(
    lang,
    `select ${BATCH}, j.*
       from (select * from "regeneration_batch" b where ${OWN} order by b."createdAt" desc, b."id" limit 50) b
       ${COUNTS}
      order by b."createdAt" desc, b."id"`,
    [userId, lang],
  );
  return rows.map(toStatus);
}

export type OwnBatch = BatchStatus & { failures: { lineId: string; message: string }[] };

/** Null for an unknown id, another owner's batch, and the owner's batch in another language. */
export async function ownBatch(batchId: string, userId: string, lang: Lang): Promise<OwnBatch | null> {
  const { rows } = await queryAs<Row & { failures: OwnBatch["failures"] }>(
    lang,
    `select ${BATCH}, j.*, f."failures"
       from "regeneration_batch" b
       ${COUNTS}
       cross join lateral (
         select coalesce(json_agg(json_build_object('lineId', x."lineId", 'message', coalesce(x."error", ''))
                                  order by x."finishedAt" desc nulls last, x."id" desc), '[]') as "failures"
           from (select "id", "lineId", "error", "finishedAt" from "regeneration_job"
                  where "batchId" = b."id" and "state" = 'failed'
                  order by "finishedAt" desc nulls last, "id" desc limit 100) x
       ) f
      where ${OWN} and b."id" = $3`,
    [userId, lang, batchId],
  );
  return rows[0] ? { ...toStatus(rows[0]), failures: rows[0].failures } : null;
}

const noSuchGeneration = () => Response.json({ error: "no such generation" }, { status: 404 });

/** The token owner's batch `batchId` in the token's language, or the 404 for any other id. */
export async function ownGeneration(
  context: Pick<TokenContext, "userId" | "lang">,
  batchId: string,
): Promise<OwnBatch | Response> {
  const batch = isUuid(batchId) ? await ownBatch(batchId, context.userId, context.lang) : null;
  return batch ?? noSuchGeneration();
}

/** Null when the token owner has batch `batchId` in the token's language, else the 404. */
export async function notOwnGeneration(
  context: Pick<TokenContext, "userId" | "lang">,
  batchId: string,
): Promise<Response | null> {
  if (!isUuid(batchId)) return noSuchGeneration();
  const { rows } = await queryAs(
    context.lang,
    `select 1 from "regeneration_batch" b where ${OWN} and b."id" = $3`,
    [context.userId, context.lang, batchId],
  );
  return rows.length ? null : noSuchGeneration();
}
