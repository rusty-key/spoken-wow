/**
 * The spoken text someone has rewritten by hand, and where generation reads it from.
 *
 * Keyed on the store-relative file, as the take table is and for the same reason: one mp3
 * is spoken by up to many NPCs, so a rewrite necessarily changes what all of them say. See
 * the header of migration 0012 for why rewriting the spoken text cannot rename that file.
 *
 * A file has the same name in every language, so an override is its language's, and is read and
 * written as that language's team.
 */
import { auditDetail, type ApiAudit } from "../activity/kinds";
import { recordActivity } from "../activity/store";
import { fileIndex } from "../audio";
import type { CorpusLine } from "../corpus";
import { shapedText } from "../generation/files";
import { PROVIDERS } from "../generation/providers";
import { currentConfig } from "../generation/settings";
import { spokenHash } from "../generation/spoken-hash";
import type { Lang } from "../lang";
import { memoByTeamLang } from "../memo";
import { queryAs, readAs } from "../teams/store";
import { overrideOf, type LineOverride } from "./override";

type OverrideRow = {
  file: string;
  lineId: string;
  text: string;
  updatedAt: Date;
  updatedBy: string | null;
  originalHash: string | null;
};

function toOverride(row: OverrideRow): LineOverride {
  return {
    file: row.file,
    lineId: row.lineId,
    text: row.text,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    originalHash: row.originalHash,
  };
}

async function stamp(lang: Lang): Promise<string> {
  const rows = await readAs<{ stamp: string | null }>(
    lang,
    `select count(*)::text || ':' || coalesce(max("updatedAt")::text, '-') as stamp
       from "line_override" where "lang" = $1`,
    [lang],
  );
  // The count is load-bearing: a delete leaves max(updatedAt) where it was, so a timestamp
  // alone would keep serving an override that no longer exists.
  return rows[0]?.stamp ?? "-";
}

const cacheKey = Symbol.for("wow-voiceover.line-overrides");

/**
 * A language's overrides, by file. Memoised behind the stamp because search needs them for every
 * row of every page, and regeneration needs them to be right rather than
 * recent - pm2 runs two workers, and an edit made on one must reach the other.
 *
 * The whole language because there are tens of these, not thousands: an override is a line
 * someone sat down and rewrote.
 */
export async function readOverrides(lang: Lang): Promise<Map<string, LineOverride>> {
  return memoByTeamLang(cacheKey, lang, await stamp(lang), async () => {
    const rows = await readAs<OverrideRow>(
      lang,
      `select "file", "lineId", "text", "updatedAt", "updatedBy", "originalHash"
         from "line_override" where "lang" = $1`,
      [lang],
    );
    return new Map(rows.map((r) => [r.file, toOverride(r)]));
  });
}

export async function writeOverride(
  lang: Lang,
  file: string,
  lineId: string,
  text: string,
  // Nullable to match the column, which is SET NULL: who rewrote a line outlives the account.
  userId: string | null,
  audit?: ApiAudit,
): Promise<{ override: LineOverride; before: string | null }> {
  const index = await fileIndex(lang);
  const original = index.get(file);
  const said = await spokenHashes(lang, file, text, index);
  // "before" is read in the same statement, from the snapshot the upsert started with, so
  // the log says what this write replaced and not what a concurrent one did.
  const { rows } = await queryAs<OverrideRow & { before: string | null }>(
    lang,
    `with "was" as (select "text" from "line_override" where "file" = $1 and "lang" = $6)
     insert into "line_override" ("file", "lineId", "text", "updatedBy", "originalHash", "lang", "spokenHashes")
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict ("teamId", "lang", "file") do update
        set "text" = excluded."text",
            "lineId" = excluded."lineId",
            "updatedAt" = now(),
            "updatedBy" = excluded."updatedBy",
            "originalHash" = excluded."originalHash",
            "spokenHashes" = excluded."spokenHashes"
     returning "file", "lineId", "text", "updatedAt", "updatedBy", "originalHash",
               (select "text" from "was") as "before"`,
    [file, lineId, text, userId, original ? spokenHash(original.text) : null, lang, said],
  );
  forgetOverrides();
  const { before, ...row } = rows[0];
  // Saving the text the line already says is not a rewrite, and would only bury real ones.
  if (before !== text) {
    await recordActivity({
      kind: "override.set",
      lang,
      actorId: userId,
      source: "quests",
      subject: file,
      lineId,
      detail: { text, before, ...auditDetail(audit, null) },
    });
  }
  return { override: toOverride(row), before };
}

/**
 * Every hash a take speaking `text` as this override can carry: one per file that resolves to it
 * (its own and its voices') and per provider, since each shapes the words with its own voice's
 * direction. Null for a file no line names, which no take can speak.
 */
async function spokenHashes(
  lang: Lang,
  file: string,
  text: string,
  index: Map<string, CorpusLine>,
): Promise<string[] | null> {
  const own = new Map([[file, { file } as LineOverride]]);
  const stem = file.replace(/\.mp3$/, "");
  const lines = [...index].filter(([f]) => f.startsWith(stem) && overrideOf(own, f)).map(([, line]) => line);
  if (lines.length === 0) return null;
  const { raceTags } = await currentConfig(lang);
  return [
    ...new Set(lines.flatMap((line) => PROVIDERS.map((p) => spokenHash(shapedText(text, lang, line, p, raceTags))))),
  ];
}

/** `by` is who reverted it, for the activity log: the delete leaves nothing else behind. */
export async function clearOverride(
  lang: Lang,
  file: string,
  by: string | null,
  audit?: ApiAudit,
): Promise<boolean> {
  const { rows } = await queryAs<{ lineId: string; text: string }>(
    lang,
    `delete from "line_override" where "file" = $1 and "lang" = $2 returning "lineId", "text"`,
    [file, lang],
  );
  forgetOverrides();
  if (rows[0]) {
    await recordActivity({
      kind: "override.cleared",
      lang,
      actorId: by,
      source: "quests",
      subject: file,
      lineId: rows[0].lineId,
      detail: { before: rows[0].text, ...auditDetail(audit, null) },
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
  delete (globalThis as Record<symbol, unknown>)[cacheKey];
}

/** The text that would actually be sent for a line, before pronunciation rules. */
export function effectiveText(
  line: { text: string },
  file: string,
  overrides: Map<string, LineOverride>,
): string {
  return overrideOf(overrides, file)?.text ?? line.text;
}
