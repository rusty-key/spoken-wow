# Changelog

The notes `scripts/release.sh` sends to CurseForge, one section per released version.

The player and the sound pack are versioned independently — the pack moves when the audio is
rebuilt, the player when its Lua changes — so a section belongs to whichever of the two
carries that version. The heading says which.

## 3.0.0 — player — 2026-10-05

- **Spoken Quests is now part of Spoken**, and this download no longer carries the addon. It
  leaves a `SpokenQuests` folder that never loads, listed greyed out as "Spoken Quests (now in
  Spoken)".
- **Install [Spoken Player](https://www.curseforge.com/wow/addons/spoken-player)** instead: it
  has Quests inside, in the `Spoken_Quests` folder, along with everything new in Spoken 3.0.0. Then
  uninstall this download and delete the `SpokenQuests` folder from `Interface\AddOns`. This
  download gets no further updates.

## 3.0.0-beta.4 — player — 2026-10-05

- **Spoken Quests is now part of Spoken**, and this download no longer carries the addon. It
  leaves a `SpokenQuests` folder that never loads, listed greyed out as "Spoken Quests (now in
  Spoken)".
- **Install [Spoken Player](https://www.curseforge.com/wow/addons/spoken-player)** instead: it
  has Quests inside, in the `Spoken_Quests` folder. Then uninstall this download and delete the
  `SpokenQuests` folder from `Interface\AddOns`.

## 3.0.0-beta.3 — player — 2026-10-04

- Ships inside Spoken 3.0.0-beta.3, in a folder renamed to `Spoken_Quests`. Settings start fresh
  again: the game names the settings file after the folder. See Spoken's changelog.

## 3.0.0-beta.2 — player — 2026-10-04

- Ships inside Spoken 3.0.0-beta.2. No changes of its own.

## 3.0.0-beta.1 — player — 2026-10-04

- Ships inside Spoken 3.0.0-beta.1 as one of its modules, no longer as a download of its own.
  See Spoken's changelog. Settings start fresh: nothing is carried over from 2.2.2.

## 2.2.2 — player

- **Italian** joins **Voice Language**, for the new Italian sound pack. No game client runs
  in Italian, so Auto never picks it: choose it yourself. While you listen in Italian,
  Spoken Quests offers no contributions.
- The newer settings - quest follow-ups, Report a problem, the gossip buttons - are
  translated into every client language.

## 2.2.1 — player

- Gossip quest lines play on Forever build 70170 again. That build reports a different
  client type, and Spoken Quests stopped setting up the gossip functions Forever needs.
  It now checks whether the client has them instead.

## 2.2.1 — Spoken Quests Audio

- The packs load on the Forever client again. Its update on 2 October marked them
  **Incompatible**, and Spoken Quests said no usable sound packs were loaded. The audio is
  unchanged from 2.2.0; install over it.

## 2.2.0 — player

- **Experimental:** NPC lines said in chat after you accept or turn in a quest are voiced. Toggle in settings.
- The NPC's greeting is muted as the dialog opens, instead of cut off mid-word. Needs Spoken Player 2.3.0.
- Quests played from the quest log name the giver in your client's language.

## 2.2.0 — Spoken Quests Audio

- Hundreds of quest follow-up lines voiced. Needs Spoken Quests 2.2.0.
- About 60 new contributed lines, mostly NPC greetings.

## 2.1.0 — sound packs

**The Forever quests are voiced.** About 1,550 lines are new since 2.0.0, all of them sent in
by players with Contribute, and 1,275 of them have a voice in these packs: 464 quest offers,
491 turn-ins and 320 NPC greetings.

- **Most of the quests new to the Forever client** speak now: 946 lines across 505 of them.
  The Skybourne elves speak with voices of their own, one for each of the game's two voice
  sets per gender.
- **Addressed reported lines.**
- **On GitHub, one download holds all four packs**, `SpokenQuestsAudioAll-2.1.0.zip`: the same
  four folders CurseForge installs, so it goes over whichever you have, from either store.
- Still one format, Ogg Vorbis at 44.1 kHz. Install over 2.0.0.

## 2.1.3 — player

- Queued quest and NPC dialogue now supplies captions to Spoken Player 2.2.3.
  Replaying an accepted quest uses its quest log description when available.
- **A Language section in the settings panel**, as Spoken Books has: voice language and
  fallback, with **Auto (<language>)** following the game client. Until now it was only in the
  `/spq` window.
- Play, Stop, the greeting setting and the AddOns-list description follow the game client's
  language.
- No longer tells you to update a sound pack that is newer than it knows about. Installing the
  2.1.0 packs under an older Spoken Quests offered an "update" back to 2.0.0.

## 0.0.1 — quests-audio-itIT — 2026-10-04

- **Experimental.** A first cut, numbered 0.0.1 so it does not read as finished: expect
  lines to be re-recorded, and report the ones that sound wrong.
- **The first Italian sound pack**, `SpokenQuestsAudio_itIT`: every quest and gossip line
  Spoken Quests has an Italian take for, in one pack for both factions. The text is the
  **QuestIT** community translation. It installs beside the English packs rather than over
  them. No game client runs in Italian, so pick it yourself under **Voice Language**.
  Needs Spoken Quests 2.2.2 or later.
  **Partial**: it voices the quests QuestIT has translated so far. Set **Fallback Language**
  to English to hear the rest.

## 0.0.3 — quests-audio-deDE — 2026-10-02

- The pack loads on the Forever client again. Its update on 2 October marked it
  **Incompatible**, and Spoken Quests said no usable sound packs were loaded. The audio is
  unchanged; install over the previous version.

## 0.0.3 — quests-audio-esES — 2026-10-02

- The pack loads on the Forever client again. Its update on 2 October marked it
  **Incompatible**, and Spoken Quests said no usable sound packs were loaded. The audio is
  unchanged; install over the previous version.

## 0.0.3 — quests-audio-esMX — 2026-10-02

- The pack loads on the Forever client again. Its update on 2 October marked it
  **Incompatible**, and Spoken Quests said no usable sound packs were loaded. The audio is
  unchanged; install over the previous version.

## 0.0.3 — quests-audio-frFR — 2026-10-02

- The pack loads on the Forever client again. Its update on 2 October marked it
  **Incompatible**, and Spoken Quests said no usable sound packs were loaded. The audio is
  unchanged; install over the previous version.

## 0.0.3 — quests-audio-ptBR — 2026-10-02

- The pack loads on the Forever client again. Its update on 2 October marked it
  **Incompatible**, and Spoken Quests said no usable sound packs were loaded. The audio is
  unchanged; install over the previous version.

## 0.0.3 — quests-audio-ruRU — 2026-10-02

- The pack loads on the Forever client again. Its update on 2 October marked it
  **Incompatible**, and Spoken Quests said no usable sound packs were loaded. The audio is
  unchanged; install over the previous version.

## 0.0.2 — quests-audio-koKR — 2026-10-02

- The pack loads on the Forever client again. Its update on 2 October marked it
  **Incompatible**, and Spoken Quests said no usable sound packs were loaded. The audio is
  unchanged; install over the previous version.

## 0.0.1 — quests-audio-koKR — 2026-10-01

- **Experimental.** A first cut, numbered 0.0.1 so it does not read as finished: expect
  lines to be re-recorded, and report the ones that sound wrong.
- **The first Korean sound pack**, `SpokenQuestsAudio_koKR`: every quest and gossip line
  Spoken Quests has a Korean take for, in one pack for both factions. It carries the
  Korean gossip text too, so gossip is recognised on a koKR client. It installs beside the
  English packs rather than over them; pick the language under **Voice Language**.
  Needs Spoken Quests 2.1.1 or later.
  **Partial**: the game's Korean text is missing for some quests, so it voices about four
  in five quest offers and turn-ins, and most gossip. Set **Fallback Language** to English
  to hear the rest.

## 0.0.2 — quests-audio-deDE — 2026-09-28

- **Experimental**, still: expect lines to be re-recorded, and report the ones that sound wrong.
- **Re-recorded.** Most lines have a new take.
- **No more stray sounds between paragraphs.** A line with more than one paragraph could fill
  the break with a laugh, a moan or a mumble nobody wrote. Each paragraph is now spoken on its
  own and the two are joined by a short pause, which is also longer than the pause at a full stop.

## 0.0.2 — quests-audio-esMX — 2026-09-28

- **Experimental**, still: expect lines to be re-recorded, and report the ones that sound wrong.
- **Re-recorded.** Most lines have a new take.
- **No more stray sounds between paragraphs.** A line with more than one paragraph could fill
  the break with a laugh, a moan or a mumble nobody wrote. Each paragraph is now spoken on its
  own and the two are joined by a short pause, which is also longer than the pause at a full stop.

## 0.0.2 — quests-audio-ptBR — 2026-09-28

- **Experimental**, still: expect lines to be re-recorded, and report the ones that sound wrong.
- **Re-recorded.** Most lines have a new take.
- **No more stray sounds between paragraphs.** A line with more than one paragraph could fill
  the break with a laugh, a moan or a mumble nobody wrote. Each paragraph is now spoken on its
  own and the two are joined by a short pause, which is also longer than the pause at a full stop.
- **Still partial**: the game's Portuguese text is missing for most quest completions, so it
  voices most quest offers and gossip but only 120 turn-ins. Set **Fallback Language** to
  English to hear the rest.

## 0.0.2 — quests-audio-ruRU — 2026-09-28

- **Experimental**, still: expect lines to be re-recorded, and report the ones that sound wrong.
- **Re-recorded.** Most lines have a new take.
- **No more stray sounds between paragraphs.** A line with more than one paragraph could fill
  the break with a laugh, a moan or a mumble nobody wrote. Each paragraph is now spoken on its
  own and the two are joined by a short pause, which is also longer than the pause at a full stop.

## 0.0.2 — quests-audio-esES — 2026-09-28

- **Experimental**, still: expect lines to be re-recorded, and report the ones that sound wrong.
- **Re-recorded.** Most lines have a new take.
- **No more stray sounds between paragraphs.** A line with more than one paragraph could fill
  the break with a laugh, a moan or a mumble nobody wrote. Each paragraph is now spoken on its
  own and the two are joined by a short pause, which is also longer than the pause at a full stop.

## 0.0.2 — quests-audio-frFR — 2026-09-28

- **Experimental**, still: expect lines to be re-recorded, and report the ones that sound wrong.
- **Re-recorded.** Most lines have a new take.
- **No more stray sounds between paragraphs.** A line with more than one paragraph could fill
  the break with a laugh, a moan or a mumble nobody wrote. Each paragraph is now spoken on its
  own and the two are joined by a short pause, which is also longer than the pause at a full stop.

## 0.0.1 — quests-audio-deDE — 2026-09-27

- **Experimental.** A first cut, numbered 0.0.1 so it does not read as finished: expect
  lines to be re-recorded, and report the ones that sound wrong.
- **The first German sound pack**, `SpokenQuestsAudio_deDE`: every quest and gossip line
  Spoken Quests has a German take for, in one pack for both factions. It carries the
  German gossip text too, so gossip is recognised on a deDE client. It installs beside the
  English packs rather than over them; pick the language under **Voice Language**.
  Needs Spoken Quests 2.1.1 or later.

## 0.0.1 — quests-audio-esMX — 2026-09-27

- **Experimental.** A first cut, numbered 0.0.1 so it does not read as finished: expect
  lines to be re-recorded, and report the ones that sound wrong.
- **The first Spanish (AL) sound pack**, `SpokenQuestsAudio_esMX`: every quest and gossip line
  Spoken Quests has a Latin American Spanish take for, in one pack for both factions. It carries the
  Latin American Spanish gossip text too, so gossip is recognised on a esMX client. It installs beside the
  English packs rather than over them; pick the language under **Voice Language**.
  Needs Spoken Quests 2.1.1 or later.

## 0.0.1 — quests-audio-ptBR — 2026-09-27

- **Experimental.** A first cut, numbered 0.0.1 so it does not read as finished: expect
  lines to be re-recorded, and report the ones that sound wrong.
- **The first Portuguese sound pack**, `SpokenQuestsAudio_ptBR`: every quest and gossip line
  Spoken Quests has a Brazilian Portuguese take for, in one pack for both factions. It carries the
  Brazilian Portuguese gossip text too, so gossip is recognised on a ptBR client. It installs beside the
  English packs rather than over them; pick the language under **Voice Language**.
  Needs Spoken Quests 2.1.1 or later.
  **Partial**: the game's Portuguese text is missing for most quest completions, so it
  voices most quest offers and gossip but only 120 turn-ins. Set **Fallback Language** to
  English to hear the rest.

## 0.0.1 — quests-audio-ruRU — 2026-09-27

- **Experimental.** A first cut, numbered 0.0.1 so it does not read as finished: expect
  lines to be re-recorded, and report the ones that sound wrong.
- **The first Russian sound pack**, `SpokenQuestsAudio_ruRU`: every quest and gossip line
  Spoken Quests has a Russian take for, in one pack for both factions. It carries the
  Russian gossip text too, so gossip is recognised on a ruRU client. It installs beside the
  English packs rather than over them; pick the language under **Voice Language**.
  Needs Spoken Quests 2.1.1 or later.

## 0.0.1 — quests-audio-esES — 2026-09-27

- **Experimental.** A first cut, numbered 0.0.1 so it does not read as finished: expect
  lines to be re-recorded, and report the ones that sound wrong.
- **The first Spanish (EU) sound pack**, `SpokenQuestsAudio_esES`: every quest and gossip line
  Spoken Quests has a European Spanish take for, in one pack for both factions. It carries the
  European Spanish gossip text too, so gossip is recognised on an esES client. It installs beside the
  English packs rather than over them; pick the language under **Voice Language**.
  Needs Spoken Quests 2.1.1 or later.

## 0.0.1 — quests-audio-frFR — 2026-09-27

- **Experimental.** A first cut, numbered 0.0.1 so it does not read as finished: expect
  lines to be re-recorded, and report the ones that sound wrong.
- **The first French sound pack**, `SpokenQuestsAudio_frFR`: every quest and gossip line
  Spoken Quests has a French take for, in one pack for both factions. It carries the
  French gossip text too, so gossip is recognised on a frFR client. It installs beside the
  English packs rather than over them; pick the language under **Voice Language**.
  Needs Spoken Quests 2.1.1 or later.

## 2.1.2 — player

- **Contributions name the NPC's voice more often.** The Contribute button now also sends the
  appearances the NPC can be drawn with, which tell the site the exact voice the game gives
  it, including for NPCs added after vanilla.
- **Closing the map with a gamepad no longer hangs the Forever client.** The quest log's Play,
  Contribute and details buttons were created in a way that tainted the client's gamepad
  navigation, so closing the map was blocked, and so was every button of the dialog saying so.

## 2.1.1 — player

- **Autoplay can be turned off.** Untick **Read dialogue when it opens** in the Spoken Quests
  settings and no quest, greeting or gossip reads itself: press **Play** in the window's top
  right, or type `/spq read`, which now reads gossip too. The same button reads **Stop** while
  the line plays. Play reads a greeting even if you have heard it before; the greeting
  frequency, now listed under autoplay, only decides what autoplay reads.

## 2.1.0 — player

- **A Contribute button, where a quest or an NPC has no voice.** Content newer than vanilla,
  a language the corpus does not carry, a line an NPC says that nobody has recorded: the quest
  frame and the gossip frame show a **Contribute** button in their top right, under the close
  button, and pressing it hands you a link to send the text your client is showing. It also
  carries what the client can see about who is speaking -- the model, the sex, the creature
  type -- which is how a new NPC gets the right voice.
- **The quest log offers it too**, where a quest's Play would be: a plus icon in the list, and
  **Contribute** on the details view's button.
- **Or gather as you play**: with gathering on (see Spoken Player 2.1.0), every quest and NPC
  line Spoken has no voice for is kept for you to send in one go, including the NPC's model
  once the client has loaded it.
- **Your name, class and race are not sent.** The game writes them into quest text for
  whoever is reading; they are put back as placeholders before a line leaves your client, so
  it can be voiced for everyone. A name with a surname counts part by part.
- The button goes away when you walk away from an NPC, rather than staying on screen after
  the conversation has closed.
- Hide it with **Hide the Contribute buttons** in the Spoken Player settings.
- Not on the 1.12, 2.4.3 and 3.3.5 clients, where contributing is off for now.

## 2.0.4 — player

- **Quests accepted and turned in by another addon are read again.** Leatrix Plus and the
  auto-turn-in addons beside it answer `QUEST_DETAIL` by calling `AcceptQuest` in the same
  frame, so the quest dialog was gone before the 10 Hz watcher could see a quest ID to
  stabilize and nothing was ever read — the audio only played for a player who clicked
  through the dialog themselves. The globals are now recorded when the client fires the
  event, and the watcher reads that record when the dialog closes with nothing dispatched
  for it.
- **The play button is back in the quest log on the Forever client.** That client reports
  itself as mainline and draws the modern map-attached quest log, which has no
  `QuestLogFrame`, no `QuestLog_Update` and no named title rows — everything the overlay
  walked to find a quest to put a button beside, so it drew nothing and said nothing. It
  walks the rows that log pools instead. The button sits left of the quest's title, and
  moves to the other end of the row, beside the tracking checkbox, when "Quest objectives"
  is on and the client's own icon has that corner.
- **A quest's details have a Play button too**, on the Forever client's quest log: a button
  beside Back that reads the quest aloud and says Stop while it is reading. The buttons in
  the list cannot follow a quest into its details view — a frame has one parent — so this
  is one button, rebound to whichever quest the panel is showing.

## 2.0.3 — player

- **Greetings are remembered at every NPC, not only the ones with quests.** The default was
  Once per Quest NPC, which silenced a repeat where the NPC had a quest to offer or hand in
  and nowhere else — so the innkeepers, vendors and flight masters a player greets a hundred
  times said the same line every time. The default is Once per NPC now. The old setting is
  still in the options, and a profile that chose one keeps it.

## 2.0.2 — player

- **A new icon in the AddOns list**: a gold exclamation mark on the Spoken shield, the same
  shield Spoken Player and Spoken Zones wear with a mark of their own. The sound packs carry
  the Quests mark, so a pack and the addon that reads it are visibly a pair. Where the player
  and this addon showed the same artwork, they no longer do.

## 2.0.1 — player

- **A first login no longer warns about an addon you never installed.** This release carries a
  placeholder folder under the old `VoiceOverRedux` name, so that your settings from before the
  rename keep loading until they have been migrated — and the addon was reading its own
  placeholder as a second, competing voiceover player. A fresh install opened with a dialog
  naming it, and with the client's own "blocked from an action only available to the Blizzard
  UI" dialog behind that, raised by the attempt to switch the folder off. An older player is
  reported and switched off only when it is really loaded and reading quests.
- An older player you had already switched off yourself is no longer described as enabled.

## 2.0.0 — player

Renamed to **Spoken Quests**, and the player extracted into the **Spoken Player** addon that
every Spoken addon speaks through. Addon managers install it automatically; the 1.12, 2.4.3
and 3.3.5 zips carry it inside.

- **Runs on the Forever client** (1.60.1, interface 16001 — the one whose TOC suffix is
  `_Camelot`), alongside Classic Era 1.15.9 and the 2.5.6 Anniversary client.
- **The commands are `/spokenquests` and `/spq`**, matching `/spoken` and `/sp` on the player
  and `/spokenzones` and `/spz` on Spoken Zones. `/vo` and `/voread` are retired — a macro that
  used one has to be edited, and `/voread` is `/spqread` now.
- The sound packs are **Spoken Quests Audio** now, and their folders moved with them:
  `SpokenQuestsAudioAlliance` and friends, where they were `VoiceOverReduxHQAudio*`. Your
  addon manager replaces the old folders; a hand-installed pack has to be deleted by hand,
  or you keep two copies of the same audio.
- Settings migrate on first login from the old VoiceOverRedux folder, which this release
  replaces with a tombstone that can be deleted afterwards.
- One queue with ZoneLore: quest lines and zone narration wait their turn behind each other,
  and nothing interrupts. Gossip yields to a queued quest line in both directions.
- The player frame, minimap button, sound channel and pause are Spoken Player's settings now.
- The settings are sections on one panel rather than a category per branch of an options
  tree. The sound packs you have, the ones you do not, and your profile are all on it,
  rather than behind a button that opened a second window. Every `/spq` command is
  unchanged, and the old window is still there for the clients with no settings panel.
- Choices are dropdowns again rather than buttons that cycled through the options.
- Report is an icon in the player's top right corner rather than a button beside the
  line. Spoken Player's settings can hide it.
- The addon calls itself Spoken Quests everywhere it speaks: chat, dialogs, the minimap
  menu, the self-test and the diagnostics. The original AI VoiceOver is still credited
  where its recording is used.
- Every sound setting is on Spoken Player's panel now: one sound channel for whatever is
  speaking, instead of one per addon, and silencing the game's own NPC dialogue while a
  line is read. Both carry over from your old settings.
- If Spoken Player is installed but switched off, a dialog offers to enable it and
  reload, rather than the addon quietly reading nothing.
- The sound packs are renamed **Spoken Quests Audio: X**, and the HQ family **Spoken Quests
  HQ Audio: X**, in the addon list and on CurseForge. Only the titles change: the folders
  keep their names, so nothing is re-downloaded and every installed pack keeps working.
- Packs are found by `X-SpokenQuests-DataModule-*` as well as the `X-VoiceOver-DataModule-*`
  key every published pack carries. A pack built from now on declares both, so one pack
  serves this release, 1.3.0, and upstream AI VoiceOver alike.

## 1.3.0 — player

**"OG Thrall".** A new option under Audio plays AI VoiceOver's original recording of Thrall's
"All members of the Horde are equal in my eyes" speech in place of this project's own. The
recording ships inside the player, so it plays whichever sound packs are installed — including
none at all. The option is off by default.

No sound pack change: install the same ones.

## 1.2.1 — player

**Turning a quest in no longer replays the quest's opening text.** Anyone running an addon that
replaces Blizzard's quest window — DialogueUI is the common one — heard the accept line again at
every hand-in, and never heard the completion line at all.

- Such an addon detaches Blizzard's quest frame from its events and draws its own window, so
  none of the panels the player was reading are ever shown. Every interaction then looked like a
  quest being offered. The player now falls back to the quest event the client actually fired,
  which says whether this is an offer, a progress check or a hand-in.
- A quest ID the client keeps reporting after a dialog closes no longer replays anything either.

No sound pack change: install the same ones.

## 1.2.0 — player

**The 1.12, 2.4.3 and 3.3.5 legacy clients are supported again.** Each has a zip of its
own on the [GitHub releases page](https://github.com/rusty-key/wow-voiceover/releases), carrying
the one `.toc` that client reads and the Ace3 build it needs. Blizzard's clients keep the single
zip they already had.

- Quest voiceovers now fire on those clients. They dispatch from the quest events directly,
  where the frame-polling reader current Classic needs cannot work.
- The Report button opens its copy box on them too, and its address is selectable.
- "Test Audio" plays through the same path the queue does, so on 2.4.3 and 3.3.5 it uses the
  music channel and can be stopped, as a real voiceover can.
- `/vo diagnostics` reports the addon's actual version instead of a stale one.

The sound packs are unchanged: install the same ones, and the player loads them even where the
client calls them out of date.

## 2.0.0 — sound packs

**The dwarves were re-recorded.** Every dwarf line is regenerated with a reworked accent —
the old one drifted between takes and landed somewhere that was not Scottish and not
anything else either.

- **Runs on the Forever client** (1.60.1, interface 16001 — the one whose TOC suffix is
  `_Camelot`), alongside Classic Era 1.15.9 and the 2.5.6 Anniversary client.
- **The packs are renamed and so are their folders**: Spoken Quests Audio: Alliance, Horde,
  Shared Quests and Gossip, installing as `SpokenQuestsAudio*`. Your addon manager replaces
  the old `VoiceOverReduxHQAudio*` folders. If you installed by hand, delete the old ones —
  otherwise you keep two copies of several hundred megabytes each, and the player sees both.
- **One pack format.** The downsampled 22.05 kHz packs are retired; these are the
  full-bandwidth ones, ~300 MB a pack. The five retired projects stay installable and get no
  further updates.
- Every pack carries the same version as Spoken Quests from here on.

## 1.2.1 — sound packs

- The packs show their own artwork in the AddOns list instead of the client's red question
  mark. No audio changed; this is 1.2.0 with an icon.

## 1.2.0 — sound packs

**The pack is now five packs, and you only need two of them.**

- Install the pack for your side and the shared one, and you get every quest line your
  character can reach: about 300 MB instead of 600. Gossip — the ambient chatter NPCs say when
  you talk to them without a quest — is a third, optional pack of 144 MB.
- Anyone who would rather have one install can still take **All**, which now installs the four
  packs for you rather than being a fifth copy of the same audio.
- Nothing was re-recorded. The audio in the split packs is byte-for-byte what 1.1.0 shipped,
  and the four split packs together hold exactly what the complete pack holds — 11,189 clips,
  no overlap, nothing missing.
- Which side a quest belongs to comes from the questgiver: an NPC hostile to the Horde and not
  to the Alliance hands out Alliance quests. Neutral hubs like Booty Bay and Gadgetzan land in
  the shared pack, so their quests play for both sides.
- **The folder names changed.** Updating through an addon manager handles it: the old
  `VoiceOverReduxAudio` folder becomes the small "All" addon, and the packs arrive beside it.
  If you installed by hand, delete the old folder after installing the new packs, or it keeps
  serving the audio it already has.

## 1.1.1 — player

- Shows its own artwork in the AddOns list instead of the client's red question mark. Nothing
  else changed.

## 1.1.0 — player

- Knows about all five sound packs, and offers them only to a player who has none installed
  rather than nagging about the four they deliberately skipped.

## 1.1.0 — sound pack

The pack is now Ogg Vorbis instead of MP3: **564 MB, down from 1.5 GB**, for the same 11,189
lines. Vorbis is worth 1.3–1.5× over MP3 at these bitrates, and the clips are resampled to
22.05 kHz, which speech survives.

Nothing else changed — same lines, same voices, same lookup tables. Install it over the old
pack; the player finds it the same way.

## 1.0.1 — player

Nests the pack under the player in the AddOns list, and targets Blizzard's clients only: one
zip carrying a `.toc` per flavor, which the client picks between.

The 1.12, 2.4.3 and 3.3.5 legacy clients are no longer supported. They predate flavor
suffixes and each needed its own zip and its own vendored Ace3.
