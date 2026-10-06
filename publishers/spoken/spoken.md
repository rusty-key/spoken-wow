---
curseforge: 1700375
wago: QN53yXKB
slug: spoken-player
name: Spoken Player
summary: Expressive, character-driven AI voiceover for WoW Forever and Classic. Quest dialogue, NPC gossip, zone lore and books, read aloud. Spoken Quests, Spoken Zones and Spoken Books in one download.
categories:
  - Audio & Video
  - Roleplay
  - Miscellaneous
license: MIT
---

**Expressive, character-driven AI voiceover for WoW Forever and Classic.** NPCs speak their quest text and gossip, zones tell their stories, and books read themselves aloud.

**Voiced with care:**

- **Voices fit the character**, not just race and gender: a dwarf warrior and a dwarf official don't sound alike.
- **A narrator** reads quests from objects such as wanted posters, and stage directions like `<Advisor Belgrum opens the note.>`
- **Sounds are performed**, not spelled out: `*hic*` is a hiccup, not "asterisk hic asterisk".
- **Names and places are pronounced right**, from a pronunciation dictionary.
- **A more natural performance** throughout.

## What's inside

Three modules, each can be switched off in the settings. **The voices are not included:** install the voice pack for each module you want to hear, or the addon stays silent.

| Module | Voices | Voice pack |
| --- | --- | --- |
| **Spoken Quests** | quest dialogue and NPC gossip | [All](https://www.curseforge.com/wow/addons/spoken-quests-audio-all), or [Alliance](https://www.curseforge.com/wow/addons/spoken-quests-audio-alliance) · [Horde](https://www.curseforge.com/wow/addons/spoken-quests-audio-horde) · [Shared](https://www.curseforge.com/wow/addons/spoken-quests-audio-shared) · [Gossip](https://www.curseforge.com/wow/addons/spoken-quests-audio-gossip) |
| **Spoken Zones** | zone and area lore, on the world map | [Spoken Zones Audio](https://www.curseforge.com/wow/addons/spoken-zones-audio) |
| **Spoken Books** | books, letters, notes and the plaques out in the world | [Spoken Books Audio](https://www.curseforge.com/wow/addons/spoken-books-audio) |

<!-- only:curseforge -->
Want everything in English at once? Install [Spoken Everything](https://www.curseforge.com/wow/addons/spoken) instead: it brings this addon and every English pack.

<!-- /only -->
Voice packs in German, Spanish, French, Korean, Portuguese, Russian and Chinese are separate downloads.

## More details

- **Quests**: the quest text plays as the dialog opens, and NPC gossip and greetings are voiced too. Every quest in the log has a Play button.
- **Zones**: the story of each zone and area in a panel beside the world map, with a picture of the place. An area you discover for the first time is narrated once. **Lore of Azeroth** browses every story without the map.
- **Books**: open a book and it reads every page in order, following you as you turn them. Your mail is never read.
- **One queue**: quest lines, zone stories and books wait their turn; nothing talks over anything. Stop, Replay and Skip from the screen, the minimap button or a key binding.
- **Your choice of display**: subtitles low on screen with the speaker's picture, a small window, the large classic window, or voice only.
- **The game makes room**: music, ambience and NPC voices are turned down while a line plays.
- **Interface in nine languages**: English, German, Spanish, French, Korean, Portuguese, Russian and both Chinese scripts.

## Coming from the separate downloads?

Spoken Quests, Spoken Zones and Spoken Books are no longer separate downloads. Install this one, then uninstall those and delete the `SpokenQuests`, `SpokenZones` and `SpokenBooks` folders from `Interface\AddOns`. Your voice packs keep working.

## Settings and commands

Game Menu → Options → AddOns → **Spoken**, or `/sp options`.

```
/sp            stop or replay the line
/sp skip       skip the current line
/sp stop       clear the queue
/sp options    settings
/sp reset      put the window and subtitles back in place
/sp share      how to send gathered lines
/spq, /spz, /spb   each module's own commands
```

## Contributing

**Bugs.** Something wrong with a line, a wrong voice, a mispronounced name or a broken quest? Press the **bug** button on the subtitle or the window while the line plays. It hands you a short link to that exact line; the page has the text, the audio and a form.

**Missing lines and corrections.** When Spoken has no voice for something on screen, it shows a **Contribute** button that hands you a link carrying the game's text; open it and press Send. Or turn on **Gather missing lines automatically** in the settings, play as usual, then upload `SavedVariables/SpokenContributions.lua` at [spoken.rusty.one/contribute](https://spoken.rusty.one/contribute). Text that reads wrong can be corrected the same way. Nothing leaves your game until you send it yourself.

**Code.** The addon is open source on [GitHub](https://github.com/rusty-key/spoken-wow): issues and pull requests are welcome.

**Voices and translations.** Want to help a voice sound right, or the addon read well in your language? Come to the [Discord](https://discord.gg/HEGUgn6Yf).

---

[Join the Discord](https://discord.gg/HEGUgn6Yf) · [Buy Me a Coffee](https://buymeacoffee.com/rustykey)
