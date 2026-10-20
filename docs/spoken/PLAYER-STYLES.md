# Narrator styles

How Spoken shows the line it is reading is one setting, **Narrator Style** (`Frame.Style`), with
five values: `"subtitle"` (Subtitles Only, the default on Forever), `"minimal"` (Small Window),
`"classic"` (Large Window), `"dialogueui"` (DialogueUI, with the DialogueUI addon installed) and
`"none"` (Voice Only). They are tiles on Spoken's settings page and in the welcome window, in that
order. `/sp style subtitles | small | large | dialogueui | voice` switches between them and says
why when it cannot; `/sp player <style>` with the stored names still works. `Addon:PlayerStyle()`
answers what is drawn where the chosen style is not on offer: `"dialogueui"` is drawn as the Small
Window while DialogueUI is missing, and the setting is kept, so the window comes back with
DialogueUI. The setting replaced three switches, `SubtitlePlayer`, `HideFrame` and `MinimalPlayer`;
`Addon:InitDB` carries a profile that set them over to the style they showed, and removes them.

Forever is the client this describes. The 1.12, 2.4.3 and 3.3.5 clients keep their code and get no
new work: they have the Large Window alone, and 1.12 has no words to show.

## How the code is split

All of it is in `addons/Spoken/UI/`, one copy for every module.

| File | What it holds |
| --- | --- |
| `Options.lua`, `Welcome.lua`, `Search.lua` | Spoken's settings page with the style tiles and Preview, the welcome window, and the box that searches the settings. |
| `Layout.lua` | `SpokenLayout`, the settings toolkit Spoken's page and every module's page are built with. |
| `PlayerFrame.lua` | The Large Window, and the router: every refresh goes through it to the style in use. |
| `MinimalPlayer.lua` | The Small Window. |
| `Subtitle.lua` | Subtitles Only. |
| `DialogueUIPlayer.lua`, `DialogueUITheme.lua`, `DialogueUITransitions.lua`, `DialogueUIOptions.lua` | The DialogueUI window, what it reads of DialogueUI, how it moves to and from DialogueUI's dialogs, and its settings rows. |
| `Transcript.lua` | The words of the line: cleaning, word timing, paging, gliding, highlight and typing. The windows draw them through it, and Subtitles Only takes its text, timing and position from it. |
| `WordMarks.lua` | Marks the line being read in another window's own text, for DialogueUI. |
| `Actions.lua` | The round buttons, Stop or Replay, Skip, the line's own actions, the "after the title" row, the Ctrl wheel, the progress line and the bronze tint. |
| `Face.lua`, `Portrait.lua`, `StaticPortrait.lua` | The speaker's face and 3D model. |
| `Compendium.lua`, `TextView.lua` | Azeroth's Compendium and its text view, which belong to no style. |
| `MinimapButton.lua`, `ContributeBox.lua` | The minimap button and menu, and the box Contribute copies from. |

## What every style shares

- **Controls.** Stop, which turns to Replay once the line is stopped, Skip, and the line's own
  actions (Report, where its module offers it, unless Hide Report Buttons is on), as the round
  buttons of `Actions.lua`. The game cannot start a sound part-way through, so there is Stop and
  Replay, never Pause and Resume. The keys Stop or Replay, Skip Line and Stop All work under every
  style, Voice Only included.
- **After the line's title**, in this order: why the line waits, "(Stopped)" while it is stopped,
  and "+N", the lines waiting behind it. The reason is what `SoundQueue:GetHeldReason` answers:
  "(Waiting for the NPC to finish speaking.)" under NPC Voice Before Reading, and for a place story
  Places reads by itself, "(Waiting for combat to end.)" or "(Waiting for the cinematic to end.)".
  A story you ask for with Play does not wait. Pointing at "+N" opens a tooltip, Up Next, with
  the waiting lines in the order they will play, each with its title and who says it, at most
  twelve (`Actions.WaitingTip`). Clicking "+N" does nothing, and a click on it reaches the window
  under it.
- **The face** (`Face.lua`): the speaker's still portrait, captured from their unit or drawn from
  their creature (`StaticPortrait.lua`), else the line's own picture, cut round, with the line's
  badge on a dark disc at its lower right, and the disc only under a badge. A creature the client
  has not cached shows the book until it comes. The Large Window draws a 3D model instead.
- **Show Progress Bar**: a progress line under the words, for the subtitles and every window.
- **Dragging** a window or the subtitles draws it to the screen's edges and middle, and the DialogueUI
  window to its resting place too, with a gold guide line where it holds. Holding Shift drags it free.
