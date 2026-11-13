-- Invitations to work on a language, sent to an address that has no account yet.
--
-- An invite binds to the address: accepting needs a session with that address and the token.
-- Only the token's SHA-256 is kept. A row is never deleted, only accepted or revoked, so the
-- team page and the log can say what happened; deleting the inviter deletes their invites.
--
-- Not row-level secured: like team_member and api_token, an invite belongs to a person and is
-- read before any team is set.

create table "invite" (
  "id"           uuid        primary key default gen_random_uuid(),
  "email"        text        not null check ("email" = lower(btrim("email"))),
  "lang"         text        not null check ("lang" ~ '^[a-z]{2}[A-Z]{2}$'),
  "capabilities" text[]      not null check (
    cardinality("capabilities") >= 1
    and "capabilities" <@ array['text', 'edit', 'regenerate', 'configure', 'ignore', 'admin', 'record']
  ),
  "tokenHash"    text        not null unique,
  "invitedBy"    text        not null references "user" ("id") on delete cascade,
  "createdAt"    timestamptz not null default now(),
  "sentAt"       timestamptz not null default now(),
  "sendCount"    integer     not null default 1,
  "expiresAt"    timestamptz not null,
  "acceptedAt"   timestamptz,
  "acceptedBy"   text        references "user" ("id") on delete set null,
  "revokedAt"    timestamptz,
  "revokedBy"    text        references "user" ("id") on delete set null
);

create unique index "invite_open_idx" on "invite" ("lang", "email")
  where "acceptedAt" is null and "revokedAt" is null;
create index "invite_inviter_idx" on "invite" ("invitedBy", "createdAt" desc);

revoke all on "invite" from spoken_app;
grant select, insert, update on "invite" to spoken_app;
