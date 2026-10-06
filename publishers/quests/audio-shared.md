---
curseforge: 1660199
wago: QNlz3YKe
release: quests-audio-shared
section: quests
lang: enUS
pack: shared
github: false
slug: spoken-quests-audio-shared
name: Spoken Quests Audio: Shared Quests
summary: Quest dialogue both factions can hear, voiced. Install alongside the Alliance or Horde pack. Needs Spoken Player.
categories:
  - Audio & Video
  - Roleplay
  - Quests & Leveling
license: MIT
---

Voiced dialogue for the quests **both factions** can take. Neutral hubs like Booty Bay, Gadgetzan, Everlook and Ratchet live here, along with every other quest whose giver talks to either side.

**Everyone wants this pack**, and on its own it is only part of the story. Pair it with your side, and with the player:

1. **[Spoken Player](https://www.curseforge.com/wow/addons/spoken-player)** — the player. Without it no pack plays.
2. **[Spoken Quests Audio: Alliance](https://www.curseforge.com/wow/addons/spoken-quests-audio-alliance)** or **[(Horde)](https://www.curseforge.com/wow/addons/spoken-quests-audio-horde)** — whichever side your character is on.

## The packs

| Pack | Holds | |
| --- | --- | --- |
<!-- only:curseforge -->
| [All](https://www.curseforge.com/wow/addons/spoken-quests-audio-all) | installs the four below | |
<!-- /only -->
| [Alliance](https://www.curseforge.com/wow/addons/spoken-quests-audio-alliance) | Alliance-only quests | |
| [Horde](https://www.curseforge.com/wow/addons/spoken-quests-audio-horde) | Horde-only quests | |
| **Shared** | quests both factions can take | **this pack** |
| [Gossip](https://www.curseforge.com/wow/addons/spoken-quests-audio-gossip) | NPC gossip chatter | |

Gossip — the chatter NPCs give you when you talk to them without a quest — is optional on top.

<!-- only:wago -->
This pack is not installable from Wago: at several hundred megabytes it is over the upload limit here. Take it from CurseForge, or take all four packs in one download, [All](https://github.com/rusty-key/spoken-wow/releases?q=quests-audio), from GitHub; unzip it into `Interface/AddOns` and the addon finds them.
<!-- /only -->
<!-- only:curseforge -->
If you would rather have one install and not think about it, take **[All](https://www.curseforge.com/wow/addons/spoken-quests-audio-all)** instead. It holds no audio itself - it just tells your addon manager to fetch all four packs.
<!-- /only -->

## Why the pack is split

The whole thing is a large download, and a good part of it is dialogue your character can never reach. A quest belongs to a side when its questgiver does — hostile to the Horde means an Alliance quest, and the other way round. A giver who talks to both sides has no faction to sort by, so those quests are here, where both packs can reach them.

## What this is

A rework of the original [AI VoiceOver](https://github.com/mrthinger/wow-voiceover) addon, which makes NPCs speak their quest text. Main changes:

- voices are matched per NPC flavor, instead of just race and gender, so a dwarf warrior and a dwarf official don't sound alike
- object quests are also voiced now, using a narrator voice
- stage directions (`<Advisor Belgrum opens the note.>`) are read by the narrator
- proper voicing of sounds — `<hic>` produces the sound of a hiccup, not the word
- tons of pronunciation fixes
- more natural-sounding performance
