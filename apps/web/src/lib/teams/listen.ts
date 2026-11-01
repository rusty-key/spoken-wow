/**
 * pm2 runs two workers, so a language one moves would be written by the other under its old team
 * until the memo's TTL ran out. Each process forgets its memo on the move's notification and on
 * every (re)connect; the TTL backstops a lost notification.
 */
import "server-only";

import { Client } from "pg";

import { connectionOptions, onCloseDb } from "@/lib/db";

import { forgetTeams } from "./store";

const CHANNEL = "spoken_team_language";
const RETRY_MS = 5_000;

let client: Client | undefined;
let retry: NodeJS.Timeout | undefined;
let stopped = true;

/** Once per process; never throws. */
export function listenForTeamChanges(): void {
  if (!stopped) return;
  stopped = false;
  void connect();
}

/**
 * Only the Next server listens: a script would never exit with the connection open, and a test
 * asks for the listener itself. `next build` runs as nodejs too but has no database.
 */
export function listenInServer(): void {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
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
    // A move made before this, while nothing listened, would otherwise wait out the TTL.
    forgetTeams();
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

export async function stopListening(): Promise<void> {
  stopped = true;
  clearTimeout(retry);
  const own = client;
  client = undefined;
  await own?.end().catch(() => {});
}

onCloseDb(stopListening);
