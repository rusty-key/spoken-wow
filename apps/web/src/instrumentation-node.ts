import { loadLanguages } from "@/lib/languages/catalogue";
import { ensureReleaseTick } from "@/lib/releases/tick";

/** The Node half of instrumentation.ts. */
export async function loadLanguagesAtBoot(): Promise<void> {
  // `next build` runs as nodejs too, with no database.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  try {
    await loadLanguages();
  } catch (error) {
    // A server that cannot reach the database still boots; the first request that asks reads again.
    console.error("could not load languages at startup:", error);
  }
}

/** On the droplet, the release queue moves on without a release page open (lib/releases/tick.ts). */
export function startReleaseTickAtBoot(): void {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  ensureReleaseTick();
}
