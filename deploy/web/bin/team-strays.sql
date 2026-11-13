-- Rows the english team holds for a language another team owns. After 0091 moves the languages,
-- workers of the release before it still map languages from a memo up to 60 s old and hear no
-- move, so what they write during the deploy or just after it can land under english.
--
-- Read-only by default. Run as the owner, which row-level security does not bind:
--
--   psql "$PROD_DATABASE_URL" -f deploy/web/bin/team-strays.sql
--
-- One line per table, with how many rows stray there, then the total. A language with no team
-- at all is left alone: there is nowhere to send its rows.
--
-- REPAIR with `-v repair=on`, only after reading the counts and with the queue paused. Issue
-- lines go last, after their issues. A row whose new team already holds its key aborts the
-- repair with a unique violation; settle that row by hand first.
--
--   psql "$PROD_DATABASE_URL" -v repair=on -f deploy/web/bin/team-strays.sql
\set ON_ERROR_STOP on

\if :{?repair}
begin;
set local strays.repair = on;
\else
begin read only;
set local strays.repair = off;
\endif

do $$
declare
  v_repair  boolean := current_setting('strays.repair')::boolean;
  v_english uuid := (select "id" from "team" where "slug" = 'english');
  v_tables  text[] := array[
    'take', 'recording', 'take_ack', 'voice_clone', 'fish_reference', 'generation_setting_locale',
    'pronunciation_lexicon_locale', 'lexicon_change', 'line_ignore', 'line_flag', 'line_issue',
    'report', 'regeneration_batch', 'regeneration_job', 'regeneration_pause', 'activity',
    'voice_sample'
  ];
  v_count integer := cardinality(v_tables) + 1;
  v_lang  text;
  v_where text;
  v_n     integer;
  v_total integer := 0;
  v_i     integer := 0;
  t       text;
begin
  foreach t in array v_tables loop
    v_i := v_i + 1;
    -- A sample's language is in its clone's name, 'voice@lang'.
    v_lang := case t when 'voice_sample' then 'split_part(r."clone", ''@'', 2)' else 'r."lang"' end;
    -- team_of_lang is null for a language with no team, which the comparison leaves out.
    v_where := format('r."teamId" = $1 and team_of_lang(%s) <> $1', v_lang);
    if v_repair then
      execute format('update %I r set "teamId" = team_of_lang(%s) where %s', t, v_lang, v_where) using v_english;
      get diagnostics v_n = row_count;
    else
      execute format('select count(*) from %I r where %s', t, v_where) into v_n using v_english;
    end if;
    v_total := v_total + v_n;
    raise notice '% / % %: %', v_i, v_count, t, v_n;
  end loop;

  -- A line of an issue goes with its issue, wherever that is now.
  if v_repair then
    update "line_issue_line" l set "teamId" = i."teamId"
      from "line_issue" i
     where i."id" = l."issueId" and l."teamId" = v_english and i."teamId" <> l."teamId";
    get diagnostics v_n = row_count;
  else
    select count(*) into v_n
      from "line_issue_line" l join "line_issue" i on i."id" = l."issueId"
     where l."teamId" = v_english and i."teamId" <> l."teamId";
  end if;
  v_total := v_total + v_n;
  raise notice '% / % line_issue_line: %', v_count, v_count, v_n;

  raise notice 'team-strays: % rows %', v_total, case when v_repair then 're-teamed' else 'stray' end;
end
$$;

\if :{?repair}
commit;
\else
rollback;
\endif
