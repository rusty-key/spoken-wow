-- Accepting a greeting looks its words up in two tables, and both lookups compare a normalised
-- form that no index held, so each ran its regular expressions over a whole language: about
-- 11,000 broadcast texts, in three forms each, and every gossip line. That was most of the
-- database time of a bulk accept, and it ran inside each row's transaction.
--
-- The expressions are the ones lib/contributions/gossip.ts builds, word for word. If they differ
-- Postgres cannot use the index, and gossip.test.ts fails.
--
-- GIN over every reading because a text matches on any of three forms, of either gender's text.
--
-- Not CONCURRENTLY, because migrate.sh runs every file in a transaction. CREATE INDEX holds
-- writes to its table while it builds, never reads.
--
-- An index changes no result, so the previous release runs against this schema unchanged.

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

-- Statistics on the indexed expressions, so the planner stops walking the primary key by id.
analyze "quest_line";
analyze "broadcast_text";
