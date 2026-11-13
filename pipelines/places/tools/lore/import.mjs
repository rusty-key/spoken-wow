#!/usr/bin/env node
// Seeds lore_line from the committed Lua data files.
//
//   node tools/lore/import.mjs           # insert anything the table does not have
//   node tools/lore/import.mjs --status  # say what would happen, write nothing
//
// This is the one-time bridge from "the text is a build input" to "the text is state",
// and it stays useful afterwards for the same reason `make db-pull` does: a second
// machine, or a rebuilt droplet, needs the corpus from somewhere.
//
// Imported rows are recorded as 'scraped', because that is what they are -- the wiki
// text as of the last scrape. That matters for more than bookkeeping: recordScrape()
// will promote over a scraped row and will not promote over an edited one, so an import
// followed by a scrape behaves exactly as a scrape into a table that was always there.
//
// Existing lines are left alone. Running this against a populated table is a no-op, not
// a reset -- it must never be the command that discards somebody's edits.

import { readLinesFromLua, isEnabled, lineIdFor, recordScrape } from "./store.mjs";
import { loadEnvFile } from "../lib/env.mjs";

// Before anything reads DATABASE_URL.
await loadEnvFile();
import { close, query } from "../voice/db.mjs";

const argv = process.argv.slice(2);
const statusOnly = argv.includes("--status");

async function main() {
  if (!isEnabled()) {
    console.error("error: DATABASE_URL is not set, so there is nothing to import into.");
    console.error("       start the local database with:  make db-up");
    process.exit(1);
  }

  const entries = await readLinesFromLua();
  const { rows } = await query(`select distinct "lineId" from "lore_line"`);
  const known = new Set(rows.map((row) => row.lineId));

  const fresh = entries.filter((entry) => !known.has(lineIdFor(entry)));

  console.log(
    `${entries.length} lines in the Lua files, ${known.size} already in the table, ` +
      `${fresh.length} to import`,
  );

  if (statusOnly || fresh.length === 0) return;

  const stats = await recordScrape(fresh);
  console.log(`imported ${stats.inserted} lines as version 1`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(close);
