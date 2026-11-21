-- entity_name_set, one writer per name at a time.
--
-- It reads the current name and max("version"), then inserts the next version. Two
-- transactions writing the same thing's first English name side by side both read nothing,
-- both insert version 1, and the second fails on entity_name_kind_entityId_lang_version_key.
-- A bulk accept does exactly that: it resolves rows eight at a time, a quest's accept,
-- progress and complete rows sit next to each other in the queue, and each new English
-- quest line names its quest through the quest_line trigger (0036). The failing row rolled
-- back whole and the moderator saw "That didn't go through".
--
-- The lock is taken before the read and held to the end of the transaction, so the second
-- writer waits for the first to commit, then reads its name (a fresh snapshot per statement
-- under read committed) and either finds it current or writes the next version.
--
-- Otherwise the function is 0070's, unchanged. Additive, per deploy/web/bin/migrate.sh: the
-- previous release calls it with the same arguments.
create or replace function "entity_name_set"(k text, eid text, l text, n text) returns void
language plpgsql as $$
declare
  current_name text;
  current_origin text;
begin
  if n is null or n = '' then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('entity_name:' || k || ':' || eid || ':' || l));

  select "name", "origin" into current_name, current_origin from "entity_name"
   where "kind" = k and "entityId" = eid and "lang" = l and "isCurrent";
  if current_name is not distinct from n or current_origin = 'edited' then
    return;
  end if;

  update "entity_name" set "isCurrent" = false
   where "kind" = k and "entityId" = eid and "lang" = l and "isCurrent";
  insert into "entity_name" ("kind", "entityId", "lang", "version", "isCurrent", "origin", "name")
  select k, eid, l, coalesce(max("version"), 0) + 1, true, 'extracted', n
    from "entity_name" where "kind" = k and "entityId" = eid and "lang" = l;
end;
$$;
