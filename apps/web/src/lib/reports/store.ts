/**
 * The only module that knows the report table's column names, following lib/generation/queue.ts.
 *
 * One table for both sides of the site (migration 0021), so every read takes a source filter
 * rather than pinning one: the triage page shows both by default, because a report is a
 * person waiting for an answer and which corpus it is about does not change how long they
 * have been waiting.
 *
 * countRecent is the rate limiter's entire implementation. It counts in Postgres rather than
 * in process memory so the limit survives a pm2 restart, which is precisely the moment a
 * flood would otherwise get through. It does not filter by source, deliberately: the limit is
 * on a person, and filing ten from each page is filing twenty.
 *
 * Every read and write runs as the team that owns the report's language. The two that cannot
 * know it run across every team: the rate limit, which is on a person in any language, and
 * reportPlace, which is how a route finds the language and queue to check a permission against.
 */
import { recordActivity } from "@/lib/activity/store";
import { BASE_LANG, type Lang } from "@/lib/lang";
import { ALL_TEAMS, query, queryIn } from "@/lib/db";
import { readOverrides } from "@/lib/quests/overrides";
import { queryAs, readAs } from "@/lib/teams/store";

import type { ReportContext } from "./context";
import { type Category, type Queue, type Report, type Status } from "./reports";
import type { Source } from "@/lib/sections";

// Timestamps are cast to text so a Report is the same shape in Postgres, over JSON and in the
// browser. `pg` hands back Date objects for timestamptz, which survive neither the wire nor a
// server-to-client component boundary as themselves. Through to_json rather than ::text, which
// writes `2026-10-03 12:34:56+00`: Safari's Date.parse refuses the space and the bare offset,
// and ISO 8601 parses everywhere.
const COLUMNS = `"id", "source", "lineId", "target", "category", "body", "status", "userId",
                 "name", "email", to_json("createdAt") #>> '{}' as "createdAt",
                 to_json("resolvedAt") #>> '{}' as "resolvedAt", "resolvedBy", "context", "queue"`;

/**
 * A complaint about the words goes to whoever keeps them, unless the words were the team's own:
 * `file` is the line's audio path, null where there is none or the section has no overrides.
 */
export async function queueFor(category: string, lang: Lang, file: string | null): Promise<Queue> {
  if (category === "other") return "text";
  if (category !== "wrong_text") return "audio";
  return file !== null && (await readOverrides(lang)).has(file) ? "audio" : "text";
}

