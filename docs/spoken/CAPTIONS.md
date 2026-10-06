# Captions

Spoken can show quest dialogue, NPC dialogue, zone lore and book pages inside the
player. Compact captions show one or two lines; expanded captions show eight.
The captions follow the recording: with **Type Words Out** on (the default) the
words appear as the voice reaches them, and with **Highlight Words** on (off by
default) two adjacent words are lit in gold. They move, resize and scale with
the player in both window layouts.

The **Subtitles Only** narrator style shows the words without a window instead,
low in the middle of the screen, four lines at a time, typed in a little ahead
of the voice. It lights no words: with the timing an estimate, a word lit as it
is typed in front of the reader shows every miss. `/spoken player subtitle`
switches to it.

![Quest captions in the WoW Forever player](captions.png)

The screenshot above is from WoW Forever on Linux. The player confirmed the
layout and approximate timing in game. Other clients have not been checked
visually. The expanded view and zone/book captions still need an in-game visual check.

## Controls

- `/spoken transcript` toggles captions; `on` and `off` also work.
- The small **+** button expands captions to eight lines. **−** restores your
  compact line setting. The player grows downward and keeps the unit icon in place.
- `/spoken transcript 1` sets one compact line; `/spoken transcript 2` sets two.
- `/spoken options` has settings for line count, font size, highlighting, typing
  out, **Auto-Scroll** (below), and the subtitles' size and background.
- Scroll over the captions to read back or ahead; they hold there. Click the
  text to follow the recording again. Right-click opens the player menu, or
  settings in the original layout. With **Type Words Out** on, a line the voice
  has not reached yet shows blank until it does; turn the setting off to read ahead.
- `/spoken transcript reset` restores the caption and subtitle defaults and
  moves the subtitles back to where they start.

## Auto-Scroll

How the captions in the window follow the voice:

| Mode | Behaviour |
|---|---|
| **Line by Line** (default) | The text glides up a line at a time as the voice reaches each line, about a quarter of a second per line, so there is no jump. The line being read is on the last row with **Type Words Out** on (below), and in the middle with it off, as synced-lyrics players (Apple Music, Spotify) keep the sung line. |
| **Page by Page** | A whole page turns when the voice reaches its end, as the captions always did. Closest to broadcast pop-on captions, which read best when the text should not move while it is read. |
| **Off** | The text holds still; the wheel moves it. Clicking the captions turns following back on, line by line. |

With **Type Words Out** on, the lines below the voice are still blank, so Line by Line keeps the
line being read on the last row instead, with what has been read above it, as roll-up
broadcast captions do. The glide needs the client to clip the captions' frame (`SetClipsChildren`); where it cannot, the text steps a
line at a time. `Transcript:GetScroll` and `Transcript:ScrollTo` let a player draw its own
scrollbar. Subtitles Only pages on its own and is not affected.

Stopping freezes the text. Replay restarts it with the recording. Skipping
shows the next clip's text, and a clip without text hides the captions.

## Settings language

Caption settings and tooltips follow the game client language. Translations cover
German, Spanish (EU and Latin America), French, Brazilian Portuguese, Russian,
Korean, Simplified Chinese and Traditional Chinese. English is the fallback.
The caption text itself follows the recording language.

## Timing and text

The sound packs have recording durations but no word timestamps. Timing is
estimated from word length, punctuation and the total duration. Two neighboring
words are highlighted to give the estimate some room. At the end of a page,
the previous word stays highlighted instead of advancing the page early.

Captions use the text captured when a quest or gossip clip was queued. Quest
log replays can use the quest description. A completion recording never uses
the acceptance text as a substitute. Different quest wording and pauses in a
recording can still make the highlight drift.

Zone and subzone captions use the full lore in the actual voice language, including
English audio fallback. Book clips carry their own page text, so turning or closing
the book does not change the captions of a queued recording. The English addon
export includes every page. New book sound pack exports include the voice language's
text; older translated packs can caption pages opened during the current session.
Mail is excluded. Captions stay hidden when matching text is unavailable.

Other sources can supply `clip.present.transcript`; the player also accepts
`clip.text`. Book captions are exported by `pipelines/books/tools/lib/lua.mjs`
using the same plain text conversion as narration. The current English export
was regenerated from the public `/api/books/search?lang=enUS` catalogue on
2026-09-27; page IDs, book order and lookup checksums are unchanged.

## Checks

Run from the repository root:

```sh
make test-player
node scripts/check-addon-xml.mjs
make zones-check
make books-test
```

The caption suite is `tests/captions/verify.lua`. It runs the real queue,
player layouts, actions and quest adapter with simulated widgets and time.
It checks playback changes, page boundaries, Unicode, resizing, attachment,
queue placement, expansion and settings. The books and zones suites also cover
caption sources, language fallback and queued pages. The fixture models layout and text width; it
does not reproduce the game's font rendering or audio.
