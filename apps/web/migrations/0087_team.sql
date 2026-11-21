-- A language has exactly one privileged team, whose work in it ships in the packs. The key is
-- (team, lang) so other teams can work in a language without owning it.
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

create function "team_of_lang"(text) returns uuid language sql stable as $$
  select "teamId" from "team_language" where "lang" = $1 and "privileged"
$$;

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
  -- A sample's language is in its clone's name, 'voice@lang'; a bare name is English.
  union select nullif(split_part("clone", '@', 2), '') from "voice_sample"
) l
 where "lang" is not null;

-- A team is a group of languages maintained by the same people. `record` alone does not make a
-- maintainer. English and every unmaintained language share one team, so an empty grant set
-- never reads as "the same people". deploy/web/bin/team-grouping.sql previews this grouping.
-- The code list is a snapshot of CODES, so every known language has a team before any write
-- needs one; adoptEveryLang covers codes added later.
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
