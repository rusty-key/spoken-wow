-- The voice design workbench (/voices/design): new ElevenLabs voices designed from a written
-- description, sampled on corpus lines and reviewed, in versions. Docs: docs/platform/VOICE-DESIGN.md.
--
-- Additive. The previous release reads none of these tables. The one change to an existing table
-- widens archive_object's prefix check to admit `designs/`, which the previous release never writes.
--
-- A version belongs to the team that made it, so every maintainer of the language sees and reviews
-- it. The ElevenLabs voice a version is saved as lives in one person's account ("holderId"), since
-- keys are per person.

-- One Gemini key per person, sealed like the ElevenLabs and fish.audio keys (0018, 0040). Gemini
-- listens to the game clips for the blind comparison. Its own table for 0040's reason.
create table "gemini_key" (
  "userId" text not null primary key references "user" ("id") on delete cascade,
  "ciphertext" text not null,
  "iv" text not null,
  "tag" text not null,
  "hint" text not null,
  "verifiedAt" timestamptz,
  "tier" text,
  "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
  "updatedAt" timestamptz default CURRENT_TIMESTAMP not null
);

-- One run of the blind comparison over a race-gender's flavors. "labels" maps the letters Gemini
-- heard to the slots, which it was never told.
create table "voice_design_analysis" (
  "id"           uuid        primary key default gen_random_uuid(),
  "teamId"       uuid        not null default spoken_team() references "team" ("id"),
  "lang"         text        not null,
  "group"        text        not null,
  "labels"       jsonb       not null,
  "result"       jsonb       not null,
  -- Null when the site had no openSMILE to measure with.
  "measurements" jsonb,
  "model"        text        not null,
  "createdBy"    text        references "user" ("id") on delete set null,
  "createdAt"    timestamptz not null default now()
);

create index "voice_design_analysis_group_idx" on "voice_design_analysis" ("teamId", "lang", "group", "createdAt" desc);

create table "voice_design" (
  "id"             uuid        primary key default gen_random_uuid(),
  "teamId"         uuid        not null default spoken_team() references "team" ("id"),
  "lang"           text        not null,
  "slot"           text        not null,
  "version"        integer     not null check ("version" > 0),
  "prompt"         text        not null,
  "previewText"    text        not null,
  -- [{generatedVoiceId, sha256, measures}], in the order ElevenLabs returned them.
  "previews"       jsonb       not null,
  "chosenPreview"  integer,
  "voiceId"        text,
  "voiceName"      text,
  "holderId"       text        references "user" ("id") on delete set null,
  -- Deleted from the holder's ElevenLabs account to free a slot; the audio here stays.
  "voiceDeletedAt" timestamptz,
  "sampleModel"    text,
  "sampleSettings" jsonb,
  "analysisId"     uuid        references "voice_design_analysis" ("id") on delete set null,
  "createdBy"      text        references "user" ("id") on delete set null,
  "createdAt"      timestamptz not null default now(),
  unique ("teamId", "lang", "slot", "version")
);

-- A version's audio: its previews and its sample lines. A re-sample replaces the sample rows;
-- the objects they named stay in the archive, as every object does.
create table "voice_design_clip" (
  "designId"   uuid        not null references "voice_design" ("id") on delete cascade,
  "teamId"     uuid        not null default spoken_team() references "team" ("id"),
  "kind"       text        not null check ("kind" in ('preview', 'sample')),
  "position"   integer     not null check ("position" >= 0),
  "sha256"     text        not null check ("sha256" ~ '^[0-9a-f]{64}$'),
  "lineId"     text,
  "text"       text,
  "npcName"    text,
  "characters" integer,
  "credits"    integer,
  "createdAt"  timestamptz not null default now(),
  primary key ("designId", "kind", "position")
);

create index "voice_design_clip_sha_idx" on "voice_design_clip" ("teamId", "sha256");

-- Append-only verdicts; the newest is the version's state.
create table "voice_design_review" (
  "id"          bigserial   primary key,
  "designId"    uuid        not null references "voice_design" ("id") on delete cascade,
  "teamId"      uuid        not null default spoken_team() references "team" ("id"),
  "status"      text        not null check ("status" in ('good', 'needs-work')),
  "note"        text        not null default '',
  "bestPreview" integer,
  -- {"sample:0": "good" | "off", "preview:1": ...}
  "clips"       jsonb       not null default '{}',
  "createdBy"   text        references "user" ("id") on delete set null,
  "createdAt"   timestamptz not null default now()
);

create index "voice_design_review_design_idx" on "voice_design_review" ("designId", "createdAt");

alter table "voice_design_analysis" enable row level security;
alter table "voice_design_analysis" force row level security;
create policy "team_isolation" on "voice_design_analysis"
  using ("teamId" = spoken_team() or spoken_all_teams())
  with check ("teamId" = spoken_team() or spoken_all_teams());

alter table "voice_design" enable row level security;
alter table "voice_design" force row level security;
create policy "team_isolation" on "voice_design"
  using ("teamId" = spoken_team() or spoken_all_teams())
  with check ("teamId" = spoken_team() or spoken_all_teams());

alter table "voice_design_clip" enable row level security;
alter table "voice_design_clip" force row level security;
create policy "team_isolation" on "voice_design_clip"
  using ("teamId" = spoken_team() or spoken_all_teams())
  with check ("teamId" = spoken_team() or spoken_all_teams());

alter table "voice_design_review" enable row level security;
alter table "voice_design_review" force row level security;
create policy "team_isolation" on "voice_design_review"
  using ("teamId" = spoken_team() or spoken_all_teams())
  with check ("teamId" = spoken_team() or spoken_all_teams());

alter table "archive_object" drop constraint "archive_object_prefix_check";
alter table "archive_object" add constraint "archive_object_prefix_check"
  check ("prefix" in ('takes', 'recordings', 'encodings', 'samples', 'references', 'designs'));
