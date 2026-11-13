-- A language's voice actors: people who record its lines by hand.
--
--   record  upload, replace and remove one's own recordings in the language, and hear
--           everybody's. Recordings live beside the generated takes, never as versions of
--           them, and ship in a pack of their own (0062).
--
-- Only a global admin grants it (permissions.ts canGrant): a recording ships under its
-- actor's name, which is not a language admin's to hand out.
--
-- Additive, per deploy/web/bin/migrate.sh: the check only widens, and the previous release
-- drops capabilities it does not know when it reads grants (grants/store.ts).
--
-- Named explicitly, as 0028 explains: `drop constraint if exists` on a name Postgres did not
-- choose silently keeps the old one. 0037 left this one to Postgres, which named it this.
alter table "language_grant" drop constraint "language_grant_capability_check";
alter table "language_grant" add constraint "language_grant_capability_check"
  check ("capability" in ('edit', 'regenerate', 'configure', 'ignore', 'admin', 'record'));
