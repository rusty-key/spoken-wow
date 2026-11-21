-- Two reads that run on every contributions page and every explorer search.
--
-- 1. momentTexts (lib/contributions/known.ts) asks for one language's current lines of a quest
-- and event, once per row of the queue. quest_line_quest_idx leads with "questId" alone, so each
-- row read every language's lines of that quest and threw most away: about a second for a queue
-- of 3,700 rows, and the page asks twice.
--
-- 2. liveTakes (lib/takes/store.ts) counts a language's takes per file on every search. As the app
-- role the row-level security policy reads "teamId", which take_file_idx does not hold, so the
-- count read every take from the heap. Including the column keeps it in the index. The new index
-- has the old one's keys, so whatever read that one reads this one.
--
-- Dropping an index changes no result, so the previous release runs against this schema unchanged.

create index if not exists "quest_line_moment_idx"
  on "quest_line" ("lang", "questId", "source") where "isCurrent";

create index if not exists "take_file_team_idx"
  on "take" ("source", "lang", "file", "version" desc) include ("teamId");

drop index if exists "take_file_idx";
