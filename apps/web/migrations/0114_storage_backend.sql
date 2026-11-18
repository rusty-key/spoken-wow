-- A team's own bucket (docs/platform/STORAGE.md). Additive: with no row here every object is in
-- our archive bucket, as before.
--
-- storage_backend is a team's S3-compatible bucket. Its secret is sealed with SPOKEN_STORAGE_KEY
-- (lib/blobs/seal.ts) and never leaves the server. A backend is never deleted while an object
-- names it: a retired one stops taking new objects and keeps serving the ones it holds.
--
-- archive_object says which team bucket holds an object. No row means our bucket. `teamId` is the
-- bucket's team, kept on the row so a read prefers its own team's copy without reading
-- storage_backend. `pending` means the team's bucket refused the PUT and the bytes wait under
-- `quarantine/<bucket>/` in ours until the retry lands them (lib/blobs/where.ts). It holds no secret and every request for a public
-- take reads it whatever the team, so it has no row-level security.

create table "storage_backend" (
  "id"             uuid        primary key default gen_random_uuid(),
  "teamId"         uuid        not null default spoken_team() references "team" ("id"),
  "label"          text        not null check (length("label") between 1 and 80),
  "provider"       text        not null check ("provider" in ('r2', 's3', 'b2', 'wasabi', 'gcs', 'minio', 'other')),
  "endpoint"       text        not null check ("endpoint" ~ '^https://[^/?#]+$'),
  "region"         text        not null default 'auto',
  "bucket"         text        not null check ("bucket" ~ '^[a-z0-9][a-z0-9.\-_]{1,62}$'),
  "pathStyle"      boolean     not null default true,
  -- Where a browser fetches an object, ending in '/'. Null: the bucket is private, and the site
  -- hands out short-lived signed addresses instead.
  "publicUrl"      text        check ("publicUrl" ~ '^https://.+/$'),
  "accessKeyId"    text        not null,
  "secretSealed"   text        not null,
  -- False for a provider that ignores If-None-Match on a PUT: the store looks before it writes.
  "conditionalPut" boolean     not null default true,
  -- New objects of the team go here. At most one per team; none means our bucket.
  "writing"        boolean     not null default false,
  "health"         text        not null default 'unchecked' check ("health" in ('unchecked', 'ok', 'failing')),
  "checkedAt"      timestamptz,
  "lastError"      text,
  "createdBy"      text        references "user" ("id") on delete set null,
  "createdAt"      timestamptz not null default now(),
  "retiredAt"      timestamptz,
  check (not ("writing" and "retiredAt" is not null))
);

create unique index "storage_backend_one_writing" on "storage_backend" ("teamId") where "writing";
create index "storage_backend_team_idx" on "storage_backend" ("teamId", "createdAt");

alter table "storage_backend" enable row level security;
alter table "storage_backend" force row level security;
create policy "team_isolation" on "storage_backend"
  using ("teamId" = spoken_team() or spoken_all_teams())
  with check ("teamId" = spoken_team() or spoken_all_teams());

create function "storage_backend_notify"() returns trigger
language plpgsql as $$
begin
  perform pg_notify('spoken_storage_backend', coalesce(new."id", old."id")::text);
  return null;
end $$;

create trigger "storage_backend_notify"
  after insert or update or delete on "storage_backend"
  for each row execute function "storage_backend_notify"();

create table "archive_object" (
  "prefix"    text        not null check ("prefix" in ('takes', 'recordings', 'encodings', 'samples', 'references')),
  "sha256"    text        not null check ("sha256" ~ '^[0-9a-f]{64}$'),
  "backendId" uuid        not null references "storage_backend" ("id"),
  "teamId"    uuid        not null references "team" ("id"),
  "pending"   boolean     not null default false,
  -- When a read or a check last found the object gone from the team's bucket.
  "missingAt" timestamptz,
  "keptAt"    timestamptz not null default now(),
  primary key ("prefix", "sha256", "backendId")
);

create index "archive_object_backend_idx" on "archive_object" ("backendId");
-- The quarantine is landed a few objects per bucket at a time, oldest first.
create index "archive_object_pending_idx" on "archive_object" ("backendId", "keptAt") where "pending";
