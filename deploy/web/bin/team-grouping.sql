-- Read-only preview of the teams migration 0087 seeds, with their members. Confirm it before
-- deploying: afterwards teams are edited, not re-seeded.
--
--   psql $PROD_DATABASE_URL -f deploy/web/bin/team-grouping.sql
with "langs" as (
  select "lang" from (
    select "code" as "lang" from "language"
    -- Every language the site knows, as 0087 lists them.
    union select unnest(array['enUS', 'deDE', 'esES', 'esMX', 'frFR', 'itIT', 'ptBR', 'ruRU', 'koKR', 'zhCN', 'zhTW', 'viVN'])
    union select "lang" from "take" union select "lang" from "recording"
    union select "lang" from "take_ack" union select "lang" from "voice_clone"
    union select "lang" from "fish_reference" union select "lang" from "generation_setting_locale"
    union select "lang" from "pronunciation_lexicon_locale" union select "lang" from "lexicon_change"
    union select "lang" from "line_ignore" union select "lang" from "line_flag"
    union select "lang" from "line_issue" union select "lang" from "report"
    union select "lang" from "regeneration_batch" union select "lang" from "regeneration_job"
    union select "lang" from "regeneration_pause" union select "lang" from "activity"
    union select nullif(split_part("clone", '@', 2), '') from "voice_sample"
  ) l
   where "lang" is not null
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
