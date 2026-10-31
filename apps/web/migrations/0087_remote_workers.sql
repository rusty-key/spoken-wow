-- Per provider, whether an author's queued lines are generated here or by their Spoken
-- Manager. In `local` mode the leader leaves their lanes alone and the Manager claims them.
create table if not exists "generation_mode" (
  "userId"    text        not null references "user" ("id") on delete cascade,
  "provider"  text        not null,
  "mode"      text        not null check ("mode" in ('site', 'local')),
  "updatedAt" timestamptz not null default now(),
  primary key ("userId", "provider")
);

-- A relayed job's request fingerprints and the Manager's ElevenLabs voices, taken at claim.
-- The answer is checked against them, so a line whose text changed since the claim is
-- generated again rather than committed with audio of the old text.
alter table "regeneration_job" add column if not exists "relay" jsonb;

-- One row per paired Manager install; only the token's hash is kept.
create table if not exists "worker_token" (
  "id"         uuid        primary key,
  "userId"     text        not null references "user" ("id") on delete cascade,
  "tokenHash"  text        not null unique,
  "label"      text        not null,
  "createdAt"  timestamptz not null default now(),
  "lastUsedAt" timestamptz,
  "revokedAt"  timestamptz
);
create index if not exists "worker_token_user_idx" on "worker_token" ("userId");

-- A pairing in progress: the owner approves `code` on the site, and the Manager collects the
-- token, sealed under SPOKEN_SECRET_KEY, once by `pollHash`, which deletes the row.
create table if not exists "worker_pairing" (
  "code"        text        primary key,
  "pollHash"    text        not null unique,
  "label"       text        not null,
  "expiresAt"   timestamptz not null,
  "userId"      text        references "user" ("id") on delete cascade,
  "sealedToken" text
);
