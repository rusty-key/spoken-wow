-- Where players met an NPC: the zone map (uiMapID) the game said they stood in when its quest or
-- gossip window opened, from the `seen` envelopes the addon gathers beside missing lines
-- (addons/Spoken/Gather.lua, lib/contributions/sighting.ts). One row per NPC, zone and uploader,
-- so the Manager sending the same file after every logout counts once, and a zone counts only
-- once two uploaders agree on it (lib/quests/sightings.ts).
create table if not exists "npc_sighting" (
  "npcType"   text        not null check ("npcType" in ('creature', 'gameobject')),
  "npcId"     integer     not null check ("npcId" > 0),
  "uiMapID"   integer     not null check ("uiMapID" > 0),
  -- 'user:<id>', 'install:<id>', or 'upload:<uuid>' for an anonymous file: who vouches. No address.
  "uploader"  text        not null,
  "createdAt" timestamptz not null default now(),
  primary key ("npcType", "npcId", "uiMapID", "uploader")
);
