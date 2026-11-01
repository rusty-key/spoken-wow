/**
 * Keeps every worker's language-to-team memo honest. pm2 runs two workers, and a language
 * moved by one would otherwise be written by the other under its old team until the memo's
 * TTL ran out. Moving a language notifies; each process forgets its memo when it hears.
 * The TTL stays as the backstop for a notification missed while reconnecting.
 */
import "server-only";

import { Client } from "pg";

import { connectionOptions } from "@/lib/db";

import { forgetTeams } from "./store";

const CHANNEL = "spoken_team_language";
const RETRY_MS = 5_000;

let client: Client | undefined;
let retry: NodeJS.Timeout | undefined;
let stopped = true;

/** Starts the listener once per process; later calls do nothing. Never throws. */
export function listenForTeamChanges(): void {
  if (!stopped) return;
  stopped = false;
  void connect();
}

/** Under Vitest only a test that asks for the listener gets one; `next build` has no database. */
export function listenUnlessTesting(): void {
  if (process.env.VITEST || process.env.NEXT_PHASE === "phase-production-build") return;
  listenForTeamChanges();
}

async function connect(): Promise<void> {
  const own = new Client(connectionOptions());
  client = own;
  own.on("notification", (message) => {
    if (message.channel === CHANNEL) forgetTeams();
  });
  own.on("error", (error) => fail(own, error));
  try {
    await own.connect();
    await own.query(`LISTEN ${CHANNEL}`);
  } catch (error) {
    fail(own, error);
  }
}

function fail(own: Client, error: unknown): void {
  if (client !== own) return;
  console.error("team listener failed, retrying in 5 s:", error);
  client = undefined;
  own.end().catch(() => {});
  if (stopped) return;
  retry = setTimeout(() => void connect(), RETRY_MS);
  // A retry timer alone must not keep a process alive.
  retry.unref();
}

/** For tests: closes the connection and cancels a pending retry. */
export async function stopListening(): Promise<void> {
  stopped = true;
  clearTimeout(retry);
  const own = client;
  client = undefined;
  await own?.end().catch(() => {});
}
