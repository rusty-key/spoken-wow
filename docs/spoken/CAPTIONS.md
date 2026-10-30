# Captions

Spoken shows the words of the line it reads (quest dialogue, NPC dialogue, place stories and
readables' pages) in each window, and as subtitles. The Small Window and the DialogueUI window show
Rows at Once of them, one or two rows, and the Small Window's **+** button expands them to eight;
the Large Window shows as many rows as its box holds, up to three. The captions follow the
recording: with **Type Words Out** on (off by default) the words appear as the voice reaches them,
and with **Highlight Words** on (the default) two adjacent words are lit, in gold, or in deep
red on parchment. They move, resize and scale with their window.

The **Subtitles Only** narrator style shows the words without a window instead, low in the middle
of the screen, under the speaker's face, name and the line's title: a page of whole sentences at a
time (Sentences at Once, 1 to 4, and never more than four rows), or row by row, typed in a little
ahead of the voice. It lights the word being read only with Type Words Out off: with the timing an
estimate, a word lit as it is typed in front of the reader shows every miss. `/sp style subtitles`
switches to it; see [`PLAYER-STYLES.md`](PLAYER-STYLES.md) for each style and the rows of its
settings.

![Quest captions in the WoW Forever player](captions.png)

The screenshot above is from WoW Forever on Linux. The player confirmed the
layout and approximate timing in game. The expanded view and place and readable captions still need
an in-game visual check.

## Controls

- `/sp narrator` turns the window and subtitles (Show Narrator) on and off; `on` and `off` also work, and
  `/sp words` still answers to it.
- In the Small Window, the small **+** button expands the captions to eight rows, and **−**
  goes back to Rows at Once. The window grows downward and keeps its portrait in place. The Large
  Window and the DialogueUI window have no such button.
- `/sp rows 1` sets Rows at Once to one row; `/sp rows 2` to two.
- `/sp settings` opens Spoken's page. Its rows for the captions are Show Narrator, Rows at Once,
  Word Size, Highlight Words, Type Words Out, Type Out By and **Auto-Scroll** (below), and for the
  subtitles Subtitle Size, Sentences at Once, Shadow Behind Words, Show Name and Title, Hide
  Portrait and Show Progress Bar. Each style shows only the rows it reads.
- Scroll over the captions in a window to read back or ahead; they hold there. Click the
  text to follow the recording again. With Ctrl held the wheel changes Window Size instead (Subtitle
  Size over the subtitles), and with Ctrl and Shift Word Size; with Lock Position on it does
  neither. Right-click the text to skip the line whose words it shows, as Skip does; a right-drag
  begun on it skips nothing. Shift-right-click opens the Small Window's menu, or the settings over
  the other windows. With
  **Type Words Out** on, a row the voice has not reached yet shows blank until it does; turn
  the setting off to read ahead. The subtitles cannot be scrolled by hand.
- `/sp transcript reset` restores the caption and subtitle defaults and
  moves the subtitles back to where they start.

The older `/spoken transcript`, `/spoken transcript on`, `/spoken transcript 1` and `/spoken
options` work as well.

## Auto-Scroll

How the captions in the window follow the voice:

| Mode | Behaviour |
|---|---|
| **Row by Row** (default) | The text glides up a row at a time as the voice reaches each row, about a quarter of a second per row, so there is no jump. The row being read is the last one with **Type Words Out** on (below), and the middle one with it off, as synced-lyrics players (Apple Music, Spotify) keep the sung line. |
| **Page by Page** | A whole page turns when the voice reaches its end, as the captions always did. Closest to broadcast pop-on captions, which read best when the text should not move while it is read. |
| **Off** | The text holds still; the wheel moves it. Clicking the captions turns following back on, row by row. |

With **Type Words Out** on, the rows below the voice are still blank, so Row by Row keeps the
row being read last instead, with what has been read above it, as roll-up broadcast
captions do. The glide needs the client to clip the captions' frame (`SetClipsChildren`); where it
cannot, the text steps a row at a time. While the text moves, a row partly past the top or bottom
edge fades by as much of it as is out of view, so rows fade out and in at the edges instead of
ending on a hard cut. The subtitles have an Auto-Scroll of their own, Page by Page (the default)
or Row by Row, and no Off.

Stopping freezes the text. Replay restarts it with the recording. Skipping
shows the next clip's text, and a clip without text hides the captions. After the line's title the
windows and the subtitles say why a line waits, "(Stopped)" and the "+N" lines waiting behind it;
pointing at "+N" lists them (see [`PLAYER-STYLES.md`](PLAYER-STYLES.md)).

## Settings language

Caption settings and tooltips follow the game client language. Translations cover
German, Spanish (EU and Latin America), French, Brazilian Portuguese, Russian,
Korean, Simplified Chinese and Traditional Chinese. English is the fallback.
The words of a place's or a readable's caption are in the Text Language, whatever the voice and
whichever language a fallback recording is in. Places has a setting for it, Text Language on the
Places page. Readables has none and uses the client's language, as the game shows a page: on a
German client the page's German words, on an English client its English ones. An Italian or
Vietnamese voice, which no client runs in, is captioned in its own words where its pack has them:
its players are on a client in another language. The two can differ on a client whose Places Text
Language is not its own language: a German client with English text has English place captions and
German readable captions. The recording's
language gives the words only where the Text Language has none for that place or page. A readable
is decided page by page, so a book can be partly in the client's language and partly in the
recording's. A book's title follows its words: the one the client showed this session, else the one
in the index of the pack in that language, else the English title. The recording's timing does not
follow words other than the ones it says, so a caption is timed by the title's lead only where its
words are the playing pack's own, or the corpus's under an English recording.

Other caption text follows the recording language.

## Timing and text

A recording the site made with ElevenLabs after word times were kept carries them in its sound
pack: one start per word of the text the take was cut from (`take."wordTimes"`), packed into one
string per clip, which `clip.present.timings` takes as it is and the captions unpack when the clip plays. Quests, gossip, places and
readables pass them as `clip.present.timings`, but only where the captions show the recording's own
words. A take without them, a fish.audio take, and captions in another language are estimated from word length, punctuation and the total duration. Two neighboring
words are highlighted to give the estimate some room, in the windows; the subtitles
light one word. At the end of a page, the previous word stays highlighted instead of
advancing the page early.

A source that knows when each word is spoken passes `clip.present.timings`: one
start time per word, in seconds from the start of the recording, in the order
the captions cut the transcript into words: `Spoken:CaptionWords(transcript)`
returns those words, with the escape sequences the captions do not show
removed. The captions then follow those
times instead of the estimate, `Spoken:GetCaption()` reports them with
`timed = true`, and Subtitles Only turns each page when the voice reaches its
first word. A list whose length does not match the words, with a hole or a time
that is not a number, or whose times go backwards or past the recording's
length, is ignored and the estimate is used.

Captions use the text captured when a quest or gossip clip was queued. Quest
log replays can use the quest description. A completion recording never uses
the acceptance text as a substitute. Different quest wording and pauses in a
recording can still make the highlight drift.

Zone and area captions use the full story in the Text Language, and in the voice's language,
fallback included, only where it has none. Readable clips carry their own page text, so turning
or closing the book does not change the captions of a queued recording. The English addon
export includes every page. New readables voice pack exports include the voice language's
text; older translated packs can caption pages opened during the current session.
Mail is excluded. Captions stay hidden when matching text is unavailable.

Other sources can supply `clip.present.transcript`; the player also accepts
`clip.text`. A source whose text is in a script the game's font cannot draw (Czech on a
Western client, for one) names a font file in `clip.present.font`. The captions, the subtitle
and every window then draw that clip's header, label and text in it, at the player's own size;
a clip without one stays in the player's font, and so does a file the client cannot load. Readable captions are exported by `pipelines/readables/tools/lib/lua.mjs`
using the same plain text conversion as narration. The current English export
was regenerated from the public `/api/readables/search?lang=enUS` catalogue on
2026-09-27; page IDs, book order and lookup checksums are unchanged.

