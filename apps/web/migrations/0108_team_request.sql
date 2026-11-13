-- Requests to start a team, and which languages' teams may appoint text maintainers.
--
-- A signed-in user asks for a team in a language; a site admin approves or rejects it. A request
-- may carry the name of a language that does not exist yet (langName/langNative, both or
-- neither); approving creates it.
--
-- Not row-level secured: a request is read before any team is set, by its author and by site
-- admins, like team_member. For that reason its team column is "approvedTeamId" and not
-- "teamId": rls.test.ts binds every table with a "teamId" column to row-level security.
--
-- "textByTeam" is on for a language made by a request: its team's admins appoint its text
-- maintainers, not only a site admin. The default keeps a release running against this schema
-- after a rollback, and keeps every existing language as it is.

alter table "language" add column "textByTeam" boolean not null default false;

create table "team_request" (
  "id"             uuid        primary key default gen_random_uuid(),
  "userId"         text        not null references "user" ("id") on delete cascade,
  "lang"           text        not null check ("lang" ~ '^[a-z]{2}[A-Z]{2}$' and "lang" <> 'enUS'),
  "langName"       text,
  "langNative"     text,
  "teamName"       text        not null,
  "note"           text,
  "state"          text        not null default 'pending'
    check ("state" in ('pending', 'approved', 'rejected', 'withdrawn')),
  "reason"         text,
  "approvedTeamId" uuid        references "team" ("id") on delete set null,
  "createdAt"      timestamptz not null default now(),
  "decidedAt"      timestamptz,
  "decidedBy"      text        references "user" ("id") on delete set null,
  check (("langName" is null) = ("langNative" is null))
);

create unique index "team_request_pending_idx" on "team_request" ("userId", "lang") where "state" = 'pending';
create index "team_request_queue_idx" on "team_request" ("createdAt") where "state" = 'pending';
