# Spoken FAQ

Answers to the tech-support questions players ask most about Spoken, its voice packs and the
Spoken Manager. The Discord bot answers from this file and nothing else, and stays silent on a
question it does not cover, so every entry here is kept short and exact. Settings are named as the
English game client shows them.

## How do I install Spoken?

There are three ways, all listed at https://spoken.quest/#install:

- **Spoken Manager** (recommended): a desktop app for Windows, macOS and Linux that finds your game and installs Spoken and the voice packs you pick. Download it from https://github.com/rusty-key/spoken-wow/releases/tag/manager-latest
- **CurseForge app**: install the meta addon for your language, such as **Spoken: English**, which pulls in Spoken and every voice pack.
- **By hand**: on https://spoken.quest/#install choose "By hand", pick your language, and download Spoken and each voice pack (Quests and Gossip, Places, Readables, Bosses). The zips are also at https://github.com/rusty-key/spoken-wow/releases. Unzip them into your game's `Interface/AddOns` folder.

Restart the game afterwards.

## I installed Spoken but nothing is read aloud

Spoken is only the player: the voices are not included. Install the voice pack for each part you want to hear (Quests, Places, Readables, Bosses), or the addon stays silent. The Manager and the meta addons such as **Spoken: English** install the packs for you; a download of Spoken on its own does not.

## Which voice packs do I need?

- **Quests**: an Alliance character needs **Alliance** + **Shared**, a Horde character **Horde** + **Shared**. **Shared** holds the quests both sides can take, including neutral hubs such as Booty Bay and Gadgetzan.
- **Gossip**: optional, what NPCs say when you talk to them without a quest. One pack for both factions.
- **All** installs all four quest packs at once.
- **Places**: zone and area lore.
- **Bosses**: dungeon and raid boss stories.
- **Readables**: books, letters, notes and plaques.

## Where is the Bosses voice pack?

Boss stories have a pack of their own, **Bosses**, separate from **Places**. Install it like the other packs, from the Spoken Manager, CurseForge or https://github.com/rusty-key/spoken-wow/releases. Boss stories need Spoken 3.7.0 or later.

## I downloaded "All" or "Spoken: English" by hand and got almost nothing

Those are meta addons: a few kilobytes that only name the real packs as dependencies, so the CurseForge app fetches them. A manual download of the zip gets you the stub alone. Install them through the CurseForge app, use the Spoken Manager, or download each pack directly.

## Can I install the voice packs from Wago?

Spoken itself is on Wago, but none of the voice packs are: they are all too large for Wago's upload limit. Take the packs from the Spoken Manager, from CurseForge, or from https://github.com/rusty-key/spoken-wow/releases and unzip them into `Interface/AddOns`.

## Where does a manual install go?

Unzip every folder into the `Interface/AddOns` folder of the game you play: `World of Warcraft/_forever_/Interface/AddOns`, `_classic_era_` or `_anniversary_`. Leave the folder names exactly as shipped (for example `Spoken`, `Spoken_Quests`, `SpokenPlacesAudio`): Spoken finds its packs by folder name. Restart the game afterwards.

## Which game versions does Spoken support?

WoW: Forever, Classic Era and TBC Anniversary. Spoken is made and tested on WoW: Forever. On TBC Anniversary only the classic zones are voiced: Outland and the other zones TBC added have no voices. Retail and the later Classic expansions are not supported.

## Does Spoken work on 1.12 or WotLK 3.3.5 private servers?

Not this version: Spoken supports WoW: Forever, Classic Era and TBC Anniversary. Community forks, maintained by others, cover those clients:

- 1.12: https://github.com/z1xel/SoftSpoken
- 3.3.5: https://github.com/PatchFoundry335/spoken-wow

We don't support them, so questions about them go to their maintainers.

## The Spoken Manager does not find my game

Press **Add Game Folder** and choose the game folder, one of its `_forever_`, `_classic_era_` or `_anniversary_` folders, or the `Interface/AddOns` folder. On Linux the Manager looks inside Wine prefixes (`$WINEPREFIX`, `~/.wine`, `~/Games/*`, Lutris, Bottles, Steam/Proton and Heroic); anywhere else, add the folder yourself.

## The Spoken Manager will not start or my system blocks it

- **Windows**: if SmartScreen asks, choose "More info", then "Run anyway".
- **macOS**: if macOS says it cannot verify the app, open System Settings → Privacy & Security and choose Open Anyway (once). Version 0.1.1 and older were not signed and show as damaged: download the newest version.
- **Linux**: on Ubuntu 24.04 and later the AppImage window may not open; start it with `--no-sandbox`, or install the `.deb` or `.rpm` instead.

## How do I update Spoken and the voice packs?

