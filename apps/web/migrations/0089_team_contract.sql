-- Teams contract: every per-team row's team is required, and the tables are keyed by it. The
-- roster, base generation settings and dismissal mark become one copy per team.
--
-- NOT ADDITIVE: deploy 2. Deploy 1's code must be running first. The old keys are gone, so the
-- release before deploy 1 cannot run against this schema and is no rollback target.

-- A language some row names but no team owns joins the english team, as switching it on does,
-- rather than failing the not null below.
insert into "team_language" ("teamId", "lang", "privileged")
select (select "id" from "team" where "slug" = 'english'), l."lang", true
  from "team_scoped_lang" l
 where team_of_lang(l."lang") is null;

-- BACKFILL whatever was written without a team while deploy 1 ran: an insert that missed
-- withTeam, or one by the release before it.
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
          where x."teamId" is null and tl."lang" = x."lang" and tl."privileged"$f$, t);
  end loop;
end
$$;

update "voice_sample" s set "teamId" = tl."teamId"
  from "team_language" tl
 where s."teamId" is null
   and tl."lang" = coalesce(nullif(split_part(s."clone", '@', 2), ''), 'enUS') and tl."privileged";

update "line_issue_line" l set "teamId" = i."teamId"
  from "line_issue" i
 where l."teamId" is null and i."id" = l."issueId";

do $$
declare
  t text;
begin
  foreach t in array array[
    'voice', 'voice_assignment', 'generation_setting', 'pronunciation_lexicon', 'queue_dismissal',
    'line_override'
  ] loop
    execute format(
      $f$update %I set "teamId" = (select "id" from "team" where "slug" = 'english')
          where "teamId" is null$f$, t);
  end loop;
end
$$;

-- A site-wide ignore or event has no team, whoever wrote it.
update "line_ignore" set "teamId" = null where "lang" is null and "teamId" is not null;
update "activity" set "teamId" = null where "lang" is null and "teamId" is not null;

-- REQUIRED. Everywhere but the site-wide rows, which say so with a check instead.
do $$
declare
  t text;
begin
  foreach t in array array[
    'take', 'recording', 'take_ack', 'voice', 'voice_assignment', 'voice_clone', 'voice_sample',
    'fish_reference', 'generation_setting', 'generation_setting_locale', 'pronunciation_lexicon',
    'pronunciation_lexicon_locale', 'lexicon_change', 'line_override', 'line_flag', 'line_issue',
    'line_issue_line', 'report', 'regeneration_batch', 'regeneration_job', 'regeneration_pause',
    'queue_dismissal'
  ] loop
    execute format('alter table %I alter column "teamId" set not null', t);
  end loop;
end
$$;

-- An ignore is site-wide exactly when it has no language, so its team says the same thing.
alter table "line_ignore" add constraint "line_ignore_team_check"
  check (("lang" is null) = ("teamId" is null));
-- An event with no language has no team. One with a language may lack a team: activity is
-- logged for a language nobody owns rather than refused.
alter table "activity" add constraint "activity_team_check"
  check ("lang" is not null or "teamId" is null);

-- THE OLD KEYS GO.
drop index "take_current_idx";
drop index "take_ack_lang_idx";
drop index "voice_clone_lang_idx";
drop index "line_issue_lang_idx";
drop index "line_ignore_scope_idx";
drop index "regeneration_job_one_per_lang_file";
drop index "voice_assignment_key_idx";
-- From before line_issue had a language: an item could not be flagged in two of them.
alter table "line_issue" drop constraint "line_issue_category_item_key";

-- Versions count per team, as two teams' takes of a language are each their own history.
alter table "take" drop constraint "take_source_lang_file_version_key";
alter table "take" add constraint "take_team_version_key" unique ("teamId", "source", "lang", "file", "version");
alter table "recording" drop constraint "recording_source_lang_file_version_key";
alter table "recording" add constraint "recording_team_version_key"
  unique ("teamId", "source", "lang", "file", "version");

