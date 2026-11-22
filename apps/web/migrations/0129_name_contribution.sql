-- The names players' clients show for an NPC, waiting for a translator to keep or drop. One row
-- per name, so two clients that disagree sit side by side. Uploaders are rows of their own, so the
-- Manager sending the same file after every logout counts once.
--
-- Additive: the check only widens, and the previous release reads 'observed' as any origin.

create table if not exists "name_contribution" (
  "id"         serial primary key,
  "kind"       text        not null check ("kind" in ('creature', 'gameobject')),
  "entityId"   text        not null,
  "lang"       text        not null,
  "name"       text        not null check (length("name") between 1 and 200),
  "status"     text        not null default 'new' check ("status" in ('new', 'accepted', 'rejected')),
  "resolvedBy" text        references "user" ("id") on delete set null,
  "createdAt"  timestamptz not null default now(),
  "updatedAt"  timestamptz not null default now(),
  unique ("kind", "entityId", "lang", "name")
);

create index if not exists "name_contribution_lang_status_idx" on "name_contribution" ("lang", "status");

-- 'user:<id>', 'install:<id>', or 'upload:<uuid>' for an anonymous file. No address.
create table if not exists "name_contribution_uploader" (
  "contributionId" integer     not null references "name_contribution" ("id") on delete cascade,
  "uploader"       text        not null,
  "createdAt"      timestamptz not null default now(),
  primary key ("contributionId", "uploader")
);

alter table "entity_name" drop constraint "entity_name_origin_check";
alter table "entity_name" add constraint "entity_name_origin_check"
  check ("origin" in ('extracted', 'edited', 'contributed', 'community', 'observed'));
