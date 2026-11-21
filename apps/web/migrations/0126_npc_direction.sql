-- One NPC's own voice direction ("[pirate accent]"), stored bracketed like the race directions.
alter table "npc" add column if not exists "direction" text;
