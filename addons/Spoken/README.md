<!-- GENERATED from publishers/spoken/spoken.md by scripts/descriptions.mjs. Do not edit by hand. -->

**Expressive, character-driven AI voiceover for WoW Forever.** NPCs speak their quest text and gossip, places tell their stories, and books read themselves aloud.

Spoken is made and tested on WoW Forever. It also installs on Classic Era and Anniversary, as it is.

**Voiced with care:**

- **Voices fit the character**, not just race and gender: a dwarf warrior and a dwarf official don't sound alike.
- **A narrator** reads quests from objects such as wanted posters, and stage directions like `<Advisor Belgrum opens the note.>`
- **Sounds are performed**, not spelled out: `*hic*` is a hiccup, not "asterisk hic asterisk".
- **Names and places are pronounced right**, from a pronunciation dictionary.
- **A more natural performance** throughout.

## What's inside

Four modules, each can be switched off in the settings. **The voices are not included:** install the voice pack for each module you want to hear, or the addon stays silent.

| Module | Voices | Voice pack |
| --- | --- | --- |
| **Spoken Quests** | quest dialogue, and what NPCs say when you talk to them | [All](https://www.curseforge.com/wow/addons/spoken-audio-quests-all), or [Alliance](https://www.curseforge.com/wow/addons/spoken-audio-quests-alliance) · [Horde](https://www.curseforge.com/wow/addons/spoken-audio-quests-horde) · [Shared](https://www.curseforge.com/wow/addons/spoken-audio-quests-shared) · [Gossip](https://www.curseforge.com/wow/addons/spoken-audio-gossip) |
| **Spoken Places** | zone and area lore, on the world map | [Spoken Audio: Places](https://www.curseforge.com/wow/addons/spoken-audio-places) |
| **Spoken Readables** | books, letters, notes and the plaques out in the world | [Spoken Audio: Readables](https://www.curseforge.com/wow/addons/spoken-audio-readables) |
| **Spoken Bosses** | the story of each dungeon and raid boss, when it falls | [Spoken Audio: Bosses](https://www.curseforge.com/wow/addons/spoken-audio-bosses) |

## Languages

Want everything at once? Install your language's set instead: it brings this addon and every voice pack in that language.

| Language | Install |
| --- | --- |
| English | [Spoken: English](https://www.curseforge.com/wow/addons/spoken-english) |
| German | [Spoken: German](https://www.curseforge.com/wow/addons/spoken-german) |
| Spanish (EU) | [Spoken: Spanish (EU)](https://www.curseforge.com/wow/addons/spoken-spanish-eu) |
| Spanish (AL) | [Spoken: Spanish (AL)](https://www.curseforge.com/wow/addons/spoken-spanish-al) |
| French | [Spoken: French](https://www.curseforge.com/wow/addons/spoken-french) |
| Korean | [Spoken: Korean](https://www.curseforge.com/wow/addons/spoken-korean) |
| Portuguese | [Spoken: Portuguese](https://www.curseforge.com/wow/addons/spoken-portuguese) |
| Russian | [Spoken: Russian](https://www.curseforge.com/wow/addons/spoken-russian) |
| Chinese (Simplified) | [Spoken: Chinese (Simplified)](https://www.curseforge.com/wow/addons/spoken-chinese-simplified) |
| Chinese (Traditional) | [Spoken: Chinese (Traditional)](https://www.curseforge.com/wow/addons/spoken-chinese-traditional) |

Spoken speaks in your client's language by default. To hear another, pick it under **Voice Language** in the settings.

## More details

- **Quests**: the quest text plays as the dialog opens. Every quest in the log has a Play button.
- **Gossip**: what an NPC says when you talk to them, and the greeting before it.
- **Places**: the story of each zone and area in a panel beside the world map, with a picture of the place. An area you discover for the first time is narrated once.
- **Azeroth's Compendium**: every quest, place story and book in one window, to browse, search and play without going there.
- **Readables**: open a book and it reads every page in order, following you as you turn them. Your mail is never read.
- **One queue**: quest lines, place stories and books wait their turn; nothing talks over anything. Pause, Stop, Replay and Skip from the screen, the minimap button or a key binding. Where a voice pack keeps its lines as sentences, Play after Pause starts the sentence again, and after Stop the text on screen.
- **Your choice of display**: subtitles low on screen with the speaker's picture, a small window, a large window, a window in DialogueUI's art when that addon is installed, or voice only.
- **The game makes room**: music, ambience and NPC voices are turned down while a line plays.
- **Interface in nine languages**: English, German, Spanish, French, Korean, Portuguese, Russian and both Chinese scripts.

## Coming from the separate downloads?

Spoken Quests, Spoken Zones (now Spoken Places) and Spoken Books are no longer separate downloads. Install this one, then uninstall those and delete the `SpokenQuests`, `SpokenZones` and `SpokenBooks` folders from `Interface\AddOns`. Your voice packs keep working.

## Settings and commands

Game Menu → Options → AddOns → **Spoken**, or `/sp settings`.

```
/sp            stop or replay the line
/sp pause      pause or resume the line
/sp skip       skip the current line
/sp stopall    stop and clear the queue
/sp compendium open Azeroth's Compendium
/sp settings   settings
/sp reset      put the window and subtitles back in place
/sp collect    turn Collect Missing Lines on or off
/sp send       how to send collected lines
/sp help       every command
/spq, /spp, /spr   each module's own commands
```

## Contributing

**Bugs.** Something wrong with a line, a wrong voice, a mispronounced name or a broken quest? Press the **bug** button on the subtitle or the window while the line plays. It hands you a short link to that exact line; the page has the text, the audio and a form.

**Missing lines and corrections.** When Spoken has no voice for something on screen, it shows a **Contribute** button that hands you a link carrying the game's text; open it and press Send. Or leave **Collect Missing Lines** on in the settings, play as usual, then upload `SavedVariables/SpokenContributions.lua` at [spoken.quest/contribute](https://spoken.quest/contribute). Text that reads wrong can be corrected the same way. Nothing leaves your game until you send it yourself.

**Code.** The addon is open source on [GitHub](https://github.com/rusty-key/spoken-wow): issues and pull requests are welcome.

**Voices and translations.** Want to help a voice sound right, or the addon read well in your language? Come to the [Discord](https://spoken.quest/discord).

## Legacy clients

- 1.12: [SoftSpoken](https://github.com/z1xel/SoftSpoken)
- 3.3.5a: [PatchFoundry335/spoken-wow](https://github.com/PatchFoundry335/spoken-wow)

## FAQ and troubleshooting

*Q. Can you add controls for faster playback, like 1.25x/1.5x?*<br>
A. Unfortunately, I can't. The game doesn't allow addons to control playback speed. I will try to release a sped-up version on GitHub Releases in the future.

*Q. Why does pausing/resuming restart the line?*<br>
A. The game doesn't allow addons to pause a track, only fully stop and restart.

*Q. Are you planning to support Retail/MoP?*<br>
A. The scope of post-Cataclysm changes is too big to implement at the same quality, so it's not planned.

*Q. What about TBC/WotLK?*<br>
A. Changes there are more additive, so it's theoretically possible, but not planned yet, as I am focused on polishing the Era and Forever experience first.

*Q. Why does the addon call me Adventurer? Can't it use my name/class/race?*<br>
A. All lines are pre-recorded. Using name is impossible with current tech, and using class/race would mean dubbing the same line multiple times over. I plan to split texts into smaller chunks, which will let us produce class/race lines, but it's not a high-priority task.

---

[Join the Discord](https://spoken.quest/discord) · [Buy Me a Coffee](https://buymeacoffee.com/rustykey)
