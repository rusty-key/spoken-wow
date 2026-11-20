// The player words the database holds, for a build run outside the site. Apart from
// player-words.mjs, which the site's browser bundle imports and so must not reach for psql.
import { execFileSync } from "node:child_process";

import { registerPlayerWords } from "./player-words.mjs";

const ask = (database, sql) =>
  execFileSync("psql", [database, "-tAX", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: sql, encoding: "utf8" });

/**
 * Registers every `language` row's words, asked through psql on `database`, as scripts/db/ asks.
 * A database before migration 0125 has none to register.
 */
export function loadPlayerWords(database) {
  const has = ask(
    database,
    `select 1 from information_schema.columns where table_name = 'language' and column_name = 'playerWords'`,
  ).trim();
  if (!has) return;
  registerPlayerWords(parseRows(ask(database, `select "code", "playerWords"::text from "language" where "playerWords" is not null`)));
}

/** psql's `code|json` rows as [code, words] pairs. */
export function parseRows(out) {
  return out
    .split("\n")
    .filter(Boolean)
    .map((row) => {
      const at = row.indexOf("|");
      return [row.slice(0, at), JSON.parse(row.slice(at + 1))];
    });
}
