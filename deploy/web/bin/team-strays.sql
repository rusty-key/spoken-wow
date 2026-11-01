-- Rows the english team holds for a language another team owns. After 0091 moves the languages,
-- workers of the release before it still map languages from a memo up to 60 s old and hear no
-- move, so what they write during the deploy or just after it can land under english.
--
-- Read-only. Run as the owner, which row-level security does not bind:
--
--   psql "$PROD_DATABASE_URL" -f deploy/web/bin/team-strays.sql
--
-- One row per table, with how many rows stray there. A language with no team at all is left
-- alone: there is nowhere to send its rows.
begin read only;

with "english" as (
  select "id" from "team" where "slug" = 'english'
), "owned" as (
  select tl."lang", tl."teamId"
    from "team_language" tl
   where tl."privileged" and tl."lang" <> 'enUS' and tl."teamId" <> (select "id" from "english")
), "counts" as (
  select 'take' as "tbl", count(*) as "strays" from "take" r join "owned" o using ("lang") where r."teamId" = (select "id" from "english")
  union all select 'recording', count(*) from "recording" r join "owned" o using ("lang") where r."teamId" = (select "id" from "english")
  union all select 'take_ack', count(*) from "take_ack" r join "owned" o using ("lang") where r."teamId" = (select "id" from "english")
  union all select 'voice_clone', count(*) from "voice_clone" r join "owned" o using ("lang") where r."teamId" = (select "id" from "english")
  union all select 'fish_reference', count(*) from "fish_reference" r join "owned" o using ("lang") where r."teamId" = (select "id" from "english")
  union all select 'generation_setting_locale', count(*) from "generation_setting_locale" r join "owned" o using ("lang") where r."teamId" = (select "id" from "english")
  union all select 'pronunciation_lexicon_locale', count(*) from "pronunciation_lexicon_locale" r join "owned" o using ("lang") where r."teamId" = (select "id" from "english")
  union all select 'lexicon_change', count(*) from "lexicon_change" r join "owned" o using ("lang") where r."teamId" = (select "id" from "english")
  union all select 'line_ignore', count(*) from "line_ignore" r join "owned" o using ("lang") where r."teamId" = (select "id" from "english")
  union all select 'line_flag', count(*) from "line_flag" r join "owned" o using ("lang") where r."teamId" = (select "id" from "english")
  union all select 'line_issue', count(*) from "line_issue" r join "owned" o using ("lang") where r."teamId" = (select "id" from "english")
  union all select 'report', count(*) from "report" r join "owned" o using ("lang") where r."teamId" = (select "id" from "english")
  union all select 'regeneration_batch', count(*) from "regeneration_batch" r join "owned" o using ("lang") where r."teamId" = (select "id" from "english")
  union all select 'regeneration_job', count(*) from "regeneration_job" r join "owned" o using ("lang") where r."teamId" = (select "id" from "english")
  union all select 'regeneration_pause', count(*) from "regeneration_pause" r join "owned" o using ("lang") where r."teamId" = (select "id" from "english")
  union all select 'activity', count(*) from "activity" r join "owned" o using ("lang") where r."teamId" = (select "id" from "english")
  -- A sample's language is in its clone's name, 'voice@lang'.
  union all select 'voice_sample', count(*) from "voice_sample" s
    join "owned" o on right(s."clone", length(o."lang") + 1) = '@' || o."lang"
   where s."teamId" = (select "id" from "english")
  -- A line of an issue goes with its issue, wherever that is now.
  union all select 'line_issue_line', count(*) from "line_issue_line" l
    join "line_issue" i on i."id" = l."issueId"
   where l."teamId" = (select "id" from "english") and i."teamId" <> l."teamId"
)
select "tbl" as "table", "strays" from "counts"
union all select '(total)', sum("strays") from "counts";

rollback;

-- REPAIR. Commented out: run it only after reading the counts above, and keep the queue paused
-- while it runs. It re-teams each stray row to its language's team, the issue lines last, so
-- they follow their issues. A row whose new team already holds the same key (a second locale
-- setting, say) aborts the whole repair with a unique violation; settle that row by hand first.
/*
begin;
do $$
declare
  v_english uuid := (select "id" from "team" where "slug" = 'english');
  v_tables  text[] := array[
    'take', 'recording', 'take_ack', 'voice_clone', 'fish_reference', 'generation_setting_locale',
    'pronunciation_lexicon_locale', 'lexicon_change', 'line_ignore', 'line_flag', 'line_issue',
    'report', 'regeneration_batch', 'regeneration_job', 'regeneration_pause', 'activity'
  ];
  v_n     integer;
  v_total integer := 0;
  v_i     integer := 0;
  v_count integer := cardinality(v_tables) + 2;
  t       text;
begin
  foreach t in array v_tables loop
    v_i := v_i + 1;
    execute format(
      'update %I r set "teamId" = team_of_lang(r."lang")
        where r."teamId" = $1 and r."lang" <> ''enUS''
          and team_of_lang(r."lang") is not null and team_of_lang(r."lang") <> $1', t)
      using v_english;
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
    raise notice '% / % %: % re-teamed', v_i, v_count, t, v_n;
  end loop;

  update "voice_sample" s set "teamId" = team_of_lang(split_part(s."clone", '@', 2))
   where s."teamId" = v_english and split_part(s."clone", '@', 2) <> 'enUS'
     and team_of_lang(split_part(s."clone", '@', 2)) is not null
     and team_of_lang(split_part(s."clone", '@', 2)) <> v_english;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;
  raise notice '% / % voice_sample: % re-teamed', v_count - 1, v_count, v_n;

  update "line_issue_line" l set "teamId" = i."teamId"
    from "line_issue" i
   where i."id" = l."issueId" and l."teamId" = v_english and i."teamId" <> l."teamId";
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;
  raise notice '% / % line_issue_line: % re-teamed', v_count, v_count, v_n;

  raise notice 'team-strays: % rows re-teamed', v_total;
end
$$;
commit;
*/
