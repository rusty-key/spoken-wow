-- Accepting a greeting compares normalised text that no index held, so each lookup ran its
-- regular expressions over a whole language.
--
-- The normalisation lives in these functions so that the indexes and the queries share it.
--
-- Not CONCURRENTLY, because migrate.sh runs every file in a transaction. broadcast_text goes
-- first because the locks last until commit, and greetings are accepted into quest_line.

-- Case and runs of whitespace aside.
create or replace function "gossip_norm"("value" text) returns text
language sql immutable as $$
  select lower(regexp_replace(btrim("value"), '\s+', ' ', 'g'))
$$;

-- A text whole and down each side of its `$g male:female;` and `$u` branches. Whole too, because
-- the client sends a `$u` branch unresolved. Schema-qualified because pg_dump restores with an
-- empty search_path, and rebuilding the index below calls this.
create or replace function "gossip_readings"("value" text) returns text[]
language sql immutable as $$
  select array[
    public."gossip_norm"("value"),
    public."gossip_norm"(regexp_replace("value", '\$[gu]([^:;]*):([^;]*);', '\1', 'gi')),
    public."gossip_norm"(regexp_replace("value", '\$[gu]([^:;]*):([^;]*);', '\2', 'gi'))
  ]
$$;

-- Both columns' readings: a query narrows to the speaker's gender after the index.
create index if not exists "broadcast_text_readings_idx"
  on "broadcast_text" using gin ((public."gossip_readings"("text") || public."gossip_readings"("text1")));

-- The planner has no statistics on an indexed expression until the table is analyzed.
analyze "broadcast_text";

create index if not exists "quest_line_gossip_text_idx"
  on "quest_line" ("lang", (public."gossip_norm"(coalesce("localeText", ''))))
  where "source" = 'gossip';

analyze "quest_line";
