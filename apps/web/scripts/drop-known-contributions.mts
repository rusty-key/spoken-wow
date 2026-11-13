/**
 * Delete the untriaged quest contributions that say what the corpus already says.
 *
 *   cd apps/web
 *   DATABASE_URL=postgres://… npx tsx --conditions=react-server \
 *     scripts/drop-known-contributions.mts [--dry-run]
 *
 * Intake drops these itself now (lib/contributions/intake.ts); this is for the rows stored
 * before it did, and for rows a later import has caught up with. "Known" is lib/contributions/
 * known.ts's answer, the same one intake and the triage page use. Only rows still "new" are
 * touched: an accepted or rejected row is somebody's decision, and an accepted one may have
 * written the line it matches.
 *
 * DATABASE_URL is required and never read from .env, as for backfill-contribution-npcs.mts.
 * --dry-run reports what would go and deletes nothing.
 */
import { closeDb, db } from "@/lib/db";
import { lineStates } from "@/lib/contributions/known";
import { listContributions } from "@/lib/contributions/store";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is unset -- say which database to delete from.");
  process.exit(1);
}

const dryRun = process.argv.includes("--dry-run");

const rows = (await listContributions("new")).filter((row) => row.source === "quests");
const states = await lineStates(rows);

const known = rows.filter((_, index) => states[index].kind === "known");
const tally = new Map<string, { known: number; changed: number; missing: number }>();
for (const [index, row] of rows.entries()) {
  const counts = tally.get(row.locale) ?? { known: 0, changed: 0, missing: 0 };
  counts[states[index].kind] += 1;
  tally.set(row.locale, counts);
}

if (!dryRun && known.length > 0) {
  await db().query(`delete from "contribution" where "id" = any($1::int[]) and "status" = 'new'`, [
    known.map((row) => row.id),
  ]);
}

console.log(dryRun ? "dry run -- nothing deleted" : "done");
console.log(`  ${"locale".padEnd(8)} ${(dryRun ? "would drop" : "dropped").padStart(10)} ${"changed".padStart(8)} ${"missing".padStart(8)}`);
for (const [locale, counts] of [...tally].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(
    `  ${locale.padEnd(8)} ${String(counts.known).padStart(10)} ${String(counts.changed).padStart(8)} ${String(counts.missing).padStart(8)}`,
  );
}

await closeDb();
