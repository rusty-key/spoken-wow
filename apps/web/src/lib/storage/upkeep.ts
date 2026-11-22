/**
 * The storage work nobody waits on, run by whichever process leads the queue, so two pm2 workers
 * never do it twice: quarantined objects moved into their team's bucket, a chunk of every move
 * between buckets, and now and then a look for objects a team deleted. A round never overlaps the
 * last.
 */
import "server-only";

import { landQuarantined } from "@/lib/blobs/keep";
import { archiveMode } from "@/lib/blobs/store";
import { every } from "@/lib/every";

import { checkObjects } from "./checks";
import { advanceMoves } from "./moves";

/** `everyMs` spaces out a task that need not run every round. */
type UpkeepTask = { name: string; run: () => Promise<unknown>; everyMs?: number };

const TASKS: UpkeepTask[] = [
  { name: "land quarantined objects", run: () => landQuarantined() },
  { name: "move objects between buckets", run: advanceMoves },
  { name: "check team buckets for deleted objects", run: () => checkObjects(), everyMs: 15 * 60_000 },
];

const EVERY_MS = 60_000;

export function startStorageUpkeep(isLeader: () => boolean, tasks: UpkeepTask[] = TASKS): { stop: () => void } {
  const lastRun = new Map<string, number>();
  return every(EVERY_MS, "storage: an upkeep round failed:", async () => {
    if (!isLeader() || archiveMode() !== "r2") return;
    for (const task of tasks) {
      const last = lastRun.get(task.name);
      if (task.everyMs && last !== undefined && Date.now() - last < task.everyMs) continue;
      lastRun.set(task.name, Date.now());
      await task.run().catch((error) => console.error(`storage: ${task.name} failed:`, error));
    }
  });
}
