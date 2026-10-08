# Changelog — Spoken

Spoken Player until 3.0.0, when it became Spoken and took its modules into one download.

## 3.2.0-alpha.1 — 2026-10-08

- **Spoken Developer, a module of its own, with a debug log to send with a report.** Installed and
  turned on (in Spoken > Developer, the welcome window or `/spoken log on`), it notes every line
  queued, started, stopped, dropped or refused, with the time and the reason, and the
  diagnostics. Right-click any Report or Contribute button to copy it with the diagnostics, or to
  write it for an AI agent on your computer (a snapshot of the moment, then a reload so the game
  saves the file). On once installed, and can be turned off; Spoken without it is unchanged. See
  [DEBUG-LOG.md](DEBUG-LOG.md).
- For feature addons: `Spoken:Log`, `AddDiagnostics`, `AddDeveloperSettings`, `AddLogSource`
  and the rest, all doing nothing without the module.

## 3.1.0 — 2026-10-06

- **Auto-Scroll for the window's captions.** It replaces Turn Pages Automatically and has three
  choices. Line by Line, the default, moves the text up a line at a time as the voice reaches
  each line, so the captions no longer jump a whole page. Page by Page is the old behaviour.
  Off keeps the text still. If you had switched page turning off, Auto-Scroll starts at Off.
  The mouse wheel scrolls by lines and keeps the text where you leave it. Subtitles Only is
  unchanged. *([earlsinclairdino](https://github.com/earlsinclairdino))*
- **Zone pictures are chosen by hand.** The pictures picked automatically from the wiki showed
  the wrong place in some areas, Felwood among them. They are replaced by 827 hand-picked,
  checked and cleaned-up pictures covering Azeroth, the Eastern Kingdoms, Kalimdor and Zephras
  Isle. About 110 areas without a checked picture show none, rather than a wrong one.
  *([Nucabe](https://github.com/Nucabe))*
- **Closing Zone Lore beside the map keeps it closed.** It used to come back each time the map
  opened. While it is closed, a button on the map's top-right edge reopens it, and so does
  turning it back on with `/spz panel`. *([Hitrem](https://github.com/Hitrem))*
- **The Lore of Azeroth window can be resized and collapsed.** Drag its corner to resize it.
  The size is kept across reloads. The button in the title bar folds the window down to the
  list of places, and choosing a place opens the text again.
  *([Hitrem](https://github.com/Hitrem))*
- Clicking a zone on a continent's map, such as Mulgore on Kalimdor, opens that zone's lore, not
  the lore of one of its areas. *([Nucabe](https://github.com/Nucabe))*
- **Fewer hangs with the gamepad UI on the Forever client.** While the gamepad UI is on, the
  notices Spoken used to show as popups at login ("No usable sound packs", "Spoken is required",
  old folders found) are printed in chat instead, because those popups could make the next
  window close fail and hang the client. Zone Lore and its reopen button are now placed beside
  the map rather than inside it, so closing the map with the gamepad is no longer blocked.
  As a side effect, the panel no longer fades with the map while you move.
  *([rusty-key](https://github.com/rusty-key))*

## 3.0.1 — 2026-10-05

- **NPC voices are muted again under gossip and greetings.** In 3.0.0 an NPC's own greeting
  played over Spoken's gossip line. It is silenced again as the window opens. Quest text still
  fades the NPC's voice out instead of cutting it. *([rusty-key](https://github.com/rusty-key))*

## 3.0.0 — 2026-10-05

**Spoken Player is now Spoken, and it comes with its modules.** One download holds Spoken,
Spoken Quests, Spoken Zones and Spoken Books, each in its own folder and grouped under Spoken
in the AddOns list. Voice packs stay separate downloads and need no update. Everything below
is new since Spoken Player 2.3.2, Spoken Quests 2.2.2, Spoken Zones 2.2.1 and Spoken Books
2.1.1. The four 3.0.0 betas are folded into it.

### Before you update

- **Install Spoken Player, then remove the old module downloads.** Spoken Quests, Spoken Zones
  and Spoken Books are no longer separate downloads. Their last update leaves a folder that
  never loads, listed greyed out as "Spoken Quests (now in Spoken)" and the like. Uninstall
  them in your addon manager and delete the `SpokenQuests`, `SpokenZones` and `SpokenBooks`
  folders from `Interface\AddOns`. The modules now live in `Spoken_Quests`, `Spoken_Zones` and
  `Spoken_Books`. If a full old copy is still there, Spoken switches it off at login and
  offers **Reload Now**, so no line plays twice. *([rusty-key](https://github.com/rusty-key))*
- **Unzipping by hand over Spoken Player works.** The download carries a `SpokenPlayer` folder
  that never loads, so the old player can't run beside Spoken. It is safe to delete. At login
  Spoken also asks you to delete `VoiceOverRedux` and `ZoneLore` if they are still there.
  *([rusty-key](https://github.com/rusty-key))*
- **Settings start fresh.** Settings are saved under new names, and nothing carries over from
  2.x: Quests' autoplay choice, the once-per-NPC greeting history and the record of zones
  already narrated all start again. Lines gathered in `SpokenContributions.lua` are kept.

### Narrator and subtitles

- **Four narrator styles.** Pick Subtitles Only, Small Window, Large Window or Voice Only in
  the welcome window, on the settings page or with `/sp player`. Subtitles Only is the default
  on modern clients. The 1.12, 2.4.3 and 3.3.5 clients start in the Large Window.
  *([Nucabe](https://github.com/Nucabe))*
- **Subtitles Only** shows the speaker and the words low on screen, typed a little ahead of the
  voice. It takes its look from shorley's Spoken Subtitles. A picture sits before the name:
  the NPC's face, the item that started the quest, a posted notice, the tablet or plaque a page
  is written on, or the zone's icon. Then comes what the line belongs to: the quest, the area
  or the page. *([Nucabe](https://github.com/Nucabe))*
- **A progress bar** runs under the words, and "+N" says how many lines are waiting. Stop or
  Replay, Skip and Report sit in a row underneath. **Show Progress** turns the bar off.
  *([Nucabe](https://github.com/Nucabe))*
- **Sentences at Once** (1 to 4, 3 by default) sets how many sentences the subtitle shows to a
  page. A sentence too long for a page turns at its commas and dashes rather than mid-phrase.
  *([Nucabe](https://github.com/Nucabe))*
- Chinese captions light up one character at a time, not all at once.
  *([rusty-key](https://github.com/rusty-key))*
- Portraits work on 2.4.3 and 3.3.5, and the Small Window no longer draws a wanted poster as a
  black disc. *([Nucabe](https://github.com/Nucabe))*

### Playback

- **Stop and Replay replace Pause.** The game can't resume a sound part-way through, so the
  button says what it does: Stop while a line plays (the line stays, marked "(Stopped)"),
  Replay to hear it from the start, Play once it has ended. The windows, the subtitle, the
  minimap menu and the key binding all work this way. Skip on a stopped queue plays the next
  line, and a reload never starts you stopped. *([Nucabe](https://github.com/Nucabe))*
- **Play no longer cuts off the line speaking.** A line you start by hand queues behind it.
  *([Nucabe](https://github.com/Nucabe))*
- **Pause Between Lines** (Audio, 1 second by default, 0 to 5) puts quiet between one line and
  the next. Book pages read on without it. *([Nucabe](https://github.com/Nucabe))*
- **Other sounds are turned down while a line plays.** Music, ambience, effects and NPC voices
  each have their own level, and come back up when the queue falls quiet. A volume you change
  mid-line is kept. *([Nucabe](https://github.com/Nucabe))*
- **NPC voices are kept for gossip and greetings**, and faded rather than cut when a quest's
  text plays. *([Nucabe](https://github.com/Nucabe))*

### Settings

- **Settings follow Blizzard's layout**: module cards you can switch off, the narrator styles
  as pictures, one voice language for every module, Profiles, and search.
  *([Nucabe](https://github.com/Nucabe))*
- Links to Wago and to Buy Me a Coffee join GitHub, Discord and CurseForge.
  *([Nucabe](https://github.com/Nucabe))*
- Every tooltip and setting was checked against what it does, in all nine languages.
  *([Nucabe](https://github.com/Nucabe))*
- New and changed text is translated into German, Spanish, French, Korean, Brazilian
  Portuguese, Russian and both Chinese scripts. *([Nucabe](https://github.com/Nucabe),
  [anon1231823](https://github.com/anon1231823))*

### Zones

- **Zone Lore is a panel beside the world map**, and **Lore of Azeroth**, the old lore window,
  lists Azeroth, its continents, zones and areas, with search. The line under a place's name
  ("in Durotar") takes you one level up. *([Nucabe](https://github.com/Nucabe))*
- **A picture of each place** sits above its story: a screenshot from the zone's or area's
  Warcraft Wiki page. **Show Pictures** turns them off. *([Nucabe](https://github.com/Nucabe))*
- Forever's Zephras Isle, Darkspear Islands, Riverglades and Shen'dralas have zone icons.
  *([Nucabe](https://github.com/Nucabe))*
- Russian, Korean and Chinese lore are offered on clients in other languages when the font
  can draw them. *([Nucabe](https://github.com/Nucabe))*
- On Forever, the map panel and the lore window wear the map's metal frame.
  *([rusty-key](https://github.com/rusty-key))*
- Zone narration no longer starts on its own while you are flying.
  *([Jared-Mac](https://github.com/Jared-Mac))*
- A cinematic stops zone narration that is already speaking
  ([#199](https://github.com/rusty-key/spoken-wow/issues/199)), and the login greeting waits
  until a new character's intro is over instead of missing it.
  *([rusty-key](https://github.com/rusty-key))*

### Quests

- **Italian** is in **Voice Language**, for the Italian sound pack. No game client runs in
  Italian, so Auto never picks it: choose it yourself. *([rusty-key](https://github.com/rusty-key))*
- Quest details: Play on a line waiting behind a stopped one plays it.
  *([Nucabe](https://github.com/Nucabe))*

### Books

- A page read through DialogueUI shows what it is written on, not a book.
  *([Nucabe](https://github.com/Nucabe))*
- `/spb read` says why nothing started. *([Nucabe](https://github.com/Nucabe))*

### Removed

- Explain in Chat, the LoreTeller row in the quest log, and stories on the left of the map.

### Thanks

- [Nucabe](https://github.com/Nucabe), who designed and wrote most of this release: the
  narrator styles, the subtitles, the settings, Zone Lore, Lore of Azeroth and the pictures.
- [Jared-Mac](https://github.com/Jared-Mac), for keeping zone narration quiet in flight.
- [anon1231823](https://github.com/anon1231823), for testing every beta and for the translations.
- shorley, whose Spoken Subtitles the subtitle's look comes from.

## 3.0.0-beta.4 — 2026-10-05

- **Stop and Replay replace Pause.** The game can't resume a sound part-way through, so the
  button now says what it does: Stop while a line plays (the line stays, marked "(Stopped)"),
  Replay to hear it from the start, Play once it has ended. The windows, the subtitle, the
  minimap menu and the key binding all follow. Skip on a stopped queue plays the next line, and
  a reload never starts you stopped.
- **Play no longer cuts off the line speaking.** A line you start by hand queues behind it.
- **Pause Between Lines** (Audio, 1 second by default, 0 to 5) puts quiet between one line and
  the next. Book pages read on without it.
- **The subtitle has a picture and a progress bar**, after shorley's Spoken Subtitles: the
  NPC's face, the item that started the quest, a posted notice, the tablet or plaque a page is
  written on, or the zone's icon, then the name and what the line belongs to. A progress bar
  sits under the words (**Show Progress** turns it off), "+N" says how many lines wait, and
  Stop or Replay, Skip and Report sit in a row underneath.
- **Sentences at Once** (1 to 4, 3 by default) sets how many sentences the subtitle shows to a
  page. A sentence too long for a page turns at its commas and dashes rather than mid-phrase.
- **NPC voices are kept for gossip and greetings**, and faded rather than cut when a quest's
  text plays.
- **Zone pictures**: a picture of each zone and area above its story, in the Zone Lore panel
  and in Lore of Azeroth. **Show Pictures** turns them off.
- Zone Lore: the line under a place's name ("in Durotar", "in Kalimdor") is in the
  map panel too, and goes one level up when clicked.
- Zone Lore offers Russian, Korean or Chinese lore on a client of another language when its
  font can draw them.
- Zone narration no longer starts automatically while flying. Thanks to Jared-Mac.
- Forever's Zephras Isle, Darkspear Islands, Riverglades and Shen'dralas have zone icons.
- Books: a plaque read through DialogueUI shows the plaque, not a book, and `/spb read` says
  why nothing started.
- Portraits work on 2.4.3 and 3.3.5 again, and come back to the subtitle after switching from
  the Small Window.
- Links: Wago and Buy Me a Coffee.
- Every tooltip and setting re-read against what it does, in all nine languages.

## 3.0.0-beta.3 — 2026-10-04

- **The modules have new folder names**: `Spoken_Quests`, `Spoken_Books` and `Spoken_Zones`.
  The old names belong to the Spoken Quests, Spoken Zones and Spoken Books downloads, which
  retire now that Spoken carries the modules. With their own folders the modules are safe from
  whatever the CurseForge app does to one of those old downloads still installed. Titles in the
  AddOns list are unchanged.
- **The old `SpokenQuests`, `SpokenZones` and `SpokenBooks` folders become harmless.** The last
  update of each old download leaves a folder that never loads, listed greyed out as
  "Spoken Quests (now in Spoken)" and the like. It is safe to delete. A full old copy still in
  Interface\AddOns would play every line a second time, so at login Spoken switches it off and
  offers **Reload Now**. Delete the folder when you can.
- **The modules' settings start fresh once more.** The game names a module's settings file
  after its folder, so the new folders begin without one: Quests' settings and profiles, Zones'
  and Books' settings, and the record of greetings heard and zones narrated. Spoken's own
  settings are kept, including which modules are switched off, and so are the lines gathered in
  `SpokenContributions.lua`.

## 3.0.0-beta.2 — 2026-10-04

- **Unzipping over an older Spoken Player works.** The download now carries a `SpokenPlayer`
  folder that never loads. Unzipping it over the old one leaves the old player nothing to load,
  so it no longer runs beside Spoken: no more "attempt to index local 'object'" error from
  LibDBIcon and no more popup asking you to delete the folder. The folder is safe to delete.

## 3.0.0-beta.1 — 2026-10-04

A beta. **Spoken Player is now Spoken**, and it comes with its modules: one download holds
Spoken, Spoken Quests, Spoken Books and Spoken Zones, each its own folder, grouped under Spoken
in the AddOns list. Voice packs stay separate downloads.

- **Everyone starts fresh.** Settings are saved under new names and nothing is carried over
  from earlier releases, including Quests' autoplay choice, the once-per-NPC greeting history
  and the record of zones already narrated. Lines gathered in `SpokenContributions.lua` are kept.
- **Delete the old folders.** At login Spoken looks for `SpokenPlayer`, `VoiceOverRedux` and
  `ZoneLore` left behind by an older release and asks you to delete them.
- **Four narrator styles**: Subtitles Only, the default on modern clients, Small Window, Large
  Window and Voice Only. Pick one in the welcome window, on the settings page or with
  `/sp player`. Legacy clients start in the Large Window.
- **Subtitles Only** shows the speaker and the words low on screen, four lines at a time, typed
  out a little ahead of the voice, with play/pause, skip and Report on hover.
- **Other sounds are turned down while a line plays**, each channel to its own level, and back
  up when the queue falls quiet. A volume you change mid-line is kept.
- Pausing fades the voice out. The round Play and Report buttons are shared by the subtitles,
  the quest log and Zone Lore.
- **Settings follow Blizzard's layout**: module cards you can switch off, the narrator styles as
  pictures, one voice language for every module, Profiles, and search.
- **Zone Lore** is a panel beside the world map. **Lore of Azeroth**, the old lore window, lists
  Azeroth, its continents, zones and areas, with search.
- Removed: Explain in Chat, the LoreTeller row in the quest log, and stories on the left of
  the map.
- New and changed text is machine-translated into German, Spanish, French, Korean, Brazilian
  Portuguese, Russian and both Chinese scripts.

## 2.3.2 — 2026-10-02

- **Report is back on Minimal Classic.** The bug icon sits in the player's top-right corner
  again instead of only in the right-click menu. **Hide the Report button** hides it, as it does
  on the original player.

## 2.3.1 — 2026-10-02

- **Forever build 70170 is recognised again.** That build reports a different client type,
  so the player stopped treating it as Forever: the **Bronze tint** setting disappeared and
  portraits lost the HD models. The player now recognises Forever by its version number,
  which keeps working whatever client type later builds report.

## 2.3.0 — 2026-10-01

- The player remembers its position, width and expanded captions across `/reload` and logins.
- Quests played from the quest log show the giver's face.
- The NPC's greeting is muted as the dialog opens, instead of cut off mid-word. Needs Spoken Quests 2.2.0.
- Game dialogue no longer stays muted after a logout or `/reload` mid-line ([#167](https://github.com/rusty-key/spoken-wow/issues/167)).

## 2.2.4 — 2026-09-29

- Quest and NPC captions appear inside the player with one or two lines and
  two-word highlighting. Timing is approximate. Change the settings under
  `/spoken options`; scroll to read and click the text to follow again.
- Zone lore and book pages use the same captions. A small plus/minus button
  switches between compact captions and an eight-line reading area in either layout.
- Caption settings and tooltips follow the game client language in German,
  Spanish (EU and Latin America), French, Brazilian Portuguese, Russian, Korean,
  Simplified Chinese and Traditional Chinese. This includes expand and collapse.
- **Missing lines are gathered by default.** Every quest, conversation and page Spoken has
  no voice for is kept for you to send in one go; nothing leaves the game unless you upload
  the file yourself. Turn it off with **Gather missing lines automatically** in the Spoken
  Player settings, now the one place the switch lives.
- **Spoken in the addon compartment.** On the clients that have Blizzard's addon compartment,
  the Spoken button shows there too, and opens the settings on the first click. **Show Spoken
  in the addon compartment** switches it.
- **Quest lines play with sound effects switched off.** Spoken Quests checks each line exists
  before queueing it, and that check ran on the sound effects channel, so with effects off
  every quest line was dropped as missing. It now checks on the channel the line plays on.

## 2.2.2 — 2026-09-26

- **Minimal Classic matches the Forever client's bronze.** On WoW Forever the panel's border,
  cast bar trim and portrait ring now take the same bronze tint as the game's own frames,
  instead of standing out in plain metal. **Bronze tint** under `/sp options` turns it off; it
  is on by default and only offered on Forever. Other clients are unchanged.

## 2.2.1 — 2026-09-23

- **No more Lua error on logout or `/reload` with the Minimal Classic layout.** When its
  settings were all still at their defaults, the game dropped them while logging out, and the
  panel went on laying itself out as the UI was taken down and failed to find them. It falls
  back to the defaults now. On the WoW Forever beta this happened on every logout and reload.

## 2.2.0 — 2026-09-22

- **A second layout, and it is the one the player opens in.** **Minimal Classic** is a
  compact panel on the modern clients: a round portrait of the speaker taken from the
  client's own art, the name in gold, the line's title under it and a slim cast bar. There
  is no permanent row of buttons — click the portrait to pause or start the line again,
  click the title to skip it, right-click anywhere on the panel for playback and for the
  source's own actions.
- **The queue folds away.** A plus button beside the panel counts the lines waiting and
  opens them; scroll for more than four, click one to drop it, and the whole drawer closes
  again. A book or a zone line carries its own badge on the portrait, so it is clear which
  addon is speaking without reading the title.
- Designed and written by [shorley-gm](https://github.com/shorley-gm), who contributed it
  in [#46](https://github.com/rusty-key/spoken-wow/pull/46) along with the artwork notes
  and an offline harness that drives the real queue and UI code.
- **The original layout is one setting away.** Turn off **Minimal Classic player** under
  `/sp options` and the player looks exactly as it did in 2.1.0; the hide-portrait,
  hide-player and per-action settings apply to both. `/sp reset` resets whichever layout
  is showing.
- Not on the 1.12, 2.4.3 and 3.3.5 clients, where it is neither offered nor drawn. They
  keep the original player.

## 2.1.0 — 2026-09-21

- **Sending the game's text where Spoken has no voice.** When Spoken Quests, Spoken Zones or
  Spoken Books has nothing for what is on screen, its Contribute button opens a small box
  holding a link. Copy it, open it in a browser and press Send: the link already carries the
  text straight from your client, so there is nothing to paste. It is compressed, so a long
  book page still fits in one link.
- **Or gather them as you play.** The first time you press Contribute you can choose to send
  just that line, or to let Spoken quietly keep every line it has no voice for and send them
  all at once. They are kept in a file of their own, `SpokenContributions.lua` in your
  `SavedVariables` folder, which you upload at spoken.rusty.one/contribute whenever you like.
  Nothing leaves your game until you do. `/spoken share` shows the steps again. Gathering
  stops at the 2,000 most recent lines.
- **A new Contributions section in the settings**: **Gather missing lines automatically**
  turns gathering off, **How to send them** shows the steps, **Clear gathered lines** empties
  the file once it has been sent, and **Hide the Contribute buttons** turns every one of those
  buttons off in one place.
- **The settings scroll.** With the new rows, the minimap and addon sections ran off the
  bottom of the window on the modern clients' settings panel.
- The link box has the keyboard as soon as it opens, so copying straight away works the
  first time too.
- The zip carries a second folder, **SpokenContributions**, which holds nothing but the
  gathered lines' file. An addon manager installs it with the player; installing by hand,
  copy both folders into `AddOns`.
- Not on the 1.12, 2.4.3 and 3.3.5 clients, where contributing is off for now.

## 2.0.4 — 2026-09-18

- **The portrait is a portrait again on the Forever client.** Selecting camera 0 of the
  creature's own model is what has framed the speaker's head on every client this addon
  runs on; the Forever client accepts that call and ignores it, so the whole NPC stood in
  the box instead. It is framed with the portrait zoom there, which that client honours.

## 2.0.3 — 2026-09-18

- **The minimap button's texture is DXT5, like every other texture Spoken ships.** The
  palettized BLP the 2.0.2 button used is legal by the format's own rules, but the Classic
  beta client asserts inside its image decoder the moment it loads one and takes the game
  down. The mark is unchanged; only the encoding is.

## 2.0.2 — 2026-09-18

- **The minimap button wears the play triangle.** It carried a crest inherited from VoiceOver
  Redux that, at the size the minimap draws, was a brown smudge. The button is the one place
  every Spoken addon is reached from, and it now shows the same mark as the AddOns list — the
  gold triangle on the dark field, without the shield frame, since the minimap draws a frame
  of its own around it.

## 2.0.1 — 2026-09-18

- **A new icon in the AddOns list**: a gold play triangle on the Spoken shield. Spoken Quests
  and Spoken Zones wear the same shield with a mark of their own, so the three read as one
  family without any two of them looking like the same addon listed twice.

## 2.0.0 — 2026-09-18

The player every Spoken addon speaks through: one queue, one window, one minimap button.

- **Runs on the Forever client** (1.60.1, interface 16001 — the one whose TOC suffix is
  `_Camelot`), alongside Classic Era 1.15.9 and the 2.5.6 Anniversary client.
- **`/sp` is a short form of `/spoken`**, matching `/spq` for Spoken Quests and `/spz` for
  Spoken Zones. One scheme across the three addons.
- **Every Spoken addon carries the same version from here on.** This is the player's first
  release, so 2.0.0 is a number it never earned on its own — it is Spoken Quests', and the
  three addons ship together and are supported together. A player comparing two of them
  should not have to work out which numbering each follows.
- Extracted from VoiceOver Redux and ZoneLore, which each carried their own copy.
- One FIFO across every addon; nothing interrupts. Gossip yields to quest dialogue at the door.
- Narration held through combat no longer blocks a quest line queued behind it.
- Report is an icon in the player's top right corner rather than a button beside the line,
  and it can be switched off under Player window. The 1.12, 2.4.3 and
  3.3.5 clients, whose art does not include that icon, get a lettered button instead.
- A quest line plays with its NPC and its title shown. The portrait is resolved before the
  rows, and asking a model frame a question the current clients no longer answer abandoned
  the rest of the update, leaving a portrait over an empty band.
- `/spoken` is a command the client recognises. It never was.
- The minimap button's tooltip gets out of the way when the menu opens, instead of
  sitting over it.
- The minimap menu is the client's own on every client that has one, so it looks and
  behaves like every other addon's: entries grouped under each addon's name, a highlight
  under the cursor, closing on a second click or a click elsewhere. The 1.12, 2.4.3 and
  3.3.5 clients have no such menu, and there the player draws its own with the same
  behaviours and a background of its own. It asked for the backdrop template and never set a
  backdrop, so its entries read as text floating over the game world.
- The settings layout is shared with Spoken Quests and Spoken Zones, so the three panels
  read alike.
- The settings panel keeps one rhythm. Every row used to place itself by adding a
  hand-tuned offset, so no two sections were spaced alike; one layout owns the spacing
  now. The links to each addon's own settings have a section of their own instead of
  trailing the minimap ones.
- The settings category is "Spoken Player", and the window's settings are headed as such
  rather than by "Up next", the queue window's own title.
- The player scale slider is visible. It was built without a height, so it drew nothing
  and left a gap on the panel where the setting should have been.
- Every sound setting lives here: the channel everything speaks on, and silencing the
  game's own NPC dialogue while a line is read. Each feature addon used to carry its own
  channel control, so a player with both had two settings for one thing.
- 2.4.3 and 3.3.5 gain rows for the music-channel playback those clients need, and for the
  HD model patch. Both settings existed from the start with no way to reach them.
- Settings under Spoken Player; the frame's position, scale and lock, the minimap button and the sound channel migrate from either old addon on first login.
