-- Every per-team row says which team it belongs to.
--
-- Today a language's rows are its team's by implication: whoever may edit the language edits
-- them. Writing the team on the row is what lets the later phases scope reads by team (row-
-- level security reads "teamId") and let two teams keep rows for the same language apart.
--
-- EXPAND ONLY. The previous release keeps running against this schema, so nothing it does
-- may fail here:
--   * "teamId" is nullable. An insert by the previous release, or any insert outside
--     withTeam (lib/db.ts), gets null; the contract release backfills those and makes the
--     column not null.
--   * Its default reads the transaction-local `spoken.team` that withTeam sets, so an insert
--     inside withTeam is scoped without its SQL naming the column. '*' (ALL_TEAMS) is no one
--     team, and reads as null.
--   * Every existing key stays. Beside each, a unique index with "teamId" first and otherwise
--     the same columns, expressions and predicate, so an `on conflict` target can switch to
--     it: Postgres picks the arbiter index by an exact match. The contract release drops the
--     old keys.
--
-- THE TEAM-FIRST UNIQUE INDEXES, for `on conflict` targets:
--   take_team_current_idx                 ("teamId", "source", "lang", "file") where "isCurrent"
--   take_ack_team_lang_idx                ("teamId", "source", "lang", "file")
--   voice_clone_team_lang_idx             ("teamId", "voice", "lang")
--   line_issue_team_lang_idx              ("teamId", "category", "item", "lang")
--   line_ignore_team_scope_idx            ("teamId", "lineId", (coalesce("lang", '')))
--   regeneration_job_team_one_per_lang_file
--                                         ("teamId", "source", "lang", "file")
--                                         where "state" in ('pending', 'running')
--   voice_assignment_team_key_idx         ("teamId", "race", (coalesce("gender", '')),
--                                          (coalesce("flavor", '')))
--   fish_reference_team_key_idx           ("teamId", "voice", "lang")
--   generation_setting_locale_team_key_idx
--                                         ("teamId", "lang")
--   pronunciation_lexicon_locale_team_key_idx
--                                         ("teamId", "lang")
--   line_flag_team_key_idx                ("teamId", "lineId", "lang")
--   line_override_team_key_idx            ("teamId", "file")
--   regeneration_pause_team_key_idx       ("teamId", "lang")
--   voice_sample_team_key_idx             ("teamId", "clone", "file")
--   voice_team_key_idx                    ("teamId", "name")
--
-- A table with no unique key leading with "teamId" gets a plain <table>_team_idx instead, for
-- the policies' filter.

do $$
declare
  t text;
begin
  foreach t in array array[
    'take', 'recording', 'take_ack', 'voice', 'voice_assignment', 'voice_clone', 'voice_sample',
    'fish_reference', 'generation_setting', 'generation_setting_locale', 'pronunciation_lexicon',
    'pronunciation_lexicon_locale', 'lexicon_change', 'line_override', 'line_ignore', 'line_flag',
    'line_issue', 'line_issue_line', 'report', 'regeneration_batch', 'regeneration_job',
    'regeneration_pause', 'queue_dismissal', 'activity'
  ] loop
    execute format('alter table %I add column "teamId" uuid references "team" ("id")', t);
    execute format(
      $f$alter table %I alter column "teamId"
           set default nullif(nullif(current_setting('spoken.team', true), ''), '*')::uuid$f$, t);
  end loop;
end
$$;

-- BACKFILL. A row with a language belongs to that language's privileged team. A null-lang
-- line_ignore or activity row is site-wide, and stays without a team.
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

-- THE TEAM-FIRST KEYS, each mirroring the key named beside it.
create unique index "take_team_current_idx"                     -- take_current_idx
  on "take" ("teamId", "source", "lang", "file") where "isCurrent";
create unique index "take_ack_team_lang_idx"                    -- take_ack_lang_idx
  on "take_ack" ("teamId", "source", "lang", "file");
create unique index "voice_clone_team_lang_idx"                 -- voice_clone_lang_idx
  on "voice_clone" ("teamId", "voice", "lang");
create unique index "line_issue_team_lang_idx"                  -- line_issue_lang_idx
  on "line_issue" ("teamId", "category", "item", "lang");
create unique index "line_ignore_team_scope_idx"                -- line_ignore_scope_idx
  on "line_ignore" ("teamId", "lineId", (coalesce("lang", '')));
-- regeneration_job_one_per_lang_file
create unique index "regeneration_job_team_one_per_lang_file"
  on "regeneration_job" ("teamId", "source", "lang", "file")
  where "state" in ('pending', 'running');
create unique index "voice_assignment_team_key_idx"             -- voice_assignment_key_idx
  on "voice_assignment" ("teamId", "race", coalesce("gender", ''), coalesce("flavor", ''));
create unique index "fish_reference_team_key_idx"               -- primary key
  on "fish_reference" ("teamId", "voice", "lang");
create unique index "generation_setting_locale_team_key_idx"    -- primary key
  on "generation_setting_locale" ("teamId", "lang");
create unique index "pronunciation_lexicon_locale_team_key_idx" -- primary key
  on "pronunciation_lexicon_locale" ("teamId", "lang");
create unique index "line_flag_team_key_idx"                    -- primary key
  on "line_flag" ("teamId", "lineId", "lang");
create unique index "line_override_team_key_idx"                -- primary key
  on "line_override" ("teamId", "file");
create unique index "regeneration_pause_team_key_idx"           -- primary key
  on "regeneration_pause" ("teamId", "lang");
create unique index "voice_sample_team_key_idx"                 -- primary key
  on "voice_sample" ("teamId", "clone", "file");
create unique index "voice_team_key_idx"                        -- primary key
  on "voice" ("teamId", "name");

create index "recording_team_idx"             on "recording" ("teamId");
create index "generation_setting_team_idx"    on "generation_setting" ("teamId");
create index "pronunciation_lexicon_team_idx" on "pronunciation_lexicon" ("teamId");
create index "lexicon_change_team_idx"        on "lexicon_change" ("teamId");
create index "line_issue_line_team_idx"       on "line_issue_line" ("teamId");
create index "report_team_idx"                on "report" ("teamId");
create index "regeneration_batch_team_idx"    on "regeneration_batch" ("teamId");
create index "queue_dismissal_team_idx"       on "queue_dismissal" ("teamId");
create index "activity_team_idx"              on "activity" ("teamId");
