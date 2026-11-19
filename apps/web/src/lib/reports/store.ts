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
 * on a person, and filing ten from each page is filing twenty. A signed-in person is counted by
 * account, so others on their network cannot use up their allowance.
 *
 * An audio report is the team's it was filed under, and a text report is the language's: whoever
 * holds `text` there handles it whatever team they work in. So a read runs across every team and
 * cuts to the acting team's rows plus the text queue (REPORT_SCOPE), and a write on a text report
 * runs as the report's own team. The rate limit, which is on a person in any language, and
 * reportPlace, which is how a route finds the language and queue to check a permission against,
 * run across every team too.
 */
import type { PoolClient, QueryResultRow } from "pg";

import { recordActivity } from "@/lib/activity/store";
import { BASE_LANG, type Lang } from "@/lib/lang";
import { ALL_TEAMS, queryIn, withTeam, type TeamId } from "@/lib/db";
import { viewersIn } from "@/lib/grants/store";
import { isAdmin } from "@/lib/permissions";
import { overrideOf } from "@/lib/quests/override";
import { readOverrides } from "@/lib/quests/overrides";
import { asTeam } from "@/lib/teams/acting";
import { asTeamOf, freshOwners, NoTeamError, ownerOrAll, plainTeamOf, queryAs, teamsOf } from "@/lib/teams/store";

