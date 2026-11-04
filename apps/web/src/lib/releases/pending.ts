/**
 * What a press of Release would send that players do not have yet: the audio that went live in a
 * section since its last release, and the lines whose text changed without new audio.
 *
 * Not the release's own comparison, which needs the pack built and hashed against the channel
 * and takes minutes. This reads the section's current takes in the language, which the build
 * starts from, and keeps those that became current after the last run that released or found
 * nothing to release started. The build also leaves out takes no line names any more; one of
 * those counts here until a release finds it unchanged, which is why the review says its numbers
 * can differ. A new take is a row of its own; putting an older version back writes none, so
 * restores come from the activity log.
 */
import "server-only";

import type { Lang } from "@/lib/lang";
import { readAs } from "@/lib/teams/store";
import { namesOf } from "@/lib/users/store";

import { RELEASE_SECTIONS, type PendingChange, type PendingView, type ReleaseSection } from "./sections";
import { lastReleasedAt } from "./store";

/** As many as the dialog lists; the counts are of all of them. */
const LISTED = 200;

/**
 * Per section, what a line is called and what it says, in the language: the reviewer reads
 * German, not ids. Each is a lateral join on `c` and yields "title" and "text"; a line with no
 * text row yet yields nulls and shows by its id. Gossip has no quest, so it is titled as gossip.
 */
const TEXT: Record<ReleaseSection, string> = {
  quests: `select coalesce(l."questTitle", case when l."lineId" like 'g:%' then 'Gossip' end) as "title", l."text"
             from "quest_line" l
            where l."lineId" = c."lineId" and l."lang" = $2 and l."isCurrent" order by l."variant" limit 1`,
  places: `select l."name" as "title", coalesce(l."full", l."short") as "text" from "lore_line" l
            where l."lineId" = c."lineId" and l."lang" = $2 and l."isCurrent" limit 1`,
  readables: `select l."title", l."text" from "book_line" l
               where l."lineId" = c."lineId" and l."lang" = $2 and l."isCurrent" limit 1`,
  bosses: `select concat_ws(' · ', b."zone", b."key") as "title", l."text" from "boss" b
             join "boss_line" l on l."bossId" = b."id" and l."lang" = $2 and l."isCurrent"
            where c."lineId" = 'boss:' || b."map" || ':' || b."key" limit 1`,
};

