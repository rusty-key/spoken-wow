-- The lines a showing plays on /listen, kept with the showing. Voicing a shown version's lines again
-- replaces its sample rows, but players go on hearing (and voting on) the lines they were shown
-- until the version is shown again.
--
-- Additive. The previous release neither reads nor writes the column; a showing it inserts during
-- the deploy has none, and the readers fall back to the version's current lines.

alter table "voice_design_showing" add column "samples" jsonb;

-- The showing players hear now plays its version's current lines, since those were locked while
-- shown. An older showing's version may have been voiced again since, so its lines are unknown
-- and stay null. The file runs in one transaction, so the setting lasts only for it.
select set_config('spoken.team', '*', true);
update "voice_design_showing" s
   set "samples" = coalesce((
     select jsonb_agg(jsonb_build_object('sha256', c."sha256", 'text', c."text", 'npcName', c."npcName") order by c."position")
       from "voice_design_clip" c
      where c."designId" = s."designId" and c."kind" = 'sample'), '[]'::jsonb)
 where s."id" = (select s2."id" from "voice_design_showing" s2
                  where s2."teamId" = s."teamId" and s2."lang" = s."lang" and s2."slot" = s."slot"
                  order by s2."id" desc limit 1);
