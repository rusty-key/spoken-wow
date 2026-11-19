/**
 * Moves the release queue on by itself on the droplet: settles a run whose job finished and
 * starts the next queued one, which otherwise waits for someone to open a release page. Started
 * by generation/boot.ts beside storage upkeep, and runs in the process that leads, so the pm2
 * workers do not all ask.
 */
import "server-only";

import { every } from "@/lib/every";

import { syncActive } from "./sync";

export const TICK_MS = 15_000;

export function startReleaseTick(
  isLeader: () => boolean,
  sync: () => Promise<unknown> = () => syncActive(),
  everyMs = TICK_MS,
): { stop: () => void } {
  return every(everyMs, "releases: could not move the queue on:", async () => {
    if (isLeader()) await sync();
  });
}
