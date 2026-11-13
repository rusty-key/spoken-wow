-- What a language's voice actors recorded (0061's `record`): one row per uploaded file.
--
-- A TABLE OF ITS OWN, NOT A KIND OF TAKE. A recording lives beside a line's generated takes,
-- never as a version of them, and ships in a pack of its own that the player prefers where
-- it has the line. In `take` it would have to share the one live flag per file
-- (take_current_idx) and the version numbering, and every reader of `take` -- the commit,
-- the restore, the pack build (scripts/audio/sounds.mjs), staleness, the lookups -- would
-- need teaching to leave it out. The previous release would not have been taught, and
-- would ship an actor's take in the generated pack and un-live it with its next commit.
--
-- THE LIVE RECORDING IS THE NEWEST ONE NOT DELETED. There is no flag to move: the latest
-- upload ships, and removing it brings back the one before, whoever recorded it. Rows are
-- never deleted, only marked, so what an actor recorded is never lost to a mis-click.
--
-- `file` is the take's `file` for the same line (takes/adapters.ts), so the two tables join
-- without translation. The audio is kept exactly as uploaded, mp3 or Ogg Vorbis, in the
-- section's archive under recorded/<lang>/ (recordings/store.ts); the pack build converts it.
--
-- `credit` is the uploader's name when they uploaded: it is what the pack credits, and it
-- outlives the account the way every provenance column here does.
--
-- Additive, per deploy/web/bin/migrate.sh: the previous release never reads it.
create table "recording" (
  "id"           bigserial   primary key,
  "source"       text        not null check ("source" in ('quests', 'zones', 'books')),
  "lang"         text        not null check ("lang" ~ '^[a-z]{2}[A-Z]{2}$'),
  "file"         text        not null,
  -- The line it was uploaded from, where there was one. A quests file is shared by every NPC
  -- who says the same words, so this is one of them, and a bulk upload names none.
  "lineId"       text,
  "version"      integer     not null check ("version" > 0),
  "format"       text        not null check ("format" in ('mp3', 'ogg')),
  "archiveFile"  text        not null,
  "bytes"        integer     not null,
  "durationSec"  numeric     not null,
  "originalName" text,
  "credit"       text        not null,
  "createdAt"    timestamptz not null default now(),
  "createdBy"    text        references "user" ("id") on delete set null,
  "deletedAt"    timestamptz,
  "deletedBy"    text        references "user" ("id") on delete set null,
  unique ("source", "lang", "file", "version")
);

-- The live recording of every file in a language, which every explorer page asks for.
create index "recording_live_idx" on "recording" ("source", "lang", "file", "version" desc)
  where "deletedAt" is null;
