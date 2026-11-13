/**
 * Runs once when a Next server process starts, before it serves a request: fills lib/lang.ts's
 * registry from the `language` table, so the synchronous isLang knows a language created at
 * runtime from the first request on.
 *
 * The import sits inside `if (process.env.NEXT_RUNTIME === "nodejs")` and nowhere else: Next
 * also compiles this file for the edge runtime, and only that exact condition lets the bundler
 * drop the import there. An early return does not, and the edge build then fails on pg's `fs`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loadLanguagesAtBoot } = await import("./instrumentation-node");
    await loadLanguagesAtBoot();
  }
}
