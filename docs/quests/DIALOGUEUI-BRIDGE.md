# DialogueUI bridge

[DialogueUI](https://www.curseforge.com/wow/addons/dialogueui) replaces the quest and gossip
frames with its own window. While that window is open it also hides the rest of the interface,
which hides Spoken's window or subtitles. `addons/Spoken_Quests/UI/DialogueUIBridge.lua`
brings back what was hidden, inside DialogueUI's window:

- **Mark the words being read.** DialogueUI's own quest and gossip text follows the line the
  way Spoken's captions do. Spoken's **Type Words Out** types it out as the voice reaches each
  word, and its **Highlight Words** lights the word being read. Either, both or neither: the
  bridge follows those two settings on Spoken's page and has none of its own. The light is
  gold on DialogueUI's dark theme and deep red on its parchment theme, where gold is hard to read.
- **Keep the words in view.** Long text scrolls to the paragraph being read whenever reading
  moves to another paragraph.
- **Show Spoken over DialogueUI.** The window or the subtitles stay on screen in the place they
  were left, with their controls. They can't be dragged until DialogueUI closes.
- **Play button on DialogueUI.** Spoken Quests draws a Play button of its own in the top-left
  corner of DialogueUI's window, in DialogueUI's art and where DialogueUI puts its
  text-to-speech button, on every quest and gossip page it has a recording for. It is there
  whether or not DialogueUI's Text To Speech is on (DialogueUI has it off by default, and
  draws its own button only with it on). Left-click plays the line, or stops it while it
  speaks; right-click turns Spoken Quests' **Read Automatically** on or off, as a right-click
  on DialogueUI's button turns its Auto Play. The sound waves move while the line sounds. On a
  page with no recording it is not there, and DialogueUI's own button, if shown, is in view.
- **DialogueUI's settings are left alone.** Nothing here changes DialogueUI's Text To Speech or
  its Auto Play. Spoken Quests still registers as DialogueUI's voiceover provider, so where the
  player has DialogueUI's Text To Speech on, its button and hotkey play the recording too.
  Whether a line reads by itself is decided by **Read Automatically** alone; DialogueUI's Auto
  Play has no say over Spoken Quests' lines.