- **Lock Position**: the windows and the subtitles cannot be dragged or resized, and clicks on
  them pass through to the game; their buttons still work. **Reset Positions**, under Fix a
  Problem, forgets the places saved for the Small, Large and DialogueUI windows and the subtitles.
- **Ctrl and the mouse wheel** over the Small Window, the DialogueUI window or the subtitles step
  their size (Window Size, or Subtitle Size) by 5 points; Ctrl, Shift and the wheel step Word Size
  by 1. Both stay within their sliders' ranges (`SIZES` in `Core.lua`), show the new value in a
  tooltip beside the pointer, and do nothing while Lock Position is on, when the wheel scrolls the
  words instead. The words pass a Ctrl wheel on to their window (`frame.spokenWheel`) and scroll
  without it. Over the subtitles without Ctrl the wheel zooms the camera. The Large Window has
  no wheel sizing. A note on Spoken's page says so under the sizes (`WINDOW_WHEEL_HINT`,
  `SUBTITLE_WHEEL_HINT`).
- **Bronze Border**, on Forever, under Look: the round buttons' rings, the faces' rings, the Large
  Window's mover ring and the Small Window's border, progress line and right-click menu in the
  bronze Forever's own frames wear (`Actions.Bronze`).
- **Read in Battlegrounds**, under While Spoken Reads, on by default. Off, a line a module starts
  by itself is not queued in a battleground or an arena (`Addon:ReadsHere`, asked by
  `SourceMethods:Enqueue`), so no style shows one there. What is queued stops when you arrive
  (`Addon:StopWhereNotRead`). A line you ask for with Play, a command or the Compendium is read.
- **Preview** on Spoken's page shows the chosen style with a sample line while no line plays,
  until it is turned off.
- With a DialogueUI dialog open, the windows step aside (`Actions.DialogCovers`).

## Settings by style

The page builds only the rows a style reads, and greys a row whose switch is off, with the reason
(`Layout:ShowWhen`, `Layout:Requires`). `tests/lua/settings_ux_test.lua` holds this list.

| Style | Rows |
| --- | --- |
| Subtitles Only | Subtitle Size, Show Narrator, Word Size, Lock Position, Shadow Behind Words, Show Name and Title, Hide Portrait (under Show Name and Title), Show Progress Bar, Sentences at Once or Rows at Once, Auto-Scroll, Highlight Words, Type Words Out, Type Out By |
| Small Window | Window Size, Show Narrator, Word Size, Lock Position, Theme, Hide Portrait, Show Progress Bar, Rows at Once, Auto-Scroll, Highlight Words, Type Words Out, Type Out By |
| Large Window | Window Size, Show Narrator, Word Size, Lock Position, Hide Portrait, Show Progress Bar, Auto-Scroll, Highlight Words, Type Words Out, Type Out By |
| DialogueUI | Window Size, Show Narrator, Word Size, Lock Position, Theme, Show Progress Bar, Rows at Once, Fit Window to Words, Auto-Scroll, Highlight Words, Type Words Out, Type Out By |
| Voice Only | none; with DialogueUI installed, Show Narrator, Highlight Words, Type Words Out and Type Out By |

- Show Narrator off puts the window and subtitles away and greys every row about them; the voice plays on. Its
  row for each module under it does the same for that module's lines.
- Highlight Words, Type Words Out and Type Out By are the rows that mark DialogueUI's own text
  too, which is why Voice Only keeps them while DialogueUI is installed.
- Under Subtitles Only, Rows at Once shows with Auto-Scroll on Row by Row, and Sentences at Once
  with Page by Page. Highlight Words waits while Type Words Out is on.
- The windows' Auto-Scroll is Row by Row, Page by Page or Off; the subtitles' has no Off.
- Rows at Once is 1 or 2 where it shows. The Large Window has none: its words fill the box, up to
  three rows.
- Bronze Border (Forever) shows under every style.
- Under DialogueUI, Spoken Quests adds a DialogueUI section, shown under every style while
  DialogueUI is installed (see below).

## Subtitles Only

`Subtitle.lua`. No window: the speaker's face, name and the line's title in a row, the words
under it, low in the middle of the screen over a soft shadow (Shadow Behind Words), and a progress
line. The words come from the captions (`Transcript.lua`), so Stop, Replay and Skip behave as
they do in the windows.

- **Auto-Scroll** is Page by Page (the default) or Row by Row. Page by page, a page holds
  Sentences at Once whole sentences (1 to 4) and never more than four rows; a page fades out
  before the next fades in, turned when the voice reaches it. Row by row, the words glide up
  through Rows at Once rows.
