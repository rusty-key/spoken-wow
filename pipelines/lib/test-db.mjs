// For script tests that read a database: languages, teams and takes seeded through psql as
// DATABASE_URL's role, which must bypass row-level security (the owner, as on spoken_ci_pin), and
// removed again. Every code is `xq` and two random capitals and every slug random, so a test run
// beside another on the same database touches none of its rows. Takes are inserted, never made.
import { execFileSync } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";

const CAPITALS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const lit = (value) => (value === null || value === undefined ? "null" : `'${String(value).replaceAll("'", "''")}'`);

/** Null when DATABASE_URL is unset, so a test can skip. */
export function seedDatabase(url = process.env.DATABASE_URL) {
  if (!url) return null;
  const langs = [];
  const teams = [];
  const undo = [];

  /** The rows of one statement, each a list of its columns as text: `-q`, or psql adds its status line, `INSERT 0 0`, as a row. */
  function sql(text) {
    return execFileSync("psql", [url, "-qtA", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-c", text], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .map((row) => row.split("\t"));
  }

  return {
    url,
    sql,
    lit,

    /** A statement the cleanup runs first, for rows a test seeded itself. */
    onCleanup(text) {
      undo.push(text);
    },

    /** A language row of a code nobody has; `client` false, as a language Spoken does not build in. */
    language({ name = "Xq", native = "Xq", client = false } = {}) {
      for (;;) {
        const code = `xq${CAPITALS[randomInt(26)]}${CAPITALS[randomInt(26)]}`;
        const made = sql(`insert into "language" ("code", "name", "native", "bcp47", "provider", "client")
                          values (${lit(code)}, ${lit(name)}, ${lit(native)}, 'xq-XQ', 'xq', ${client})
                          on conflict do nothing returning "code"`);
        if (made.length) {
          langs.push(code);
          return code;
        }
      }
    },

    /** A team voicing `lang`, its packs plain (`_<lang>`) or carrying its slug. */
    team(lang, { packName = "plain", official = true, name = null } = {}) {
      const slug = `test-${randomUUID().slice(0, 8)}`;
      const [[id]] = sql(`insert into "team" ("slug", "name", "official")
                          values (${lit(slug)}, ${lit(name ?? slug)}, ${official}) returning "id"`);
      teams.push(id);
      sql(`insert into "team_language" ("teamId", "lang", "packName") values (${lit(id)}, ${lit(lang)}, ${lit(packName)})`);
      return { id, slug, name: name ?? slug };
    },

    /** A live take of `team`. */
    take({ team, source, lang, file, lineId, sha256, archiveFile = null, shownText = null, version = 1 }) {
      sql(`insert into "take" ("teamId", "source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes",
                               "sha256", "archiveFile", "shownText", "durationSec")
           values (${lit(team)}, ${lit(source)}, ${lit(lang)}, ${lit(file)}, ${lit(lineId)}, ${version}, true, 'imported', 1,
                   ${lit(sha256)}, ${lit(archiveFile)}, ${lit(shownText)}, 1.5)`);
    },

    cleanup() {
      for (const text of undo.reverse()) sql(text);
      const ids = `array[${teams.map(lit).join(", ") || "null"}]::uuid[]`;
      const codes = `array[${langs.map(lit).join(", ") || "null"}]::text[]`;
      for (const table of ["take", "team_member", "voice_assignment", "voice", "generation_setting", "queue_dismissal", "activity"]) {
        sql(`delete from "${table}" where "teamId" = any(${ids})`);
      }
      sql(`delete from "team_language" where "teamId" = any(${ids}) or "lang" = any(${codes})`);
      sql(`delete from "team" where "id" = any(${ids})`);
      sql(`delete from "language" where "code" = any(${codes})`);
    },
  };
}
