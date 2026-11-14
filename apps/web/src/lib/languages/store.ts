/**
 * Which languages the site serves: the `language` table, and the only module that knows its
 * columns.
 *
 * The built-in languages are code (lib/lang.ts); the rest are rows here, registered at boot and on
 * every change. The URL rewrites use a build-time list of page sections, and the layout validates
 * the prefix. Whether one is switched ON is here, because it is an admin's decision taken at
 * runtime -- a language with nothing translated yet should not be one click away in the
 * header, and turning it on should not need a deploy.
 *
 * English is always on. It is what a bare URL means, and a site that could switch it off
 * would have no pages at all; setEnabled refuses to.
 */
import "server-only";

import type { ClientBase } from "pg";

import { recordActivity } from "@/lib/activity/store";
import { inTransaction, query } from "@/lib/db";
import { BASE_LANG, BUILTIN, allLangs, derivedTags, isLang, type Lang } from "@/lib/lang";
import { loadLanguages } from "@/lib/languages/catalogue";
import { adoptEveryLang, adoptLang, forgetTeams } from "@/lib/teams/store";

export type LanguageState = { code: Lang; enabled: boolean };

/** Every language the site knows of, in the list's order, with whether it is on. */
export async function languageStates(): Promise<LanguageState[]> {
  await loadLanguages();
  const rows = await query<{ code: string; enabled: boolean }>(
    `select "code", "enabled" from "language"`,
  );
  const enabled = new Set(rows.filter((row) => row.enabled).map((row) => row.code));
  return allLangs().map((code) => ({ code, enabled: code === BASE_LANG || enabled.has(code) }));
}

export async function isEnabled(lang: Lang): Promise<boolean> {
  if (lang === BASE_LANG) return true;
  const rows = await query<{ enabled: boolean }>(
    `select "enabled" from "language" where "code" = $1`,
    [lang],
  );
  return rows[0]?.enabled === true;
}

/** Whether a language's team admins appoint its text maintainers. False for a language with no row. */
export async function textByTeam(lang: string): Promise<boolean> {
  const rows = await query<{ textByTeam: boolean }>(`select "textByTeam" from "language" where "code" = $1`, [lang]);
  return rows[0]?.textByTeam === true;
}

/**
 * Recorded in the activity log only when the state actually flips. The admin page sends the
 * whole switch's value, so a second click on a stale page, or a retry, would otherwise log a
 * language being turned on that was already on.
 */
export async function setEnabled(lang: string, enabled: boolean, userId: string): Promise<void> {
  if (!isLang(lang)) throw new Error(`${lang} is not a language this site knows`);
  if (lang === BASE_LANG) throw new Error("English cannot be switched off");
  // One transaction, so a language is never enabled without a team for its work to land on.
  const was = await inTransaction(async (client) => {
    const previous = await setEnabledOn(client, lang, enabled, userId);
    await adoptEveryLang(client);
    return previous;
  });
  forgetTeams();
  if ((was ?? false) === enabled) return;
  await recordActivity({ kind: "language.toggled", lang, actorId: userId, detail: { enabled } });
}

/**
 * Switches a language on or off on the caller's client, and returns the previous state: null for
 * a language never switched, which languageStates treats as off. Checks nothing and logs nothing;
 * a language created in the same transaction is not in the registry yet.
 */
export async function setEnabledOn(
  client: ClientBase,
  lang: string,
  enabled: boolean,
  userId: string,
): Promise<boolean | null> {
  // The CTE reads the row as it was before this statement, so "was" is the previous state. A row
  // is described when it is made (migration 0107), so this only ever updates one.
  const { rows } = await client.query<{ was: boolean | null }>(
    `with "before" as (select "enabled" from "language" where "code" = $1)
     update "language"
        set "enabled" = $2, "updatedAt" = now(), "updatedBy" = $3
      where "code" = $1
     returning (select "enabled" from "before") as "was"`,
    [lang, enabled, userId],
  );
  if (!rows[0]) throw new Error(`${lang} has no row in the language table`);
  return rows[0].was;
}

/** Lets the admins of the language's privileged team appoint its text maintainers. */
export async function giveTextToTeam(client: ClientBase, lang: string): Promise<void> {
  await client.query(`update "language" set "textByTeam" = true where "code" = $1`, [lang]);
}

export class LanguageExistsError extends Error {
  constructor(code: string) {
    super(`${code} is already a language`);
    this.name = "LanguageExistsError";
  }
}

export type NewLanguage = { code: string; name: string; native: string; bcp47: string; provider: string };

/** A language from its code and names: jaJP is ja-JP to a browser and ja to the speech provider. */
export function describeNew(code: string, name: string, native: string): NewLanguage {
  return { code, name, native, ...derivedTags(code) };
}

/**
 * A language made, switched off, with a team of its own to hold its work. On the caller's
 * client so an approval can wrap it in one transaction; the caller calls forgetLanguages() and
 * forgetTeams() once that commits.
 */
export async function addLanguage(client: ClientBase, input: NewLanguage, userId: string): Promise<void> {
  if (BUILTIN.some((language) => language.code === input.code)) throw new LanguageExistsError(input.code);
  // The conflict clause, not a read first: two admins adding the same code cannot both succeed.
  const { rowCount } = await client.query(
    `insert into "language" ("code", "name", "native", "bcp47", "provider", "client", "enabled", "updatedBy")
     values ($1, $2, $3, $4, $5, false, false, $6)
     on conflict ("code") do nothing`,
    [input.code, input.name, input.native, input.bcp47, input.provider, userId],
  );
  if (!rowCount) throw new LanguageExistsError(input.code);
  await adoptLang(client, input.code);
}
