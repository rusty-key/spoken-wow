-- Read-only preview of the teams that migration 0087 seeds: which languages end up together,
-- and who their members are. Same grouping as the migration, nothing written.
--
--   psql $PROD_DATABASE_URL -f deploy/web/bin/team-grouping.sql
--
-- Confirm it against the people before deploying; after deploy, teams are edited, not re-seeded.
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
), "grouped" as (
  select case when "key" = '{}' then 'english'
              else lower(string_agg("lang", '-' order by "lang")) end as "slug",
         string_agg("lang", ' ' order by "lang") as "languages",
         "key"
    from "keyed"
   group by "key"
)
select g."slug",
       g."languages",
       coalesce((select string_agg(u."email", ', ' order by u."email")
                   from "user" u where u."id" = any(g."key")), '(no maintainers)') as "members"
  from "grouped" g
 order by (g."slug" = 'english') desc, g."slug";
