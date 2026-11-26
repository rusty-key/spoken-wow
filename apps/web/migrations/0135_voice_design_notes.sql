-- What a design version says about itself beside its prompt: the designer's note (which preview
-- was saved and why) and Gemini's description of the voice, including what it heard when the
-- version was revised from a review. Additive: nothing before reads them.
alter table "voice_design" add column "note" text;
alter table "voice_design" add column "analysis" jsonb;
