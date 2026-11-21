-- Additive. Null on a take from before this or not cut here: its pack ships the line's current
-- text, which may have moved on since. A take's text never changes after it is cut.

alter table "take" add column "shownText" text;
