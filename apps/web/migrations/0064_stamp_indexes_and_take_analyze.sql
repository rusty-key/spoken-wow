-- Two things the explorers' per-request queries were missing (2026-10-03).
--
-- 1. Indexes the version stamps can answer from.
--
-- Every quests search first asks whether its memoised corpus is still current, and the
-- answer is a stamp (lib/stamp.ts): max(id), count(*) and sum(id) of the current rows of one
-- language. No index led with "lang", so each stamp was a sequential scan of every
-- language's rows -- 17,000 pages of quest_line, read mostly from disk on the droplet, about
-- 120 ms on every request before any work began. Covering indexes make each stamp an
-- index-only scan of one language's entries. entity_name is read by the same stamp for
-- every language but English, with "kind" in the condition too.
--
-- 2. Analyze `take` sooner.
--
-- The default re-analyzes a table once 10% of its rows have changed: about 19,000 takes.
-- Italian's 4,097 takes all arrived between two autoanalyzes, so the planner went on
-- believing itIT had one take, and liveTakes' plan for it ran 18 seconds on every itIT
-- search. takes/store.ts no longer has a join to misplan, but every query that filters take
-- by language still plans from that estimate, and a new language's takes always arrive in a
-- burst. 1% is a few thousand takes, analyzed in well under a second.
--
-- Additive, per deploy/web/bin/migrate.sh: an index and a storage parameter, which the
-- previous release neither reads nor minds.

create index if not exists "quest_line_lang_stamp_idx"
  on "quest_line" ("lang", "id") include ("isCurrent");

create index if not exists "entity_name_lang_stamp_idx"
  on "entity_name" ("lang", "kind", "id") include ("isCurrent");

alter table "take" set (autovacuum_analyze_scale_factor = 0.01);
