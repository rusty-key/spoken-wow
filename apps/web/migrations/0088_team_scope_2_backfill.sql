-- UPDATEs only: row locks, so reads never wait on them.

-- A null-lang line_ignore or activity row is site-wide, and stays without a team.
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

-- A sample's language is in its clone's name, 'voice@lang'; a bare name is English.
update "voice_sample" s set "teamId" = tl."teamId"
  from "team_language" tl
 where tl."lang" = coalesce(nullif(split_part(s."clone", '@', 2), ''), 'enUS') and tl."privileged";

update "line_issue_line" l set "teamId" = i."teamId"
  from "line_issue" i
 where i."id" = l."issueId";

-- Tables with no language of their own belong to the english team.
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
