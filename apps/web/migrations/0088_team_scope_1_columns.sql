-- Split into three files, each its own migrate.sh transaction, so no lock outlives its work.
-- This one is catalog-only under ACCESS EXCLUSIVE: the nullable column rewrites nothing, the
-- default is set after the add so it applies to new rows only, and the foreign key is NOT VALID
-- to skip the scan (3_keys validates it). Backfill takes row locks; indexes hold writes only.
--
-- Expand only, so the previous release keeps working: "teamId" stays nullable and an insert
-- outside withTeam gets null until the contract release backfills it and sets not null.
-- spoken_team() reads the transaction-local `spoken.team` withTeam sets; '*' (ALL_TEAMS) reads
-- as null. It is stable, not volatile, as current_setting is.

create function spoken_team() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('spoken.team', true), ''), '*')::uuid
$$;

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
    execute format('alter table %I add column "teamId" uuid', t);
    execute format('alter table %I alter column "teamId" set default spoken_team()', t);
    -- The name Postgres gives an inline `references`, so the schema matches a single add column.
    execute format(
      'alter table %I add constraint %I foreign key ("teamId") references "team" ("id") not valid',
      t, t || '_teamId_fkey');
  end loop;
end
$$;
