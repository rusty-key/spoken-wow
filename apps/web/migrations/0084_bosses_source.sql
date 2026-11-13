-- Bosses joins the sections every take, job, report and recording is keyed by. 'zones' and
-- 'books' stay allowed for the reason 0081 gives.
--
-- The constraint names are the ones Postgres generated (see 0027).

alter table "take"
  drop constraint if exists "take_source_check",
  add constraint "take_source_check"
    check ("source" in ('quests', 'places', 'readables', 'zones', 'books', 'bosses'));

alter table "regeneration_job"
  drop constraint if exists "regeneration_job_source_check",
  add constraint "regeneration_job_source_check"
    check ("source" in ('quests', 'places', 'readables', 'zones', 'books', 'bosses'));

alter table "regeneration_batch"
  drop constraint if exists "regeneration_batch_source_check",
  add constraint "regeneration_batch_source_check"
    check ("source" in ('quests', 'places', 'readables', 'zones', 'books', 'bosses'));

alter table "report"
  drop constraint if exists "report_source_check",
  add constraint "report_source_check"
    check ("source" in ('quests', 'places', 'readables', 'zones', 'books', 'bosses'));

alter table "contribution"
  drop constraint if exists "contribution_source_check",
  add constraint "contribution_source_check"
    check ("source" in ('quests', 'places', 'readables', 'zones', 'books', 'bosses'));

alter table "take_ack"
  drop constraint if exists "take_ack_source_check",
  add constraint "take_ack_source_check"
    check ("source" in ('quests', 'places', 'readables', 'zones', 'books', 'bosses'));

alter table "activity"
  drop constraint if exists "activity_source_check",
  add constraint "activity_source_check"
    check ("source" in ('quests', 'places', 'readables', 'zones', 'books', 'bosses'));

alter table "recording"
  drop constraint if exists "recording_source_check",
  add constraint "recording_source_check"
    check ("source" in ('quests', 'places', 'readables', 'zones', 'books', 'bosses'));
