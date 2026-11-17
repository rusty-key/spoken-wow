/**
 * The spoken text a team has rewritten by hand for a place, readable or boss line.
 *
 * Keyed by line id within a source, in the acting team's language. Every read and write is the
 * acting team's, so a second team's rewrite is invisible to the privileged one.
 */
import { auditDetail, type ApiAudit } from "../activity/kinds";
import { recordActivity } from "../activity/store";
import { spokenHash } from "../generation/spoken-hash";
import type { Lang } from "../lang";
import { memoByTeamLang } from "../memo";
import { hasDrifted } from "../quests/override-drift";
import { queryAs, readAs } from "../teams/store";
import type { NarratedSource, OverrideView, TextOverride } from "./types";

type OverrideRow = {
  lineId: string;
  text: string;
  updatedAt: Date;
  updatedBy: string | null;
  originalHash: string | null;
};

function toOverride(row: OverrideRow): TextOverride {
  return {
    lineId: row.lineId,
    text: row.text,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    originalHash: row.originalHash,
  };
}

/** `"-"` when the language has no team, so nothing is read for it. */
export async function overrideStamp(source: NarratedSource, lang: Lang): Promise<string> {
  const rows = await readAs<{ stamp: string | null }>(
    lang,
    `select count(*)::text || ':' || coalesce(max("updatedAt")::text, '-') as stamp
       from "text_override" where "lang" = $1 and "source" = $2`,
    [lang, source],
  );
  // The count is load-bearing: a delete leaves max(updatedAt) where it was.
  return rows[0]?.stamp ?? "-";
}

const cacheKey = Symbol.for("wow-voiceover.text-overrides");

/** The acting team's overrides for a source in a language, by line id. */
export async function readTextOverrides(
  source: NarratedSource,
  lang: Lang,
): Promise<Map<string, TextOverride>> {
  const stamp = await overrideStamp(source, lang);
  return memoByTeamLang(cacheKey, lang, `${source}:${stamp}`, async () => {
    const rows = await readAs<OverrideRow>(
      lang,
      `select "lineId", "text", "updatedAt", "updatedBy", "originalHash"
         from "text_override" where "lang" = $1 and "source" = $2`,
      [lang, source],
    );
    return new Map(rows.map((r) => [r.lineId, toOverride(r)]));
  });
}

export async function writeTextOverride(args: {
  source: NarratedSource;
  lang: Lang;
  lineId: string;
  text: string;
  original: string;
  // Nullable to match the column, which is SET NULL: who rewrote a line outlives the account.
  userId: string | null;
  audit?: ApiAudit;
}): Promise<{ override: TextOverride; wrote: boolean }> {
  const { source, lang, lineId, text, original, userId, audit } = args;
  // "before" is read in the same statement, from the snapshot the upsert started with, so
  // the log says what this write replaced and not what a concurrent one did.
  const { rows } = await queryAs<OverrideRow & { before: string | null }>(
    lang,
    `with "was" as (select "text" from "text_override"
                     where "lang" = $1 and "source" = $2 and "lineId" = $3)
     insert into "text_override" ("lang", "source", "lineId", "text", "updatedBy", "originalHash")
     values ($1, $2, $3, $4, $5, $6)
     on conflict ("teamId", "lang", "source", "lineId") do update
        set "text" = excluded."text",
            "updatedAt" = now(),
            "updatedBy" = excluded."updatedBy",
            "originalHash" = excluded."originalHash"
     returning "lineId", "text", "updatedAt", "updatedBy", "originalHash",
               (select "text" from "was") as "before"`,
    [lang, source, lineId, text, userId, spokenHash(original)],
  );
  forgetTextOverrides();
  const { before, ...row } = rows[0];
  const wrote = before !== text;
  // Saving the text the line already says is not a rewrite, and would only bury real ones.
  if (wrote) {
    await recordActivity({
      kind: "override.set",
      lang,
      actorId: userId,
      source,
      subject: lineId,
      lineId,
      detail: { text, before, ...auditDetail(audit, null) },
    });
  }
  return { override: toOverride(row), wrote };
}

/** `by` is who reverted it, for the activity log: the delete leaves nothing else behind. */
export async function clearTextOverride(args: {
  source: NarratedSource;
  lang: Lang;
  lineId: string;
  by: string | null;
  audit?: ApiAudit;
}): Promise<boolean> {
  const { source, lang, lineId, by, audit } = args;
  const { rows } = await queryAs<{ text: string }>(
    lang,
    `delete from "text_override" where "lang" = $1 and "source" = $2 and "lineId" = $3 returning "text"`,
    [lang, source, lineId],
  );
  forgetTextOverrides();
  if (rows[0]) {
    await recordActivity({
      kind: "override.cleared",
      lang,
      actorId: by,
      source,
      subject: lineId,
      lineId,
      detail: { before: rows[0].text, ...auditDetail(audit, null) },
    });
  }
  return rows.length > 0;
}

/**
 * Forget the memo after a write in this worker: `updatedAt` is `now()`, so a read in the same
 * transaction timestamp would see an unchanged stamp and serve the replaced text.
 */
export function forgetTextOverrides(): void {
  delete (globalThis as Record<symbol, unknown>)[cacheKey];
}

export function viewOf(override: TextOverride | undefined, original: string): OverrideView | undefined {
  if (!override) return undefined;
  return {
    text: override.text,
    drifted: hasDrifted(override, original),
    updatedAt: override.updatedAt,
    updatedBy: override.updatedBy,
  };
}
