/**
 * Cut every live take that has no sentence pieces yet (lib/takes/pieces.ts).
 *
 *   cd apps/web
 *   DATABASE_URL=postgres://… npx tsx --conditions=react-server \
 *     scripts/cut-pieces.mts [--dry-run] [quests places readables bosses]
 *
 * Takes are cut at commit; this cuts the ones committed before that, and any whose cut failed. A
 * take with word times that fit its words is cut at them, any other at its measured pauses. Run it
 * on the droplet with the site's app.env: it reads and writes the archive as the site does.
 * DATABASE_URL is never read from .env, so it is aimed at a database on purpose. A take that fails
 * is logged and left without pieces, so its line ships whole; a second run tries it again.
 */
import { ALL_TEAMS, closeDb, queryIn, type TeamId } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { SOURCES, type Source } from "@/lib/sections";
import { PROFILE } from "@/lib/takes/encode";
import { cutMissingForPack } from "@/lib/takes/pieces";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is unset -- say which database to write to.");
  process.exit(2);
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const named = args.filter((arg) => arg !== "--dry-run");
const unknown = named.filter((arg) => !(SOURCES as readonly string[]).includes(arg));
if (unknown.length) {
  console.error(`not a section: ${unknown.join(", ")}`);
  process.exit(2);
}
const sources = (named.length ? named : SOURCES) as readonly Source[];

/** Live takes per language and team with no pieces, and how many of them have word times. */
async function missing(source: Source): Promise<{ lang: Lang; teamId: TeamId; count: number; timed: number }[]> {
  return queryIn(
    ALL_TEAMS,
    `select t."lang", t."teamId", count(distinct t."sha256")::int as "count",
            count(distinct t."sha256") filter (where t."wordTimes" is not null and t."shownText" is not null)::int as "timed"
       from "take" t
       left join "take_pieces" p
         on p."source" = t."source" and p."sha256" = t."sha256" and p."profile" = $2
      where t."source" = $1 and t."isCurrent" and t."sha256" is not null and p."id" is null
      group by t."lang", t."teamId"
      order by t."lang"`,
    [source, PROFILE],
  );
}

// A day: unbounded in practice, and under setTimeout's limit.
const BUDGET_MS = 24 * 60 * 60_000;

let cut = 0;
let found = 0;
for (const source of sources) {
  for (const { lang, teamId, count, timed } of await missing(source)) {
    console.log(`${source} ${lang} (team ${teamId}): ${count} takes without pieces, ${timed} with word times`);
    found += count;
    if (dryRun) continue;
    const failed = new Set<string>();
    for (;;) {
      const round = await cutMissingForPack(source, lang, teamId, BUDGET_MS, failed);
      cut += round.cut;
      console.log(`  ${round.cut} cut`);
      if (round.tried === 0) break;
    }
  }
}

if (!dryRun && cut < found) console.log(`${found - cut} takes could not be cut: their errors are logged above`);
await closeDb();
