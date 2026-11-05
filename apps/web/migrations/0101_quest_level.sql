-- Additive. A quest's level, so maintainers can spend a limited budget on low-level quests first.
-- Keyed on the quest and not on quest_line, whose rows are per language and per version: the
-- level is the same for all of them, and a quest can have a level before it has any text.
create table if not exists "quest_level" (
  "questId"   integer primary key,
  "level"     smallint not null check ("level" >= 0),
  -- A contribution only fills a blank. An import overwrites, so it can correct a forged upload,
  -- which needs no account to send.
  "source"    text not null check ("source" in ('import', 'contribution')),
  "updatedAt" timestamptz not null default now()
);

create index if not exists "quest_level_level_idx" on "quest_level" ("level");