import { packTeam, type ReportContext } from "./context";
import { CATEGORIES, CATEGORY_QUEUE, QUEUES, queuesOf, type Category, type Queue, type Report, type Status } from "./reports";
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
 * The rows the acting team sees: the language's text queue, and its own audio reports. With no
 * team (a text maintainer in none of the language's), the text queue alone.
 */
const REPORT_SCOPE = (team: number) => `("queue" = 'text' or "teamId" = $${team}::uuid)`;

/** The acting team REPORT_SCOPE cuts by; null where the caller works in no team of `lang`. */
async function scopeTeam(lang: Lang): Promise<TeamId | null> {
  const team = await ownerOrAll(lang);
  return team === ALL_TEAMS ? null : team;
}

/**
 * A read across every team, cut by REPORT_SCOPE. `where` holds the conditions and `params` their
 * values; the acting team is added last.
 */
async function readScoped<T extends QueryResultRow>(
  lang: Lang,
  sql: (where: string) => string,
  where: readonly string[],
  params: readonly unknown[],
): Promise<T[]> {
  const team = await scopeTeam(lang);
  const scoped = [...where, REPORT_SCOPE(params.length + 1)].join(" and ");
  return queryIn<T>(ALL_TEAMS, sql(scoped), [...params, team]);
}

/**
 * A complaint about the words goes to whoever keeps them, unless the words were the team's own:
 * `file` is the line's audio path, null where there is none or the section has no overrides.
 */
export async function queueFor(category: Category, lang: Lang, file: string | null): Promise<Queue> {
  if (category !== "wrong_text" || file === null) return CATEGORY_QUEUE[category];
  return overrideOf(await readOverrides(lang), file) ? "audio" : CATEGORY_QUEUE[category];
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
  // on something they cannot reach. Each copy's queue is judged by its own team's overrides; a
  // text report is the language's, so it is filed once, whatever the teams.
  const lang = input.lang ?? BASE_LANG;
  const teams = await reportTeams(lang, input.context);
  if (teams.length === 0) throw new NoTeamError(lang);
  let filedText = false;
  for (const team of teams) {
    await asTeam(lang, team, async () => {
      const queue = await queueFor(input.category, lang, input.file ?? null);
      if (queue === "text" && filedText) return;
      filedText ||= queue === "text";
      await insertReport(input, lang, queue);
    });
  }
}

/**
 * The teams a report is filed with: the team whose pack played, else the reporter's, else the
 * team with plain packs, whose packs a report naming no team (an older addon, the plain pack)
 * played. Else every team of the language, since none of them is the one.
 */
async function reportTeams(lang: Lang, context: ReportContext | null | undefined): Promise<TeamId[]> {
  const pack = await packTeamOf(lang, context);
  if (pack) return [pack];
  const team = (await freshOwners([lang])).get(lang) ?? (await plainTeamOf(lang));
  if (team) return [team];
  return (await teamsOf(lang)).map((each) => each.id);
}

/**
 * The team the context names as the one whose pack played, where that team voices `lang`. A
 * slug naming any other team, which only a forged context can, is no team.
 */
async function packTeamOf(lang: Lang, context: ReportContext | null | undefined): Promise<TeamId | null> {
  const slug = packTeam(context);
  if (!slug) return null;
  return (await teamsOf(lang)).find((team) => team.slug === slug)?.id ?? null;
}

async function insertReport(input: Parameters<typeof createReport>[0], lang: Lang, queue: Queue): Promise<void> {
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

/** Who a report counts against: a signed-in reporter by account, anyone else by address. */
export type Reporter = { userId: string } | { ip: string };

export async function countRecent(reporter: Reporter, withinMs: number): Promise<number> {
  const [column, value] = "userId" in reporter ? ['"userId"', reporter.userId] : ['"ip"', reporter.ip];
  const rows = await queryIn<{ count: string }>(
    ALL_TEAMS,
    `select count(*)::text as count
       from "report"
      where ${column} = $1
        and "createdAt" > now() - ($2::bigint * interval '1 millisecond')`,
    [value, withinMs],
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
  queues: readonly Queue[] = QUEUES,
): Promise<Report[]> {
  // One language's reports, like every other list on a page in that language: a claim about
  // how a Portuguese take sounds is for whoever looks after the Portuguese.
  const where: string[] = [`"lang" = $2`, `"queue" = any($3::text[])`];
  const params: unknown[] = [limit, lang, queues];
  if (status !== "all") where.push(`"status" = $${params.push(status)}`);
  if (source !== "all") where.push(`"source" = $${params.push(source)}`);
  // Across sources on purpose: "everyone who says a word is being read wrong" is one
  // worklist, and which corpus each of them was playing does not change the fix.
  if (category !== "all") where.push(`"category" = $${params.push(category)}`);

  return readScoped<Report>(
    lang,
    (clause) => `select ${COLUMNS}
       from "report"
      where ${clause}
      order by "createdAt" desc
      limit $1`,
    where,
    params,
  );
}

/** Open reports per category in `queues`, as listReports would list them, with no rows to carry. */
export async function openReportCounts(lang: Lang, queues: readonly Queue[]): Promise<Record<Category, number>> {
  const rows = await readScoped<{ category: Category; count: string }>(
    lang,
    (clause) => `select "category", count(*) as "count" from "report"
      where ${clause} group by "category"`,
    [`"lang" = $1`, `"queue" = any($2::text[])`, `"status" = 'open'`],
    [lang, queues],
  );
  const counts = Object.fromEntries(CATEGORIES.map((category) => [category, 0])) as Record<Category, number>;
  for (const row of rows) counts[row.category] = Number(row.count);
  return counts;
}

export async function reportsForLine(
  source: Source,
  lineId: string,
  lang: Lang = BASE_LANG,
  queues: readonly Queue[] = QUEUES,
): Promise<Report[]> {
  return readScoped<Report>(
    lang,
    (clause) => `select ${COLUMNS}
       from "report"
      where ${clause}
      order by "status" = 'open' desc, "createdAt" desc`,
    [`"source" = $1`, `"lineId" = $2`, `"lang" = $3`, `"queue" = any($4::text[])`],
    [source, lineId, lang, queues],
  );
}

/** `lang` is the report's, from reportLang. */
export async function reportById(id: number, lang: Lang): Promise<Report | null> {
  const rows = await readScoped<Report>(
    lang,
    (clause) => `select ${COLUMNS} from "report" where ${clause}`,
    [`"id" = $1`],
    [id],
  );
  return rows[0] ?? null;
}

/**
 * The language a report was filed in and the queue it waits in, or null for an id that does not
 * exist. Across every team: these are what say whose it is, and whether the caller may see it.
 */
export async function reportPlace(id: number): Promise<{ lang: Lang; queue: Queue; teamId: TeamId } | null> {
  const rows = await queryIn<{ lang: Lang; queue: Queue; teamId: TeamId }>(
    ALL_TEAMS,
    `select "lang", "queue", "teamId" from "report" where "id" = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Who works each queue in a language, as the triage pages compare them. Site owners are left out:
 * they hold both everywhere, so they say nothing about whether the groups differ.
 */
export async function queueHolders(lang: Lang): Promise<Record<Queue, Set<string>>> {
  const holders: Record<Queue, Set<string>> = { text: new Set(), audio: new Set() };
  for (const [userId, viewer] of await viewersIn(lang)) {
    if (isAdmin(viewer.role)) continue;
    for (const queue of queuesOf(viewer, lang)) holders[queue].add(userId);
  }
  return holders;
}

/**
 * `work` as the team a write on `place` runs as: a text report's own team, whoever acts, and an
 * audio report as the acting team, so one that is not theirs matches nothing.
 */
function writeAs<T>(
  place: { queue: Queue; teamId: TeamId },
  lang: Lang,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return place.queue === "text" ? withTeam(place.teamId, work) : asTeamOf(lang, work);
}

/**
 * Added to a write's where clause: a text report written as its own team must still be a text
 * report when the write lands, or a concurrent pass to audio would let it change an audio one.
 */
function stillText(place: { queue: Queue }): string {
  return place.queue === "text" ? ` and "queue" = 'text'` : "";
}

/** `lang` is the report's. A report already in `queue` is left unlogged. */
export async function setQueue(id: number, queue: Queue, actorId: string, lang: Lang): Promise<Report | null> {
  const place = await reportPlace(id);
  if (!place) return null;
  const { rows } = await writeAs(place, lang, (client) => client.query<Report>(
    `update "report" set "queue" = $2 where "id" = $1 and "queue" <> $2${stillText(place)} returning ${COLUMNS}`,
    [id, queue],
  ));
  const report = rows[0];
  if (!report) return reportById(id, lang);
  await recordActivity({
    kind: "report.passed",
    lang,
    source: report.source,
    subject: String(report.id),
    lineId: report.lineId,
    actorId,
    detail: { to: queue },
    team: place.teamId,
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
  const place = await reportPlace(id);
  if (!place) return null;
  // Reopening clears the resolution rather than leaving a stale resolver on an open report.
  const { rows } = await writeAs(place, lang, (client) => client.query<Report & { lang: Lang }>(
    `update "report"
        set "status" = $2,
            "resolvedAt" = case when $2 = 'open' then null else now() end,
            "resolvedBy" = case when $2 = 'open' then null else $3 end
      where "id" = $1${stillText(place)}
      returning ${COLUMNS}, "lang"`,
    [id, status, userId],
  ));
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
    team: place.teamId,
  });
  return report;
}

/**
 * The open reports in one language that this person put aside while sorting. Every section at
 * once: ids are unique across them, so a caller holding one section's reports can use it as is.
 */
export async function skippedIds(userId: string, lang: Lang): Promise<Set<number>> {
  const rows = await readScoped<{ id: string }>(
    lang,
    (clause) => `select r."id"::text as "id"
       from "report_skip" s
       join "report" r on r."id" = s."reportId"
      where ${clause}`,
    [`s."userId" = $1`, `r."lang" = $2`, `r."status" = 'open'`],
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
  const team = await scopeTeam(lang);
  const { rowCount } = await withTeam(ALL_TEAMS, (client) => client.query(
    `insert into "report_skip" ("userId", "reportId")
     select $1, "id" from "report"
      where "id" = any($2::bigint[]) and "lang" = $3 and "status" = 'open' and "queue" = any($4::text[])
        and ${REPORT_SCOPE(5)}
     on conflict do nothing`,
    [userId, ids, lang, queues, team],
  ));
  return rowCount ?? 0;
}

/** Puts every report this person skipped in one section and language back in their queue. */
export async function resetSkips(userId: string, source: Source, lang: Lang): Promise<number> {
  const team = await scopeTeam(lang);
  const { rowCount } = await withTeam(ALL_TEAMS, (client) => client.query(
    `delete from "report_skip" s
      using "report" r
      where r."id" = s."reportId" and s."userId" = $1 and r."source" = $2 and r."lang" = $3
        and ${REPORT_SCOPE(4)}`,
    [userId, source, lang, team],
  ));
  return rowCount ?? 0;
}
