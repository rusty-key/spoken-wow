-- Text a translation community wrote, imported as a feed.
--
-- Italian has no game text: no client runs in it, so the world database carries none and no
-- player's client can send any. Its quests come from QuestIT, a community that translates
-- them and keeps doing so, imported by pipelines/quests/tools/import_questit.py on each of
-- their releases. Those rows are neither the game's ('extracted') nor a player's envelope
-- ('contributed') nor a correction made here ('edited'), and the history should say so.
--
-- The import treats them as its own: a new QuestIT release replaces a 'community' row, and
-- records beside an 'edited' one without making it live, as every import does.
--
-- Additive, per deploy/web/bin/migrate.sh: the checks only widen, and the previous release
-- reads the new value as it reads any other origin.

alter table "quest_line" drop constraint "quest_line_origin_check";
alter table "quest_line" add constraint "quest_line_origin_check"
  check ("origin" in ('extracted', 'edited', 'contributed', 'community'));

alter table "book_line" drop constraint "book_line_origin_check";
alter table "book_line" add constraint "book_line_origin_check"
  check ("origin" in ('extracted', 'edited', 'contributed', 'community'));

alter table "entity_name" drop constraint "entity_name_origin_check";
alter table "entity_name" add constraint "entity_name_origin_check"
  check ("origin" in ('extracted', 'edited', 'contributed', 'community'));
