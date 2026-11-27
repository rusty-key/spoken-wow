-- The lines a showing plays on /listen, kept with the showing. Voicing a shown version's lines again
-- replaces its sample rows, but players go on hearing (and voting on) the lines they were shown
-- until the version is shown again.
--
-- Additive. The previous release neither reads nor writes the column; a showing it inserts during
-- the deploy has none, and the readers fall back to the version's current lines.

alter table "voice_design_showing" add column "samples" jsonb;

-- Every showing so far played its version's current lines. The file runs in one transaction, so
-- the setting lasts only for it.
select set_config('spoken.team', '*', true);
update "voice_design_showing" s
   set "samples" = coalesce((
     select jsonb_agg(jsonb_build_object('sha256', c."sha256", 'text', c."text", 'npcName', c."npcName") order by c."position")
       from "voice_design_clip" c
      where c."designId" = s."designId" and c."kind" = 'sample'), '[]'::jsonb);
