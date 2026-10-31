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

-- SEEDING. Today's boundaries are the ones the grants already draw, so the teams are the
-- groups of languages that the same people maintain. `record` alone does not make a
-- maintainer: a voice actor looks after nothing. English, and every language nobody
-- maintains, share one team -- an empty key must not read as "the same people".
--
-- The same query, read-only, is deploy/web/bin/team-grouping.sql; run it against production
-- before deploying to see who ends up together.
create temp table "team_seed" on commit drop as
with "langs" as (
  select "code" as "lang" from "language"
  union select "lang" from "take"
  union select 'enUS'
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
