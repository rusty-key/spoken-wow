-- A language keeps one quest_line per line id: variant 0.
--
-- 103 line ids carry two English variants, because the vmangos dump keeps a quest_template
-- row per content patch and the corpus transcribes both (0032). English keeps them: the
-- addon's title lookup needs the older patch's title on a vanilla client. A translation has
-- no such thing to carry -- locales_quest is one row per quest, with no patch -- and every
-- variant of a line shares one file, so one mp3 per language.
--
-- The locale import wrote a translation per English variant anyway. Where the variants have
-- different English that was the same text twice. Where they have the same English (9 line
-- ids: q:172:complete:f/m, q:4265:complete/progress, q:8292:complete, q:8293:complete/progress,
-- q:8298:complete, q:8300:complete) the import's (lineId, originalText) lookup kept only the
-- last variant, so variant 0 stayed untranslated -- and regeneration voices a line from its
-- first variant, so those files could not be voiced in any language.
--
-- tts_cli/locale_import.py and contribution accept now write variant 0 only, and the
-- translated explorer reads variant 0 only. This moves the existing rows to match:
--
--   1. Where a language has a line only under a later variant, that variant's rows -- every
--      version, so its history comes along -- become variant 0.
--   2. Every other non-English row under a later variant is deleted. On production at the
--      time of writing all of them are origin 'extracted' and identical in text to their
--      variant 0, so nothing anyone wrote is lost; the import re-derives them from the dump.
--
-- English is untouched. Data-only, and a no-op once applied.

update "quest_line" as q
   set "variant" = 0
 where q."lang" <> 'enUS'
   and q."variant" = 1
   and not exists (select 1 from "quest_line" z
                    where z."lineId" = q."lineId" and z."lang" = q."lang" and z."variant" = 0);

delete from "quest_line"
 where "lang" <> 'enUS'
   and "variant" > 0;
