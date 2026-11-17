-- Moving a team's archive objects between our bucket and its own, or between two of its own
-- (docs/platform/STORAGE.md). Additive. A null end is our bucket. A move copies and never deletes
-- the source's bytes: into ours it drops the team bucket's archive_object row once our copy is
-- there, so reads come home.
--
-- The queue leader's upkeep (lib/storage/moves.ts) works through the objects in key order, a chunk
-- a round, and `cursor` is the last key done, so a restart carries on where it stopped.

create table "storage_move" (
  "id"            uuid        primary key default gen_random_uuid(),
  "teamId"        uuid        not null default spoken_team() references "team" ("id"),
  -- A bucket removed later leaves its finished moves behind, naming no bucket.
  "fromBackendId" uuid        references "storage_backend" ("id") on delete set null,
  "toBackendId"   uuid        references "storage_backend" ("id") on delete set null,
  "state"         text        not null default 'queued'
                    check ("state" in ('queued', 'running', 'done', 'failed', 'cancelled')),
  "total"         integer,
  "copied"        integer     not null default 0,
  "already"       integer     not null default 0,
  "missing"       integer     not null default 0,
  "cursor"        text,
  "lastError"     text,
  "requestedBy"   text        references "user" ("id") on delete set null,
  "createdAt"     timestamptz not null default now(),
  "startedAt"     timestamptz,
  "finishedAt"    timestamptz,
  check ("state" not in ('queued', 'running') or "fromBackendId" is distinct from "toBackendId")
);

-- One move at a time per team: two would race over the same objects.
create unique index "storage_move_one_active" on "storage_move" ("teamId") where "state" in ('queued', 'running');
create index "storage_move_team_idx" on "storage_move" ("teamId", "createdAt" desc);

alter table "storage_move" enable row level security;
alter table "storage_move" force row level security;
create policy "team_isolation" on "storage_move"
  using ("teamId" = spoken_team() or spoken_all_teams())
  with check ("teamId" = spoken_team() or spoken_all_teams());
