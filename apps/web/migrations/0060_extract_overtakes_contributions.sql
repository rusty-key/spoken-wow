-- What the game's own data says overtakes what a player sent in.
--
-- A contribution fills a gap the extract left: a line, a speaker or a name the dump did not
-- have. Once an import finds the same thing in the dump, the contribution has done its job and
-- the extract is the source of truth. Lines already worked that way -- an import promotes over
-- a 'contributed' line and only records beside an 'edited' one -- but speakers and names did
-- not:
--
--   * A contributed name was written as 'edited', so every import treated it as a moderator's
--     correction and recorded the dump's name beside it instead of promoting it. Names gain the
--     'contributed' origin quest_line has had since 0034, and the ones accepted contributions
--     wrote -- the only rows whose note is "contribution #N" -- move to it.
--
--   * Contributed speakers were round-tripped. The export lists them like any other row, so
--     importing that export inserted each again as an extracted speaker beside its contributed
--     original: 1,600 duplicates on production, every one an exact copy. They are not the
--     extract's -- no dump had those lines -- so the copies go and the contributed rows stay.
--     tts_cli/corpus_db.py now marks contributed rows in the export and skips them on import,
--     and drops a contributed speaker when a genuine extract finds the same NPC on its line.
--
-- Data plus a widened check, and safe under a rollback: the code before this release reads
-- 'contributed' names as it reads any other, and the speakers deleted are copies.

alter table "entity_name" drop constraint "entity_name_origin_check";
alter table "entity_name" add constraint "entity_name_origin_check"
  check ("origin" in ('extracted', 'edited', 'contributed'));

update "entity_name"
   set "origin" = 'contributed'
 where "origin" = 'edited'
   and "note" ~ '^contribution #[0-9]+$';

delete from "quest_line_speaker" e
 using "quest_line_speaker" c
 where e."contributionId" is null
   and c."contributionId" is not null
   and e."lineId" = c."lineId" and e."lang" = c."lang" and e."variant" = c."variant"
   and e."npcType" = c."npcType" and e."npcId" = c."npcId"
   and e."npcName" = c."npcName" and e."race" = c."race" and e."gender" = c."gender"
   and e."flavor" is not distinct from c."flavor" and e."voice" = c."voice";
