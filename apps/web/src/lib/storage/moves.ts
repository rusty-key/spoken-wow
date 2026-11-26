/**
 * Moving a team's archive objects from one bucket to another (docs/platform/STORAGE.md). Nothing is
 * deleted from the source: our bucket keeps everything it ever held, and a team's own is the
 * team's. Into a team bucket a move adds an archive_object row once the copy is there; into ours it
 * drops the source's row, so reads come home.
 *
 * The queue leader's upkeep advances every queued or running move by one chunk a round, in key
 * order from `cursor`, so a restart carries on where it stopped.
 */
import "server-only";

import { ALL_TEAMS, query, queryIn, TEAM_ROWS, withTeam, type TeamId } from "@/lib/db";
import { dropQuarantined, keepsOwnStorage, recordObject } from "@/lib/blobs/keep";
import { archive, readBounded, readsBlobs, sha256Of, type BlobStore } from "@/lib/blobs/store";
import { backendStore, markMissing, OBJECT_ROW, objectParams, split } from "@/lib/blobs/where";

import { StorageError } from "./backends";
import { errorText } from "./error-text";

type MoveState = "queued" | "running" | "done" | "failed" | "cancelled";

export type MoveView = {
  id: string;
  fromBackendId: string | null;
  toBackendId: string | null;
  /** The buckets' names when the move started; null for our archive. */
  fromLabel: string | null;
  toLabel: string | null;
  state: MoveState;
  total: number | null;
  copied: number;
  already: number;
  missing: number;
  lastError: string | null;
  createdAt: string;
  finishedAt: string | null;
};

type MoveRow = Omit<MoveView, "createdAt" | "finishedAt"> & {
  teamId: TeamId;
  cursor: string | null;
  createdAt: Date;
  finishedAt: Date | null;
};

const COLUMNS = `"id", "teamId", "fromBackendId", "toBackendId", "fromLabel", "toLabel", "state", "total", "copied", "already", "missing",
  "cursor", "lastError", "createdAt", "finishedAt"`;

const toView = ({ teamId: _team, cursor: _cursor, ...row }: MoveRow): MoveView => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  finishedAt: row.finishedAt?.toISOString() ?? null,
});

/** How many objects a round copies for each move. */
const CHUNK = 200;
const PARALLEL = 4;

/**
 * The team's objects in `from`, after `cursor` in key order, as a query. Ours means every object a
 * row of the team names that none of the team's own buckets holds a landed copy of: another team
 * holding the same bytes does not count.
 */
function objectsQuery(team: TeamId, from: string | null, cursor: string | null): { sql: string; params: unknown[] } {
  // Keys sort by prefix, then hash: the cursor splits the same way.
  const [afterPrefix, afterSha] = cursor ? cursor.split("/") : ["", ""];
  if (from) {
    return {
      sql: `select "prefix", "sha256" from "archive_object"
             where "backendId" = $1 and not "pending" and ("prefix", "sha256") > ($2, $3)`,
      params: [from, afterPrefix, afterSha],
    };
  }
  return {
    sql: `with "objects" ("prefix", "sha256") as (
            select 'takes', "sha256" from "take" where "teamId" = $1 and "sha256" is not null
            union
            select 'encodings', e."encodedSha256" from "take_encoding" e
              join "take" t on t."sha256" = e."sha256" and t."source" = e."source" where t."teamId" = $1
            union
            select 'encodings', unnest(p."encodedSha256s") from "take_pieces" p
              join "take" t on t."sha256" = p."sha256" and t."source" = p."source" where t."teamId" = $1
            union
            select 'recordings', "sha256" from "recording" where "teamId" = $1 and "sha256" is not null
            union
            select 'references', "sha256" from "fish_reference" where "teamId" = $1 and "sha256" is not null
            union
            select 'samples', "sha256" from "voice_sample" where "teamId" = $1
            union
            select 'designs', "sha256" from "voice_design_clip" where "teamId" = $1
          )
          select o."prefix", o."sha256" from "objects" o
           where (o."prefix", o."sha256") > ($2, $3)
             and not exists (
               select 1 from "archive_object" a
                where a."prefix" = o."prefix" and a."sha256" = o."sha256" and a."teamId" = $1
                 and not a."pending" and a."missingAt" is null)`,
    params: [team, afterPrefix, afterSha],
  };
}