- **Type Words Out** types each page in a little ahead of the voice, by letter or by word (Type
  Out By). **Highlight Words** lights the word being read only while the words show whole, with
  Type Words Out off: an estimated timing lit as it is typed in front of the reader shows every
  miss.
- **Show Name and Title** off leaves the row out; it still says "(Stopped)" or why a line waits,
  and Hide Portrait waits on it.
- The words do nothing when clicked, and there is no right-click menu: a subtitle in the middle
  of the screen is clicked by accident, and a right-drag there is the camera turning. Stop or
  Replay, Skip and Report fade in under it while the pointer is over it.
- Dragged by its words, it moves anywhere on the screen and keeps its place. It is drawn to the
  screen's edges and middle, with a gold guide line where it holds; Shift drags it free.
- It shows once the voice has begun, or while the line is stopped or held back, so that it can
  say why nothing is being read.

## Small Window

`MinimalPlayer.lua`, contributed as Minimal Classic: see
[`docs/minimal-classic/`](../minimal-classic/README.md). The face beside a panel with the speaker's
name over the line's title, the controls at the header's right, then Rows at Once of the words
(the **+** button expands them to eight, **−** goes back) and the progress line.

- **Theme**: Parchment, with dark words (the default), or Dark, with light words.
- **Hide Portrait** leaves the face out.
- Right-click opens a menu: Stop or Replay, Skip Line, Stop All, Open Azeroth's Compendium,
  Settings, and the line's actions that name themselves.
- Dragged by the panel or the name; the game's own size grabber at the lower right, shown under
  the pointer while unlocked, sets its width. It fades in and out, and out and in again from one
  line to the next.
- Not on the 1.12, 2.4.3 and 3.3.5 clients.

## Large Window

`PlayerFrame.lua`. The game's Talking Head frame where the client has its art (Spoken's own art
elsewhere): a bigger portrait drawn as a 3D model, the speaker's name, up to three rows of the
words, the controls at the top right where the frame has its close button, and the progress line.
It is dragged by the ring at the portrait's lower left, and it fades as the Small Window does. It
is the only window the 1.12, 2.4.3 and 3.3.5 clients have.

## DialogueUI

