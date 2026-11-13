-- How far along the boss data is, as one comparable string.
--
-- The bosses section's stamp for scripts/db/check-synced.sh, in place of section_stamp.sql:
-- boss_instance, boss and boss_line have no serial id, so the highest id and the sum of live
-- ids that stamp reads do not exist. A digest of every row instead, which notices an edit, a
-- new version, a retired boss and a renamed one alike; the tables are a few thousand rows.
-- Named columns rather than whole rows: ids make bosses-sync gives out fresh (entity_name's),
-- authors it blanks where the account is not on this machine ("editedBy"), and timestamps,
-- whose text follows each session's time zone, would differ with the data the same.
--
-- Takes and recordings as section_stamp.sql reads them, for when the bosses section has them.
-- Takes the same two psql variables; corpus is unused.
select 'bosses ' ||
       (select count(*) || ':' || md5(coalesce(string_agg(
                 row("map", "kind", "zone", "storyMap", "storyKey", "position")::text,
                 E'\n' order by "map"), ''))
          from "boss_instance")
       || ' / ' ||
       (select count(*) || ':' || md5(coalesce(string_agg(
                 row("id", "map", "key", "position", "encounterIds", "creatureId", "displayId", "zone", "retired")::text,
                 E'\n' order by "id"), ''))
          from "boss")
       || ' / lines ' ||
       (select count(*) || ':' || md5(coalesce(string_agg(
                 row("bossId", "lang", "version", "isCurrent", "origin", "text", "source", "note")::text,
                 E'\n' order by "bossId", "lang", "version"), ''))
          from "boss_line")
       || ' / names ' ||
       (select count(*) || ':' || md5(coalesce(string_agg(
                 row("kind", "entityId", "lang", "version", "isCurrent", "origin", "name")::text,
                 E'\n' order by "kind", "entityId", "lang", "version"), ''))
          from "entity_name" where "kind" in ('boss', 'instance'))
       || ' / takes ' ||
       (select coalesce(max("id"), 0) || ':' || count(*) || ':'
               || coalesce(sum("id") filter (where "isCurrent"), 0)
          from "take" where "source" = :'source')
       || ' / recordings ' ||
       (select coalesce(max("id"), 0) || ':' || count(*) filter (where "deletedAt" is null)
          from "recording" where "source" = :'source');