In the Spoken Manager, a game's card shows an **Update** button when Spoken or any installed voice pack has a newer version; one press updates them all. Turn on **Keep Spoken Up to Date** in the Manager's settings and it installs these updates by itself. If you move from CurseForge to the Manager, it finds the addons already installed and updates over them. The CurseForge app updates its own installs. By hand, download the new zips and unzip them over the old folders.

## Spoken says it switched off folders left by an older version

Spoken Quests, Spoken Zones and Spoken Books used to be separate downloads and are now part of Spoken. Delete the `SpokenQuests`, `SpokenZones` and `SpokenBooks` folders (and `Spoken_Books` or `Spoken_Writings` if named) from `Interface\AddOns`, uninstall the old addons from your addon manager, and reload. Your voice packs keep working.

## How do I check that a voice pack works?

Open Spoken's settings (Game Menu → Options → AddOns → **Spoken**, or `/sp settings`) and go to the module's page. **Voice Packs** shows whether a pack is installed, and **Play a Test Line** plays a line. `/spq test` does the same for quests. If a pack shows **Not loaded**, check that it is enabled in the game's AddOns list.

## I get "No usable voice packs were loaded"

That message comes from Spoken Quests: it found no quest voice pack. Install the quest packs for your faction (or **All**) and restart the game. `/spq diagnostics` prints which packs it detected and why one did not load.

## Spoken says "Spoken is stopped, so new lines wait"

Spoken's queue is stopped, so nothing new plays until you carry on. Press **Replay** or **Skip** on the window or subtitles, type `/sp replay`, or use the **Stop or Replay** key. `/sp stopall` clears the queue.

## How do I hear a line again after it finished?

**Replay** only works on a line that is still in the queue, such as one you stopped. It cannot bring back a line that has already finished. To hear a finished quest, place or book again, open Azeroth's Compendium (`/sp compendium`) and play it from its page.

## An NPC or quest is silent

Spoken has no recording of that line yet. This is common for quests and NPCs that WoW: Forever added or changed. When Spoken has no voice for something on screen, it shows a **Contribute** button: send the line and it can be voiced in a later pack update. Also check that the matching pack is installed: gossip needs the **Gossip** pack, and a quest needs your faction's pack and **Shared**.

## Quests do not start reading by themselves

Turn on **Read Automatically** on the **Quests** page of Spoken's settings. **Read After Accepting** waits until you accept or hand in the quest, and reads nothing for a quest you close without either. **Stop When Window Closes** stops the reading as the window closes. **Read Quest Progress Text** decides whether the "not done yet" page reads itself. Every quest in the Quest Log and Blizzard's objective tracker has a Play button either way (**Show Play Button**). Questie's tracker has none: the Questie team asked Spoken to stop adding one.

## Why does an NPC only greet me once?

**Read Greetings**, on the **Gossip** page, is **Once for Quest Givers** by default: a quest giver's greeting is read once, and other NPCs greet every time. Choose **Every Time**, **Once per Greeting** or **Never** instead. **Forget Greetings Heard** clears the list for this character.

## How do I change or turn off the subtitles?

**Narrator Style** on Spoken's settings page picks how lines show: **Subtitles Only**, **Small Window**, **Large Window**, **DialogueUI** (with that addon installed) or **Voice Only**. `/sp style subtitles | small | large | dialogueui | voice` switches from chat. **Show Narrator** turns the words off for everything or for one part, and the voice still plays. `/sp reset` puts the window and subtitles back in place, and **Lock Position** stops them moving.

## How do I move the subtitles or the window?

Drag them with the left mouse button. If they don't move, turn off **Lock Position** in Spoken's settings. `/sp reset` puts them back in place.

## How do I control Spoken's volume?

Spoken plays through the game's **Master Volume** by default; **Volume Follows**, under Sound on Spoken's settings page, picks another slider. While a line plays, **Turn Other Sounds Down** lowers music, ambience and effects, and **Silence NPC Voices** mutes the game's own NPC voices. If the game window is in the background the client mutes itself; turn on **Keep Reading in Background** under Playback to keep hearing Spoken.

## Can Spoken go quiet when I'm in Discord voice chat?

No: the game gives addons no way to see a Discord voice channel. Stop it yourself with the **Stop or Replay** or **Stop All** keys (in the Spoken category of Key Bindings), `/sp stopall`, or the minimap button. To stop a part reading at all, turn it off under **What Spoken Reads**. **Read in Battlegrounds**, under While Spoken Reads, keeps Spoken quiet in battlegrounds and arenas.

## Place stories stop when I enter combat

