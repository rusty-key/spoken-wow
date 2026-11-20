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
import { readAsActing } from "@/lib/teams/store";
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
  /** The take live now, which a staged version's line may no longer have. */
  current: number | null;
};

/**
 * Per file, the version that was live at `at` (a parameter, null for none): the one the file's
 * last cut or restore up to then made live, or, for a file older than the activity log, its
 * newest version from then. As `file, version`, computed once per query rather than per take.
 */
function liveAt(at: string): string {
  return `select f."file", coalesce(a."version", f."version") as "version"
    from (select o."file", max(o."version") as "version" from "take" o
           where o."source" = $1 and o."lang" = $2 and o."teamId" = coalesce(spoken_team(), team_of_lang($2))
             and o."createdAt" <= ${at}
           group by o."file") f
    left join (select distinct on (e."subject") e."subject", (e."detail"->>'version')::int as "version"
                 from "activity" e
                where e."lang" = $2 and e."source" = $1 and e."kind" in ('take.generated', 'take.restored')
                  and e."at" <= ${at}
                order by e."subject", e."at" desc) a on a."subject" = f."file"`;
}

/**
 * Whether take `t` is the one live at `$4` (with `until_live` joined on its file), or live now
 * without `$4`.
 */
const LIVE = `($4::timestamptz is null and t."isCurrent"
    or $4::timestamptz is not null and t."createdAt" <= $4 and t."version" is not distinct from until_live."version")`;

/**
 * Every file whose live audio changed since `$3`, as `file, lineId, version, at, by, kind`: the
 * acting team's takes, which its release builds from, or the privileged team's read as all teams.
 * With `$4`, as it stood then: what a release that started at `$4` built from; without, the takes
 * live now.
 *
 * A restore counts only when it put back something other than what was live at `$3`: cutting
 * v3 and going back to v2 is an undo, and players already have v2.
 */
