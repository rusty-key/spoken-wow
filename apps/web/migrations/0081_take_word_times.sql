-- When each word of a take starts, kept with the take so a pack build can ship it (issue #394).
--
-- "wordTimes" is one string in the format pipelines/timings/export.py writes: each word's start in
-- hundredths of a second after the word before, two base-64 digits a word. Null means the take has
-- none, and the captions keep estimating. "wordTimesSource" says who measured them: 'whisperx' is
-- forced alignment of the text over the saved audio (pipelines/timings/align.py --clip), run when
-- the generator gave no times of its own.
--
-- Not 'not null': a take made before this, or on a server with no aligner set, has no times, and
-- that is a state the pack build already knows how to leave alone.
alter table "take"
  add column "wordTimes" text,
  add column "wordTimesSource" text
    check ("wordTimesSource" in ('whisperx', 'provider'));

alter table "take"
  add constraint "take_word_times_source_check"
  check (("wordTimes" is null) = ("wordTimesSource" is null));
