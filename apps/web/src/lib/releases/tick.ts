/**
 * Moves the release queue on by itself on the droplet: settles a run whose job finished and
 * starts the next queued one, which otherwise waits for someone to open a release page.
 */
import "server-only";

import { runsOnDroplet } from "./droplet";
import { syncActive } from "./sync";

export const TICK_MS = 15_000;

const key = Symbol.for("spoken.releases.tick");
type Holder = { [key]?: { stop: () => void } };

/** Calls `sync` every `everyMs`, never over a call still running; a failure is logged and the next tick tries again. */
export function startReleaseTick(sync: () => Promise<unknown> = () => syncActive(), everyMs = TICK_MS): { stop: () => void } {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await sync();
    } catch (error) {
      console.error("releases: could not move the queue on:", error);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), everyMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}

/**
 * Starts the tick once per process, on the machine that runs the jobs; elsewhere GitHub runs
 * them and a release page's check is enough. Both pm2 workers tick: settling a run and claiming
 * the next are safe from two at once (store.ts applyUpdate, claimNext). Memoised on globalThis,
 * as dev re-evaluates modules on hot reload.
 */
export function ensureReleaseTick(): void {
  if (!runsOnDroplet()) return;
  const holder = globalThis as Holder;
  if (holder[key]) return;
  holder[key] = startReleaseTick();
}
