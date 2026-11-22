/**
 * The language a person reads Backstage in, kept on the account so it follows them between
 * links and machines. No row means no choice.
 */
import "server-only";

import { cache } from "react";

import { query } from "@/lib/db";
import { isLang, type Lang } from "@/lib/lang";

/**
 * The choice, or null for none: absent row, null column, or a code this site no longer knows.
 * Cached per render: the layout and the profile page both ask.
 */
export const uiLangOf = cache(async (userId: string): Promise<Lang | null> => {
  const rows = await query<{ uiLang: string | null }>(
    `select "uiLang" from "user_setting" where "userId" = $1`,
    [userId],
  );
  const code = rows[0]?.uiLang;
  // A language removed after it was chosen leaves a code nothing can render.
  return code && isLang(code) ? code : null;
});

/** `null` clears the choice by deleting the row: a row with no choice says nothing a missing row does not. */
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
