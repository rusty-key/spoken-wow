-- Additive. A press that found nothing to release is its own state, and one that did says which
-- version it made; a run from before this reads as done with no version.

alter table "release_run" drop constraint "release_run_state_check";
alter table "release_run" add constraint "release_run_state_check"
  check ("state" in ('dispatching', 'running', 'done', 'unchanged', 'failed'));
alter table "release_run" add column "version" text;
