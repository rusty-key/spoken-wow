-- A batch's jobs by batch: deleting a batch cascades to its jobs, and Stop looks for a batch's
-- unfinished ones, and without this each walked the whole table. Not CONCURRENTLY, because
-- migrate.sh runs every file in a transaction.
create index if not exists "regeneration_job_batch"
  on "regeneration_job" ("batchId");

-- Running jobs by lease: each claim cancels a stopped batch's lapsed ones, and the claim
-- index would have it walk every pending row to find them.
create index if not exists "regeneration_job_lease"
  on "regeneration_job" ("leaseUntil")
  where "state" = 'running';
