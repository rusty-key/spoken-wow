-- Quests whose text names a class as a word of its own ("There's a priest out in the
-- mountains"), not as the reader's class. A reader of that class sends the word as `$c`, and
-- intake puts it back from the corpus line (lib/contributions/class-words.ts). Keyed on the
-- quest, as quest_level is: the word is the quest's in every language.
create table if not exists "quest_class_word" (
  "questId"   integer primary key,
  "markedBy"  text,
  "createdAt" timestamptz not null default now()
);
