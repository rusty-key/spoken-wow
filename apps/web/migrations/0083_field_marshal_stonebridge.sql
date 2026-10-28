-- NPC 14721 was renamed from Field Marshal Afrasiabi to Field Marshal Stonebridge.
-- The appearance data already identifies her as the human-female-official voice; make that
-- answer authoritative so every language catalogue moves her lines to the female voice.

insert into "npc" ("npcKind", "npcId", "race", "gender", "flavor", "provenance", "confirmed", "doubtful", "note")
values (
  'creature', 14721, 'human', 'female', 'official', 'moderator', true, false,
  'Field Marshal Stonebridge: renamed by the game and confirmed female from the current NPC data.'
)
on conflict ("npcKind", "npcId") do update
  set "race" = excluded."race",
      "gender" = excluded."gender",
      "flavor" = excluded."flavor",
      "provenance" = excluded."provenance",
      "confirmed" = excluded."confirmed",
      "doubtful" = excluded."doubtful",
      "note" = excluded."note",
      "updatedAt" = now();

-- Keep the name correction in every locale that currently contains the old proper name.
-- entity_name is versioned, so retain the old name as history and make a new current version.
with retired as (
  update "entity_name"
     set "isCurrent" = false
   where "kind" = 'creature'
     and "entityId" = '14721'
     and "isCurrent"
     and "name" like '%Afrasiabi%'
  returning "kind", "entityId", "lang", "name"
)
insert into "entity_name" ("kind", "entityId", "lang", "version", "isCurrent", "origin", "name", "note")
select r."kind", r."entityId", r."lang",
       coalesce((select max(e."version") + 1
                   from "entity_name" e
                  where e."kind" = r."kind"
                    and e."entityId" = r."entityId"
                    and e."lang" = r."lang"), 1),
       true, 'edited', replace(r."name", 'Afrasiabi', 'Stonebridge'),
       'NPC 14721 was renamed by the game.'
  from retired r;

-- A fresh database may not have an English entity_name row yet.
insert into "entity_name" ("kind", "entityId", "lang", "version", "isCurrent", "origin", "name", "note")
select 'creature', '14721', 'enUS', coalesce(max("version"), 0) + 1, true, 'edited',
       'Field Marshal Stonebridge', 'NPC 14721 was renamed by the game.'
  from "entity_name" e
 where e."kind" = 'creature'
   and e."entityId" = '14721'
   and e."lang" = 'enUS'
   and not exists (
         select 1
           from "entity_name" current_name
          where current_name."kind" = 'creature'
            and current_name."entityId" = '14721'
            and current_name."lang" = 'enUS'
            and current_name."isCurrent"
       );

-- Speaker names are retained per locale because they are what that client showed. Change only
-- the proper name, leaving each locale's translated rank/title intact.
update "quest_line_speaker"
   set "npcName" = replace("npcName", 'Afrasiabi', 'Stonebridge')
 where "npcType" = 'creature'
   and "npcId" = 14721
   and "npcName" like '%Afrasiabi%';

-- The old name also appears in the quest's target text and completion stage direction. The
-- filenames and line ids stay frozen; the next audio build regenerates the changed wording.
-- quest_line is versioned, so retain the old text as history and make edited current versions.
with retired as (
  update "quest_line"
     set "isCurrent" = false
   where "isCurrent"
     and ("text" like '%Afrasiabi%'
       or "originalText" like '%Afrasiabi%'
       or coalesce("localeText", '') like '%Afrasiabi%')
  returning "lineId", "variant", "lang", "source", "questId", "questTitle", "playerGender",
            "fileName", "text", "originalText", "localeText", "generatable", "skipReason"
)
insert into "quest_line"
  ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId",
   "questTitle", "playerGender", "fileName", "text", "originalText", "localeText",
   "generatable", "skipReason", "editedBy", "note")
select r."lineId", r."variant", r."lang",
       coalesce((select max(q."version") + 1
                   from "quest_line" q
                  where q."lineId" = r."lineId"
                    and q."variant" = r."variant"
                    and q."lang" = r."lang"), 1),
       true, 'edited', r."source", r."questId", r."questTitle", r."playerGender", r."fileName",
       replace(r."text", 'Afrasiabi', 'Stonebridge'),
       replace(r."originalText", 'Afrasiabi', 'Stonebridge'),
       replace(r."localeText", 'Afrasiabi', 'Stonebridge'),
       r."generatable", r."skipReason", null, 'NPC 14721 was renamed by the game.'
  from retired r;
