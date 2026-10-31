/**
 * Start the regeneration queue on first use.
 *
 * WHY NOT instrumentation.ts, which is the obvious home for this. Next compiles that file
 * for the edge runtime as well as for node, and does it whether or not the app has any edge
 * code - this one has none. The NEXT_RUNTIME guard inside register() stops the code running
 * there, but not being bundled, so webpack's dev compiler has to resolve the whole server
 * graph for a runtime that will never execute it: pg's optional native binding first, then
 * fs, path, stream, and finally our own modules reaching node:crypto. `next dev` answers
 * 500 and no next.config.ts setting fixes it, because the problem is the compile happening
 * at all. `next build` never hits this: it only produces an edge compile when the app
 * actually contains edge code, so production was always fine.
 *
 * The cost of this file existing instead: the queue no longer resumes the moment a process
 * boots. It resumes when something calls in. In practice that is an admin opening the
 * explorer, because Explorer polls /api/regenerate/queue every fifteen seconds for anyone
 * who can regenerate - so a batch interrupted by a deploy restarts within seconds of someone
 * who cares about it looking at the page, and sits idle until then. That trade was made
 * deliberately; deploy/README.md records the two ways back out of it.
 *
 * Idempotent and memoised on globalThis, because the dev server re-evaluates modules on hot
 * reload and a fresh leader per reload would contend with the one already holding the lock.
 */
import type { Worker } from "./worker";

import { inTransaction } from "@/lib/db";
import { adoptEveryLang, forgetTeams } from "@/lib/teams/store";

import { startLeader, type Leader } from "./leader";
import { startWorker } from "./worker";

const key = Symbol.for("wow-voiceover.queue-boot");
type Holder = { [key]?: { leader: Leader; worker: Worker } };

/** The running worker, for the enqueue route to nudge. Null before the first call. */
export function queueWorker(): Worker | null {
  return (globalThis as Holder)[key]?.worker ?? null;
}

/**
 * Make sure this process is contending for the queue.
 *
 * Safe to call on every request: after the first it is a property read.
 */
export function ensureQueueRunning(): void {
  const holder = globalThis as Holder;
  if (holder[key]) return;

  // Here because this is the once-per-process start the app has (see the top of the file). A
  // failure is logged and left: the queue must start whether or not the seeding could.
  void inTransaction(adoptEveryLang)
    .then(forgetTeams)
    .catch((error) => console.error("teams: could not give every language a team", error));

  const leader = startLeader();
  const worker = startWorker(leader.held);
  holder[key] = { leader, worker };

  /**
   * Stand down cleanly.
   *
   * The in-flight requests are awaited rather than abandoned - they are already at
   * ElevenLabs and will be billed - and the lock is released only afterwards, so during a
   * `pm2 reload` the incoming worker waits rather than draining alongside this one.
   *
   * Two settings in deploy/ecosystem.config.js are what make that true rather than merely
   * intended, and it is not true without them:
   *
   * `NEXT_MANUAL_SIG_HANDLE: "1"`, because Next installs its own SIGTERM handler that ends
   * in process.exit(0). Nothing coordinates two handlers, so whichever finished first would
   * exit the process out from under this one, mid-generation. The variable tells Next not to
   * install its, at the cost that nothing closes the HTTP server first: requests in flight
   * when this exits are cut rather than drained.
   *
   * `kill_timeout: 30000`, because pm2's default is 1600 ms - shorter than a single
   * ElevenLabs call, so without it every reload SIGKILLs mid-generation and the handover
   * degrades to lease reclaim.
   */
  let shuttingDown = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      void (async () => {
        await worker.stop().catch(() => {});
        await leader.stop().catch(() => {});
        process.exit(0);
      })();
    });
  }
}
