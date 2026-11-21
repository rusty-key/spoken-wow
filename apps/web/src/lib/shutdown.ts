/**
 * What this process finishes before it exits on SIGINT or SIGTERM: the regeneration queue
 * (generation/boot.ts) and the release tick (releases/tick.ts), each registered by whichever
 * starts. One handler for them all, because each handler would end in process.exit and the
 * first to finish would cut the others short. deploy/web/ecosystem.config.js sets
 * NEXT_MANUAL_SIG_HANDLE so Next installs none of its own, and kill_timeout so pm2 waits.
 *
 * Memoised on globalThis, as dev re-evaluates modules on hot reload.
 */
import "server-only";

const key = Symbol.for("spoken.shutdown");
type Holder = { [key]?: { stops: Set<() => Promise<unknown>>; ending: Promise<void> | null } };

function registry() {
  const holder = globalThis as Holder;
  if (!holder[key]) {
    const state: NonNullable<Holder[typeof key]> = { stops: new Set(), ending: null };
    holder[key] = state;
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.on(signal, () => void shutDown().then(() => process.exit(0)));
    }
  }
  return holder[key];
}

/** Runs `stop` before the process exits on a signal, beside every other one registered. */
export function onShutdown(stop: () => Promise<unknown>): void {
  registry().stops.add(stop);
}

/** Every registered stop, at once; a second signal waits on the same. */
export function shutDown(): Promise<void> {
  const state = registry();
  state.ending ??= Promise.allSettled([...state.stops].map((stop) => stop())).then(() => {});
  return state.ending;
}
