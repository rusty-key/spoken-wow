-- The zones and books sections are now keyed places and readables, the names players
-- already see.
--
-- NOT ADDITIVE, BY DECISION. Every row's "source" is rewritten rather than read under both
-- keys: "isCurrent" is unique per (source, file, lang), so a line stored under both keys
-- could hold two current takes. The checks are widened to all five values first and stay
-- wide, so the release being replaced can still write 'zones' and 'books' during the
-- symlink swap; spoken-one-off-scripts' section-keys-stragglers.sql rewrites what it wrote.
-- Rolling back past this release needs that script's reverse first, or the old code finds
-- no places or readables rows at all.
--
-- The constraint names are the ones Postgres generated (see 0027).

alter table "take"
  drop constraint if exists "take_source_check",
  add constraint "take_source_check"
    check ("source" in ('quests', 'places', 'readables', 'zones', 'books'));

alter table "regeneration_job"
  drop constraint if exists "regeneration_job_source_check",
  add constraint "regeneration_job_source_check"
    check ("source" in ('quests', 'places', 'readables', 'zones', 'books'));

alter table "regeneration_batch"
  drop constraint if exists "regeneration_batch_source_check",
  add constraint "regeneration_batch_source_check"
    check ("source" in ('quests', 'places', 'readables', 'zones', 'books'));

alter table "report"
  drop constraint if exists "report_source_check",
  add constraint "report_source_check"
    check ("source" in ('quests', 'places', 'readables', 'zones', 'books'));

alter table "contribution"
  drop constraint if exists "contribution_source_check",
  add constraint "contribution_source_check"
    check ("source" in ('quests', 'places', 'readables', 'zones', 'books'));

alter table "take_ack"
  drop constraint if exists "take_ack_source_check",
  add constraint "take_ack_source_check"
    check ("source" in ('quests', 'places', 'readables', 'zones', 'books'));

alter table "activity"
  drop constraint if exists "activity_source_check",
  add constraint "activity_source_check"
    check ("source" in ('quests', 'places', 'readables', 'zones', 'books'));

alter table "recording"
  drop constraint if exists "recording_source_check",
  add constraint "recording_source_check"
    check ("source" in ('quests', 'places', 'readables', 'zones', 'books'));

update "take"               set "source" = case "source" when 'zones' then 'places' else 'readables' end where "source" in ('zones', 'books');
update "regeneration_job"   set "source" = case "source" when 'zones' then 'places' else 'readables' end where "source" in ('zones', 'books');
update "regeneration_batch" set "source" = case "source" when 'zones' then 'places' else 'readables' end where "source" in ('zones', 'books');
update "report"             set "source" = case "source" when 'zones' then 'places' else 'readables' end where "source" in ('zones', 'books');
update "contribution"       set "source" = case "source" when 'zones' then 'places' else 'readables' end where "source" in ('zones', 'books');
update "take_ack"           set "source" = case "source" when 'zones' then 'places' else 'readables' end where "source" in ('zones', 'books');
update "activity"           set "source" = case "source" when 'zones' then 'places' else 'readables' end where "source" in ('zones', 'books');
update "recording"          set "source" = case "source" when 'zones' then 'places' else 'readables' end where "source" in ('zones', 'books');
