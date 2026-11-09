-- Keyed on the quest and not on quest_line, whose rows are per language and per version: the
-- level is the same for all of them, and a quest can have a level before it has any text.
create table if not exists "quest_level" (
  "questId" integer primary key,
  "level"   smallint not null check ("level" >= 0)
);
