-- Lines the corpus has but a player's pack could not voice, one row per line, pack language and
-- manager install. The Spoken Manager sends the gathered file with a random install id when the
-- player turned Sharing on; a line the corpus already knows lands here instead of being dropped.
-- "How many players miss this line" is a count of rows. The IP is not kept here: it stays in
-- contribution_hit, which only the rate limit reads.
create table if not exists "missing_audio_hit" (
  "lineId"      text        not null,
  "packLang"    text        not null,
  -- The pack's own .toc version, "none" when no pack serves that language, null when the addon
  -- predates the field.
  "packVersion" text,
  "installId"   uuid        not null,
  "firstSeen"   timestamptz not null default now(),
  "lastSeen"    timestamptz not null default now(),
  -- Language first, so the key also serves the ranking (one language, grouped by line).
  primary key ("packLang", "lineId", "installId")
);

-- The manager's uploads, counted per install as well as per IP: one install cannot spend the
-- allowance of everyone behind the same address.
alter table "contribution_hit" add column if not exists "installId" uuid;
create index if not exists "contribution_hit_install_idx" on "contribution_hit" ("installId", "createdAt")
  where "installId" is not null;
