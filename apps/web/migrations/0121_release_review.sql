-- Releases queue, and a team that is not official stages its release for a site owner to review
-- (docs/platform/TEAMS.md, *Releases*). Additive.
--
-- A run is a release, the promotion of a staged release a site owner approved, or the delisting of
-- a team's pack: all three write the channel's indexes, so all three take the one-active lock.
-- A press while another run is active waits as `queued`, outside that lock; settling a run starts
-- the oldest queued one. A staged release ends `awaiting_review`, with what it staged (`staged`);
-- approval makes it `approved` and inserts a `promote` run naming it (`promotes`), whose success
-- makes the staged run `done`, and whose failure puts it back to `awaiting_review`. A rejected one
-- ends `rejected`, and one replaced by a newer staged version of the same section, language and
-- team ends `superseded`.
--
-- Code from before this reads the five new states as not active, which they are not.

alter table "release_run" add column if not exists "kind" text not null default 'release';
alter table "release_run" add constraint "release_run_kind_check" check ("kind" in ('release', 'promote', 'delist'));

-- The bump a queued press asked for, which it needs when it starts.
alter table "release_run" add column if not exists "bump" text;
-- Decided at the press from team.official, so changing it mid-run changes nothing in flight.
alter table "release_run" add column if not exists "stage" boolean not null default false;
-- A staged run's channel entries; a promote run's copy of them; a delist run's folders.
alter table "release_run" add column if not exists "staged" jsonb;
alter table "release_run" add column if not exists "promotes" uuid references "release_run" ("id");
alter table "release_run" add column if not exists "reviewedBy" text references "user" ("id") on delete set null;
alter table "release_run" add column if not exists "reviewedAt" timestamptz;
alter table "release_run" add column if not exists "reviewNote" text;
-- When it left the queue to build, which is what its build read the takes at; null for a run that
-- started before this, whose press and start were one moment.
alter table "release_run" add column if not exists "startedAt" timestamptz;

-- Replaced whole to widen it, as 0097_release_outcome.sql did.
alter table "release_run" drop constraint "release_run_state_check";
alter table "release_run" add constraint "release_run_state_check"
  check ("state" in ('queued', 'dispatching', 'running', 'awaiting_review', 'approved', 'done', 'unchanged', 'failed', 'rejected', 'superseded'));

create index if not exists "release_run_queued_idx" on "release_run" ("createdAt") where "state" = 'queued';