With the [DialogueUI](https://www.curseforge.com/wow/addons/dialogueui) addon installed, a smaller
twin of DialogueUI's quest window, in DialogueUI's own art. Without DialogueUI there is no tile.
`/sp diagnostics` adds a `dialogueui:` line with what was read from DialogueUI.

### The window

A parchment, or dark, panel in DialogueUI's proportions, showing only the line playing:

- DialogueUI's own header strip, with the speaker's face in its socket, the line's title beside it
  in DialogueUI's title type and the speaker's name small above, then why the line waits,
  "(Stopped)" and "+N";
- Stop (Replay once stopped), Skip and the line's own actions, Report among them, at the header's
  right end;
- a place's picture over the words;
- Rows at Once of the words, in DialogueUI's paragraph font, with an empty row between
  paragraphs, and the progress line under them.

There is no scrollbar: the words follow the **Auto-Scroll** mode, and the wheel scrolls them.
Right-click opens the settings. Drag anywhere to move it; it then keeps its own saved place, apart
from the other windows'. Unmoved, or after Reset Positions, it rests at the screen's top left, out
of the next dialog's way. Sizing it with Ctrl and the wheel is not a move: it keeps its top-left
corner.

Every fade is of the window as one image (a frame buffer), and nothing in it may change while it
is one: changing anything inside a frame buffer crashes the Forever client. So while it is, it is
deaf to the pointer, the captions are held, and its own updates wait (`Skin:Buffer`, `Unbuffer`,
`Defer`).

`DialogueUITransitions.lua` moves it to and from DialogueUI's dialogs. When DialogueUI's window
closes on a line that plays on, the dialog's words fade first, then this window slides and shrinks
out of it to where it rests. A dialog that closes on a line it queued behind another sends that
line's page behind this window, and its count ripples.

Nothing is source-specific. A zone's story or a readable's page plays in it as a quest line does:
the book for a face, the book's or the zone's name as the speaker, the page or the area as the
title, or the clip's key when there is none. A readable's page is drawn in DialogueUI's book art,
paper or stone by its material.

**Nothing of DialogueUI is copied.** The panel loads DialogueUI's texture files
(`Interface/AddOns/DialogueUI/Art/Theme_Brown/` or `Theme_Dark/`, and `Art/Book/` for books) and
asks DialogueUI's font objects which font they write in. That is why the style exists only with
DialogueUI installed.

### Its settings

It follows the settings of the other windows, on Spoken's page:

- **Window Size** scales the whole panel, text included. The panel is laid out exactly as
  DialogueUI's window, at its size, paddings, text size (its Font Size setting), row spacing
  (0.35 of the text size) and paragraph gap. At the default Window Size (70%) it is 65% of
  DialogueUI's window; the size scales from there.
- **Word Size** sets the words against DialogueUI's: at the default 16 they are DialogueUI's
  size, at 24 half as large again. The row spacing follows the words; the header and buttons
  stay with the panel.
- **Rows at Once**: 1 or 2 rows of the words. It has no expand button and no resize handle, and
  the Small Window's expand state (`CaptionsExpanded`) does not change it.

Two rows are the window's alone, built only with DialogueUI installed (`DialogueUIOptions.lua`)
and shown while this style is chosen: **Theme** under Look and **Fit Window to Words** under
Words.

- **Theme** is one row: Same as DialogueUI (the default), which follows DialogueUI's theme and
  changes the moment DialogueUI does, or Parchment or Dark for good. It is kept as two settings,
  `FollowTheme` and `Theme`.
- **Fit Window to Words** (on): the panel is only as tall as the line's words need, Rows at Once
  being the most it grows to; a long line scrolls. Off, it always shows Rows at Once.

After the narrator style's settings comes a DialogueUI section from each module that registered
one with `Spoken:AddDialogueUISettings(build)`, shown under every style since it changes
DialogueUI's own window. Spoken Quests puts its DialogueUI switches there: Mark Words in
DialogueUI, Keep the Words in View and Listen Button on DialogueUI
(see [`docs/quests/DIALOGUEUI-BRIDGE.md`](../quests/DIALOGUEUI-BRIDGE.md)). Reset Spoken Settings
puts all of them back.

The highlight on the words being read is deep red on parchment and gold on dark, the same pair
Spoken Quests lights DialogueUI's own text with.

### What it reads, and what happens if DialogueUI changes

Nothing it reads is a public API, and each is checked before use:

- `DialogueUITheme.lua`: the saved variables `DialogueUI_DB` (`Theme`, `FrameSize`,
  `MobileDeviceMode`); the window `DUIQuestFrame` (`frameWidth`, `frameHeight`, `Parchments`, and
  its `LoadTheme` and `UpdateFrameSize` methods, hooked to follow changes); the font objects
  `DUIFont_Quest_Paragraph`, `DUIFont_Quest_Title_18` and `DUIFont_QuestType_Left`.
- `DialogueUIPlayer.lua` and `DialogueUITransitions.lua`: whether `DUIQuestFrame` and
  `DUIBookFrame` are shown, watched by a child of each; their `Hide` and `ShowUI`, wrapped so the
  dialog's words fade before it closes; `DUIQuestFrame:GetQuestFinishedDelay()`; the dialogs'
  `BackgroundFrame`, `Footer` and place on screen; DialogueUI's art files.
- `Actions.lua`: whether either dialog is shown (`Actions.DialogCovers`, `Actions.WatchDialogs`),
  and the Play, Skip and Report row Spoken Quests and Spoken Readables put on the dialogs
  (`Spoken:CreateDialogueUIRow`).

If a DialogueUI release renames them, the tile is not offered, `/sp style dialogueui` says the
version is not recognised, and a profile set to it is drawn as the Small Window; nothing errors.
The window size has a fallback computed the way DialogueUI computes its own.

Tests: `tests/lua/player_dialogueui_style_test.lua`, against a fake DialogueUI.

## Voice Only

Nothing of Spoken's on screen: the lines are only heard, and the keys still stop, replay and skip
them. The first time a line waits behind a stop with nothing on screen to show it, Spoken says so
in chat (`STOPPED_REMINDER`). The window and subtitle rows are hidden. With DialogueUI installed, Show Narrator, Highlight Words, Type Words Out and Type Out By
still mark DialogueUI's own quest, gossip and book text (`Spoken:GetCaption`), so the page offers
them under this style too (`DialogueUIOptions:WordRowsShown`).

## Tests

`tests/lua/settings_ux_test.lua` (the rows of each style, the commands), `player_frame_test.lua`,
`subtitle_pages_test.lua`, `player_dialogueui_style_test.lua`, `battlegrounds_test.lua`, and
`tests/captions/verify.lua` for the words.
