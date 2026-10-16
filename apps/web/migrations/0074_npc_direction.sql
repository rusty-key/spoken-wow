-- A direction for one NPC's voice, sent in front of its words like a race's accent direction
-- (generation_settings.raceTags): "[pirate accent]" for "Pretty Boy" Duncan, whose voice is
-- every other human man's. Stored bracketed, as the race directions are. Additive: no reader
-- of npc changes.
alter table "npc" add column if not exists "direction" text;
