-- Every per-team row says which team it belongs to: the backfill.
--
-- The second of three files (0088_team_scope_1_columns.sql says why three). UPDATEs only:
-- they take row locks, so a read of these tables never waits on them, and only a write to a
-- row being filled does. The index list is in 0088_team_scope_3_keys.sql.

-- A row with a language belongs to that language's privileged team. A null-lang line_ignore
-- or activity row is site-wide, and stays without a team.
do $$
declare
  t text;
begin
  foreach t in array array[
    'take', 'recording', 'take_ack', 'voice_clone', 'fish_reference', 'generation_setting_locale',
    'pronunciation_lexicon_locale', 'lexicon_change', 'line_ignore', 'line_flag', 'line_issue',
    'report', 'regeneration_batch', 'regeneration_job', 'regeneration_pause', 'activity'
  ] loop
    execute format(
      $f$update %I x set "teamId" = tl."teamId"
           from "team_language" tl
          where tl."lang" = x."lang" and tl."privileged"$f$, t);
  end loop;
end
$$;

-- A sample's language is in the name of the clone it was uploaded for, 'voice@lang', and a
-- bare name is English.
update "voice_sample" s set "teamId" = tl."teamId"
  from "team_language" tl
 where tl."lang" = coalesce(nullif(split_part(s."clone", '@', 2), ''), 'enUS') and tl."privileged";

update "line_issue_line" l set "teamId" = i."teamId"
  from "line_issue" i
 where i."id" = l."issueId";

-- No language of their own. The roster, the shared generation settings and lexicon, the
-- queue's dismissal mark and the English text overrides are all English's today.
do $$
declare
  t text;
begin
  foreach t in array array[
    'voice', 'voice_assignment', 'generation_setting', 'pronunciation_lexicon', 'queue_dismissal',
    'line_override'
  ] loop
    execute format(
      $f$update %I set "teamId" = (select "id" from "team" where "slug" = 'english')$f$, t);
  end loop;
end
$$;
