# Gossip

Gossip is what an NPC says when the player talks to them: the gossip page, and the greeting a quest
giver opens with. It is a part of Spoken, and its code is in `addons/Spoken_Quests`, which reads
every NPC window. Players see it as Gossip on Spoken's list of parts and as its own page under
Spoken's settings. Quests, the other part of that addon, reads the text of a quest.

The voices are the quests packs. A gossip line is a file in the Gossip pack (English) or in a
language's one pack (`SpokenQuestsAudio_<lang>`). There is no sound pack of its own, and the
lines are made on the site's gossip explorer (`/gossip`), next to the quest lines
(`docs/quests/README.md`).

## Where it is

| File | What it does |
| --- | --- |
| `VoiceOver.lua` | The two windows it reads (`QUEST_GREETING`, `GOSSIP_SHOW`), their events and hooks, and the rules for when a line plays (`ShouldPlayGossip`, `MuteGreetingAhead`). `PartOfPage` says which part a window belongs to. |
| `Player.lua` | Registers the `gossip` source beside `quests`, hands lines to the right one (`SourceOf`, `Owns`), and holds the Stop Gossip control. |
| `UI/GossipSettingsPanel.lua` | The Gossip page under Spoken's settings. |
| `GreetingFirst.lua` | NPC Voice Before Reading: the NPC's own greeting plays first. |
| `EasterEggs.lua`, `Sounds/og-thrall.mp3` | The original Thrall recording, played in place of the pack's when its setting is on. |
| `Gossip/<lang>.lua`, `Gossip/Aliases.lua` | Generated. Every line's text in the client's language, and the files one moment is also recorded under. |
| `UI/DialogPlayButton.lua`, `UI/DialogueUIBridge.lua`, `UI/ContributeButton.lua` | The Listen, Report and Contribute controls on the NPC windows and on DialogueUI's. |

Both parts run in one environment, the global `VoiceOver` table. The name stays: every sound
pack calls into it.

## How a line is read

1. The client opens a window. The addon hears `QUEST_GREETING` or `GOSSIP_SHOW` on its event
   frame, and also hooks the windows' `OnShow` and `QuestFrame_OnEvent`, because the globals that
   hold the text can lag the event. Each signal waits 0.1 s and the last one for a window wins.
2. In the frame the window opens, `MuteGreetingAhead` cuts the NPC's own spoken greeting, but
   only where a pack has a line for this speaker and the settings say it will be read. Any
   other NPC keeps its own voice. On a first talk the client may not have the NPC's text yet when
   the window is read: a read that finds the text empty keeps the mute and reads the window again
   every 0.2 s, up to five times (`WaitsForGreetingText`). A read that finds text and no line, or
   a greeting already heard, gives the voice back at once. With the game's dialogue left alone or
   the queue paused nothing is muted and the window is read once.
3. `GetNPCGossipTextHash` finds the line from the speaker and the words. It looks in the
   tables written in the client's language first (`Gossip/<lang>.lua`, then the packs'), and only
   if no pack in that language knows the NPC does it try the others. The closest match by shared
   words wins. Chinese has no spaces between words, so Chinese and Korean text is compared by
   pairs of neighbouring characters, and a curly apostrophe or a no-break space counts as the
   plain one. In the client's language a line must also be close enough to the text
   (`GOSSIP_MATCH_FLOOR`, after the player's name, class, race and sex are filled into it), since
   an NPC whose text depends on who asks (a trainer's profession, a guard's faction) may have
   only some of its variants in the packs. A variant it lacks plays nothing and offers Contribute.
   The other languages' words cannot match the screen's, so there an NPC with one line plays it,
   and an NPC with several plays one only where it clears the floor; otherwise nothing plays and
   the window offers Contribute.
4. `PrepareSound` finds the file in the voice language, then the fallback language, trying the
   line's aliases and the player's `m-` or `f-` variant, and applies the Thrall recording if
   that setting is on.
5. The line is queued on the `gossip` source with priority `low`. A greeting waits for the
   NPC's own greeting to finish where NPC Voice Before Reading is on. With DialogueUI's window up,
   the read waits until the window is fully shown.

When the player picks an option, the next page is read whatever Read Greetings says: the
once-per settings hold back only the greeting an NPC opens with. The page is labelled with the
option picked.

## Settings

Everything the Quests addon stores is in `SpokenQuestsSettings`, in the profile chosen on
Spoken's own page. Gossip adds no saved variable.

- On Spoken's page: Gossip's switch and Show Narrator. Off, no NPC window is read and Quests
  keeps reading quests. The switches are saved with the profile.
- Read Automatically, on the Quests page, decides whether any NPC window reads by itself, as
  it did before Gossip had a page. Read Greetings waits on it, and says so. So does NPC Voice
  Before Reading, on the same page: the NPC's own greeting plays first, for quest windows and
  gossip windows.
- On Gossip's page, Read Greetings: Every Time, Once for Quest Givers (the default), Once per
  Greeting (saved as `OncePerNPC`) or Never. The once-per settings remember each text an NPC greets
  with, so an NPC with several greetings reads each new one once. Once for Quest Givers holds
  back a repeat only where the NPC has quests. At Never nothing reads itself and the NPC windows
  show a Listen button.
- Original Thrall Speech, and Forget Greetings Heard, which makes every
  NPC greet this character again. That matters only for the two once-per settings. Heard
  greetings are kept per character in `hasSeenGossipForNPC`: under each NPC's GUID, a short hash
  of every text heard from it, marked when the line starts playing. A GUID marked `true` dates
  from when only the NPC was kept, and counts as unheard.
- Stop When Window Closes is on the Quests page and covers the quest, gossip and greeting windows.
  Closing the quest frame also stops a greeting, but never a quest's own line.

## Commands

Gossip has no commands of its own. `/spq read` reads whichever NPC window is open, `/spq test`
plays a known line, `/spq diagnostics` prints the client, the settings and the packs that hold
gossip, and `/sp settings` opens Spoken's page.

## Where the text and the packs come from

- Each client language but English has its gossip text in `Gossip/<lang>.lua`. Forever's `.toc`
  loads only the client's own with `[AllowLoadTextLocale]`.
- `docs/quests/README.md` explains how the lines, their BroadcastText ids and the aliases are
  made: "Gossip text for every client" and "Which greeting a text is".
- The Report address for a greeting is `…/quests/r/npc/{creatureID}`, and a gameobject has
  `…/quests/r/object/{objectID}`. The Contribute button appears where no pack has the line.
