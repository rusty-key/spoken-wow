/**
 * What a press of Release would send that players do not have yet: the audio that went live in a
 * section since its last release.
 *
 * Not the release's own comparison, which needs the pack built and hashed against the channel
 * and takes minutes (scripts/manager/publish.mjs). This reads what that build reads -- a
 * section's current takes in the language, scripts/audio/sounds.mjs -- and keeps those that
 * became current after the last run that released or found nothing to release started. A new
 * take is a row of its own; putting an older version back writes none, so restores come from the
 * activity log.
 */
import "server-only";

import type { Lang } from "@/lib/lang";
import { readAs } from "@/lib/teams/store";
import { namesOf } from "@/lib/users/store";

import type { PendingChange, PendingView, ReleaseSection } from "./sections";

/** As many as the dialog lists; the counts are of all of them. */
const LISTED = 200;

/**
 * Per section, what a line is called and what it says, in the language: the reviewer reads
 * German, not ids. Each is a lateral join on `c` and yields "title" and "text"; a line with no
 * text row yet yields nulls and shows by its id.
 */
const TEXT: Record<ReleaseSection, string> = {
  quests: `select l."questTitle" as "title", l."text" from "quest_line" l
            where l."lineId" = c."lineId" and l."lang" = $2 and l."isCurrent" order by l."variant" limit 1`,
  places: `select l."name" as "title", coalesce(l."full", l."short") as "text" from "lore_line" l
            where l."lineId" = c."lineId" and l."lang" = $2 and l."isCurrent" limit 1`,
  readables: `select l."title", l."text" from "book_line" l
               where l."lineId" = c."lineId" and l."lang" = $2 and l."isCurrent" limit 1`,
  bosses: `select concat_ws(' · ', b."zone", b."key") as "title", l."text" from "boss" b
             join "boss_line" l on l."bossId" = b."id" and l."lang" = $2 and l."isCurrent"
            where c."lineId" = 'boss:' || b."map" || ':' || b."key" limit 1`,
};

type Row = {
  file: string;
  lineId: string | null;
  version: number;
  at: Date;
  by: string | null;
  kind: "new" | "restored";
  title: string | null;
  text: string | null;
};

/**
 * Every file whose live audio changed since `$3`, as `file, lineId, version, at, by, kind`.
 *
 * A restore counts only when it put back something other than what was live at `$3`: cutting
 * v3 and going back to v2 is an undo, and players already have v2. What was live then is
 * taken as the newest version older than `$3`, which holds unless that file had a restore
 * before `$3` too.
 */
const CHANGED = `
  select t."file", t."lineId", t."version", t."createdAt" as "at", t."createdBy" as "by", 'new' as "kind"
    from "take" t
   where t."source" = $1 and t."lang" = $2 and t."isCurrent" and t."teamId" = team_of_lang($2)
     and ($3::timestamptz is null or t."createdAt" > $3)
  union all
  -- A file restored and regenerated since counts once, as the newer take; restored twice, once,
  -- at the latest.
  select * from (
    select distinct on (a."subject") a."subject", t."lineId", t."version", a."at", a."actorId", 'restored'
      from "activity" a
      join "take" t on t."source" = a."source" and t."lang" = a."lang" and t."file" = a."subject"
                   and t."isCurrent" and t."teamId" = team_of_lang($2)
     where $3::timestamptz is not null and a."kind" = 'take.restored' and a."lang" = $2
       and a."source" = $1 and a."at" > $3 and t."createdAt" <= $3
       and t."version" is distinct from (
         select max(o."version") from "take" o
          where o."source" = t."source" and o."lang" = t."lang" and o."file" = t."file"
            and o."teamId" = t."teamId" and o."createdAt" <= $3)
     order by a."subject", a."at" desc
  ) restored`;

/**
 * Text the release rebuilds into the pack's lookup without any audio changing: an edited or
 * retired line, a renamed one, one ignored or let back in. Distinct lines, not edits.
 */
const TEXT_KINDS = ["text.edited", "text.restored", "text.retired", "name.edited", "name.restored", "name.retired", "ignore.set", "ignore.cleared"];

/**
 * With `list` false, the counts alone: the dashboard says how many and links here, and the
 * list and its text lookups are the most expensive part.
 */
export async function pendingChanges(
  section: ReleaseSection,
  lang: Lang,
  since: Date | null,
  { list = true }: { list?: boolean } = {},
): Promise<PendingView> {
  // One after another: every caller asks for several sections at once, and each query here is a
  // connection of its own, so in parallel one page view could hold a dozen of the pool's thirty.
  const counts = await readAs<{ total: string; restored: string }>(
    lang,
    `select count(*) as "total", count(*) filter (where "kind" = 'restored') as "restored" from (${CHANGED}) c`,
    [section, lang, since],
  );
  const rows = list
    ? await readAs<Row>(
        lang,
        `select c.*, x."title", x."text"
           from (select * from (${CHANGED}) changed order by "at" desc limit ${LISTED}) c
           left join lateral (${TEXT[section]}) x on true
          order by c."at" desc`,
        [section, lang, since],
      )
    : [];
  const people = list
    ? await readAs<{ by: string | null; count: string }>(
        lang,
        `select "by", count(*) as "count" from (
           select t."createdBy" as "by" from "take" t
            where t."source" = $1 and t."lang" = $2 and t."isCurrent" and t."teamId" = team_of_lang($2)
              and ($3::timestamptz is null or t."createdAt" > $3)
         ) p group by "by" order by count(*) desc`,
        [section, lang, since],
      )
    : [];
  // Before any release everything goes out anyway, so there is nothing to add.
  const text = since
    ? await readAs<{ count: string }>(
        lang,
        `select count(distinct coalesce("lineId", "subject")) as "count" from "activity"
          where "lang" = $1 and "source" = $2 and "at" > $3 and "kind" = any($4::text[])`,
        [lang, section, since, TEXT_KINDS],
      )
    : [{ count: "0" }];
  const names = await namesOf([...rows.map((row) => row.by), ...people.map((row) => row.by)]);
  const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  const changes: PendingChange[] = rows.map((row) => ({
    file: row.file,
    lineId: row.lineId,
    version: row.version,
    at: row.at.toISOString(),
    byId: row.by,
    by: name(row.by),
    kind: row.kind,
    title: row.title,
    text: row.text,
  }));
  return {
    since: since?.toISOString() ?? null,
    count: Number(counts[0]?.total ?? 0),
    restored: Number(counts[0]?.restored ?? 0),
    textChanges: Number(text[0]?.count ?? 0),
    // New takes only: who put an older version back is in `changes`, and is rarely many.
    people: people.map((row) => ({ id: row.by, name: name(row.by), count: Number(row.count) })),
    changes,
  };
}
