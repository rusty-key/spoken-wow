-- Teams: the people who look after a set of languages together, and the languages they own.
--
-- A language belongs to exactly one *privileged* team -- the one whose members' work in it
-- ships in the packs. The table is keyed (team, lang) rather than lang alone so that a later
-- phase can let other teams work in a language without owning it; `privileged` is that line.
--
-- Additive: nothing reads these yet, so the previous release is unaffected.
create table "team" (
  "id"        uuid        primary key default gen_random_uuid(),
  "slug"      text        not null unique check ("slug" ~ '^[a-z][a-z0-9-]{1,40}$'),
  "name"      text        not null,
  "createdAt" timestamptz not null default now()
);

create table "team_language" (
  "teamId"     uuid    not null references "team" ("id") on delete cascade,
  "lang"       text    not null check ("lang" ~ '^[a-z]{2}[A-Z]{2}$'),
  "privileged" boolean not null default true,
  primary key ("teamId", "lang")
);

create unique index "team_language_privileged_idx" on "team_language" ("lang") where "privileged";

-- The privileged team of a language, or null for one nobody owns: the lookup every script and
-- query that knows only a language makes, so none of them repeats team_language's columns.
create function "team_of_lang"(text) returns uuid language sql stable as $$
  select "teamId" from "team_language" where "lang" = $1 and "privileged"
$$;

-- Every language some per-team row names, the set no row may be left without a team for.
create view "team_scoped_lang" as
select "lang" from (
  select "code" as "lang" from "language"
  union select "lang" from "take" union select "lang" from "recording"
  union select "lang" from "take_ack" union select "lang" from "voice_clone"
  union select "lang" from "fish_reference" union select "lang" from "generation_setting_locale"
  union select "lang" from "pronunciation_lexicon_locale" union select "lang" from "lexicon_change"
  union select "lang" from "line_ignore" union select "lang" from "line_flag"
  union select "lang" from "line_issue" union select "lang" from "report"
  union select "lang" from "regeneration_batch" union select "lang" from "regeneration_job"
  union select "lang" from "regeneration_pause" union select "lang" from "activity"
  -- A sample's language is in its clone's name, 'voice@lang'; a bare name is English's.
  union select nullif(split_part("clone", '@', 2), '') from "voice_sample"
) l
 where "lang" is not null;

-- SEEDING. Today's boundaries are the ones the grants already draw, so the teams are the
-- groups of languages that the same people maintain. `record` alone does not make a
-- maintainer: a voice actor looks after nothing. English, and every language nobody
-- maintains, share one team -- an empty key must not read as "the same people".
--
-- The same query, read-only, is deploy/web/bin/team-grouping.sql; run it against production
-- before deploying to see who ends up together.
--
-- Every language some per-team row names (team_scoped_lang) gets a team here, the same set
-- 0089 later checks (0089_team_contract.sql), so that no row of deploy 1 is left with a
-- language nobody owns.
--
-- So does every language the site knows, so that a report or activity in one nobody has
-- switched on has a team from the moment this deploys. The list is a snapshot of CODES
-- (apps/web/src/lib/lang.ts); adoptEveryLang (generation/boot.ts, languages/store.ts
-- setEnabled) covers codes added later. Parking unowned languages on the english team is a
-- phase-1 stopgap: eventually a language no team owns goes to a separate bucket, not English.
create temp table "team_seed" on commit drop as
with "langs" as (
  select "lang" from "team_scoped_lang"
  union select unnest(array['enUS', 'deDE', 'esES', 'esMX', 'frFR', 'itIT', 'ptBR', 'ruRU', 'koKR', 'zhCN', 'zhTW', 'viVN'])
), "keyed" as (
  select l."lang",
         case when l."lang" = 'enUS' then '{}'::text[]
              else coalesce(
                (select array_agg(distinct g."userId" order by g."userId")
                   from "language_grant" g
                  where g."lang" = l."lang"
                    and g."capability" in ('edit', 'regenerate', 'configure', 'ignore', 'admin')),
                '{}') end as "key"
    from "langs" l
)
select case when "key" = '{}' then 'english'
            else lower(string_agg("lang", '-' order by "lang")) end as "slug",
       case when "key" = '{}' then 'English'
            else string_agg("lang", ' + ' order by "lang") end as "name",
       array_agg("lang" order by "lang") as "langs"
  from "keyed"
 group by "key";

insert into "team" ("slug", "name") select "slug", "name" from "team_seed";

insert into "team_language" ("teamId", "lang")
select t."id", l."lang"
  from "team_seed" s
  join "team" t on t."slug" = s."slug"
 cross join lateral unnest(s."langs") as l ("lang");
