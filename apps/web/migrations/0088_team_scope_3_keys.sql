-- Not CONCURRENTLY, because migrate.sh runs every file in a transaction. CREATE INDEX holds
-- writes to its table while it builds, never reads.
--
-- Every existing key stays. Beside each goes a unique index with "teamId" first and otherwise
-- identical, because Postgres picks an `on conflict` arbiter index by exact match.

-- Each mirrors the key named beside it.
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

-- For the row-level security filter, on tables with no unique key leading with "teamId".
create index "recording_team_idx"             on "recording" ("teamId");
create index "generation_setting_team_idx"    on "generation_setting" ("teamId");
create index "pronunciation_lexicon_team_idx" on "pronunciation_lexicon" ("teamId");
create index "lexicon_change_team_idx"        on "lexicon_change" ("teamId");
create index "line_issue_line_team_idx"       on "line_issue_line" ("teamId");
create index "report_team_idx"                on "report" ("teamId");
create index "regeneration_batch_team_idx"    on "regeneration_batch" ("teamId");
create index "queue_dismissal_team_idx"       on "queue_dismissal" ("teamId");
create index "activity_team_idx"              on "activity" ("teamId");
-- Its team-first key is partial, so it cannot serve a filter on every job.
create index "regeneration_job_team_idx"      on "regeneration_job" ("teamId");

-- Validating takes a lock that holds neither reads nor writes.
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
    execute format('alter table %I validate constraint %I', t, t || '_teamId_fkey');
  end loop;
end
$$;
