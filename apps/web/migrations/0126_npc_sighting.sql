-- Where players met an NPC: the zone map (uiMapID) the game said they stood in when its quest or
-- gossip window opened, from the `seen` envelopes the addon gathers beside missing lines
-- (addons/Spoken/Gather.lua, lib/contributions/sighting.ts). One row per NPC, zone and uploader,
-- so a file sent twice counts once, and a zone counts only once two uploaders agree on it
-- (lib/quests/sightings.ts): anyone can hand-build a file.
create table if not exists "npc_sighting" (
  "npcType"   text        not null check ("npcType" in ('creature', 'gameobject')),
  "npcId"     integer     not null check ("npcId" > 0),
  "uiMapID"   integer     not null check ("uiMapID" > 0),
  -- 'user:<id>', 'install:<id>' or 'ip:<sha-256>': who vouches, never a raw address.
  "uploader"  text        not null,
  "createdAt" timestamptz not null default now(),
  primary key ("npcType", "npcId", "uiMapID", "uploader")
);
