-- How far along one section's data is, as one comparable string.
--
-- Run locally and on production by scripts/db/check-synced.sh, with two psql variables:
--   corpus   the section's text table (quest_line, lore_line, book_line)
--   source   the section's name in the take table
-- Fed on stdin rather than written into a command, because the quoting for a query this
-- shape -- single quotes inside a shell command inside an ssh argument -- is unreadable
-- and was got wrong on the first attempt.
--
-- Two stamps, the corpus and the section's takes, each the three terms the apps' own memos
-- use: an edit or a new take inserts a row so the highest id moves, a delete moves the
-- count, and a restore moves the live flag between rows that already exist -- which only
-- the sum of live ids notices.
--
-- A third, the section's voice-actor recordings (migration 0062), the same way: an upload
-- inserts a row, and a removal only sets deletedAt, which the count of live rows notices.
select (select coalesce(max("id"), 0) || ':' || count(*) || ':'
               || coalesce(sum("id") filter (where "isCurrent"), 0)
          from :"corpus")
       || ' / takes ' ||
       (select coalesce(max("id"), 0) || ':' || count(*) || ':'
               || coalesce(sum("id") filter (where "isCurrent"), 0)
          from "take" where "source" = :'source')
       || ' / recordings ' ||
       (select coalesce(max("id"), 0) || ':' || count(*) filter (where "deletedAt" is null)
          from "recording" where "source" = :'source');
