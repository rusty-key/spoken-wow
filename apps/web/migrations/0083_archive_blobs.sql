-- The audio archive moves to an R2 bucket, each object named by the SHA-256 of its bytes
-- (lib/blobs/store.ts). A row says which object it is by that hash. `archiveFile` stays for
-- rows whose bytes are still only on the volume, and is null for rows written once the
-- bucket is the only store.
--
-- Nullable: rows from before the move get theirs from one-off/2026-10-archive-to-r2, which
-- hashes the files already on the volume.
alter table "take" add column if not exists "sha256" text;
alter table "recording" add column if not exists "sha256" text;
alter table "fish_reference" add column if not exists "sha256" text;

-- A recording no longer has to have a file on the volume.
alter table "recording" alter column "archiveFile" drop not null;

-- The clips a clone is built from. They were listed by reading their directory, which a
-- bucket has no cheap equivalent of, so each clip gets a row. `clone` is the clone's name
-- (lib/voices/clone-name.ts): the slot for English, `slot@lang` for another language.
-- `file` is the stored name the routes and the reference rows already use.
create table if not exists "voice_sample" (
  "clone"      text        not null,
  "file"       text        not null,
  "sha256"     text        not null,
  "bytes"      integer     not null,
  "uploadedAt" timestamptz not null default now(),
  primary key ("clone", "file")
);
