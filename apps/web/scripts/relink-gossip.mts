/**
 * Link gossip lines to BroadcastText ids by their text, and merge lines minted twice
 * (lib/broadcast/relink.ts). The site does this after every cache upload; this is for a run by
 * hand, after an import.
 *
 *   cd apps/web
 *   DATABASE_URL=postgres://… npx tsx --conditions=react-server scripts/relink-gossip.mts [--dry-run]
 *
 * DATABASE_URL is required and never read from .env, so the database is named on purpose.
 */
import { closeDb } from "@/lib/db";
import { relinkGossip } from "@/lib/broadcast/relink";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is unset -- say which database to relink.");
  process.exit(1);
}
const dryRun = process.argv.includes("--dry-run");
const { linked, merges } = await relinkGossip({ dryRun });
console.log(`${dryRun ? "would link" : "linked"} ${linked} lines by text`);
for (const [line, into] of merges) console.log(`${dryRun ? "would merge" : "merged"} ${line} into ${into}`);
await closeDb();