The DialogueUI window draws the captions in DialogueUI's font, size and colours, with an
empty row between paragraphs, at the player's Word Size and Rows at Once like the other
windows. See
[`PLAYER-STYLES.md`](PLAYER-STYLES.md).

## Captions in another window

`Spoken:GetCaption()` returns the clip, the words and the reading position the captions use,
whether **Highlight Words** and **Type Words Out** are on, and **Type Out By** (`typewriterBy`). It stays current while the
captions are hidden or turned off. `Spoken:SplitCaption(text)` splits any text the way the
captions do, and records where each word sits in that text. With the two, another addon can
mark the same words in its own copy of the line. Spoken Quests does this inside DialogueUI's
window (see [`docs/quests/DIALOGUEUI-BRIDGE.md`](../quests/DIALOGUEUI-BRIDGE.md)), and Spoken
Readables in its book view. So **Show Narrator**, **Highlight Words** and **Type Words Out** apply to
DialogueUI's own text under every narrator style, Voice Only included, when Mark Words in
DialogueUI is on; with DialogueUI installed Spoken's page offers them under Voice Only
(`DialogueUIOptions:WordRowsShown`). **Type Out By** applies there too.

## Checks

Run from the repository root:

```sh
make test-player
node scripts/check-addon-xml.mjs
make places-check
make readables-test
```

The caption suite is `tests/captions/verify.lua`. It runs the real queue,
player layouts, actions and quest adapter with simulated widgets and time.
It checks playback changes, page boundaries, Unicode, resizing, attachment,
queue placement, expansion and settings. The readables and places suites also cover
caption sources, language fallback and queued pages. The fixture models layout and text width; it
does not reproduce the game's font rendering or audio.
