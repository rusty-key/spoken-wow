-- A take's clip as a pack ships it, made at commit (lib/takes/encode.ts).
-- Keyed by the master's bytes, so a restore or a byte-identical regeneration reuses it.
-- `source` is denormalised so scripts/db/sync-section.sh carries these rows with the takes.
create table if not exists "take_encoding" (
  "id"            bigserial   primary key,
  "source"        text        not null,
  "sha256"        text        not null,
  "profile"       text        not null,
  "encodedSha256" text        not null,
  "bytes"         integer     not null,
  "durationSec"   numeric,
  "createdAt"     timestamptz not null default now(),
  unique ("source", "sha256", "profile")
);