**Stop When Combat Starts**, under Read Automatically on the **Places** page, is off by default; when it is on, a story that started on its own stops when a fight begins and plays again from the start once it ends. Either way, a story that has not started yet waits for the fight to end, and a story you start with Play keeps going.

## Places are only read once

Places reads each zone and area once per character by default. Turn on **Read Every Visit** under When to Read on the **Places** page and choose how long to wait before the same place is read again. **Forget Visited Places** (`/spp forget`) clears this character's list.

## What are the slash commands?

- `/sp`: stop or replay the line
- `/sp skip`: skip the current line
- `/sp stopall`: stop and clear the queue
- `/sp compendium`: open Azeroth's Compendium
- `/sp settings`: settings
- `/sp reset`: put the window and subtitles back in place
- `/sp diagnostics`: print what Spoken sees, for a bug report
- `/sp help`: every command

`/spq`, `/spp` and `/spr` are the Quests, Places and Readables commands.

## Does Spoken work with DialogueUI or Immersion?

Yes. With **DialogueUI**, pick the **DialogueUI** Narrator Style to show lines in DialogueUI's art; Spoken adds a Listen button to its window and marks the words being read (**Mark Words in DialogueUI**). With **Immersion**, Spoken's window and subtitles hide while Immersion's window is open, the voice plays on, and Immersion turns its pages with the voice.

## Does Spoken work with auto-accept addons like Leatrix Plus or Zygor?

Yes. When Leatrix Plus, Zygor, RestedXP or Enhance QoL accepts or hands in a quest for you, Spoken still reads it, as long as that addon leaves the quest's data in place. If quests stopped reading with one of them, update Spoken first.

## Does Spoken work with map addons like Leatrix Maps or OpenMap?

Yes. The Place Story panel sits beside Leatrix Maps' map frame, and its dungeon maps open Spoken's lore. On OpenMap's world map, areas light up under the cursor and a click opens that area's story; with Spoken Bosses, OpenMap's dungeon and boss panels open the boss stories.

## Which languages are there?

Voice packs exist in English, German, Spanish (Spain and Latin America), French, Portuguese (Brazil), Russian, Korean and both Chinese scripts; other languages, such as Italian, are made by their own teams. Spoken speaks your client's language by default. To hear another, install that language's packs and add it under **Voices, in Order** on Spoken's settings page, moving it to the top. A line plays in the first voice in that list that has it, so the voices after the first decide what plays for a line it has no recording of; past the last, Spoken stays silent. Language packs install beside the English ones rather than replacing them.

No game client runs in languages such as Italian or Polish, so Spoken never picks them by itself: install the pack (the Spoken Manager lists community packs on its **Community** page), then add the language under **Voices, in Order**.

## Can I hear another team's voices for my language?

Yes, where a language has packs from more than one team. Install them from the Spoken Manager's **Voice Packs** page, where each team's packs say who made them. Each team's pack is a voice of its own under **Voices, in Order**, named "Deutsch · {team}", beside the language's own "Deutsch". Put the one you want first; the voices after it fill in the lines it has not recorded.

## A line has the wrong voice, a mispronounced name or wrong text

Press the **Report** (bug) button on the subtitles or the window while the line plays, or on its page in Azeroth's Compendium. It gives you a short link to that exact line on spoken.quest, with the text, the audio and a form. Copy the link and open it in your browser.

## How do I report a bug or a Lua error?

First update Spoken, since many errors are already fixed. Then post in the **#bugs** forum on the Discord (https://spoken.quest/discord) with your client (Forever, Classic Era or Anniversary), your Spoken version, the full error text and the steps that cause it. The output of `/sp diagnostics` helps. Issues are also welcome on GitHub: https://github.com/rusty-key/spoken-wow/issues

## How can I send lines that have no voice?

- The easiest: turn on **Sharing** in the Spoken Manager's Settings, and it sends the collected lines for you after each logout or `/reload`.
- Or press **Contribute** when Spoken shows it, open the link and press Send.
- Or turn on **Collect Missing Lines** in Spoken's settings (or `/sp collect`), play as usual, log out or `/reload`, then upload `WTF/Account/<your account>/SavedVariables/SpokenContributions.lua` at https://spoken.quest/contribute

Nothing leaves your game until you send it. `/sp send` shows these steps in game.

## How can I help with voices, translations or code?

Voices and translations are worked on with the team on the Discord: https://spoken.quest/discord. The addon is open source at https://github.com/rusty-key/spoken-wow, and issues and pull requests are welcome.

Anyone can also make a voice pack, for example in a new language or with other voices. The guide is at https://github.com/rusty-key/spoken-wow/blob/master/community/README.md, and the voices are generated with your own key. Submit the pack at https://spoken.quest/packs: once it is approved, it shows on the Spoken Manager's **Community** page.
