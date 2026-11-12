/**
 * Runs once when a Next server process starts, before it serves a request: fills lib/lang.ts's
 * registry from the `language` table, so the synchronous isLang knows a language created at
 * runtime from the first request on.
 */
export async function register(): Promise<void> {
  // The edge runtime has no database driver, and `next build` runs as nodejs with no database.
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { loadLanguages } = await import("@/lib/languages/catalogue");
  try {
    await loadLanguages();
  } catch (error) {
    // A server that cannot reach the database still boots; the first request that asks reads again.
    console.error("could not load languages at startup:", error);
  }
}
