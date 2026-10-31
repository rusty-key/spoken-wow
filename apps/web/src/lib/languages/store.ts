/**
 * Which languages the site serves: the `language` table, and the only module that knows its
 * columns.
 *
 * What a language IS is code (lib/lang.ts), because the URL rewrites validate a URL prefix without
 * a database. Whether one is switched ON is here, because it is an admin's decision taken at
 * runtime -- a language with nothing translated yet should not be one click away in the
 * header, and turning it on should not need a deploy.
 *
 * English is always on. It is what a bare URL means, and a site that could switch it off
 * would have no pages at all; setEnabled refuses to.
 */
import "server-only";

import { recordActivity } from "@/lib/activity/store";
import { inTransaction, query } from "@/lib/db";
import { BASE_LANG, CODES, isLang, type Lang } from "@/lib/lang";
import { forgetTeams } from "@/lib/teams/store";

export type LanguageState = { code: Lang; enabled: boolean };

/** Every language the site knows of, in the list's order, with whether it is on. */
export async function languageStates(): Promise<LanguageState[]> {
  const rows = await query<{ code: string; enabled: boolean }>(
    `select "code", "enabled" from "language"`,
  );
  const enabled = new Set(rows.filter((row) => row.enabled).map((row) => row.code));
  return CODES.map((code) => ({ code, enabled: code === BASE_LANG || enabled.has(code) }));
}

export async function isEnabled(lang: Lang): Promise<boolean> {
  if (lang === BASE_LANG) return true;
  const rows = await query<{ enabled: boolean }>(
    `select "enabled" from "language" where "code" = $1`,
    [lang],
  );
  return rows[0]?.enabled === true;
}

/**
 * Recorded in the activity log only when the state actually flips. The admin page sends the
 * whole switch's value, so a second click on a stale page, or a retry, would otherwise log a
 * language being turned on that was already on.
 */
export async function setEnabled(lang: string, enabled: boolean, userId: string): Promise<void> {
  if (!isLang(lang)) throw new Error(`${lang} is not a language this site knows`);
  if (lang === BASE_LANG) throw new Error("English cannot be switched off");
  // The CTE reads the row as it was before this statement, so "was" is the previous state:
  // null for a language never switched, which languageStates treats as off.
  // A language nobody has a team for yet goes to the English team, which is where every
  // unmaintained language lives; handing it to a team of its own is a later, deliberate act.
  // Same transaction, so a language is never enabled without somewhere for its work to land.
  const row = await inTransaction(async (client) => {
    const { rows } = await client.query<{ was: boolean | null }>(
      `with "before" as (select "enabled" from "language" where "code" = $1)
       insert into "language" ("code", "enabled", "updatedAt", "updatedBy")
       values ($1, $2, now(), $3)
       on conflict ("code") do update
          set "enabled" = excluded."enabled", "updatedAt" = now(), "updatedBy" = excluded."updatedBy"
       returning (select "enabled" from "before") as "was"`,
      [lang, enabled, userId],
    );
    await client.query(
      `insert into "team_language" ("teamId", "lang", "privileged")
       select "id", $1, true from "team" where "slug" = 'english'
          and not exists (select 1 from "team_language" where "lang" = $1 and "privileged")
       on conflict do nothing`,
      [lang],
    );
    return rows[0];
  });
  forgetTeams();
  if ((row?.was ?? false) === enabled) return;
  await recordActivity({ kind: "language.toggled", lang, actorId: userId, detail: { enabled } });
}
