-- An accent direction per race, for the models that perform an audio tag rather than reading
-- it aloud.
--
-- Dwarves are why: they are meant to sound Scottish, and a voice read by eleven_v3 comes
-- back close to RP. A text-to-speech request carries no channel for direction, so the
-- direction has to travel inside the text - see accentTagged in lib/generation/narration.ts.
--
-- Nullable rather than defaulted to the committed tags: the row that exists right now was
-- written by a release that had no opinion about accents, and reading one into it would
-- start tagging lines nobody asked to have tagged. readSettings turns null into no tags.
--
-- Additive and forward-only per deploy/bin/migrate.sh: the previous release never names this
-- column, so it keeps running against this schema.

alter table "generation_setting" add column "raceTags" jsonb;
