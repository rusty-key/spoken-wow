-- Quests whose text names a class as a word of its own ("There's a priest out in the
-- mountains"), not as the reader's class. A reader of that class sends the word as `$c`, and
-- intake puts it back from the corpus line (lib/contributions/class-words.ts). Per language,
-- because each language's text maintainers mark their own.
create table if not exists "quest_class_word" (
  "questId"   integer not null,
  "lang"      text not null,
  "markedBy"  text,
  "createdAt" timestamptz not null default now(),
  primary key ("questId", "lang")
);
