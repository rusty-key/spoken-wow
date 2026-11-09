# 2026-09: quests line overrides become versions of their lines

**Status: NOT YET RUN. Run once, and only when the condition below holds.** See `../README.md`.

## What it does

Before the quests corpus moved into Postgres, the only way to change what a quest line says was
a note in `line_override`: "this file should say this instead", keyed by the audio file, with
no history. Now that `quest_line` keeps versions, the way zones' `lore_line` and books'
`book_line` do, a fix to a line's wording is a new `edited` version of it.

`fold-overrides.py` turns each `line_override` row into that version: it retires the line's
live version and inserts one carrying the override's text, with the override's author as
`editedBy` and the note "migrated from line_override". A line whose live version already says
the override's text is left alone, so a second run writes nothing. Production had 4 overrides
when this was written.

It folds English's only. Another language's overrides are a team's spoken text, not fixes to its
original, and stay where they are.

## When to run it: not before the site stops reading `line_override`

As of PR #29 the site still reads and writes overrides: the line editor writes a
`line_override` row, clearing one deletes it, and search, staleness, dirtiness and
regeneration all prefer an override's text to the line's. Folded before that changes, the
same fix would live in two places, and **clearing an override would leave the line saying
it**, because the folded version is now the line's own text.

So it runs as part of the change that moves the quests line editor onto `quest_line`
versions (writing and restoring them like `lib/places/lore.ts` does) and drops the reads of
`line_override`. At that point, in order:

1. deploy that change;
2. `DATABASE_URL=… pipelines/quests/.venv/bin/python one-off/2026-09-fold-overrides/fold-overrides.py`

Also due in that change: `import-corpus` (`pipelines/quests/tts_cli/corpus_db.py`) decides a
line is unchanged by comparing the live text with the extract. For an `edited` line those
never match, so every import records the extract again as a duplicate version. It should
compare with the newest `extracted` version instead. No line is `edited` until this runs, so
it does nothing wrong before then.

## Rehearsal

Run against `spoken_prod_rehearsal` (a copy of production's database): 4 overrides, 4 folded.
A second run: 4 already applied, 0 folded.
