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

A parchment, or dark, panel in DialogueUI's proportions, showing only the line playing:

- the speaker's face in the socket of DialogueUI's header strip;
- the line's title beside it in DialogueUI's title type, with the speaker's name small above,
  and after the title "(Stopped)" while the line is stopped and the count of the lines waiting;
- Stop (Replay once stopped), Skip and the line's own actions, Report among them, at the
  header's right end;
- a place's picture over the words, as Place Lore draws it;
- Lines Shown of the words, in DialogueUI's paragraph font, with an empty line between
  paragraphs, and the progress line under them.

There is no scrollbar: the words follow the caption **Auto-Scroll** mode, and the wheel
scrolls them. Right-click opens the settings. When DialogueUI's window closes on a line that
plays on, this one slides and shrinks out of it to the screen's top left, or to where it was
dragged. Drag anywhere to move it; it then keeps its own saved place, apart from the other
windows'. Reset puts it back at the top left. Sizing it with Ctrl and the wheel is not a
move: it keeps its top-left corner.

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
  size, at 24 half as large again. The line spacing follows the text; the header and buttons
  stay with the panel.
- **Lines Shown**: the panel shows 1 or 2 lines of the words. It has no expand button and no
  resize handle, and the other windows' expand state (`CaptionsExpanded`) does not change it.
- **Mouse wheel**: Ctrl and the wheel over the panel step Window Size by 5%; Ctrl, Shift and
  the wheel step Text Size by 1. Both stay within those sliders' ranges, keep the panel's top
  left corner where it was, and show the new value in a tooltip. The words pass a Ctrl wheel
  on to the panel (`frame.spokenWheel`) and scroll as before without it.

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
- **Fit to the Words** (on): the panel is only as tall as the line's words need, Lines Shown
  being the most it grows to; a long line scrolls. Off, it always shows Lines Shown.

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
