/**
 * Fill in the speaker of already-stored quest contributions from a re-gathered file.
 *
 *   cd apps/web
 *   DATABASE_URL=postgres://… npx tsx --conditions=react-server \
 *     scripts/backfill-contribution-npcs.mts [--dry-run] FILE…
 *
 * FILE is a SpokenContributions SavedVariables file (.lua), the same thing the contribute page
 * takes, or a JSON array of { envelope } objects. Every envelope goes through the app's own
 * parseEnvelope and submissionFrom, so its "dedup" is exactly the one intake computed; a row
 * with that dedup and no NPC gets the envelope's npc/kind/model/sex/creature merged into its
 * meta (store.ts's fillContributionNpcs), and its speaker is then resolved as intake would have
 * (lib/npc/resolve.ts). Nothing is inserted and no count moves: a line that was never stored,
 * or that already names an NPC, is only counted in the summary.
 *
 * DATABASE_URL is required and never read from .env: the point of this script is to be aimed
 * at a database on purpose. --dry-run reports what would change and writes nothing.
 */
import { readFileSync } from "node:fs";

import { closeDb, db } from "@/lib/db";
import { parseEnvelope } from "@/lib/contributions/envelope";
import { envelopesFromSavedVariables } from "@/lib/contributions/saved-variables";
import type { Submission } from "@/lib/contributions/contributions";
import { fillContributionNpcs } from "@/lib/contributions/store";
import { submissionFrom } from "@/lib/contributions/submission";
import { observedFrom, resolveNpc } from "@/lib/npc/resolve";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is unset -- say which database to write to.");
  process.exit(2);
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const files = args.filter((arg) => arg !== "--dry-run");
if (files.length === 0) {
  console.error("usage: backfill-contribution-npcs.mts [--dry-run] FILE…");
  process.exit(2);
}

function envelopesIn(file: string): string[] {
  const source = readFileSync(file, "utf8");
  if (file.endsWith(".json")) {
    return (JSON.parse(source) as { envelope: string }[]).map((row) => row.envelope);
  }
  return envelopesFromSavedVariables(source);
}

const tally = {
  envelopes: 0,
  refused: 0,
  noNpc: 0,
  filled: 0,
  alreadyNamed: 0,
  notStored: 0,
  resolved: 0,
  resolveFailed: 0,
};

/** Progress on stderr, rewritten in place on a terminal so the summary on stdout stays clean. */
function progress(label: string, done: number, total: number) {
  if (process.stderr.isTTY) {
    process.stderr.write(`\r  ${label} ${done}/${total}`);
    if (done === total) process.stderr.write("\n");
  } else if (done === total || done % 100 === 0) {
    process.stderr.write(`  ${label} ${done}/${total}\n`);
  }
}

// 1. Parse, locally. The same line in two files (a split upload, or two gatherings) is one row.
const naming = new Map<string, Submission>();
for (const file of files) {
  const envelopes = envelopesIn(file);
  console.error(`read ${envelopes.length} envelopes from ${file}`);
  for (const raw of envelopes) {
    tally.envelopes += 1;
    const parsed = parseEnvelope(raw);
    const submission = parsed.ok && parsed.value.source === "quests" ? submissionFrom(parsed.value, raw, null) : null;
    if (!submission) tally.refused += 1;
    else if (!submission.meta.npc) tally.noNpc += 1;
    else naming.set(submission.dedup, submission);
  }
}

// 2. Where each stands, in one query: a round trip per line is minutes over a tunnel.
console.error(`looking up ${naming.size} lines…`);
const { rows } = await db().query<{ dedup: string; npc: string | null }>(
  `select "dedup", "meta"->>'npc' as "npc" from "contribution" where "dedup" = any($1::text[])`,
  [[...naming.keys()]],
);
const stored = new Map(rows.map((row) => [row.dedup, row.npc]));
const toFill: Submission[] = [];
for (const [dedup, submission] of naming) {
  if (!stored.has(dedup)) tally.notStored += 1;
  else if (stored.get(dedup)) tally.alreadyNamed += 1;
  else toFill.push(submission);
}

// 3. Fill, in one statement. fillContributionNpcs re-checks each row, so a row named between
// the lookup and here is left alone and simply not counted.
let filled = toFill;
if (!dryRun) {
  console.error(`filling ${toFill.length} lines…`);
  const changed = new Set(await fillContributionNpcs(toFill));
  filled = toFill.filter((submission) => changed.has(submission.dedup));
  tally.alreadyNamed += toFill.length - filled.length;
}
tally.filled = filled.length;

// 4. Resolve each speaker once per distinct observation, as a batch upload does. This is the
// slow part -- each reads the corpus -- hence the progress.
if (!dryRun) {
  const observations = new Map<string, ReturnType<typeof observedFrom>>();
  for (const submission of filled) {
    // As storeSubmission does: build lives in its own column, so it goes back in for observedFrom.
    const observed = observedFrom({ ...submission.meta, build: submission.build });
    observations.set(JSON.stringify(observed), observed);
  }
  let done = 0;
  for (const observed of observations.values()) {
    try {
      await resolveNpc(observed);
      tally.resolved += 1;
    } catch (error) {
      tally.resolveFailed += 1;
      console.error(`\ncould not resolve ${observed.npcKind} ${observed.npcId}:`, error);
    }
    progress("resolving speakers", ++done, observations.size);
  }
}

console.log(dryRun ? "dry run -- nothing written" : "done");
console.log(`  envelopes read           ${tally.envelopes}`);
console.log(`  refused by intake checks ${tally.refused}`);
console.log(`  naming no NPC (skipped)  ${tally.noNpc}`);
console.log(`  ${(dryRun ? "would fill" : "filled").padEnd(24)} ${tally.filled}`);
console.log(`  already named an NPC     ${tally.alreadyNamed}`);
console.log(`  not stored at all        ${tally.notStored}`);
if (!dryRun) console.log(`  speakers resolved        ${tally.resolved} (${tally.resolveFailed} failed)`);

await closeDb();
