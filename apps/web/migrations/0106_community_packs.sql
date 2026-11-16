-- Community voice packs: the Manager's registry.
--
-- A pack is the identity an author owns; every upload of it is a submission, so a rejected
-- update never displaces the last approved version (the public list reads the newest approved
-- submission per pack).
--
-- "ownerId" and "submittedBy" go null when an account is deleted: the pack stays live and an
-- admin can hand it to somebody else. At most one submission per pack waits for review.
--
-- The two packs of packs.json are seeded as approved with no owner, so the registry does not
-- change on the day it moves here.

create table if not exists "community_pack" (
  "id"         text primary key
                 check ("id" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length("id") <= 48),
  "ownerId"    text references "user" ("id") on delete set null,
  "lang"       text not null check ("lang" ~ '^[a-z]{2}[A-Z]{2}$'),
  "section"    text not null check ("section" in ('quests', 'places', 'readables')),
  "createdAt"  timestamptz not null default now(),
  "unlistedAt" timestamptz,
  "unlistedBy" text references "user" ("id") on delete set null
);

create table if not exists "community_pack_submission" (
  "id"           bigserial primary key,
  "packId"       text not null references "community_pack" ("id") on delete cascade,
  "submittedBy"  text references "user" ("id") on delete set null,
  "title"        text not null,
  "author"       text not null,
  "description"  text not null,
  "version"      text not null,
  "size"         bigint not null,
  "sha256"       text not null,
  "url"          text not null,
  "homepage"     text,
  "license"      text,
  "status"       text not null default 'pending'
                   check ("status" in ('pending', 'approved', 'rejected', 'withdrawn')),
  "submittedAt"  timestamptz not null default now(),
  "reviewedBy"   text references "user" ("id") on delete set null,
  "reviewedAt"   timestamptz,
  "rejectReason" text
);

create unique index if not exists "community_pack_submission_one_pending"
  on "community_pack_submission" ("packId") where "status" = 'pending';

create index if not exists "community_pack_submission_latest_approved"
  on "community_pack_submission" ("packId", "reviewedAt" desc) where "status" = 'approved';

insert into "community_pack" ("id", "lang", "section", "createdAt") values
  ('polski', 'plPL', 'quests', '2026-11-05 00:00+00'),
  ('ivrit', 'heIL', 'quests', '2026-11-07 00:00+00')
on conflict ("id") do nothing;

insert into "community_pack_submission"
  ("packId", "title", "author", "description", "version", "size", "sha256", "url", "homepage", "license",
   "status", "submittedAt", "reviewedAt")
select 'polski', 'Spoken Polski', 'zaxcer',
  'Polish quest voiceover for levels 1-58, both sides: every starting zone and levelling zone up to Western Plaguelands (11 773 recordings with male and female variants). Translation entirely by the WoWPoPolskuForever team led by Loe''Aner, used with permission. Voices designed with ElevenLabs Voice Design, lines by ElevenLabs v4 Turbo.',
  '0.3.0', 1293995350, '2db65466b8c0cc5a6a74b63f8fffcf812904df667fcde86a650b91009392769a',
  'https://github.com/zaxcer/spoken-polish/releases/download/v0.3.0/SpokenCommunity_polski-0.3.0.zip',
  'https://github.com/zaxcer/spoken-polish', 'Non-commercial; text WoWPoPolskuForever',
  'approved', '2026-11-05 00:00+00', '2026-11-05 00:00+00'
where not exists (select 1 from "community_pack_submission" where "packId" = 'polski');

insert into "community_pack_submission"
  ("packId", "title", "author", "description", "version", "size", "sha256", "url", "homepage", "license",
   "status", "submittedAt", "reviewedAt")
select 'ivrit', 'Spoken Hebrew (Ivrit)', 'renanbazinin',
  'Hebrew quest and gossip voiceover, growing zone by zone (now the six starting zones, the six capitals and most zones up to level 30: about 5,100 recordings). Fan translation made for the pack with a shared glossary. Voices are ElevenLabs clones of each race''s NPC voices, lines by ElevenLabs v4 and v4 Turbo. Captions read right to left in Noto Sans Hebrew.',
  '0.6.3', 471609008, '5d43061d748c809925e41625f16504e337c963331b28fb7674fabda7c3a33a81',
  'https://github.com/renanbazinin/spoken-ivrit/releases/download/v0.6.3/SpokenCommunity_ivrit-0.6.3.zip',
  'https://github.com/renanbazinin/spoken-ivrit', 'Non-commercial fan work',
  'approved', '2026-11-07 00:00+00', '2026-11-07 00:00+00'
where not exists (select 1 from "community_pack_submission" where "packId" = 'ivrit');
