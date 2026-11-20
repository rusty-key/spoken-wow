-- Matching a batch of greetings to broadcast_text took a minute and a half for one language. The
-- readings index (0104) holds no language, so the planner took the btree on "lang" instead and
-- ran gossip_readings over every row of the language, once per greeting.
--
-- Here each reading is keyed by its language, so one GIN lookup answers both and leaves the
-- planner nothing cheaper to choose. 0104's index stays, for a release rolled back to the old
-- query. Not CONCURRENTLY, because migrate.sh runs every file in a transaction.

-- Every reading of a row's two wordings (0104's gossip_readings), each as `lang|reading`. Lang is
-- a fixed four-letter code, so the first `|` always ends it. Schema-qualified because pg_dump
-- restores with an empty search_path, and rebuilding the index below calls this.
create or replace function "gossip_lang_readings"("lang" text, "text" text, "text1" text) returns text[]
language sql immutable as $$
  select array(
    select "lang" || '|' || r
      from unnest(public."gossip_readings"("text") || public."gossip_readings"("text1")) as r
  )
$$;

-- The key a lookup asks for: the language and the shown text, normalised as the readings are.
create or replace function "gossip_lang_key"("lang" text, "value" text) returns text
language sql immutable as $$
  select "lang" || '|' || public."gossip_norm"("value")
$$;

create index if not exists "broadcast_text_lang_readings_idx"
  on "broadcast_text" using gin ((public."gossip_lang_readings"("lang", "text", "text1")));

-- The planner has no statistics on an indexed expression until the table is analyzed.
analyze "broadcast_text";
