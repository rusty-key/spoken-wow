-- Each archive object is named by the SHA-256 of its bytes (lib/blobs/store.ts). Nullable:
-- older rows get theirs from one-off/2026-10-archive-to-r2.
alter table "take" add column if not exists "sha256" text;
alter table "recording" add column if not exists "sha256" text;
alter table "fish_reference" add column if not exists "sha256" text;

alter table "recording" alter column "archiveFile" drop not null;

-- A bucket cannot cheaply list a clone's clips, so each clip gets a row. `clone` is the
-- clone's name (lib/voices/clone-name.ts): the slot for English, `slot@lang` otherwise.
create table if not exists "voice_sample" (
  "clone"      text        not null,
  "file"       text        not null,
  "sha256"     text        not null,
  "bytes"      integer     not null,
  "uploadedAt" timestamptz not null default now(),
  primary key ("clone", "file")
);
