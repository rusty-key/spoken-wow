-- Every per-team row says which team it belongs to: the column.
--
-- Today a language's rows are its team's by implication: whoever may edit the language edits
-- them. Writing the team on the row is what lets the later phases scope reads by team (row-
-- level security reads "teamId") and let two teams keep rows for the same language apart.
--
-- IN THREE FILES, each its own migrate.sh transaction, so that no lock is held longer than
-- its work needs:
--   1_columns   this: the column, its default and its foreign key, on every per-team table.
--               ACCESS EXCLUSIVE on each table, but only for a catalog change: a nullable
--               column with no default on the row rewrites nothing, and the default is set
--               after it is added, so it applies to new rows only. The foreign key is added
--               NOT VALID, which skips the scan of the table; 3_keys validates it.
--   2_backfill  the UPDATEs. Row locks only, so reads never wait on it.
--   3_keys      the team-first unique indexes and their header list, the plain team indexes,
--               and the foreign keys validated. CREATE INDEX holds writes, not reads.
-- 0088_regeneration_job_batch_index.sql (platform/manager-generation) sorts before these,
-- and it only adds an index on regeneration_job ("batchId") that nothing here touches, so
-- either order gives the same schema.
--
-- EXPAND ONLY. The previous release keeps running against this schema, so nothing it does
-- may fail here:
--   * "teamId" is nullable. An insert by the previous release, or any insert outside
--     withTeam (lib/db.ts), gets null; the contract release backfills those and makes the
--     column not null.
--   * Its default, spoken_team(), reads the transaction-local `spoken.team` that withTeam sets,
--     so an insert inside withTeam is scoped without its SQL naming the column. '*' (ALL_TEAMS)
--     is no one team, and reads as null. It is stable, not volatile, as current_setting is.
--   * Every existing key stays; 0088_team_scope_3_keys.sql lists the team-first ones beside
--     them.

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
    -- The name Postgres gives a column's `references`, so the schema is the one a single
    -- `add column ... references` would have made.
    execute format(
      'alter table %I add constraint %I foreign key ("teamId") references "team" ("id") not valid',
      t, t || '_teamId_fkey');
  end loop;
end
$$;
