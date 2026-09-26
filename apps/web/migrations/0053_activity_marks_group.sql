-- Marks cleared in one click are folded under that click's row, like a queue batch's takes.
--
-- Clearing the marks a search found is one click and up to 20,000 files (api/dirty), and
-- each file is its own "take.acked" row, so one click could fill a day's log. The click now
-- writes a "marks.cleared" row carrying a groupId, and every file's row carries the same one;
-- the page hides the files and lists them when the click's row is opened. This is the index
-- that opening reads, the same shape as "activity_batch_idx" in 0050.
--
-- Acks written before this have no groupId and stay one row each: grouping them now would
-- mean an UPDATE, and migrations here only add.

create index "activity_marks_idx" on "activity" (("detail"->>'groupId'))
  where "kind" = 'take.acked';
