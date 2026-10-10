/**
 * The spoken text someone has rewritten by hand, and where generation reads it from.
 *
 * Keyed on the store-relative file, as the take table is and for the same reason: one mp3
 * is spoken by up to many NPCs, so a rewrite necessarily changes what all of them say. See
 * the header of migration 0012 for why rewriting the spoken text cannot rename that file.
 */
import { recordActivity } from "../activity/store";
import { BASE_LANG, type Lang } from "../lang";
import { db } from "../db";
import { overrideOf, type LineOverride } from "./override";

type OverrideRow = {
  file: string;
  lineId: string;
  text: string;
  updatedAt: Date;
  updatedBy: string | null;
};

function toOverride(row: OverrideRow): LineOverride {
  return {
    file: row.file,
    lineId: row.lineId,
    text: row.text,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

async function stamp(): Promise<string> {
  const { rows } = await db().query<{ stamp: string | null }>(
    `select count(*)::text || ':' || coalesce(max("updatedAt")::text, '-') as stamp
       from "line_override"`,
  );
  // The count is load-bearing: a delete leaves max(updatedAt) where it was, so a timestamp
  // alone would keep serving an override that no longer exists.
  return rows[0]?.stamp ?? "-";
}

const cacheKey = Symbol.for("wow-voiceover.line-overrides");
type CacheHolder = { [cacheKey]?: { map: Map<string, LineOverride>; stamp: string } };

/**
 * Every override, by file. Memoised behind the stamp because search needs it for every
 * row of every page, and regeneration needs it to be right rather than
 * recent - pm2 runs two workers, and an edit made on one must reach the other.
 *
 * Whole-table because there are tens of these, not thousands: an override is a line someone
 * sat down and rewrote.
 */
/**
 * `lang` other than English reads as no overrides at all: an override rewrites the English
 * corpus, and another language's rewrites are versions of its own text.
 */
export async function readOverrides(lang: Lang = BASE_LANG): Promise<Map<string, LineOverride>> {
  if (lang !== BASE_LANG) return new Map();
  const holder = globalThis as CacheHolder;
  const current = await stamp();
  if (holder[cacheKey]?.stamp === current) return holder[cacheKey].map;

  const { rows } = await db().query<OverrideRow>(
    `select "file", "lineId", "text", "updatedAt", "updatedBy" from "line_override"`,
  );
  const map = new Map(rows.map((r) => [r.file, toOverride(r)]));
  holder[cacheKey] = { map, stamp: current };
  return map;
}

export async function writeOverride(
  file: string,
  lineId: string,
  text: string,
  // Nullable to match the column, which is SET NULL: who rewrote a line outlives the account.
  userId: string | null,
  // The contribution the text came from, when it is a correction accepted from the game: the
  // table has no provenance column, so the activity log is where that is kept.
  contributionId?: number,
): Promise<LineOverride> {
  // "before" is read in the same statement, from the snapshot the upsert started with, so
  // the log says what this write replaced and not what a concurrent one did.
  const { rows } = await db().query<OverrideRow & { before: string | null }>(
    `with "was" as (select "text" from "line_override" where "file" = $1)
     insert into "line_override" ("file", "lineId", "text", "updatedBy")
     values ($1, $2, $3, $4)
     on conflict ("file") do update
        set "text" = excluded."text",
            "lineId" = excluded."lineId",
            "updatedAt" = now(),
            "updatedBy" = excluded."updatedBy"
     returning "file", "lineId", "text", "updatedAt", "updatedBy",
               (select "text" from "was") as "before"`,
    [file, lineId, text, userId],
  );
  forgetOverrides();
  const { before, ...row } = rows[0];
  // Saving the text the line already says is not a rewrite, and would only bury real ones.
  if (before !== text) {
    await recordActivity({
      kind: "override.set",
      lang: BASE_LANG,
      actorId: userId,
      source: "quests",
      subject: file,
      lineId,
      detail: contributionId ? { text, before, contribution: contributionId } : { text, before },
    });
  }
  return toOverride(row);
}

/** `by` is who reverted it, for the activity log: the delete leaves nothing else behind. */
export async function clearOverride(file: string, by: string | null): Promise<boolean> {
  const { rows } = await db().query<{ lineId: string; text: string }>(
    `delete from "line_override" where "file" = $1 returning "lineId", "text"`,
    [file],
  );
  forgetOverrides();
  if (rows[0]) {
    await recordActivity({
      kind: "override.cleared",
      lang: BASE_LANG,
      actorId: by,
      source: "quests",
      subject: file,
      lineId: rows[0].lineId,
      detail: { before: rows[0].text },
    });
  }
  return rows.length > 0;
}

/**
 * Forget the memo after a write in this worker.
 *
 * The stamp would notice on the next read anyway, but not always in time: `updatedAt` is
 * `now()`, and a read landing in the same transaction timestamp would see an unchanged stamp
 * and serve the text that was just replaced - to the person who just replaced it.
 */
export function forgetOverrides(): void {
  delete (globalThis as CacheHolder)[cacheKey];
}

/** The text that would actually be sent for a line, before pronunciation rules. */
export function effectiveText(
  line: { text: string },
  file: string,
  overrides: Map<string, LineOverride>,
): string {
  return overrideOf(overrides, file)?.text ?? line.text;
}
