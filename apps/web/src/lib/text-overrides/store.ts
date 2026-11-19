/**
 * The spoken text a team has rewritten by hand for a place, readable or boss line.
 *
 * Keyed by line id within a source, in the acting team's language. Every read and write is the
 * acting team's, so one team's rewrite is invisible to the language's other teams.
 */
import { auditDetail, type ApiAudit } from "../activity/kinds";
import { recordActivity } from "../activity/store";
import { spokenHash } from "../generation/spoken-hash";
import type { Lang } from "../lang";
import { memoByTeamLang } from "../memo";
import { hasDrifted } from "../quests/override-drift";
import { ALL_TEAMS, query, queryIn } from "../db";
import { ownerOrAll, queryAs, readAs } from "../teams/store";
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

/** The override stamp as a SQL fragment, so it can share one statement with another stamp. */
function stampSql(langParam: string, sourceParam: string): string {
  // The count is load-bearing: a delete leaves max(updatedAt) where it was. The id sum is too:
  // absorbing a minted readable moves a row to another line's id and leaves both unchanged.
  // So is the original hash sum: keeping an override over a changed original moves only that.
  return `(select count(*)::text || ':' ||
                  coalesce(max("updatedAt")::text || ':' || sum(hashtext("lineId"))::text || ':' ||
                           sum(hashtext(coalesce("originalHash", '')))::text, '-')
             from "text_override" where "lang" = ${langParam} and "source" = ${sourceParam})`;
}

/** `"-"` when the language has no team, so nothing is read for it. */
export async function overrideStamp(source: NarratedSource, lang: Lang): Promise<string> {
  const rows = await readAs<{ stamp: string }>(lang, `select ${stampSql("$1", "$2")} as "stamp"`, [lang, source]);
  return rows[0]?.stamp ?? "-";
}

/**
 * A catalogue's shared-text stamp and the acting team's override stamp, in one statement on one
 * connection. `shared` reads only shared tables, which answer the same under any team. An
 * unowned language reads no override and stamps `"-"`: acting as ALL_TEAMS, row-level
 * security would count every team's rows.
 */
export async function stampsWithOverrides(
  source: NarratedSource,
  lang: Lang,
  shared: { sql: string; params: unknown[] },
): Promise<{ stamp: string; overrides: string }> {
  const team = await ownerOrAll(lang);
  if (team === ALL_TEAMS) {
    const rows = await query<{ stamp: string }>(`select ${shared.sql} as "stamp"`, shared.params);
    return { stamp: rows[0]?.stamp ?? "", overrides: "-" };
  }
  const n = shared.params.length;
  const rows = await queryIn<{ stamp: string; overrides: string }>(
    team,
    `select ${shared.sql} as "stamp", ${stampSql(`$${n + 1}`, `$${n + 2}`)} as "overrides"`,
    [...shared.params, lang, source],
  );
  return { stamp: rows[0]?.stamp ?? "", overrides: rows[0]?.overrides ?? "-" };
}

const SOURCES: readonly NarratedSource[] = ["places", "readables", "bosses"];

// One memo slot per source: a slot holds one version per team and language, so sources sharing
// one would rebuild it on every alternating read.
const cacheKeys = Object.fromEntries(
  SOURCES.map((s) => [s, Symbol.for(`wow-voiceover.text-overrides.${s}`)]),
) as Record<NarratedSource, symbol>;

/**
 * The acting team's overrides for a source in a language, by line id. `stamp` is an
 * overrideStamp the caller has just read, so it is not read again.
 */
export async function readTextOverrides(
  source: NarratedSource,
  lang: Lang,
  stamp?: string,
): Promise<Map<string, TextOverride>> {
  stamp ??= await overrideStamp(source, lang);
  return memoByTeamLang(cacheKeys[source], lang, stamp, async () => {
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
  // Imported late: the catalogues read overrides through this module.
  const { overrideSpokenHash } = await import("./spoken");
  const said = await overrideSpokenHash(source, lang, lineId, text);
  // "before" is read in the same statement, from the snapshot the upsert started with, so
  // the log says what this write replaced and not what a concurrent one did. Keeping the same
  // text over a changed original is no rewrite, so it leaves who rewrote it and when.
  const { rows } = await queryAs<OverrideRow & { before: string | null }>(
    lang,
    `with "was" as (select "text" from "text_override"
                     where "lang" = $1 and "source" = $2 and "lineId" = $3)
     insert into "text_override" ("lang", "source", "lineId", "text", "updatedBy", "originalHash", "spokenHash")
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict ("teamId", "lang", "source", "lineId") do update
        set "text" = excluded."text",
            "updatedAt" = case when "text_override"."text" is distinct from excluded."text"
                               then now() else "text_override"."updatedAt" end,
            "updatedBy" = case when "text_override"."text" is distinct from excluded."text"
                               then excluded."updatedBy" else "text_override"."updatedBy" end,
            "originalHash" = excluded."originalHash",
            "spokenHash" = excluded."spokenHash"
     returning "lineId", "text", "updatedAt", "updatedBy", "originalHash",
               (select "text" from "was") as "before"`,
    [lang, source, lineId, text, userId, spokenHash(original), said],
  );
  forgetTextOverrides(source);
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
  forgetTextOverrides(source);
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
export function forgetTextOverrides(source?: NarratedSource): void {
  for (const s of source ? [source] : SOURCES) delete (globalThis as Record<symbol, unknown>)[cacheKeys[s]];
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