export async function createReport(input: {
  source: Source;
  lang?: Lang;
  lineId: string | null;
  target: string | null;
  /** The English quest line's audio path, which is what an override is filed under. */
  file?: string | null;
  category: Category;
  body: string;
  userId: string | null;
  name: string | null;
  email: string | null;
  ip: string | null;
  context?: ReportContext | null;
}): Promise<void> {
  // Returns nothing: the reporter cannot read a report back, so an id would only be a handle
  // on something they cannot reach. The team comes from the language alone, so the addon's
  // anonymous report is filed with whoever looks after its language.
  const lang = input.lang ?? BASE_LANG;
  const queue = await queueFor(input.category, lang, input.file ?? null);
  await queryAs(
    lang,
    `insert into "report"
       ("source", "lang", "lineId", "target", "category", "body", "userId", "name", "email", "ip",
        "context", "queue")
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      input.source,
      lang,
      input.lineId,
      input.target,
      input.category,
      input.body,
      input.userId,
      input.name,
      input.email,
      input.ip,
      input.context ? JSON.stringify(input.context) : null,
      queue,
    ],
  );
}

export async function countRecent(ip: string, withinMs: number): Promise<number> {
  const rows = await queryIn<{ count: string }>(
    ALL_TEAMS,
    `select count(*)::text as count
       from "report"
      where "ip" = $1
        and "createdAt" > now() - ($2::bigint * interval '1 millisecond')`,
    [ip, withinMs],
  );
  return Number(rows[0]?.count ?? 0);
}

export async function listReports(
  status: Status | "all",
  source: Source | "all" = "all",
  category: Category | "all" = "all",
  /** Null for every one: the triage page counts each tab, so it reads them all. */
  limit: number | null = 500,
  lang: Lang = BASE_LANG,
  /** The queues the viewer works; absent for every report in the language. */
  queues?: readonly Queue[],
): Promise<Report[]> {
  // One language's reports, like every other list on a page in that language: a claim about
  // how a Portuguese take sounds is for whoever looks after the Portuguese.
  const where: string[] = [`"lang" = $2`];
  const params: unknown[] = [limit, lang];
  if (status !== "all") where.push(`"status" = $${params.push(status)}`);
  if (source !== "all") where.push(`"source" = $${params.push(source)}`);
  // Across sources on purpose: "everyone who says a word is being read wrong" is one
  // worklist, and which corpus each of them was playing does not change the fix.
  if (category !== "all") where.push(`"category" = $${params.push(category)}`);
  if (queues) where.push(`"queue" = any($${params.push(queues)}::text[])`);

  return readAs<Report>(
    lang,
    `select ${COLUMNS}
       from "report"
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by "createdAt" desc
      limit $1`,
    params,
  );
}

export async function reportsForLine(
  source: Source,
  lineId: string,
  lang: Lang = BASE_LANG,
  /** The queues the viewer works; absent for every report on the line. */
  queues?: readonly Queue[],
): Promise<Report[]> {
  return readAs<Report>(
    lang,
    `select ${COLUMNS}
       from "report"
      where "source" = $1 and "lineId" = $2 and "lang" = $3
        and ($4::text[] is null or "queue" = any($4::text[]))
      order by "status" = 'open' desc, "createdAt" desc`,
    [source, lineId, lang, queues ?? null],
  );
}

/** `lang` is the report's, from reportLang. */
export async function reportById(id: number, lang: Lang): Promise<Report | null> {
  const rows = await readAs<Report>(lang, `select ${COLUMNS} from "report" where "id" = $1`, [id]);
  return rows[0] ?? null;
}

/**
 * The language a report was filed in and the queue it waits in, or null for an id that does not
 * exist. Across every team: these are what say whose it is, and whether the caller may see it.
 */
export async function reportPlace(id: number): Promise<{ lang: Lang; queue: Queue } | null> {
  const rows = await queryIn<{ lang: Lang; queue: Queue }>(
    ALL_TEAMS,
    `select "lang", "queue" from "report" where "id" = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Who works each queue in a language, as the triage pages compare them. Site owners are left out:
 * they hold both everywhere, seeded rows or not, so they say nothing about whether the groups differ.
 */
export async function queueHolders(lang: Lang): Promise<Record<Queue, Set<string>>> {
  const rows = await query<{ userId: string; queue: Queue }>(
    `select g."userId", 'text' as "queue"
       from "language_grant" g join "user" u on u."id" = g."userId"
      where g."lang" = $1 and u."role" is distinct from 'admin'
     union
     select m."userId", 'audio'
       from "team_member" m join "user" u on u."id" = m."userId"
      where m."lang" = $1 and m."capability" in ('edit', 'admin') and u."role" is distinct from 'admin'`,
    [lang],
  );
  const holders = (queue: Queue) => new Set(rows.filter((row) => row.queue === queue).map((row) => row.userId));
  return { text: holders("text"), audio: holders("audio") };
}

/** `lang` is the report's, from reportPlace. A report already there is left as it is, and unlogged. */
export async function setQueue(id: number, queue: Queue, actorId: string, lang: Lang): Promise<Report | null> {
  const { rows } = await queryAs<Report & { lang: Lang }>(
    lang,
    `update "report" set "queue" = $2 where "id" = $1 and "queue" <> $2 returning ${COLUMNS}, "lang"`,
    [id, queue],
  );
  if (!rows[0]) return reportById(id, lang);
  const { lang: filed, ...report } = rows[0];
  await recordActivity({
    kind: "report.passed",
    lang: filed,
    source: report.source,
    subject: String(report.id),
    lineId: report.lineId,
    actorId,
    detail: { to: queue },
  });
  return report;
}

/** `lang` is the report's, from reportPlace. */
export async function setStatus(
  id: number,
  status: Status,
  userId: string,
  lang: Lang,
): Promise<Report | null> {
  // Reopening clears the resolution rather than leaving a stale resolver on an open report.
  const { rows } = await queryAs<Report & { lang: Lang }>(
    lang,
    `update "report"
        set "status" = $2,
            "resolvedAt" = case when $2 = 'open' then null else now() end,
            "resolvedBy" = case when $2 = 'open' then null else $3 end
      where "id" = $1
      returning ${COLUMNS}, "lang"`,
    [id, status, userId],
  );
  if (!rows[0]) return null;
  const { lang: filed, ...report } = rows[0];
  // After the update, which is one statement with no transaction to join. A reopen is logged
  // too, as status "open": it undoes a resolution somebody else may have relied on.
  await recordActivity({
    kind: "report.resolved",
    lang: filed,
    source: report.source,
    subject: String(report.id),
    lineId: report.lineId,
    actorId: userId,
    detail: { status: report.status, category: report.category },
  });
  return report;
}

/**
 * The open reports in one language that this person put aside while sorting. Every section at
 * once: ids are unique across them, so a caller holding one section's reports can use it as is.
 */
export async function skippedIds(userId: string, lang: Lang): Promise<Set<number>> {
  const rows = await readAs<{ id: string }>(
    lang,
    `select r."id"::text as "id"
       from "report_skip" s
       join "report" r on r."id" = s."reportId"
      where s."userId" = $1 and r."lang" = $2 and r."status" = 'open'`,
    [userId, lang],
  );
  return new Set(rows.map((row) => Number(row.id)));
}

/**
 * Only open reports in `lang` are written: the caller's grant is for that language, and an
 * id from another one, or one already answered, has nothing to put aside.
 */
export async function skipReports(
  userId: string,
  ids: number[],
  lang: Lang,
  queues: readonly Queue[],
): Promise<number> {
  if (!ids.length) return 0;
  const { rowCount } = await queryAs(
    lang,
    `insert into "report_skip" ("userId", "reportId")
     select $1, "id" from "report"
      where "id" = any($2::bigint[]) and "lang" = $3 and "status" = 'open' and "queue" = any($4::text[])
     on conflict do nothing`,
    [userId, ids, lang, queues],
  );
  return rowCount ?? 0;
}

/** Puts every report this person skipped in one section and language back in their queue. */
export async function resetSkips(userId: string, source: Source, lang: Lang): Promise<number> {
  const { rowCount } = await queryAs(
    lang,
    `delete from "report_skip" s
      using "report" r
      where r."id" = s."reportId" and s."userId" = $1 and r."source" = $2 and r."lang" = $3`,
    [userId, source, lang],
  );
  return rowCount ?? 0;
}
