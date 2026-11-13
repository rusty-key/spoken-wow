-- Additive. The app role's grants on these tables come from default privileges. Neither has row
-- level security: a token and a run belong to a person, whichever team owns the language.

create table "api_token" (
  "id"         uuid        primary key default gen_random_uuid(),
  "userId"     text        not null references "user" ("id") on delete cascade,
  "lang"       text        not null,
  "access"     text        not null check ("access" in ('read', 'write')),
  "label"      text        not null,
  "tokenHash"  text        not null unique,
  "hint"       text        not null,
  "createdAt"  timestamptz not null default now(),
  "expiresAt"  timestamptz not null,
  "lastUsedAt" timestamptz,
  "revokedAt"  timestamptz
);

create index "api_token_user_idx" on "api_token" ("userId");

-- Written before a mass update's first item, so a run cut off partway can still be found and
-- undone though its response never arrived.
create table "api_batch" (
  "id"        uuid        primary key default gen_random_uuid(),
  "userId"    text        not null references "user" ("id") on delete cascade,
  "tokenId"   uuid        references "api_token" ("id") on delete set null,
  "lang"      text        not null,
  "section"   text        not null,
  "itemCount" integer     not null,
  "note"      text,
  "createdAt" timestamptz not null default now()
);

create index "api_batch_user_idx" on "api_batch" ("userId", "lang", "createdAt" desc);

-- detail.batchId already means a voice queue batch, so an undo walks its own key.
create index "activity_api_batch_idx" on "activity" (("detail"->>'apiBatchId'))
  where "detail" ? 'apiBatchId';
