-- When each word of a take starts, in seconds from the start of the file the addon plays: one
-- entry per word of the text the addon shows, split at whitespace as Spoken splits its captions.
--
-- Null is a take with no times: one cut before this, by fish.audio, or whose spoken words could
-- not be matched one to one with the words shown. The captions then estimate, as they always
-- have, so no take is backfilled.
alter table "take" add column "wordTimes" real[];
