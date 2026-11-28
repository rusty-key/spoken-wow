-- NPC barks: what an NPC says as you open its window (greeting), close it (farewell) and click
-- it again and again (pissed), in our voices, so a pack whose voices differ from the game's can
-- mute the game's clips without two voices meeting in one conversation.
--
-- A bark belongs to an NPC type, not to an NPC: every NPC of a type plays the same clips, so a
-- per-NPC row (quest_line_speaker) would repeat each bark for thousands of NPCs. It is keyed by
-- the game clip it stands for, so the same file in a shopkeeper's set and the plain set of one
-- type is one bark.

-- The game's voice sets (NPCSounds rows) and their clips, per kind, as Forever ships them
-- (pipelines/quests/voice/npc-sounds.json). Game data: imported, never edited. A set with no
-- type of ours (animals, named NPCs) has null type columns; the pack must never mute it.
create table "npc_bark_set" (
  "setId"    integer   primary key,
  "race"     text,
  "gender"   text,
  "flavor"   text,
  "greeting" integer[] not null,
  "farewell" integer[] not null,
  "pissed"   integer[] not null,
  "build"    text      not null
);

create table "npc_bark" (
  id             bigserial   primary key,
  "gameFile"     integer     not null,
  "race"         text        not null,
  "gender"       text        not null,
  "flavor"       text,
  "kind"         text        not null check ("kind" in ('greeting', 'farewell', 'pissed')),
  "lang"         text        not null default 'enUS',
  "version"      integer     not null,
  "isCurrent"    boolean     not null default false,
  -- 'extracted' is the transcript of the game's clip; 'edited' was written here, and an import
  -- never replaces it.
  "origin"       text        not null check ("origin" in ('extracted', 'edited')),
  "text"         text        not null,
  "originalText" text        not null,
  "editedBy"     text        references "user" ("id") on delete set null,
  "note"         text,
  "createdAt"    timestamptz not null default now(),
  foreign key ("race", "gender") references "gender" ("race", "gender")
);

create unique index "npc_bark_version_idx"
  on "npc_bark" ("gameFile", "race", "gender", coalesce("flavor", ''), "lang", "version");

-- One live version per bark per language, for the reason quest_line_current_idx gives.
create unique index "npc_bark_current_idx"
  on "npc_bark" ("gameFile", "race", "gender", coalesce("flavor", ''), "lang") where "isCurrent";
