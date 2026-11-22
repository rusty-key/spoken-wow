-- Additive. The player genders ('m', 'f') whose client showed a quest line's text word for word,
-- gathered from the copies intake finds already on file (lib/contributions/readers.ts). On the
-- version row, so a new text starts with none. Empty for every line before this; the previous
-- release never reads or writes it.

alter table "quest_line" add column "readerGenders" text[] not null default '{}';
