/**
 * One database per test worker, cloned from the one DATABASE_URL names.
 *
 * The suite ran one file at a time because the queue tests claim from a real, shared table:
 * claiming is global, so files running side by side took each other's jobs. A worker of its
 * own database has nobody to race, and loading 370 files in series was most of the run.
 *
 * Cloning needs CREATEDB. A role without it (the local development one) keeps the old
 * arrangement: one worker, on the database it names.
 */
import os from "node:os";
import type { TestProject } from "vitest/node";
import { Client } from "pg";

/** Above this the clones cost more than the workers save on a CI runner's four cores. */
const MOST_WORKERS = 8;

export function cloneName(base: string, worker: number): string {
  return `${base}_w${worker}`;
}

export function workerUrl(url: string, worker: number): string {
  const parsed = new URL(url);
  parsed.pathname = `/${cloneName(decodeURIComponent(parsed.pathname.slice(1)), worker)}`;
  return parsed.toString();
}

async function canClone(url: string): Promise<boolean> {
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    const { rows } = await client.query<{ ok: boolean }>(
      `select "rolcreatedb" or "rolsuper" as "ok" from "pg_roles" where "rolname" = current_user`,
    );
    return rows[0]?.ok ?? false;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

/** How many workers the run gets: one unless every worker can have a database of its own. */
export async function workerCount(url: string | undefined): Promise<number> {
  if (!url || !(await canClone(url))) return 1;
  return Math.max(1, Math.min(MOST_WORKERS, os.availableParallelism() - 1));
}

/**
 * Connects to a database other than the one cloned, since Postgres refuses to copy a database
 * anyone is connected to. CI's is `postgres` itself.
 */
async function admin(url: string, base: string): Promise<Client> {
  const parsed = new URL(url);
  parsed.pathname = base === "postgres" ? "/template1" : "/postgres";
  const client = new Client({ connectionString: parsed.toString() });
  await client.connect();
  return client;
}

export default async function setup(project: TestProject) {
  const workers = project.config.maxWorkers;
  const url = process.env.DATABASE_URL ?? project.config.env?.DATABASE_URL;
  if (!url || !project.config.fileParallelism || workers < 2) return;

  const base = decodeURIComponent(new URL(url).pathname.slice(1));
  const client = await admin(url, base);
  const ident = (name: string) => client.escapeIdentifier(name);
  const dropAll = async () => {
    for (let worker = 1; worker <= workers; worker++) {
      await client.query(`drop database if exists ${ident(cloneName(base, worker))} with (force)`);
    }
  };
  try {
    await dropAll();
    for (let worker = 1; worker <= workers; worker++) {
      await client.query(`create database ${ident(cloneName(base, worker))} template ${ident(base)}`);
    }
  } catch (error) {
    await client.end().catch(() => {});
    throw error;
  }
  return async () => {
    try {
      await dropAll();
    } finally {
      await client.end();
    }
  };
}
