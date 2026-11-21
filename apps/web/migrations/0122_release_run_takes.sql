-- Additive. The takes a staged run's pack was built from, by file: { version, sha256 }, which its
-- review lists and plays. Apart from "staged", which a promote run copies and every status check
-- reads.

alter table "release_run" add column if not exists "takes" jsonb;
