-- Take back the "corpus" answers that came from contributions.
--
-- npcVoiceFromCorpus used to read every speaker in the catalogue, including the ones accepted
-- contributions wrote -- and those were written from the NPC's own resolution at the time,
-- often an unconfirmed model guess. Read back as "corpus", the guess became confirmed and
-- outranked every later answer, the game's own appearance data included. It now reads extracted
-- speakers only; this demotes the rows it confirmed before, keeping their voice as the guess
-- it was, so the next report of the NPC (or a moderator) can settle it.
--
-- The condition mirrors npcVoiceFromCorpus: no current English line with an extracted speaker
-- of this kind and id. Data only, and safe under a rollback: the code before this release
-- would confirm such a row again at the NPC's next report, which is where it started.
update "npc_resolution" r
   set "provenance" = 'client',
       "confirmed" = false,
       "updatedAt" = now()
 where r."provenance" = 'corpus'
   and not exists (
     select 1
       from "quest_line_speaker" s
       join "quest_line" l
         on l."lineId" = s."lineId" and l."variant" = s."variant"
        and l."lang" = s."lang" and l."isCurrent"
      where s."lang" = 'enUS'
        and s."contributionId" is null
        and s."npcType" = r."npcKind"
        and s."npcId" = r."npcId"
   );
