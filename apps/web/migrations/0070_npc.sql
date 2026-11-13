-- Who an NPC is, once, for every line it speaks.
--
-- A speaker row carried its own race, gender, flavor and voice, copied from the extract or
-- from npc_resolution at accept, so a moderator's answer never reached the lines an NPC
-- already spoke, and one NPC could speak in several voices. "npc" holds the answer per NPC;
-- a line's voice is read from its speakers' NPCs. Names are per language and live in
-- entity_name.
--
-- Same provenance ranking and invariants as npc_resolution (0030, 0031, 0054, 0055), plus the
-- `item` kind speakers already use. A `corpus` row is the extract's: race and gender from the
-- display, flavor from the NPC's greeting sounds, and no flavor where the game has none.
--
-- Additive: npc_resolution and the speaker columns stay, so the previous release keeps
-- reading them. Backfilled from both, so no line loses its voice between this
-- migration and the next corpus import, which replaces the `corpus` rows with the extract's.

create table if not exists "npc" (
  "npcKind"      text not null,
  "npcId"        integer not null,
  "race"         text,
  "gender"       text,
  "flavor"       text,
  "provenance"   text not null,
  "confirmed"    boolean not null default false,
  "doubtful"     boolean not null default false,
  "modelFileId"  integer,
  "sex"          integer,
  "creatureType" text,
  "build"        text,
  "note"         text,
  "resolvedBy"   text references "user" ("id") on delete set null,
  "updatedAt"    timestamptz not null default now(),
  primary key ("npcKind", "npcId"),
  constraint "npc_kind_check" check ("npcKind" in ('creature', 'gameobject', 'item')),
  constraint "npc_provenance_check"
    check ("provenance" in ('corpus', 'display', 'client', 'moderator', 'none')),
  constraint "npc_confirmed_provenance_check"
    check (not "confirmed" or "provenance" in ('corpus', 'display', 'moderator')),
  constraint "npc_none_is_empty_check"
    check ("provenance" <> 'none' or ("race" is null and "gender" is null and "flavor" is null)),
  -- A moderator's doubt, or the import's default flavor for an NPC the game names none for.
  constraint "npc_doubtful_provenance_check"
    check (not "doubtful" or "provenance" in ('moderator', 'corpus'))
);

create index if not exists "npc_unconfirmed_idx" on "npc" ("confirmed", "updatedAt" desc);

-- An answer lands only over one ranked no higher (lib/npc/store.ts says why each sits where it
-- does). A value missing here ranks below `none`, so it can never land and the store's
-- every-provenance test names it, rather than tying `none` and winning quietly.
create or replace function "npc_provenance_rank"("provenance" text) returns integer
language sql immutable as $$
  select case "provenance" when 'moderator' then 4 when 'corpus' then 3 when 'display' then 2
                           when 'client' then 1 when 'none' then 0 else -1 end
$$;

-- The extract's speakers: one row per NPC, its most common flavor until the next import
-- writes the extract's own.
insert into "npc" ("npcKind", "npcId", "race", "gender", "flavor", "provenance", "confirmed")
select distinct on (s."npcType", s."npcId")
       s."npcType", s."npcId", s."race", s."gender", s."flavor", 'corpus', true
  from (select "npcType", "npcId", "race", "gender", "flavor", count(*) as "n"
          from "quest_line_speaker"
         where "lang" = 'enUS' and "contributionId" is null
         group by 1, 2, 3, 4, 5) s
 order by s."npcType", s."npcId", s."n" desc, s."flavor"
on conflict do nothing;

-- Then every answer a contribution or a moderator gave, where it ranks at least as high.
insert into "npc" ("npcKind", "npcId", "race", "gender", "flavor", "provenance", "confirmed",
                   "doubtful", "modelFileId", "sex", "creatureType", "build", "note",
                   "resolvedBy", "updatedAt")
select "npcKind", "npcId", "race", "gender", "flavor", "provenance", "confirmed", "doubtful",
       "modelFileId", "sex", "creatureType", "build", "note", "resolvedBy", "updatedAt"
  from "npc_resolution"
on conflict ("npcKind", "npcId") do update
  set "race" = excluded."race", "gender" = excluded."gender", "flavor" = excluded."flavor",
      "provenance" = excluded."provenance", "confirmed" = excluded."confirmed",
      "doubtful" = excluded."doubtful", "modelFileId" = excluded."modelFileId",
      "sex" = excluded."sex", "creatureType" = excluded."creatureType",
      "build" = excluded."build", "note" = excluded."note",
      "resolvedBy" = excluded."resolvedBy", "updatedAt" = excluded."updatedAt"
  where "npc_provenance_rank"("npc"."provenance") <= "npc_provenance_rank"(excluded."provenance");

-- The names those answers carried, in English where English has none: a contribution's NPC
-- the extract never named had its name nowhere else.
insert into "entity_name" ("kind", "entityId", "lang", "version", "isCurrent", "origin", "name", "note")
select r."npcKind", r."npcId"::text, 'enUS', 1, true, 'contributed', r."npcName", 'npc_resolution'
  from "npc_resolution" r
 where r."npcName" is not null and btrim(r."npcName") <> ''
   and not exists (select 1 from "entity_name" e
                    where e."kind" = r."npcKind" and e."entityId" = r."npcId"::text
                      and e."lang" = 'enUS')
on conflict do nothing;

-- A moderator can rename an NPC in English too (api/contributions/npc). The speaker trigger
-- writes the extract's English name on every import, so it leaves an edited name alone.
create or replace function "entity_name_set"(k text, eid text, l text, n text) returns void
language plpgsql as $$
declare
  current_name text;
  current_origin text;
begin
  if n is null or n = '' then
    return;
  end if;

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
