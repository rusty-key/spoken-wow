-- Additive: one row per press of Release on the site. 0090's default privileges give the app
-- role its grants on a table made here.

create table "release_run" (
  "id"          uuid        primary key default gen_random_uuid(),
  "teamId"      uuid        not null default spoken_team() references "team" ("id"),
  "section"     text        not null,
  "lang"        text        not null,
  "state"       text        not null check ("state" in ('dispatching', 'running', 'done', 'failed')),
  "githubRunId" bigint,
  "githubUrl"   text,
  "step"        text,
  "error"       text,
  "requestedBy" text        references "user" ("id") on delete set null,
  "createdAt"   timestamptz not null default now(),
  "finishedAt"  timestamptz
);

-- One release at a time, whichever team asked: the index holds across teams though the policy
-- below hides their rows from each other.
create unique index "release_run_one_active" on "release_run" ((true))
  where "state" in ('dispatching', 'running');

create index "release_run_team_idx" on "release_run" ("teamId", "createdAt" desc);

alter table "release_run" enable row level security;
alter table "release_run" force row level security;
create policy "team_isolation" on "release_run"
  using ("teamId" = spoken_team() or spoken_all_teams())
  with check ("teamId" = spoken_team() or spoken_all_teams());