function changed(section: ReleaseSection): string {
  return `
  with until_live as (${liveAt("$4::timestamptz")}),
       since_live as (${liveAt("$3::timestamptz")})
  select t."file", t."lineId", t."version", t."createdAt" as "at", t."createdBy" as "by", 'new' as "kind"
    from "take" t
    left join until_live on until_live."file" = t."file"
   where t."source" = $1 and t."lang" = $2 and ${LIVE} and t."teamId" = coalesce(spoken_team(), team_of_lang($2))
     and ($3::timestamptz is null or t."createdAt" > $3) ${SHIPPED[section]}
  union all
  -- A file restored and regenerated since counts once, as the newer take; restored twice, once,
  -- at the latest.
  select * from (
    select distinct on (a."subject") a."subject", t."lineId", t."version", a."at", a."actorId", 'restored'
      from "activity" a
      join "take" t on t."source" = a."source" and t."lang" = a."lang" and t."file" = a."subject"
                   and t."teamId" = coalesce(spoken_team(), team_of_lang($2))
      left join until_live on until_live."file" = t."file"
      left join since_live on since_live."file" = t."file"
     where $3::timestamptz is not null and a."kind" = 'take.restored' and a."lang" = $2
       and a."source" = $1 and a."at" > $3 and ($4::timestamptz is null or a."at" <= $4)
       and ${LIVE} and t."createdAt" <= $3 ${SHIPPED[section]}
       and t."version" is distinct from since_live."version"
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
 * list with its text lookups only when a review opens. `people` (with the list by default) names
 * who made them, as the review page shows without the list. With `until`, the changes up to then
 * and the takes live then: a staged version, which built from what was live when it started.
 */
export async function pendingChanges(
  section: ReleaseSection,
  lang: Lang,
  since: Date | null,
  { list = true, people = list, until = null }: { list?: boolean; people?: boolean; until?: Date | null } = {},
): Promise<PendingView> {
  return summarize(section, lang, changed(section), [since, until], { list, people, since, until });
}

/**
 * The lines of staged run `$3`'s pack (its `takes`, as sounds.mjs recorded them) whose take is not
 * the one players have: none of `$4`'s, the release they have, or another version or hash of it.
 * As `file, lineId, version, at, by, kind`: an older version than one cut before the build counts
 * as put back.
 */
const STAGED = `
  with picked as (select p.key as "file", (p.value->>'version')::int as "version", p.value->>'sha256' as "sha256",
                         coalesce(r."startedAt", r."createdAt") as "built"
                    from "release_run" r, jsonb_each(r."takes") p where r."id" = $3),
       had as (select p.key as "file", (p.value->>'version')::int as "version", p.value->>'sha256' as "sha256"
                 from "release_run" r, jsonb_each(r."takes") p where r."id" = $4)
  select p."file", t."lineId", p."version", coalesce(t."createdAt", p."built") as "at", t."createdBy" as "by",
         case when exists (select 1 from "take" n
                            where n."source" = $1 and n."lang" = $2 and n."file" = p."file"
                              and n."teamId" = coalesce(spoken_team(), team_of_lang($2))
                              and n."version" > p."version" and n."createdAt" <= p."built")
              then 'restored' else 'new' end as "kind"
    from picked p
    left join had h on h."file" = p."file"
    left join "take" t on t."source" = $1 and t."lang" = $2 and t."file" = p."file" and t."version" = p."version"
                      and t."teamId" = coalesce(spoken_team(), team_of_lang($2))
   where h."file" is null or h."version" is distinct from p."version" or h."sha256" is distinct from p."sha256"`;

/**
 * What staged run `runId` changes for players, from the takes its pack was built from rather than
 * from the takes live when it started: each line it holds whose take players do not have from
 * `playersHave`, the team's release they have, or every line when that is null. Read as the run's
 * team. `since` and `until` count the text changes, which no take records.
 */
export async function stagedChanges(
  section: ReleaseSection,
  lang: Lang,
  runId: string,
  playersHave: string | null,
  { list = true, people = list, since, until }: { list?: boolean; people?: boolean; since: Date | null; until: Date | null },
): Promise<PendingView> {
  return summarize(section, lang, STAGED, [runId, playersHave], { list, people, since, until });
}

/** Counts, people and the newest lines of `CHANGED`, a query on `$1` section and `$2` language then `extra`. */
async function summarize(
  section: ReleaseSection,
  lang: Lang,
  CHANGED: string,
  extra: unknown[],
  { list, people: withPeople, since, until }: { list: boolean; people: boolean; since: Date | null; until: Date | null },
): Promise<PendingView> {
  const params = [section, lang, ...extra];
  // One after another: a page asks for every section at once, and each query here holds a
  // connection of its own while it runs.
  const byPerson = await readAsActing<{ by: string | null; count: string; restored: string }>(
    lang,
    `select "by", count(*) as "count", count(*) filter (where "kind" = 'restored') as "restored"
       from (${CHANGED}) c group by "by" order by count(*) desc`,
    params,
  );
  const rows = list
    ? await readAsActing<Row>(
        lang,
        `select c.*, x."title", x."text", live_now."version" as "current"
           from (select * from (${CHANGED}) changed order by "at" desc limit ${LISTED}) c
           left join lateral (${TEXT[section]}) x on true
           left join lateral (select n."version" from "take" n
                               where n."source" = $1 and n."lang" = $2 and n."file" = c."file" and n."isCurrent"
                                 and n."teamId" = coalesce(spoken_team(), team_of_lang($2))) live_now on true
          order by c."at" desc`,
        params,
      )
    : [];
  // Everybody in the list, restores included, so a person's chip counts the rows it filters to.
  const people = withPeople ? byPerson : [];
  const textChanges = await textChangeCount(section, lang, since, until);
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
    current: row.current === row.version ? null : row.current,
  }));
  return {
    since: since?.toISOString() ?? null,
    count: byPerson.reduce((sum, row) => sum + Number(row.count), 0),
    restored: byPerson.reduce((sum, row) => sum + Number(row.restored), 0),
    textChanges,
    people: people.map((row) => ({ id: row.by, name: name(row.by), count: Number(row.count) })),
    changes,
  };
}

/**
 * Lines whose text the release rebuilds with no new audio (TEXT_KINDS), since `since` and up to
 * `until` when given. A line with a take counted as its audio is left out: with `until`, the take
 * live then, which a release that started then built from, not one recut since.
 */
export async function textChangeCount(section: ReleaseSection, lang: Lang, since: Date | null, until: Date | null): Promise<number> {
  // Before any release everything goes out anyway, so there is nothing to add.
  if (!since) return 0;
  const rows = await readAsActing<{ count: string }>(
    lang,
    `with until_live as (${liveAt("$4::timestamptz")})
     select count(distinct coalesce(a."lineId", a."subject")) as "count" from "activity" a
      where a."at" > $3 and ($4::timestamptz is null or a."at" <= $4)
        and ((a."lang" = $2 and a."source" = $1 and a."kind" = any($5::text[]))
             -- An ignore in every language has no language of its own, and the build applies it.
             or (a."lang" is null and a."source" = $1 and a."kind" in ('ignore.set', 'ignore.cleared'))
             or (a."lang" = $2 and a."source" is null and a."kind" in ('name.edited', 'name.restored', 'name.retired')
                 and split_part(a."subject", ':', 1) = any($6::text[])))
        and not exists (select 1 from "take" t
                          left join until_live on until_live."file" = t."file"
                         where t."source" = $1 and t."lang" = $2 and ${LIVE}
                           and t."lineId" = coalesce(a."lineId", a."subject") and t."createdAt" > $3)`,
    [section, lang, since, until, TEXT_KINDS, SHIPPED_NAMES[section]],
  );
  return Number(rows[0]?.count ?? 0);
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