async function objectsIn(team: TeamId, from: string | null, cursor: string | null, limit: number): Promise<string[]> {
  const { sql, params } = objectsQuery(team, from, cursor);
  const rows = await queryIn<{ prefix: string; sha256: string }>(
    team,
    `select "prefix", "sha256" from (${sql}) q order by "prefix", "sha256" limit ${Number(limit)}`,
    params,
  );
  return rows.map((row) => `${row.prefix}/${row.sha256}`);
}

async function countObjects(team: TeamId, from: string | null): Promise<number> {
  const { sql, params } = objectsQuery(team, from, null);
  const [{ n }] = await queryIn<{ n: number }>(team, `select count(*)::int as "n" from (${sql}) q`, params);
  return n;
}

const storeOf = (backendId: string | null): Promise<BlobStore> => (backendId ? backendStore(backendId) : Promise.resolve(archive()));

export async function listMoves(team: TeamId, limit = 5): Promise<MoveView[]> {
  const rows = await queryIn<MoveRow>(team, `select ${COLUMNS} from "storage_move" where ${TEAM_ROWS} order by "createdAt" desc limit $1`, [limit]);
  return rows.map(toView);
}

/** Queues a move. Into a team bucket only one that passed its test and is not retired. */
export async function startMove(team: TeamId, from: string | null, to: string | null, userId: string): Promise<MoveView> {
  if (from === to) throw new StorageError("A move goes from one bucket to another.");
  // The upkeep that runs moves only works once our archive is a bucket: a move queued before would
  // hold the team's one slot for good.
  if (!readsBlobs()) throw new StorageError("The site's archive is not a bucket yet (SPOKEN_ARCHIVE_STORE=r2), so nothing can be moved.", 409);
  if (to === null && (await keepsOwnStorage(team))) {
    throw new StorageError("Your team keeps its audio only in its own buckets, so nothing moves into Spoken's archive.", 409);
  }
  try {
    // One transaction, the buckets locked: a bucket cannot be removed between the check and the
    // insert, which would leave the move aimed at nothing (lib/storage/backends.ts removeBackend).
    return await withTeam(team, async (client) => {
      const { rows: ends } = await client.query<{ id: string; label: string; health: string; retiredAt: Date | null }>(
        `select "id", "label", "health", "retiredAt" from "storage_backend"
          where "id" = any($1::uuid[]) and ${TEAM_ROWS} for share`,
        [[from, to].filter(Boolean)],
      );
      for (const end of [from, to]) {
        if (end && !ends.some((row) => row.id === end)) throw new StorageError("No such bucket in this team.", 404);
      }
      const target = ends.find((row) => row.id === to);
      if (target && (target.health !== "ok" || target.retiredAt)) {
        throw new StorageError("Move only into a bucket that passed its test and is not retired.", 409);
      }
      const label = (id: string | null) => ends.find((row) => row.id === id)?.label ?? null;
      const { rows: [row] } = await client.query<MoveRow>(
        `insert into "storage_move" ("fromBackendId", "toBackendId", "fromLabel", "toLabel", "requestedBy")
         values ($1, $2, $3, $4, $5) returning ${COLUMNS}`,
        [from, to, label(from), label(to), userId],
      );
      return toView(row);
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new StorageError("A move is already running for this team.", 409);
    throw error;
  }
}

export async function cancelMove(team: TeamId, id: string): Promise<void> {
  const rows = await queryIn(
    team,
    `update "storage_move" set "state" = 'cancelled', "finishedAt" = now()
      where "id" = $1 and "state" in ('queued', 'running') and ${TEAM_ROWS} returning "id"`,
    [id],
  );
  if (rows.length === 0) throw new StorageError("No running move to stop.", 404);
}

type Outcome = "copied" | "already" | "missing";

/** Larger than any clip, recording or reference: a source answering more is not trusted to be ours. */
const MAX_OBJECT_BYTES = 100 * 1024 * 1024;
/** How long one object's body may take to arrive from the source. */
const READ_MS = 120_000;

async function moveOne(key: string, move: MoveRow, source: BlobStore, target: BlobStore): Promise<Outcome> {
  const { prefix, sha256 } = split(key);
  const object = await source.get(key);
  if (!object?.body) {
    await markMissing(key, move.fromBackendId);
    return "missing";
  }
  if (object.size > MAX_OBJECT_BYTES) {
    await object.body.cancel();
    throw new Error(`${key} is ${object.size} bytes in the source, more than any archive object`);
  }
  // Bounded in time too: a source that trickles its body would hold up every team's upkeep.
  const data = await readBounded(object.body, { maxBytes: MAX_OBJECT_BYTES, deadlineMs: READ_MS });
  if (sha256Of(data) !== sha256) throw new Error(`${key} does not match its hash in the source`);
  const there = await target.head(key);
  if (!there) await target.put(key, data, object.contentType);
  // A copy that was waiting in our quarantine for this bucket is landed by this one: drop ours.
  if (move.toBackendId) {
    if ((await recordObject(prefix, sha256, move.toBackendId, move.teamId, false)).was) await dropQuarantined(move.toBackendId, key);
  }
  // Into ours: the source's row goes, so reads find our copy. The team's bytes stay where they are.
  else await query(`delete from "archive_object" where ${OBJECT_ROW}`, objectParams(key, move.fromBackendId!));
  return there ? "already" : "copied";
}

/**
 * One chunk of one move. A target that refuses a write fails the move, with the reason; the
 * objects already moved stay moved, and a new move carries on from there.
 */
async function advanceMove(id: string, chunk = CHUNK): Promise<MoveState> {
  const [move] = await queryIn<MoveRow>(
    ALL_TEAMS,
    `update "storage_move" set "state" = 'running', "startedAt" = coalesce("startedAt", now())
      where "id" = $1 and "state" in ('queued', 'running') returning ${COLUMNS}`,
    [id],
  );
  if (!move) return "cancelled";
  // The team was made to keep its own storage after this move into ours was queued.
  if (move.toBackendId === null && (await keepsOwnStorage(move.teamId))) {
    await queryIn(
      ALL_TEAMS,
      `update "storage_move" set "state" = 'failed', "lastError" = $2, "finishedAt" = now() where "id" = $1 and "state" = 'running'`,
      [id, "The team now keeps its audio only in its own buckets, so nothing moves into Spoken's archive."],
    );
    return "failed";
  }
  if (move.total === null) {
    const total = await countObjects(move.teamId, move.fromBackendId);
    await queryIn(ALL_TEAMS, `update "storage_move" set "total" = $2 where "id" = $1`, [id, total]);
  }
  const keys = await objectsIn(move.teamId, move.fromBackendId, move.cursor, chunk);
  if (keys.length === 0) {
    await queryIn(ALL_TEAMS, `update "storage_move" set "state" = 'done', "finishedAt" = now() where "id" = $1 and "state" = 'running'`, [id]);
    return "done";
  }

  const [source, target] = await Promise.all([storeOf(move.fromBackendId), storeOf(move.toBackendId)]);
  const counts: Record<Outcome, number> = { copied: 0, already: 0, missing: 0 };
  let failure: string | null = null;
  // In order, PARALLEL at a time, so the cursor only passes keys that are done.
  let done = 0;
  for (; done < keys.length && !failure; done += PARALLEL) {
    const results = await Promise.allSettled(keys.slice(done, done + PARALLEL).map((key) => moveOne(key, move, source, target)));
    for (const result of results) {
      if (result.status === "fulfilled") counts[result.value]++;
      else failure ??= errorText(result.reason);
    }
  }
  const cursor = failure ? move.cursor : keys[keys.length - 1];
  await queryIn(
    ALL_TEAMS,
    `update "storage_move"
        set "copied" = "copied" + $2, "already" = "already" + $3, "missing" = "missing" + $4, "cursor" = $5,
            "state" = case when $6::text is null then "state" else 'failed' end,
            "lastError" = coalesce($6, "lastError"),
            "finishedAt" = case when $6::text is null then "finishedAt" else now() end
      where "id" = $1 and "state" = 'running'`,
    [id, counts.copied, counts.already, counts.missing, cursor, failure],
  );
  return failure ? "failed" : "running";
}

/** A chunk of every move waiting, for the upkeep round. */
export async function advanceMoves(): Promise<void> {
  const moves = await queryIn<{ id: string }>(ALL_TEAMS, `select "id" from "storage_move" where "state" in ('queued', 'running') order by "createdAt"`);
  for (const { id } of moves) {
    await advanceMove(id).catch(async (error) => {
      await queryIn(
        ALL_TEAMS,
        `update "storage_move" set "state" = 'failed', "lastError" = $2, "finishedAt" = now()
          where "id" = $1 and "state" in ('queued', 'running')`,
        [id, errorText(error)],
      );
    });
  }
}

/** For a test that cannot wait for the round: a move run to the end. */
export async function runMoveForTests(id: string, chunk = 3): Promise<MoveState> {
  let state: MoveState = "running";
  while (state === "running") state = await advanceMove(id, chunk);
  return state;
}