- **Report a problem, or contribute a missing line.** Just under DialogueUI's Decline (or
  Goodbye) button, right-aligned with it and clear of the parchment's curled foot, sits the
  player's round Report icon (16 px), faint (40 %)
  as in the DialogueUI narrator style, on every quest and gossip page: it opens the report
  address for the page, the quest's or the NPC's. For a quest or gossip line no pack has, the
  same icon is in full, with **No voice-over playing? Contribute!** beside it, in DialogueUI's
  small serif and the red of DialogueUI's Accept button (sampled from its art; on the dark
  theme lifted so small text reads on black); either then does what the game's Contribute
  button does. Both copy boxes show over the window. Always on, with no setting: the
  Contribute button was missing under DialogueUI
  ([rusty-key/spoken-wow#246](https://github.com/rusty-key/spoken-wow/issues/246)), and
  gathering saved nothing.

All but **Show Spoken over DialogueUI** are on by default: DialogueUI's window, marked as the
line plays, already shows the words. They sit in the Quests section of Spoken's **DialogueUI** page
(Spoken > DialogueUI), beside the DialogueUI narrator style's settings, added there through
`Spoken:AddDialogueUISettings`; that page's Defaults button resets them too. With a Spoken too
old to have that page, they are a **DialogueUI** section of the Quests page instead. Without
DialogueUI installed there are none anywhere. When something else they need is missing they
are greyed out with the reason in their tooltip.
`/spq diagnostics` prints one `DialogueUI:` line with the same answer.

## How it works

Nothing in DialogueUI is changed. The module reaches it from outside, through names that are
DialogueUI internals rather than an API:

- `DUIQuestFrame` is the window. Each paragraph of text is a FontString in its
  `fontStringPool`, tagged with `ttsFlag`, or with `isTranslation` for translator addons.
- `HandleQuestDetail`, `HandleQuestProgress`, `HandleQuestComplete`, `HandleQuestGreeting`
  and `HandleGossip` build a page. They are hooked with `hooksecurefunc`, because DialogueUI
  calls them by name (`self[handler](self)`) on every build and rebuild. An item reward
  resolving, a settings change or a repeated `QUEST_DETAIL` all trigger a rebuild.
- `DialogueUIAPI.SetVOProvider` is DialogueUI's one public hook for voiceover addons.

All of these are checked once at login. If any is missing, the module does nothing and the
settings panel says that DialogueUI's version isn't recognised.

**Timing and matching.** The timing is the captions' own estimate, read through
`Spoken:GetCaption()`, which also says whether Highlight Words and Type Words Out are on. It
is worked out on every call rather than read from the captions, which stop updating while
DialogueUI hides their window. Each line of DialogueUI's text is split with
`Spoken:SplitCaption()`, the same splitter the captions use, so Chinese is matched character
by character. The caption's words are then matched in order against DialogueUI's words:

- A match may skip a few words. This covers the NPC name DialogueUI can put in front of the
  text, and a hint above it.
- Every starting paragraph is tried, because DialogueUI can keep earlier gossip above the
  current page. On a tie, the later paragraph wins.
- Below 60 % of the words matched, the window shows something else, so nothing is marked.
- Only Spoken Quests' own lines are matched. A zone's lore or a book page playing while
  DialogueUI is open leaves its text alone.

**Drawing.** Both marks are made in the paragraph's own text:

- The highlight is a colour code around the word.
- Typing out shows the paragraphs the line covers up to the word being read, and the ones
  after it blank. DialogueUI draws a page the moment the dialog opens, while Spoken Quests
  reads it a moment later (0.1 s for gossip, once a quest has held still for 0.4 s). So when
  a page is about to be read, `Addon:ExpectedLine(event, true)` gives its line's text as the
  page is built, and its words are blank from the first frame, for up to 2.5 s, until the
  voice reaches them. Shown whole until then, they flashed up and vanished. The page's own
  line is looked for (`Addon:GetVisibleLine`), not just its speaker's. A page nothing will
  read on its own shows whole at once, as does one opened while another part's line plays,
  and one whose read then queues nothing shows as soon as that read is done
  (`Bridge:Read`, from `Addon:InvokeQuestHandler`), not after the 2.5 s. Paragraphs outside the line, such as earlier gossip or the objectives' list
  when the recording does not read it, stay whole. Nothing shows before the voice starts and
  everything once it has finished, as in the captions. A clip with no length is shown whole.

Colour codes take no width, and a left-aligned prefix wraps exactly as the whole paragraph
did. DialogueUI placed every paragraph once, when it built the page, so nothing moves. Words
inside a link are never marked, so a link is never split. The original text is put back when
the line ends, when the window closes or when the setting is turned off, because DialogueUI
reads that text back for its own text-to-speech.

**Waiting for the window.** DialogueUI shows its window on the client's event and then plays
an intro (a 0.2 s fade, or 0.75 s for its unfold and fly-in styles) and fades the text in over
0.35 s. A line Spoken Quests reads on its own could start in the middle of that, the voice
ahead of the words it marks. So an automatic read of the page DialogueUI is showing waits,
in `Bridge:Defer` (asked by `Addon:InvokeQuestHandler`), until the window and its text are at
full opacity, for at most 1.5 s, and is dropped if the window closes first. A read the player
asks for, and a dialog DialogueUI is not showing, read at once.

**Hosting the player.** This uses `Spoken:SetPlayerHost(DUIQuestFrame)`:

- The window and the subtitles are reparented with their anchors kept and their scale
  adjusted, so they keep their exact place on screen.
- Their strata is raised above the window. The subtitles pass clicks through to it.
- The windows can still be dragged: their effective scale and UIParent anchor are kept, so a
  place saved over the window is the same place without it. The subtitles are click-through.

`Spoken:SetPlayerHost(nil)` puts all of it back, the subtitles' own low strata included.

**Contribute button.** Spoken Quests decides there is a line to contribute from the game's
quest panels and gossip frame, which DialogueUI never shows. `Bridge:Page()` gives the
dialog event of the page DialogueUI's window shows instead, from DialogueUI's
`DUIQuestFrame.handler` (the page builder it last ran). `Contribute.lua` falls back on it to
read the quest or gossip text, so gathering works as well. `UI/ContributeButton.lua` then
puts its Report and Contribute corner on DialogueUI's window, as children of the window since
DialogueUI hides UIParent, and
the bridge refreshes it as pages are built and as the window opens and closes. The margins
under and beside the footer buttons are measured from DialogueUI's `ExitButton` each time,
since DialogueUI's window size setting changes them. Their tooltip is one of the game's make
(`GameTooltipTemplate`) on the window, scaled to the game's, since the game's own is a child of
UIParent too. `ReportButton.lua` reads the quest page
from `Bridge:Page()` too, and while a page is up shows its address in Spoken's copy box rather
than the game's popup, which is a child of UIParent. While the window is open, the bridge also passes it
to `Spoken:SetContributeHost`, which puts Spoken's copy box over it. A box still open when the
window closes goes back to UIParent and stays up.

**Play button.** DialogueUI creates its own button only when its Text To Speech setting turns
on, and has no public way to show it, so the bridge builds one: a child of `DUIQuestFrame`,
24 px at its top-left inset of 8, drawn from DialogueUI's `Art/Theme_Shared/TTSButton.png` in
the cell of DialogueUI's theme (told from the colour of `DUIFont_QuestType_Left`, as the
Contribute corner tells it), with DialogueUI's `DUISpeakerAnimationTemplate` for the waves where
it exists. It is shown from the page hooks, the window opening, and every half second while the
window is open, since a quest's ID can arrive after its page is drawn and the packs load after
login. Where DialogueUI's own button is shown under it, it is set transparent while Spoken's
stands there and given back its alpha when Spoken's goes. The tooltip is the window's own
GameTooltip (`ContributeButton:DialogueUITooltip`), since the game's is hidden with UIParent.

DialogueUI hears the client's quest event before Spoken Quests' recorder does. So the line is
resolved from the page DialogueUI shows, through `Addon:GetVisibleLine(event)`, rather than from
the last recorded event; the provider DialogueUI asks does the same. Play reads the line at once
(`Player:PlayPreparedNow`): the player's `PlayNow` lets a speaking line finish first, so
whatever speaks, a zone's lore or a book page, is stopped, the line played, and what was stopped
skipped rather than kept to replay; the rest of the queue plays after. A line waiting behind
another is brought forward. Stop takes the line out of the queue. Both buttons and `isPlaying`
answer for the line at the head of the queue and not stopped there, since DialogueUI's button
stops a playing line and plays one that is not. The provider's Stop works only while the
window is open. DialogueUI also asks the provider to stop as its window closes, and accepting a
quest closes it. That comes from DialogueUI's "TTS Auto Stop" setting, which is on by default
even with its text-to-speech off. Obeying it would cut every line short at the accept, so
whether closing the dialog stops the line is left to Spoken Quests' own **Stop When Window
Closes**.

**Auto Play.** DialogueUI's autoplay calls the provider's Play after asking it for its delay,
which a click on its button never does. That call is always ignored: Spoken Quests' own
**Read Automatically** reads the line or not, so the two never both start it.

## Limits

- The timing is an estimate, as for the captions. The recording says "adventurer" where the
  text has the player's name, so the marks can run slightly ahead or behind around a long name.
- A word wrapped in a link or colour by DialogueUI or another addon is never marked.
- Matching relies on DialogueUI showing the client's text. A translator addon's translated
  paragraphs are skipped, and only the original paragraphs, when shown, are marked.
- DialogueUI's text-to-speech reads the paragraphs back from the window. While a paragraph is
  typed part way it would read only that part. With **Play Button on DialogueUI** on, a page
  with a recording plays the recording instead.
- DialogueUI's internals can change in any release. When they do, the settings say so and
  nothing breaks, but the feature is off until this file catches up.

Tests: `tests/lua/quests_dialogueui_test.lua`, against a fake `DUIQuestFrame`.
