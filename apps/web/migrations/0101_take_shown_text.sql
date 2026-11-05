-- Additive. The words a take was voiced from, as players read them, so a sound pack can show what
-- it says. Null on a take from before this, or one not cut here: its pack ships the line's current
-- text, which may have moved on since. A take's text never changes after it is cut.

alter table "take" add column "shownText" text;
