/**
 * Write restored stage directions into line_override.
 *
 * The companion to tools/restore_stage_directions.py, which computes the text and writes
 * nothing. This puts it in Postgres, as overrides rather than as a corpus change: an override
 * is exactly "what a line should say instead of what the corpus says it says" (migration
 * 0012), it is keyed on the file like the regeneration queue, and clearing a row undoes it.
 *
 * Writing a row does not generate anything. It makes the line's live audio *stale* - the take
 * predates the text - which is what turns this into a worklist rather than a fait accompli.
 *
 * Dry run by default. Nothing is written without --write.
 *
 *   cd web && node scripts/apply-overrides.mjs /tmp/restored.json          # says what it would do
 *   cd web && node scripts/apply-overrides.mjs /tmp/restored.json --write  # does it
 *
 * It lives under web/ rather than tools/ because `pg` is a web dependency and this is the
 * app's database; from tools/ the import does not resolve.
 *
 * DATABASE_URL decides which database, so pointing it at the droplet is a deliberate act.
 * Run it against a local database first and listen to a line before doing that.
 */
import fs from "node:fs";
import path from "node:path";

import pg from "pg";

const INVALID_CHARS = "$<>";
/** Capitalised spans only, mirroring web/src/lib/text-gate.ts. */
const DIRECTION = /<[A-Z][^<>]*>/g;

function unvoiceable(text) {
  const spoken = text.replace(DIRECTION, "");
  return [...INVALID_CHARS].some((character) => spoken.includes(character));
}

async function main() {
  const [artifact, ...flags] = process.argv.slice(2);
  const write = flags.includes("--write");

  if (!artifact) {
    console.error("usage: node scripts/apply-overrides.mjs <restored.json> [--write]");
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set");
    process.exit(2);
  }

  const entries = JSON.parse(fs.readFileSync(path.resolve(artifact), "utf8"));

  // The same gate the app applies, so a row that would leave a line unvoiceable never lands.
  // Nothing in the artifact should fail this; if one does, the generator changed under it.
  const refused = entries.filter((entry) => unvoiceable(entry.text));
  if (refused.length) {
    console.error(`refusing ${refused.length} entries whose text is still unvoiceable:`);
    for (const entry of refused.slice(0, 5)) console.error(`  ${entry.file}  ${entry.lineId}`);
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const { rows: existing } = await pool.query(
      `select "file" from "line_override" where "file" = any($1::text[])`,
      [entries.map((entry) => entry.file)],
    );
    const held = new Set(existing.map((row) => row.file));

    // Never overwrite a hand-written override: someone decided what that line should say, and
    // this script's opinion is only that a direction was missing.
    const fresh = entries.filter((entry) => !held.has(entry.file));

    console.log(`${entries.length} restorable, ${held.size} already overridden, ${fresh.length} to write`);

    if (!write) {
      console.log("\ndry run. Sample of what would be written:\n");
      for (const entry of fresh.slice(0, 3)) {
        console.log(`  ${entry.file}  (${entry.npcName})`);
        console.log(`    now:  ${JSON.stringify(entry.was.slice(0, 100))}`);
        console.log(`    then: ${JSON.stringify(entry.text.slice(0, 100))}\n`);
      }
      console.log("pass --write to apply");
      return;
    }

    let written = 0;
    for (const entry of fresh) {
      await pool.query(
        // English's text, so the english team's override. The script sets no team, so it names it.
        `insert into "line_override" ("teamId", "file", "lineId", "text", "updatedBy")
         values ((select "teamId" from "team_language" where "lang" = 'enUS' and "privileged"), $1, $2, $3, null)
         on conflict ("teamId", "file") do nothing`,
        [entry.file, entry.lineId, entry.text],
      );
      written += 1;
    }
    console.log(`wrote ${written} overrides. Nothing has been regenerated.`);
  } finally {
    await pool.end();
  }
}

await main();