/** Per section, the takes its build leaves out, as a condition on `t`: a retired boss ships none. */
const SHIPPED: Record<ReleaseSection, string> = {
  quests: "",
  places: "",
  readables: "",
  bosses: `and not exists (select 1 from "boss" b
                            where 'boss:' || b."map" || ':' || b."key" = t."lineId" and b."retired")`,
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
 * v3 and going back to v2 is an undo, and players already have v2. What was live then is the
 * version the file's last cut or restore before `$3` made live, or, for a file older than the
 * activity log, its newest version from before `$3`.
 */
function changed(section: ReleaseSection): string {
  return `
  select t."file", t."lineId", t."version", t."createdAt" as "at", t."createdBy" as "by", 'new' as "kind"
    from "take" t
   where t."source" = $1 and t."lang" = $2 and t."isCurrent" and t."teamId" = team_of_lang($2)
     and ($3::timestamptz is null or t."createdAt" > $3) ${SHIPPED[section]}
  union all
  -- A file restored and regenerated since counts once, as the newer take; restored twice, once,
  -- at the latest.
  select * from (
    select distinct on (a."subject") a."subject", t."lineId", t."version", a."at", a."actorId", 'restored'
      from "activity" a
      join "take" t on t."source" = a."source" and t."lang" = a."lang" and t."file" = a."subject"
                   and t."isCurrent" and t."teamId" = team_of_lang($2)
     where $3::timestamptz is not null and a."kind" = 'take.restored' and a."lang" = $2
       and a."source" = $1 and a."at" > $3 and t."createdAt" <= $3 ${SHIPPED[section]}
       and t."version" is distinct from coalesce(
         (select (e."detail"->>'version')::int from "activity" e
           where e."lang" = $2 and e."source" = $1 and e."subject" = t."file"
             and e."kind" in ('take.generated', 'take.restored') and e."at" <= $3
           order by e."at" desc limit 1),
         (select max(o."version") from "take" o
           where o."source" = t."source" and o."lang" = t."lang" and o."file" = t."file"
             and o."teamId" = t."teamId" and o."createdAt" <= $3))
     order by a."subject", a."at" desc
  ) restored`;
}

/**
 * Text the release rebuilds into the pack's lookup without any audio changing: an edited or
 * retired line, a renamed one, one ignored or let back in. Distinct lines, not edits, and none
 * that has a new take too, since that line is counted with the audio already.
 */
const TEXT_KINDS = ["text.edited", "text.restored", "text.retired", "ignore.set", "ignore.cleared"];

/**
 * The name kinds each section's build reads as they stand on the site. A name's activity row has
 * no section, so its kind is what says which pack it changes. Quest titles ship from quest_line,
 * and readables' lookup takes only extracted and contributed names, so a site edit of either
 * reaches no pack and would read as a release with nothing in it.
 */
const SHIPPED_NAMES: Record<ReleaseSection, readonly string[]> = {
  quests: ["creature", "gameobject", "item"],
  places: ["zone", "subzone"],
  readables: [],
  bosses: ["boss"],
};

/**
 * With `list` false, the counts alone: the release page asks for those on every check, and the
 * list with its text lookups only when a review opens.
 */
export async function pendingChanges(
  section: ReleaseSection,
  lang: Lang,
  since: Date | null,
  { list = true }: { list?: boolean } = {},
): Promise<PendingView> {
  const CHANGED = changed(section);
  // One after another: a page asks for every section at once, and each query here holds a
  // connection of its own while it runs.
  const byPerson = await readAs<{ by: string | null; count: string; restored: string }>(
    lang,
    `select "by", count(*) as "count", count(*) filter (where "kind" = 'restored') as "restored"
       from (${CHANGED}) c group by "by" order by count(*) desc`,
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
  // Everybody in the list, restores included, so a person's chip counts the rows it filters to.
  const people = list ? byPerson : [];
  // Before any release everything goes out anyway, so there is nothing to add.
  const text = since
    ? await readAs<{ count: string }>(
        lang,
        `select count(distinct coalesce(a."lineId", a."subject")) as "count" from "activity" a
          where a."at" > $3
            and ((a."lang" = $1 and a."source" = $2 and a."kind" = any($4::text[]))
                 -- An ignore in every language has no language of its own, and the build applies it.
                 or (a."lang" is null and a."source" = $2 and a."kind" in ('ignore.set', 'ignore.cleared'))
                 or (a."lang" = $1 and a."source" is null and a."kind" in ('name.edited', 'name.restored', 'name.retired')
                     and split_part(a."subject", ':', 1) = any($5::text[])))
            and not exists (select 1 from "take" t
                             where t."source" = $2 and t."lang" = $1 and t."isCurrent"
                               and t."lineId" = coalesce(a."lineId", a."subject") and t."createdAt" > $3)`,
        [lang, section, since, TEXT_KINDS, SHIPPED_NAMES[section]],
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
    count: byPerson.reduce((sum, row) => sum + Number(row.count), 0),
    restored: byPerson.reduce((sum, row) => sum + Number(row.restored), 0),
    textChanges: Number(text[0]?.count ?? 0),
    people: people.map((row) => ({ id: row.by, name: name(row.by), count: Number(row.count) })),
    changes,
  };
}

/** Every section's counts in a language, each from its own last release. */
export async function pendingBySection(lang: Lang): Promise<Record<ReleaseSection, PendingView>> {
  const released = await lastReleasedAt(lang);
  const sections = await Promise.all(
    RELEASE_SECTIONS.map(
      async (section) => [section, await pendingChanges(section, lang, released.get(section) ?? null, { list: false })] as const,
    ),
  );
  return Object.fromEntries(sections) as Record<ReleaseSection, PendingView>;
}
