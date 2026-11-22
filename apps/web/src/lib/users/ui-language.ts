/**
 * The language a person reads Backstage in.
 *
 * It belongs to the person, not to the page: a volunteer who reads Chinese may look after a
 * German team. Kept on the account so it follows them between links, browsers and machines.
 *
 * No row, or a null column, means no choice: the page reads its `[lang]` segment, as a
 * signed-out visitor's does.
 */
import "server-only";

import { query } from "@/lib/db";
import { isLang, type Lang } from "@/lib/lang";

/** The choice, or null for none: absent row, null column, or a code this site no longer knows. */
export async function uiLangOf(userId: string): Promise<Lang | null> {
  const rows = await query<{ uiLang: string | null }>(
    `select "uiLang" from "user_setting" where "userId" = $1`,
    [userId],
  );
  const code = rows[0]?.uiLang;
  // A language removed after it was chosen leaves a code nothing can render.
  return code && isLang(code) ? code : null;
}

/**
 * Saves the choice. `null` clears it, so the fallback applies again -- done as a delete rather
 * than a null write, since a row with no choice says nothing a missing row does not.
 */
export async function setUiLang(userId: string, lang: Lang | null): Promise<void> {
  if (lang === null) {
    await query(`delete from "user_setting" where "userId" = $1`, [userId]);
    return;
  }
  await query(
    `insert into "user_setting" ("userId", "uiLang", "updatedAt") values ($1, $2, now())
       on conflict ("userId") do update set "uiLang" = excluded."uiLang", "updatedAt" = now()`,
    [userId, lang],
  );
}
