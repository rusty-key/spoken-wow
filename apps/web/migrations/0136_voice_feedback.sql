-- Players' feedback on designed voices (/listen): a maintainer shows a version to players, anyone
-- votes on it, and people who voted hear by email when the voice is shown again.
-- Docs: docs/platform/VOICE-DESIGN.md.
--
-- Additive. The previous release reads none of these tables.

-- One press of Show to players. A slot's public version is its newest showing's. Votes belong to
-- the showing, so showing a version again starts a fresh round.
create table "voice_design_showing" (
  "id"        bigserial   primary key,
  "designId"  uuid        not null references "voice_design" ("id") on delete cascade,
  "teamId"    uuid        not null default spoken_team() references "team" ("id"),
  "lang"      text        not null,
  "slot"      text        not null,
  "createdBy" text        references "user" ("id") on delete set null,
  "createdAt" timestamptz not null default now()
);

create index "voice_design_showing_slot_idx" on "voice_design_showing" ("teamId", "lang", "slot", "id" desc);
create index "voice_design_showing_design_idx" on "voice_design_showing" ("designId");

-- "voter" is `u:<userId>` for an account, `a:<uuid>` for the anonymous cookie. One row each, so a
-- second vote replaces the first and nobody can vote twice from one browser.
create table "voice_feedback" (
  "showingId" bigint      not null references "voice_design_showing" ("id") on delete cascade,
  "teamId"    uuid        not null default spoken_team() references "team" ("id"),
  "voter"     text        not null check ("voter" ~ '^(u|a):.+$'),
  "userId"    text        references "user" ("id") on delete set null,
  "verdict"   text        not null check ("verdict" in ('fits', 'close', 'off', 'skip')),
  "note"      text        not null default '' check (length("note") <= 2000),
  -- Hidden by a maintainer as spam: the note leaves the list, the verdict still counts.
  "hiddenAt"  timestamptz,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  primary key ("showingId", "voter")
);

create index "voice_feedback_voter_idx" on "voice_feedback" ("voter");

alter table "voice_design_showing" enable row level security;
alter table "voice_design_showing" force row level security;
create policy "team_isolation" on "voice_design_showing"
  using ("teamId" = spoken_team() or spoken_all_teams())
  with check ("teamId" = spoken_team() or spoken_all_teams());

alter table "voice_feedback" enable row level security;
alter table "voice_feedback" force row level security;
create policy "team_isolation" on "voice_feedback"
  using ("teamId" = spoken_team() or spoken_all_teams())
  with check ("teamId" = spoken_team() or spoken_all_teams());

-- An anonymous voter's address. Nothing but the confirmation goes to it until "confirmedAt" is set,
-- so nobody can sign a stranger up.
create table "voice_follower" (
  "voter"         text        primary key check ("voter" ~ '^a:.+$'),
  "email"         text        not null,
  "confirmToken"  text        not null unique,
  "confirmSentAt" timestamptz,
  -- Who asked, so one sender cannot mail confirmations to address after address.
  "confirmIp"     text,
  "confirmedAt"   timestamptz,
  "createdAt"     timestamptz not null default now()
);

create index "voice_follower_ip_idx" on "voice_follower" ("confirmIp", "confirmSentAt");

-- Addresses that unsubscribed, lowercased. Covers accounts and anonymous followers alike.
create table "voice_follow_optout" (
  "email"     text        primary key,
  "createdAt" timestamptz not null default now()
);

-- A voice shown again that an address should hear about; sent in one email a day at most.
create table "voice_follow_notice" (
  "email"     text        not null,
  "showingId" bigint      not null references "voice_design_showing" ("id") on delete cascade,
  "createdAt" timestamptz not null default now(),
  "sentAt"    timestamptz,
  primary key ("email", "showingId")
);

create index "voice_follow_notice_unsent_idx" on "voice_follow_notice" ("email") where "sentAt" is null;
