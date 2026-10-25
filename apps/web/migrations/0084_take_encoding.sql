-- A take's clip as a pack ships it, made when the take is committed (lib/takes/encode.ts).
-- Quests packs ship mono Ogg Vorbis (scripts/quests/package-audio.sh's ogg-q0-44k), never the
-- mp3 a take is cut as, so every release used to re-encode every clip on the machine that
-- built it. With the encoding in the archive bucket, a pack build fetches it instead.
--
-- Keyed by the master's bytes rather than by the take, so a restore or a regenerated clip
-- that came out byte-identical reuses what is there. `source` is denormalised so the
-- section syncs (scripts/db/sync-section.sh) carry each section's rows with its takes.
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
