/**
 * Encode every live take that has no Ogg yet.
 *
 *   cd apps/web
 *   DATABASE_URL=postgres://… npx tsx --conditions=react-server \
 *     scripts/encode-takes.mts [--dry-run] [places readables bosses]
 *
 * A release stops on a live take without an Ogg, and a press encodes for only 30 seconds, so
 * takes committed before their section's packs shipped Ogg are encoded here with no time limit.
 * Run it on the droplet with the site's app.env: it reads and writes the archive as the site does.
 * DATABASE_URL is never read from .env, so it is aimed at a database on purpose. A take that
 * fails is in its language's activity log, and a second run tries it again.
 */
import { ALL_TEAMS, closeDb, queryIn, type TeamId } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { SOURCES, type Source } from "@/lib/sections";
import { encodeMissingForPack } from "@/lib/takes/encode";

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
const sources = (named.length ? named : ["places", "readables", "bosses"]) as Source[];

/** Live takes per language and team with no usable Ogg, as encodeMissingForPack finds them. */
async function missing(source: Source): Promise<{ lang: Lang; teamId: TeamId; count: number }[]> {
  return queryIn(
    ALL_TEAMS,
    `select t."lang", t."teamId", count(distinct t."sha256")::int as "count"
       from "take" t
       left join "take_encoding" e
         on e."source" = t."source" and e."sha256" = t."sha256" and e."profile" = 'ogg-q0-44k'
      where t."source" = $1 and t."isCurrent" and t."sha256" is not null
        and coalesce(e."durationSec", 0) <= 0
      group by t."lang", t."teamId"
      order by t."lang"`,
    [source],
  );
}

// A day: unbounded in practice, and under setTimeout's limit, past which Node fires it at once.
const BUDGET_MS = 24 * 60 * 60_000;

let stuck = 0;
for (const source of sources) {
  for (const { lang, teamId, count } of await missing(source)) {
    console.log(`${source} ${lang} (team ${teamId}): ${count} takes without an Ogg`);
    if (dryRun) continue;
    // encodeMissingForPack takes 500 at a time; stop once a round encodes nothing more.
    for (let left = count; left > 0; ) {
      await encodeMissingForPack(source, lang, teamId, BUDGET_MS);
      const now = (await missing(source)).find((row) => row.lang === lang && row.teamId === teamId)?.count ?? 0;
      console.log(`  ${left - now} encoded, ${now} left`);
      if (now >= left) {
        stuck += now;
        break;
      }
      left = now;
    }
  }
}

if (stuck) console.log(`${stuck} takes could not be encoded: their errors are in the activity log`);
await closeDb();
