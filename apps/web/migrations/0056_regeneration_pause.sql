-- Pausing the regeneration queue, one language at a time.
--
-- Stop throws the waiting work away; Pause keeps it and stops claiming it until someone
-- presses Resume. A row here means "claim nothing in this language": claimNext skips its
-- jobs, pending and lease-expired alike, and activeLanes ranks queues without them so a
-- paused queue gives its place to the next one rather than holding it idle.
--
-- KEYED ON THE LANGUAGE, not the batch, for two reasons. It is the scope Stop already has:
-- a Portuguese translator's Pause halts the Portuguese work and leaves the English running,
-- as a global admin's halts all of it. And a pause on the batches that exist would not hold
-- back a batch queued after it, which is not what anyone pressing Pause means.
--
-- Paused jobs stay 'pending' rather than gaining a state of their own. The credit guard
-- (regeneration_job_one_per_file, 0013) covers only pending and running, so a 'paused' state
-- would let the same file be queued again and paid for twice.
--
-- No expiry: a pause lasts until Resume. Additive, per deploy/bin/migrate.sh - the previous
-- release never reads this table, so rolling back just ignores any pause in force.
create table "regeneration_pause" (
  "lang"     text        primary key,
  "pausedAt" timestamptz not null default now(),
  -- Nullable and SET NULL, like every other provenance column here.
  "pausedBy" text        references "user" ("id") on delete set null
);
