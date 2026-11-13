---
curseforge: 1660202
wago: XKqA45Ky
release: quests-audio-gossip
section: quests
lang: enUS
pack: gossip
github: false
slug: spoken-audio-gossip
name: Spoken Audio: Gossip
summary: NPC gossip chatter, voiced. Optional extra for any of the quest packs. Needs Spoken.
categories:
  - Audio & Video
  - Roleplay
  - Quests & Leveling
license: MIT
---

Voiced NPC gossip — the chatter you get when you talk to someone without a quest to hand in.

Innkeepers, guards, faction quartermasters and the rest saying their piece out loud, in the same voices they use for quests. Purely extra: it adds nothing to a quest you were already hearing, and it costs nothing to skip.

**You need the player and at least one quest pack for any of this to work:**

1. **[Spoken](https://www.curseforge.com/wow/addons/spoken)** — the player. Without it no pack plays.
2. Your quest audio — **[Alliance](https://www.curseforge.com/wow/addons/spoken-audio-quests-alliance)** or **[Horde](https://www.curseforge.com/wow/addons/spoken-audio-quests-horde)**, plus **[Shared](https://www.curseforge.com/wow/addons/spoken-audio-quests-shared)**.

## The packs

| Pack | Holds | |
| --- | --- | --- |
<!-- only:curseforge -->
| [All](https://www.curseforge.com/wow/addons/spoken-audio-quests-all) | installs the four below | |
<!-- /only -->
| [Alliance](https://www.curseforge.com/wow/addons/spoken-audio-quests-alliance) | Alliance-only quests | |
| [Horde](https://www.curseforge.com/wow/addons/spoken-audio-quests-horde) | Horde-only quests | |
| [Shared](https://www.curseforge.com/wow/addons/spoken-audio-quests-shared) | quests both factions can take | |
| **Gossip** | NPC gossip chatter | **this pack** |

Gossip is not split by faction: an NPC greets whoever walks up, so one pack serves both sides.

<!-- only:wago -->
This pack is not installable from Wago: at several hundred megabytes it is over the upload limit here. Take it from CurseForge, or take all four packs in one download, [All](https://github.com/rusty-key/spoken-wow/releases?q=quests-audio), from GitHub; unzip it into `Interface/AddOns` and the addon finds them.
<!-- /only -->
<!-- only:curseforge -->
If you would rather have one install and not think about it, take **[All](https://www.curseforge.com/wow/addons/spoken-audio-quests-all)** instead. It holds no audio itself - it just tells your addon manager to fetch all four packs, this one included.
<!-- /only -->

## What this is

A rework of the original [AI VoiceOver](https://github.com/mrthinger/wow-voiceover) addon, which makes NPCs speak their quest text. Main changes:

- voices are matched per NPC flavor, instead of just race and gender, so a dwarf warrior and a dwarf official don't sound alike
- object quests are also voiced now, using a narrator voice
- stage directions (`<Advisor Belgrum opens the note.>`) are read by the narrator
- proper voicing of sounds — `<hic>` produces the sound of a hiccup, not the word
- tons of pronunciation fixes
- more natural-sounding performance
