# The DialogueUI narrator style

With the [DialogueUI](https://www.curseforge.com/wow/addons/dialogueui) addon installed, Spoken
offers a fifth **Narrator Style**, **DialogueUI**: a smaller twin of DialogueUI's quest window,
in DialogueUI's own art. Its tile sits after the Large Window's, on Spoken's settings page and
in the welcome window. Without DialogueUI there is no tile.

`/spoken player dialogueui` switches to it, and says why when it cannot. `/spoken diagnostics`
adds a `dialogueui:` line with what was read from DialogueUI.

## The setting

The narrator style is one setting, `Frame.Style`: `"subtitle"` (Subtitles Only, the default on
the modern clients), `"minimal"` (Small Window), `"classic"` (Large Window, the legacy clients'
default), `"dialogueui"` or `"none"` (Voice Only). It replaces three switches, `SubtitlePlayer`,
`HideFrame` and `MinimalPlayer`; `Addon:InitDB` carries a profile that set them over to the
style they showed, and removes them. `Addon:PlayerStyle()` answers what is drawn where the
chosen style is not on offer: `"dialogueui"` is drawn as the Small Window while DialogueUI is
missing, and the setting is kept, so the window comes back with DialogueUI.

## The window

A tall parchment, or dark, panel in DialogueUI's proportions:

- the speaker's face in the socket of DialogueUI's header strip;
- the line's title beside it in DialogueUI's title type, with the speaker's name small above;
- the words filling the body, in DialogueUI's paragraph font, with an empty line between
  paragraphs;
- the waiting lines under them;
- Stop (Replay once stopped) and Stop All along the foot with the line's own actions, the Report icon faint
  at the row's end.

A scrollbar appears beside the words when the line runs past the page. It follows the
caption **Auto-Scroll** mode, by line. Hover the face to stop or replay, as in the Small
Window. The cross in the corner skips to the next line. Right-click opens the settings.
It opens where DialogueUI puts its own window: the same top, centred on the same spot, on
the side DialogueUI's Frame Orientation chooses, so a line that plays on after the dialog
closes stays where the dialog was. It follows DialogueUI there until it is dragged, or sized
from its corner. Drag anywhere to move it; it then keeps its own saved place, apart from the
other windows'. Reset puts it back where DialogueUI's window is. Sizing it with Ctrl and the
wheel is not a move: it keeps following DialogueUI, or keeps its top-left corner once dragged.

Nothing is source-specific. A zone's lore or a book page plays in it as a quest line does:
the book for a face, the book's or the zone's name as the speaker, the page or the subzone as
the title, or the clip's key when there is none.

**Nothing of DialogueUI is copied.** The panel loads DialogueUI's texture files
(`Interface/AddOns/DialogueUI/Art/Theme_Brown/` or `Theme_Dark/`) and asks DialogueUI's font
object which font it writes in. That is why the style exists only with DialogueUI installed.

## Its settings

It follows the player's own settings on Spoken's page, as the other windows do:

- **Window Size** scales the whole panel, text included. The panel is laid out exactly as
  DialogueUI's window, at its size, paddings, text size (its Font Size setting), line spacing
  (0.35 of the text size) and paragraph gap. At the default Window Size (70%) it is 65% of
  DialogueUI's window; the size scales from there.
- **Text Size** sets the words against DialogueUI's: at the default 16 they are DialogueUI's
  size, at 24 half as large again. The line spacing follows the text; the header, queue rows
  and buttons stay with the panel.
- **Lines Shown** and the expand state: the plus or minus button beside the close cross opens
  the panel to its size or folds it to Lines Shown (1 or 2). It is the same expand state the
  other windows' captions share (`CaptionsExpanded`), so it opens folded by default and
  opening it opens theirs. Expanded, the handle in the bottom-right corner drags the panel
  taller or shorter. Hold **Shift** as you start the drag to change its width too, from 60%
  to twice DialogueUI's. The size is kept until **Reset Position**.
- **Mouse wheel**: Ctrl and the wheel over the panel step Window Size by 5%; Ctrl, Shift and
  the wheel step Text Size by 1. Both stay within those sliders' ranges, keep the panel's top
  left corner where it was, and show the new value in a tooltip. The words and the queue pass
  a Ctrl wheel on to the panel (`frame.spokenWheel`) and scroll as before without it.

What only this window has is on its own page, **Spoken > DialogueUI**, built only with
DialogueUI installed (`addons/Spoken/UI/DialogueUIOptions.lua`). It is always the last entry
under Spoken: it is registered a frame after `PLAYER_ENTERING_WORLD`, once every module's page
is in (Spoken Books registers its own at that event). Spoken's page shows a **DialogueUI
Settings** button while this style is chosen. The page holds the rows below, and a section
from each module that registered one with `Spoken:AddDialogueUISettings(build)`: Spoken Quests
puts its DialogueUI switches there (see
[`docs/quests/DIALOGUEUI-BRIDGE.md`](../quests/DIALOGUEUI-BRIDGE.md)). Its Defaults button puts
all of them back. The window's rows are greyed, saying where to choose the style, while
another narrator style is chosen.

- **Follow DialogueUI's Theme** (on): parchment or dark, whichever DialogueUI is set to,
  switching the moment DialogueUI does. Off, **Theme** picks one for good.
- **Fit to the Words** (on): the panel is only as tall as the line's words need, its size
  (expanded) or Lines Shown (folded) being the most it grows to; a long line still fills it
  and scrolls. Off, the panel always opens at its full size.

The highlight on the words being read is deep red on parchment and gold on dark, the same
pair Spoken Quests lights DialogueUI's own text with.

## Over DialogueUI

With Spoken Quests' **Show Spoken Over DialogueUI** on, whichever style is chosen is hosted on
DialogueUI's window while it is open and comes back afterwards: see
[`docs/quests/DIALOGUEUI-BRIDGE.md`](../quests/DIALOGUEUI-BRIDGE.md). The DialogueUI window
keeps its size on screen there, as the others do.

## What it reads, and what happens if DialogueUI changes

Only `addons/Spoken/UI/DialogueUITheme.lua` reaches into DialogueUI, and nothing it reads is
a public API:

- the saved variables `DialogueUI_DB` (`Theme`, `FrameSize`, `MobileDeviceMode`);
- the window `DUIQuestFrame` (`frameWidth`, `frameHeight`, `Parchments`, and its `LoadTheme`
  and `UpdateFrameSize` methods, hooked to follow changes);
- the font objects `DUIFont_Quest_Paragraph`, `DUIFont_Quest_Title_18` and `DUIFont_QuestType_Left`.

Each is checked before use. If a DialogueUI release renames them, the tile is not offered,
`/spoken player dialogueui` says the version is not recognised, and a profile set to it is
drawn as the Small Window; nothing errors. The window size has a fallback computed the way
DialogueUI computes its own.

The panel is `addons/Spoken/UI/DialogueUIPlayer.lua`. Tests:
`tests/lua/player_dialogueui_style_test.lua`, against a fake DialogueUI.
