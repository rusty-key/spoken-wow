/**
 * The storage work nobody waits on, run by whichever process leads the queue, so two pm2 workers
 * never do it twice: quarantined objects moved into their team's bucket. A round never overlaps
 * the last.
 */
import "server-only";

import { landQuarantined } from "@/lib/blobs/keep";
import { archiveMode } from "@/lib/blobs/store";

export type UpkeepTask = { name: string; run: () => Promise<unknown> };

const TASKS: UpkeepTask[] = [{ name: "land quarantined objects", run: () => landQuarantined() }];

const EVERY_MS = 60_000;

export function startStorageUpkeep(isLeader: () => boolean, tasks: UpkeepTask[] = TASKS): { stop: () => void } {
  let busy = false;
  const round = async () => {
    if (busy || !isLeader() || archiveMode() !== "r2") return;
    busy = true;
    try {
      for (const task of tasks) {
        await task.run().catch((error) => console.error(`storage: ${task.name} failed:`, error));
      }
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void round(), EVERY_MS);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
