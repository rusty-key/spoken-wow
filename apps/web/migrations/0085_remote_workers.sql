-- Generation on an author's own machine (lib/generation/relay.ts, lib/worker/).
--
-- An author picks, per provider, whether their queued lines are generated here, with the key
-- sealed on the server, or by their Spoken Manager, with a key the server never sees. In
-- `local` mode the leader leaves their lanes alone and the Manager claims them.
create table if not exists "generation_mode" (
  "userId"    text        not null references "user" ("id") on delete cascade,
  "provider"  text        not null,
  "mode"      text        not null check ("mode" in ('site', 'local')),
  "updatedAt" timestamptz not null default now(),
  primary key ("userId", "provider")
);

-- What a relayed job's provider requests were, when it was claimed: their fingerprints, and
-- the ElevenLabs voices the Manager's account holds. The answer is checked against them, so a
-- line whose text changed between the claim and the answer is generated again rather than
-- committed with audio of the old text.
alter table "regeneration_job" add column if not exists "relay" jsonb;

-- The Manager's credential: one row per paired install, only the token's hash kept.
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

-- A pairing in progress: the Manager shows `code`, its owner approves it signed in on the
-- site, and the Manager collects the token by `pollHash`. The token waits here sealed under
-- SPOKEN_SECRET_KEY until it is collected once, then the row goes.
create table if not exists "worker_pairing" (
  "code"        text        primary key,
  "pollHash"    text        not null unique,
  "label"       text        not null,
  "expiresAt"   timestamptz not null,
  "userId"      text        references "user" ("id") on delete cascade,
  "sealedToken" text
);