-- The team-first twin of a primary key becomes it.
alter table "voice_assignment" drop constraint "voice_assignment_voice_fkey";
do $$
declare
  t text;
begin
  foreach t in array array[
    'fish_reference', 'generation_setting_locale', 'pronunciation_lexicon_locale', 'line_flag',
    'line_override', 'regeneration_pause', 'voice_sample', 'voice'
  ] loop
    execute format('alter table %I drop constraint %I', t, t || '_pkey');
    execute format('alter table %I add constraint %I primary key using index %I',
                   t, t || '_pkey', t || '_team_key_idx');
  end loop;
end
$$;

-- One row per team where there was one row, keyed by the team. Dropping "id" drops the
-- singleton key and its check.
do $$
declare
  t text;
begin
  foreach t in array array['generation_setting', 'pronunciation_lexicon', 'queue_dismissal'] loop
    execute format('alter table %I drop column "id"', t);
    execute format('alter table %I add primary key ("teamId")', t);
    execute format('drop index %I', t || '_team_idx');
  end loop;
end
$$;

-- A site-wide ignore has a null team, and nulls are distinct in line_ignore_team_scope_idx:
-- this is what keeps one per line.
create unique index "line_ignore_site_wide_idx" on "line_ignore" ("lineId") where "teamId" is null;

-- EVERY TEAM ITS OWN COPY, copied from the english team so nothing a language reads changes.
-- The pronunciation lexicon stays English's: another language's is its _locale row.
insert into "voice" ("teamId", "name", "race", "gender", "createdAt")
select t."id", v."name", v."race", v."gender", v."createdAt"
  from "voice" v
  join "team" e on e."id" = v."teamId" and e."slug" = 'english'
 cross join "team" t
 where t."id" <> e."id"
on conflict do nothing;

insert into "voice_assignment" ("teamId", "race", "gender", "flavor", "voice")
select t."id", a."race", a."gender", a."flavor", a."voice"
  from "voice_assignment" a
  join "team" e on e."id" = a."teamId" and e."slug" = 'english'
 cross join "team" t
 where t."id" <> e."id"
on conflict do nothing;

insert into "generation_setting"
  ("teamId", "modelId", "voiceSettings", "seedStrategy", "raceTags", "updatedAt", "updatedBy")
select t."id", g."modelId", g."voiceSettings", g."seedStrategy", g."raceTags", g."updatedAt", g."updatedBy"
  from "generation_setting" g
  join "team" e on e."id" = g."teamId" and e."slug" = 'english'
 cross join "team" t
 where t."id" <> e."id"
on conflict do nothing;

insert into "queue_dismissal" ("teamId", "throughJobId", "dismissedAt", "dismissedBy")
select t."id", d."throughJobId", d."dismissedAt", d."dismissedBy"
  from "queue_dismissal" d
  join "team" e on e."id" = d."teamId" and e."slug" = 'english'
 cross join "team" t
 where t."id" <> e."id"
on conflict do nothing;

-- An assignment names a voice of its own team's roster.
alter table "voice_assignment" add constraint "voice_assignment_voice_fkey"
  foreign key ("teamId", "voice") references "voice" ("teamId", "name");

-- The roster lookup reads one team's assignments: the team the caller acts as (withTeam), or
-- English's for a connection that sets none, such as the corpus export, whose corpus is English.
create or replace function "voice_for"(r text, g text, f text) returns text
language sql stable as $$
  select case when r ~ '^model-\d+$' then r else (
    select a."voice" from "voice_assignment" a
     where a."teamId" = coalesce(spoken_team(), (select "id" from "team" where "slug" = 'english'))
       and a."race" = r
       and (a."gender" is null or a."gender" = g)
       and (a."flavor" is null or a."flavor" = f)
     order by (a."gender" is not null) desc, (a."flavor" is not null) desc
     limit 1) end
$$;
