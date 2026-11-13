/** A person's own batches in one language, read through a token: what became of what they queued. */
import "server-only";

import type { Lang } from "@/lib/lang";
import type { Source } from "@/lib/sections";
import { queryAs } from "@/lib/teams/store";

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

const SELECT = `
  select b."id", b."label", b."source", b."createdAt", b."stoppedAt", b."stoppedBecause",
         count(j."id") filter (where j."state" = 'pending')::int   as "pending",
         count(j."id") filter (where j."state" = 'running')::int   as "running",
         count(j."id") filter (where j."state" = 'done')::int      as "done",
         count(j."id") filter (where j."state" = 'failed')::int    as "failed",
         count(j."id") filter (where j."state" = 'cancelled')::int as "cancelled",
         coalesce(sum(j."credits"), 0)::int                        as "credits",
         coalesce(sum(j."costUsd"), 0)                             as "costUsd"
    from "regeneration_batch" b
    left join "regeneration_job" j on j."batchId" = b."id"
   where b."createdBy" = $1 and b."lang" = $2`;

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

export async function listOwnBatches(userId: string, lang: Lang, limit = 50): Promise<BatchStatus[]> {
  const { rows } = await queryAs<Row>(
    lang,
    `${SELECT} group by b."id" order by b."createdAt" desc, b."id" limit $3`,
    [userId, lang, limit],
  );
  return rows.map(toStatus);
}

/** Null for an unknown id, another owner's batch, and the owner's batch in another language. */
export async function ownBatch(
  batchId: string,
  userId: string,
  lang: Lang,
): Promise<(BatchStatus & { failures: { lineId: string; message: string }[] }) | null> {
  const { rows } = await queryAs<Row>(lang, `${SELECT} and b."id" = $3 group by b."id"`, [userId, lang, batchId]);
  if (!rows[0]) return null;
  const failed = await queryAs<{ lineId: string; error: string | null }>(
    lang,
    `select "lineId", "error" from "regeneration_job"
      where "batchId" = $1 and "state" = 'failed'
      order by "finishedAt" desc nulls last, "id" desc limit 100`,
    [batchId],
  );
  return {
    ...toStatus(rows[0]),
    failures: failed.rows.map((row) => ({ lineId: row.lineId, message: row.error ?? "" })),
  };
}
