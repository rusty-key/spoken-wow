/**
 * The one Postgres pool.
 *
 * Shared rather than one per module: pm2 runs two workers, so every additional pool is
 * another set of idle connections against a database that only holds accounts, roles and
 * voice provenance.
 *
 * `new Pool()` does not open a connection until the first query, so importing this during
 * `next build` does not need a reachable database.
 */
import { Pool, type PoolClient, type QueryResultRow } from "pg";

/** "team"."id". Defined here so withTeam need not import the teams module. */
export type TeamId = string;

/**
 * How many connections one process may hold.
 *
 * Sized rather than left at node-postgres' default of 10, because the regeneration queue
 * holds two clients per job in flight - the per-file advisory lock in lock.ts across the
 * whole ElevenLabs call, and a second one for commitTake's transaction inside it -
 * plus one the leader never returns. At the default, a batch wide enough fills the pool with
 * its own held clients and then waits forever for the commits that would free them.
 *
 * Thirty against a Postgres with max_connections = 100 and two pm2 cluster workers: sixty in
 * the worst case where both workers are saturated, leaving room for psql, a migration and the
 * odd one-off process. Raising this without also re-reading max_connections is how a deploy
 * starts failing on "too many clients".
 */
export const POOL_MAX = 30;

/**
 * How long a query waits for a free connection before giving up.
 *
 * node-postgres waits forever by default, which turns pool exhaustion into a process that
 * accepts requests and answers none of them - including the one that would stop the queue.
 * Ten seconds is longer than any statement this app runs, so reaching it means the pool is
 * exhausted, and an error that names that is worth far more than a hang.
 */
export const POOL_CONNECTION_TIMEOUT_MS = 10_000;

const poolKey = Symbol.for("wow-voiceover.pool");
type PoolHolder = { [poolKey]?: Pool };

/** Where and as whom to connect, for the pool and for connections of their own (the team listener). */
export function connectionOptions(): { connectionString?: string; options?: string } {
  return {
    connectionString: process.env.DATABASE_URL,
    // Lets tests and CI act as the unprivileged app role, so row-level security applies to them.
    ...(process.env.DATABASE_ROLE ? { options: `-c role=${process.env.DATABASE_ROLE}` } : {}),
  };
}

export function db(): Pool {
  const holder = globalThis as PoolHolder;
  // Memoised on globalThis because the dev server re-evaluates modules on hot reload, and
  // a fresh pool per reload leaks connections until Postgres refuses new ones.
  if (!holder[poolKey]) {
    holder[poolKey] = new Pool({
      ...connectionOptions(),
      max: POOL_MAX,
      connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
    });
  }
  return holder[poolKey]!;
}

/**
 * One query, rows only.
 *
 * Most of this app reaches for db().query directly, because it wants the result object -
 * rowCount is what several statements are checked by. This is for the modules where the
 * rows are the whole answer, and it exists so code moved here from the zones app keeps
 * reading the way it did rather than growing a `.rows` at every call site.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await db().query<T>(text, params);
  return result.rows;
}

/** `work` in one transaction on one client: committed when it returns, rolled back when it throws. */
export async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    // Its own failure (a dropped connection) would hide the error that matters.
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** The team value for system work that legitimately spans teams: the queue leader's claim, owner views. */
export const ALL_TEAMS = "*";

/**
 * `work` in a transaction that acts as `team`. The setting is transaction-local, so it cannot
 * leak onto the next user of the pooled connection. Row-level security policies read it.
 */
export async function withTeam<T>(
  team: TeamId | typeof ALL_TEAMS,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return inTransaction(async (client) => {
    await actAs(client, team);
    return work(client);
  });
}

/**
 * Act as `team` for the rest of `client`'s open transaction, for one opened by hand that learns
 * its team from a row it locks. Transaction-local too, so it ends with the commit or rollback.
 */
export async function actAs(client: Pick<PoolClient, "query">, team: TeamId | typeof ALL_TEAMS): Promise<void> {
  await client.query(`select set_config('spoken.team', $1, true)`, [team]);
}

/**
 * Rows of the team this transaction acts as, or every team under ALL_TEAMS, for the tables that
 * keep one copy per team. Row-level security draws the same line; this keeps the read right on
 * a connection it does not bind, and matches nothing outside withTeam.
 */
export const TEAM_ROWS = `"teamId" in (select "id" from "team" where current_setting('spoken.team', true) in ('*', "id"::text))`;

/** One query, rows only, as `team`. */
export async function queryIn<T extends QueryResultRow = QueryResultRow>(
  team: TeamId | typeof ALL_TEAMS,
  text: string,
  params?: unknown[],
): Promise<T[]> {
  return withTeam(team, async (client) => (await client.query<T>(text, params)).rows);
}

const hooksKey = Symbol.for("wow-voiceover.close-hooks");
type HooksHolder = { [hooksKey]?: Set<() => Promise<void>> };

/** On globalThis like the pool: a script run by tsx can load this module twice, ESM and CJS. */
function closeHooks(): Set<() => Promise<void>> {
  const holder = globalThis as HooksHolder;
  return (holder[hooksKey] ??= new Set());
}

/**
 * Something closeDb also closes: a connection of a module's own, like the team listener, which
 * this module cannot import without a cycle.
 */
export function onCloseDb(hook: () => Promise<void>): void {
  closeHooks().add(hook);
}

/**
 * Close the pool, and every connection registered with onCloseDb, and forget the pool, so the next db() builds a fresh one.
 *
 * For tests. Ending the pool without clearing the memo leaves a closed pool on globalThis,
 * and vitest reuses workers between files - so one test file finishing would break the next
 * one to run in that worker, as an intermittent "Cannot use a pool after calling end".
 */
export async function closeDb(): Promise<void> {
  await Promise.all([...closeHooks()].map((hook) => hook()));
  const holder = globalThis as PoolHolder;
  const pool = holder[poolKey];
  if (!pool) return;
  delete holder[poolKey];
  await pool.end();
}
