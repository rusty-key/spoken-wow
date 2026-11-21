/**
 * pm2 runs two workers, so a language one moves would be written by the other under its old team
 * until the memo's TTL ran out, and a language one creates would be unknown to the other. Each
 * process forgets its memos on a notification and on every (re)connect; the TTLs backstop a lost
 * notification. One connection listens on every channel.
 */
import "server-only";

import { Client } from "pg";

import { connectionOptions, onCloseDb } from "@/lib/db";

const RETRY_MS = 5_000;

/**
 * On globalThis for the reason lib/lang.ts's registry is: Next loads this module once per bundle
 * layer, and each copy would open its own connection and miss the others' channels.
 */
const stateKey = Symbol.for("spoken.teams.listen");
type State = {
  /** What each channel's notification does; also run on every (re)connect, for what was missed. */
  channels: Map<string, () => void>;
  client?: Client;
  /** The client once it LISTENs on every channel then registered; a later one LISTENs on it directly. */
  live?: Client;
  retry?: NodeJS.Timeout;
  stopped: boolean;
};
type StateHolder = { [stateKey]?: State };
const state: State = ((globalThis as StateHolder)[stateKey] ??= { channels: new Map(), stopped: true });
const CHANNELS = state.channels;

/** Once per process; never throws. */
export function listenForTeamChanges(): void {
  if (!state.stopped) return;
  state.stopped = false;
  void connect();
}

/**
 * Runs `onChange` on each notification on `channel` and on every (re)connect. Registers in any
 * process, but only the Next server starts listening: a script would never exit with the
 * connection open, and a test asks for the listener itself. `next build` runs as nodejs too but
 * has no database.
 */
export function listenInServer(channel: string, onChange: () => void): void {
  const added = !CHANNELS.has(channel);
  CHANNELS.set(channel, onChange);
  if (added && state.live) listenOn(state.live, channel);
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  listenForTeamChanges();
}

async function connect(): Promise<void> {
  const own = new Client(connectionOptions());
  state.client = own;
  own.on("notification", (message) => {
    CHANNELS.get(message.channel)?.();
  });
  own.on("error", (error) => fail(own, error));
  try {
    await own.connect();
    // Also visits a channel registered while this awaits.
    for (const channel of CHANNELS.keys()) await own.query(`LISTEN ${channel}`);
    if (state.client !== own) return;
    state.live = own;
    // A change made before this, while nothing listened, would otherwise wait out the TTL.
    for (const onChange of CHANNELS.values()) onChange();
  } catch (error) {
    fail(own, error);
  }
}

/**
 * The caller's read can land between its SELECT and this LISTEN, and a change committed there
 * is never notified, so the handler runs once the LISTEN holds.
 */
function listenOn(own: Client, channel: string): void {
  own
    .query(`LISTEN ${channel}`)
    .then(() => {
      if (state.live === own) CHANNELS.get(channel)?.();
    })
    .catch((error) => fail(own, error));
}

function fail(own: Client, error: unknown): void {
  if (state.client !== own) return;
  console.error("change listener failed, retrying in 5 s:", error);
  state.client = undefined;
  state.live = undefined;
  own.end().catch(() => {});
  if (state.stopped) return;
  state.retry = setTimeout(() => void connect(), RETRY_MS);
  // A retry timer alone must not keep a process alive.
  state.retry.unref();
}

export async function stopListening(): Promise<void> {
  state.stopped = true;
  clearTimeout(state.retry);
  const own = state.client;
  state.client = undefined;
  state.live = undefined;
  await own?.end().catch(() => {});
}

onCloseDb(stopListening);
