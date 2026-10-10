/**
 * Lines this project has decided never to voice.
 *
 * The war-effort tallies read "$2113w", a counter the game expands against a live server, so
 * no take of them can ever be right. Quest 1 is Blizzard's own test quest. Neither is a text
 * defect an override could fix, and neither should sit in a search, a queue or the module.
 *
 * Keyed on lineId, unlike overrides.ts - see the header of migration 0017 for why a decision
 * about a line cannot be recorded against the file it happens to share with another.
 *
 * Read on every search, so it is memoised the way overrides are: whole table behind a
 * count-and-timestamp stamp, because there are tens of these rather than thousands and pm2
 * runs two workers that must not disagree about what is hidden.
 */
import { recordActivity } from "../activity/store";
import { db } from "../db";
import { baseLineId } from "../contributions/naming";
import { BASE_LANG, type Lang } from "../lang";

export type LineIgnore = {
  lineId: string;
  /** Null when the line is ignored in every language; otherwise the one it is ignored in. */
  lang: string | null;
  reason: string;
  createdAt: string;
  createdBy: string | null;
};

type IgnoreRow = {
  lineId: string;
  lang: string | null;
  reason: string;
  createdAt: Date;
  createdBy: string | null;
};

function toIgnore(row: IgnoreRow): LineIgnore {
  return {
    lineId: row.lineId,
    lang: row.lang,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  };
}

async function stamp(): Promise<string> {
  const { rows } = await db().query<{ stamp: string | null }>(
    `select count(*)::text || ':' || coalesce(max("createdAt")::text, '-') as stamp
       from "line_ignore"`,
  );
  // The count is load-bearing for the same reason it is in overrides.ts: un-ignoring a line
  // leaves max(createdAt) where it was, so a timestamp alone would keep hiding it.
  return rows[0]?.stamp ?? "-";
}

const cacheKey = Symbol.for("wow-voiceover.line-ignores");
type CacheHolder = {
  [cacheKey]?: { stamp: string; byLang: Map<string, Map<string, LineIgnore>> };
};

/**
 * Every line ignored in a language, by lineId: those ignored everywhere and those ignored in
 * this language alone. Where a line is both, the everywhere row is the one returned -- it is
 * the broader decision, and the one a language's own cannot undo.
 */
export async function readIgnores(lang: Lang = BASE_LANG): Promise<Map<string, LineIgnore>> {
  const holder = globalThis as CacheHolder;
  const current = await stamp();
  if (holder[cacheKey]?.stamp !== current) holder[cacheKey] = { stamp: current, byLang: new Map() };
  const memo = holder[cacheKey]!.byLang;

  let map = memo.get(lang);
  if (!map) {
    const { rows } = await db().query<IgnoreRow>(
      `select "lineId", "lang", "reason", "createdAt", "createdBy" from "line_ignore"
        where "lang" is null or "lang" = $1
        order by "lang" nulls last`,
      [lang],
    );
    map = new Map(rows.map((r) => [r.lineId, toIgnore(r)]));
    memo.set(lang, map);
  }
  return map;
}

export async function writeIgnore(
  lineId: string,
  reason: string,
  // Nullable to match the column, which is SET NULL: who decided outlives the account.
  userId: string | null,
  // Null ignores the line in every language, which is what every ignore used to mean.
  lang: Lang | null = null,
): Promise<LineIgnore> {
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("an ignore needs a reason: a decision nobody can revisit is a bug");
  // Ignoring one voice of a line ignores the line, as the pack build reads it.
  lineId = baseLineId(lineId);

  const { rows } = await db().query<IgnoreRow>(
    `insert into "line_ignore" ("lineId", "lang", "reason", "createdBy")
     values ($1, $4, $2, $3)
     on conflict ("lineId", (coalesce("lang", ''))) do update
        set "reason" = excluded."reason",
            "createdAt" = now(),
            "createdBy" = excluded."createdBy"
     returning "lineId", "lang", "reason", "createdAt", "createdBy"`,
    [lineId, trimmed, userId, lang],
  );
  forgetIgnores();
  // A null lang is an ignore in every language, and so a row every language's log shows.
  await recordActivity({
    kind: "ignore.set",
    lang,
    actorId: userId,
    source: "quests",
    subject: lineId,
    lineId,
    detail: { reason: trimmed },
  });
  return toIgnore(rows[0]);
}

/** `by` is who lifted it, for the activity log: the delete leaves nothing else behind. */
export async function clearIgnore(
  lineId: string,
  lang: Lang | null,
  by: string | null,
): Promise<boolean> {
  lineId = baseLineId(lineId);
  const { rowCount } = await db().query(
    `delete from "line_ignore" where "lineId" = $1 and "lang" is not distinct from $2`,
    [lineId, lang],
  );
  forgetIgnores();
  const removed = (rowCount ?? 0) > 0;
  if (removed) {
    await recordActivity({
      kind: "ignore.cleared",
      lang,
      actorId: by,
      source: "quests",
      subject: lineId,
      lineId,
      detail: {},
    });
  }
  return removed;
}

/**
 * Forget the memo after a write in this worker. Same race overrides.ts guards: `createdAt`
 * is `now()`, and a read inside the same transaction timestamp would see an unchanged stamp.
 */
export function forgetIgnores(): void {
  delete (globalThis as CacheHolder)[cacheKey];
}
