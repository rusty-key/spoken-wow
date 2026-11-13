-- A speaker an admin added by hand, from the explorer.
--
-- Some lines are spoken by more NPCs than the dump says: a quest offered by two givers, a
-- greeting several guards share. Nothing could say so but a player's contribution, so a line
-- stayed in its one voice however many NPCs spoke it.
--
-- "addedBy" is the admin who added the row. Like "contributionId" (0034), it is what the
-- importer keeps: an import replaces every speaker wholesale (tts_cli/corpus_db.py), and a row
-- a person added is not the extract's to replace, until the dump has the same NPC on the same
-- line. Added rows take an `ord` from 1,000,000 up, clear of the extract's own 0..n numbering,
-- as contributed rows do.
--
-- Additive and forward-only: the previous release reads an added row as one of the extract's.

alter table "quest_line_speaker" add column if not exists "addedBy" text;
