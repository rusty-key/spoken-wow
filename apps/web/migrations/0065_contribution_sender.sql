-- One row per copy of a contribution sent by a signed-in or named player. The "dedup" upsert
-- keeps only the first sender's identity, so without this later senders are lost. Copies with
-- no row are the anonymous ones: "count" minus these rows.
--
-- Backfilled with each row's first sender; later copies of older rows stay anonymous.
--
-- Additive: a new table the previous release never reads.

create table if not exists "contribution_sender" (
  "id"             serial primary key,
  "contributionId" integer not null references "contribution" ("id") on delete cascade,
  "userId"         text references "user" ("id") on delete set null,
  "name"           text,
  "createdAt"      timestamptz not null default now()
);

create index if not exists "contribution_sender_contribution_idx"
  on "contribution_sender" ("contributionId");

insert into "contribution_sender" ("contributionId", "userId", "name", "createdAt")
select c."id", c."userId", c."name", c."createdAt"
  from "contribution" c
 where (c."userId" is not null or c."name" is not null)
   and not exists (select 1 from "contribution_sender" s where s."contributionId" = c."id");
