---
curseforge: 1660198
wago: vNAg3OKo
release: quests-audio-horde
section: quests
lang: enUS
pack: horde
github: false
slug: spoken-quests-audio-horde
name: Spoken Quests Audio: Horde
summary: Horde-only quest dialogue, voiced. Pair it with the Shared pack. Needs Spoken Player.
categories:
  - Audio & Video
  - Roleplay
  - Quests & Leveling
license: MIT
---

Voiced dialogue for the quests only a Horde character can take.

**You need two more addons for this to do anything:**

1. **[Spoken Player](https://www.curseforge.com/wow/addons/spoken-player)** — the player. Without it no pack plays.
2. **[Spoken Quests Audio: Shared Quests](https://www.curseforge.com/wow/addons/spoken-quests-audio-shared)** — the quests both factions can take, including everything in the neutral hubs like Booty Bay and Gadgetzan. Without it a Horde character hears only part of their quests.

## The packs

| Pack | Holds | |
| --- | --- | --- |
<!-- only:curseforge -->
| [All](https://www.curseforge.com/wow/addons/spoken-quests-audio-all) | installs the four below | |
<!-- /only -->
| [Alliance](https://www.curseforge.com/wow/addons/spoken-quests-audio-alliance) | Alliance-only quests | |
| **Horde** | Horde-only quests | **this pack** |
| [Shared](https://www.curseforge.com/wow/addons/spoken-quests-audio-shared) | quests both factions can take | |
| [Gossip](https://www.curseforge.com/wow/addons/spoken-quests-audio-gossip) | NPC gossip chatter | |

Gossip — the chatter NPCs give you when you talk to them without a quest — is optional on top.

<!-- only:wago -->
This pack is not installable from Wago: at several hundred megabytes it is over the upload limit here. Take it from CurseForge, or take all four packs in one download, [All](https://github.com/rusty-key/spoken-wow/releases?q=quests-audio), from GitHub; unzip it into `Interface/AddOns` and the addon finds them.
<!-- /only -->
<!-- only:curseforge -->
If you would rather have one install and not think about it, take **[All](https://www.curseforge.com/wow/addons/spoken-quests-audio-all)** instead. It holds no audio itself - it just tells your addon manager to fetch all four packs.
<!-- /only -->

## Why the pack is split

The whole thing is a large download, and a good part of it is dialogue your character can never reach. A quest belongs to a side when its questgiver does: an NPC hostile to the Alliance and friendly to the Horde hands out Horde quests. Neutral givers land in the Shared pack, so their quests play for everyone.

## What this is

A rework of the original [AI VoiceOver](https://github.com/mrthinger/wow-voiceover) addon, which makes NPCs speak their quest text. Main changes:

- voices are matched per NPC flavor, instead of just race and gender, so an orc grunt and an orc official don't sound alike
- object quests are also voiced now, using a narrator voice
- stage directions (`<Advisor Belgrum opens the note.>`) are read by the narrator
- proper voicing of sounds — `<hic>` produces the sound of a hiccup, not the word
- tons of pronunciation fixes
- more natural-sounding performance
