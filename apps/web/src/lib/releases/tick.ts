/**
 * Moves the release queue on by itself on the droplet: settles a run whose job finished and
 * starts the next queued one, which otherwise waits for someone to open a release page. Started
 * at boot (instrumentation-node.ts) in one pm2 worker, so the workers do not all ask; a second
 * asking would be harmless (store.ts claimNext and applyUpdate take one winner), only wasted.
 * Apart from the regeneration queue, which starts in whichever worker is first asked for it.
 */
import "server-only";

import { every } from "@/lib/every";
import { onShutdown } from "@/lib/shutdown";

import { runsOnDroplet } from "./droplet";
import { syncActive } from "./sync";

export const TICK_MS = 15_000;

export function startReleaseTick(
  sync: () => Promise<unknown> = () => syncActive(),
  everyMs = TICK_MS,
): { stop: (waitMs?: number) => Promise<void> } {
  return every(everyMs, "releases: could not move the queue on:", sync);
}

/**
 * Whether this process ticks: on the machine that runs the jobs (elsewhere GitHub runs them, and
 * a release page's check is enough), in pm2's first worker, or in a process pm2 numbers not.
 */
export function ticksHere(env: Partial<NodeJS.ProcessEnv> = process.env): boolean {
  return runsOnDroplet() && (env.NODE_APP_INSTANCE ?? "0") === "0";
}

const key = Symbol.for("spoken.releases.tick");
type Holder = { [key]?: { stop: (waitMs?: number) => Promise<void> } };

/**
 * Starts the tick once, in the process that ticks. A reload waits for a round still running, so
 * a run the round claimed gets its job before the process exits. Memoised on globalThis, as dev
 * re-evaluates modules on hot reload.
 */
export function ensureReleaseTick(): void {
  if (!ticksHere()) return;
  const holder = globalThis as Holder;
  if (holder[key]) return;
  const tick = startReleaseTick();
  holder[key] = tick;
  onShutdown(() => tick.stop());
}
