# Word times

When each word of a voice recording starts, so the captions light the word being said instead of
estimating it. The times are data: they ship inside the voice packs, not in Spoken. The
current export is in the repo at `data/word-times.json` (English, aligned with WhisperX), so a package run can use it
as it is: `WORD_TIMES=pipelines/timings/data/word-times.json`.

## Where it sits in the voice work

1. The voices are generated and the packs installed (`pipelines/quests`, `zones`, `books`).
2. `make timings-manifest ADDONS=<Interface/AddOns>` lists the English clips and the text each was
   voiced from (`manifest.py`).
3. `make timings-align` lays each text over its recording with WhisperX (`align.py`): forced
   alignment by a wav2vec2 model, so every word of the text gets a time and none is misheard.
   `ENGINE=whisper` uses faster-whisper instead, which hears the recording and matches what it
   heard to the text. Rows already in `build/timings/aligned.jsonl` are skipped, so it can be
   stopped and started again.
4. `make timings-export` writes `build/timings/word-times.json` (`export.py`), leaving out clips
   that matched poorly and recordings cut again since.
5. The packs get their share, either in a package run with `WORD_TIMES=build/timings/word-times.json`
   (the quests, zones and Readables package scripts), or into the installed packs with
   `make timings-packs ADDONS=...`. `pack_times.py` writes each pack's `Data/WordTimes.lua` and lists
   it in the pack's `.toc`.

A clip with no entry, a clip in another language and a pack built without times are timed by
estimate. See `docs/spoken/CAPTIONS.md`.

## Setup

`pip install -r pipelines/timings/requirements.txt`. WhisperX needs torch; on Windows install the CUDA
build first or the aligner runs on the CPU, many times slower. The first run downloads the alignment
model (about 360 MB for English).

## Notes

- The caption words are the text cut at whitespace, as the addon cuts it (`Spoken:CaptionWords`);
  `align.py` hands WhisperX that one line. A word it cannot place (a numeral, a symbol) is put
  between its neighbours, and `matched` counts only the words it placed.
- A take generated on the site is timed when it is saved: `apps/web` runs `align.py --clip` (set
  `WORD_TIMES_ALIGNER`, see `deploy/web/README.md`) when the generator gave no times, and keeps the
  result in `take."wordTimes"`, for English takes only. The text it aligns is the site's, before the
  addon fills in a player's name, so a pack build that reads the column must check that the number
  of times equals the number of words the pack shows, as `export.py` does for the data above. The
  packs still get their data from steps 2 to 5 above until a pack build reads that column.
- Another language needs its own aligned rows and its own pack data; `--language` picks WhisperX's
  model for it. Only English has been run.
