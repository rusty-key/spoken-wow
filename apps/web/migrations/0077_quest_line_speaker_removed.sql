-- A speaker of the dump's that an admin took off a moment. An import replaces every extracted
-- speaker wholesale (tts_cli/corpus_db.py), so deleting the row alone would not last: the
-- importer skips the speakers this table names, on both player-gender sides of the moment.
--
-- "removedBy" has no foreign key: the export carries it, and a database seeded from that file
-- has none of the users it names. The previous release ignores the table, so its next import
-- brings the removed speakers back.

create table if not exists "quest_line_speaker_removed" (
  "moment"    text        not null,
  "npcType"   text        not null check ("npcType" in ('creature', 'gameobject', 'item')),
  "npcId"     integer     not null,
  "removedBy" text        not null,
  "removedAt" timestamptz not null default now(),
  primary key ("moment", "npcType", "npcId")
);
