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

import { ALL_TEAMS, query, queryIn, TEAM_ROWS, type TeamId } from "@/lib/db";
import { recordObject } from "@/lib/blobs/keep";
import { archive, blobKey, sha256Of, type BlobPrefix, type BlobStore } from "@/lib/blobs/store";
import { backendStore } from "@/lib/blobs/where";

import { StorageError } from "./backends";

export type MoveState = "queued" | "running" | "done" | "failed" | "cancelled";

export type MoveView = {
  id: string;
  fromBackendId: string | null;
  toBackendId: string | null;
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

const COLUMNS = `"id", "teamId", "fromBackendId", "toBackendId", "state", "total", "copied", "already", "missing",
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
 * The team's objects in `from`, after `cursor` in key order. Ours means every object a row of the
 * team names that no team bucket holds a landed copy of.
 */
async function objectsIn(team: TeamId, from: string | null, cursor: string | null, limit: number | null): Promise<string[]> {
  // Keys sort by prefix, then hash: the cursor splits the same way.
  const [afterPrefix, afterSha] = cursor ? cursor.split("/") : ["", ""];
  const limited = limit === null ? "" : `limit ${Number(limit)}`;
  const rows = from
    ? await queryIn<{ prefix: string; sha256: string }>(
        team,
        `select "prefix", "sha256" from "archive_object"
          where "backendId" = $1 and not "pending" and ("prefix", "sha256") > ($2, $3)
          order by "prefix", "sha256" ${limited}`,
        [from, afterPrefix, afterSha],
      )
    : await queryIn<{ prefix: string; sha256: string }>(
        team,
        `with "objects" ("prefix", "sha256") as (
           select 'takes', "sha256" from "take" where "teamId" = $1 and "sha256" is not null
           union
           select 'encodings', e."encodedSha256" from "take_encoding" e
             join "take" t on t."sha256" = e."sha256" and t."source" = e."source" where t."teamId" = $1
           union
           select 'recordings', "sha256" from "recording" where "teamId" = $1 and "sha256" is not null
           union
           select 'references', "sha256" from "fish_reference" where "teamId" = $1 and "sha256" is not null
           union
           select 'samples', "sha256" from "voice_sample" where "teamId" = $1
         )
         select o."prefix", o."sha256" from "objects" o
          where (o."prefix", o."sha256") > ($2, $3)
            and not exists (
              select 1 from "archive_object" a
               where a."prefix" = o."prefix" and a."sha256" = o."sha256" and not a."pending" and a."missingAt" is null)
          order by o."prefix", o."sha256" ${limited}`,
        [team, afterPrefix, afterSha],
      );
  return rows.map((row) => `${row.prefix}/${row.sha256}`);
}

const storeOf = (backendId: string | null): Promise<BlobStore> => (backendId ? backendStore(backendId) : Promise.resolve(archive()));

export async function listMoves(team: TeamId, limit = 5): Promise<MoveView[]> {
  const rows = await queryIn<MoveRow>(team, `select ${COLUMNS} from "storage_move" where ${TEAM_ROWS} order by "createdAt" desc limit $1`, [limit]);
  return rows.map(toView);
}

/** Queues a move. Into a team bucket only one that passed its test and is not retired. */
export async function startMove(team: TeamId, from: string | null, to: string | null, userId: string): Promise<MoveView> {
  if (from === to) throw new StorageError("A move goes from one bucket to another.");
  const ends = await queryIn<{ id: string; health: string; retiredAt: Date | null }>(
    team,
    `select "id", "health", "retiredAt" from "storage_backend" where "id" = any($1::uuid[]) and ${TEAM_ROWS}`,
    [[from, to].filter(Boolean)],
  );
  for (const end of [from, to]) {
    if (end && !ends.some((row) => row.id === end)) throw new StorageError("No such bucket in this team.", 404);
  }
  const target = ends.find((row) => row.id === to);
  if (target && (target.health !== "ok" || target.retiredAt)) {
    throw new StorageError("Move only into a bucket that passed its test and is not retired.", 409);
  }
  try {
    const [row] = await queryIn<MoveRow>(
      team,
      `insert into "storage_move" ("fromBackendId", "toBackendId", "requestedBy") values ($1, $2, $3) returning ${COLUMNS}`,
      [from, to, userId],
    );
    return toView(row);
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

async function moveOne(key: string, move: MoveRow, source: BlobStore, target: BlobStore): Promise<Outcome> {
  const slash = key.indexOf("/");
  const prefix = key.slice(0, slash) as BlobPrefix;
  const sha256 = key.slice(slash + 1);
  const object = await source.get(blobKey(prefix, sha256));
  if (!object?.body) {
    if (move.fromBackendId) {
      await query(
        `update "archive_object" set "missingAt" = now() where "prefix" = $1 and "sha256" = $2 and "backendId" = $3`,
        [prefix, sha256, move.fromBackendId],
      );
    }
    return "missing";
  }
  const data = Buffer.from(await new Response(object.body).arrayBuffer());
  if (sha256Of(data) !== sha256) throw new Error(`${key} does not match its hash in the source`);
  const there = await target.head(key);
  if (!there) await target.put(key, data, object.contentType);
  if (move.toBackendId) await recordObject(prefix, sha256, move.toBackendId, false);
  // Into ours: the source's row goes, so reads find our copy. The team's bytes stay where they are.
  else await query(`delete from "archive_object" where "prefix" = $1 and "sha256" = $2 and "backendId" = $3`, [prefix, sha256, move.fromBackendId]);
  return there ? "already" : "copied";
}

/**
 * One chunk of one move. A target that refuses a write fails the move, with the reason; the
 * objects already moved stay moved, and a new move carries on from there.
 */
export async function advanceMove(id: string, chunk = CHUNK): Promise<MoveState> {
  const [move] = await queryIn<MoveRow>(
    ALL_TEAMS,
    `update "storage_move" set "state" = 'running', "startedAt" = coalesce("startedAt", now())
      where "id" = $1 and "state" in ('queued', 'running') returning ${COLUMNS}`,
    [id],
  );
  if (!move) return "cancelled";
  if (move.total === null) {
    const all = await objectsIn(move.teamId, move.fromBackendId, null, null);
    await queryIn(ALL_TEAMS, `update "storage_move" set "total" = $2 where "id" = $1`, [id, all.length]);
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
      else failure ??= result.reason instanceof Error ? result.reason.message : String(result.reason);
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
    [id, counts.copied, counts.already, counts.missing, cursor, failure?.slice(0, 300) ?? null],
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
        `update "storage_move" set "state" = 'failed', "lastError" = $2, "finishedAt" = now() where "id" = $1`,
        [id, (error instanceof Error ? error.message : String(error)).slice(0, 300)],
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

