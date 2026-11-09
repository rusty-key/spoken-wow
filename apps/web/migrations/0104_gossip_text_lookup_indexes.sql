-- Accepting a greeting compares normalised text that no index held, so each lookup ran its
-- regular expressions over a whole language.
--
-- These expressions must match lib/contributions/gossip.ts exactly, or Postgres cannot use the
-- index. gossip.test.ts checks that.
--
-- GIN because a text matches on any of three forms, of either gender's text.
--
-- Not CONCURRENTLY, because migrate.sh runs every file in a transaction.

create index if not exists "quest_line_gossip_text_idx"
  on "quest_line" ("lang", (lower(regexp_replace(btrim(coalesce("localeText", '')), '\s+', ' ', 'g'))))
  where "source" = 'gossip';

create index if not exists "broadcast_text_readings_idx"
  on "broadcast_text" using gin ((array[
    lower(regexp_replace(btrim(coalesce(nullif("text", ''), "text1")), '\s+', ' ', 'g')),
    lower(regexp_replace(btrim(regexp_replace(coalesce(nullif("text", ''), "text1"), '\$[gu]([^:;]*):([^;]*);', '\1', 'gi')), '\s+', ' ', 'g')),
    lower(regexp_replace(btrim(regexp_replace(coalesce(nullif("text", ''), "text1"), '\$[gu]([^:;]*):([^;]*);', '\2', 'gi')), '\s+', ' ', 'g')),
    lower(regexp_replace(btrim(coalesce(nullif("text1", ''), "text")), '\s+', ' ', 'g')),
    lower(regexp_replace(btrim(regexp_replace(coalesce(nullif("text1", ''), "text"), '\$[gu]([^:;]*):([^;]*);', '\1', 'gi')), '\s+', ' ', 'g')),
    lower(regexp_replace(btrim(regexp_replace(coalesce(nullif("text1", ''), "text"), '\$[gu]([^:;]*):([^;]*);', '\2', 'gi')), '\s+', ' ', 'g'))
  ]));

-- The planner has no statistics on an indexed expression until the table is analyzed.
analyze "quest_line";
analyze "broadcast_text";
