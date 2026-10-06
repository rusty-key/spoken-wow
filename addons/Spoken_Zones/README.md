**Zone lore on the world map, for WoW Classic Era.** One of [Spoken](https://www.curseforge.com/wow/addons/spoken-player)'s modules: it comes in Spoken's download, beside Spoken Quests and Spoken Books, and narrates through it.

Open the map and the lore of the zone you're looking at appears beside it. Click a named subzone and you get that place's story instead. Optionally, it's read aloud.

## The lore, as of 0.3.0

**The lore text** starts from warcraft.wiki.gg and was rewritten across the whole corpus to describe the world as a vanilla character finds it: post-vanilla world state, quest outcomes told as settled history, and game-mechanical phrasing were taken out, over several full review passes. The wiki is written for a modern reader, though, and with this many places some of it will still slip through. If an entry reads wrong — later-expansion lore, a resolved conflict your character can plainly see unresolved, a fourth-wall break — the **Report** button on the entry is the fastest way to say so; reports decide what gets fixed first.

## What it does

- **Zone Lore** — the current zone's story in a panel of its own beside the map, on the quest log's parchment. Resize it, set the font size, or close it; it stays closed until you reopen it with the map button on the map's edge.
- **Subzone lore** — click any named area on the map to read about it.
- **Hover preview** — point at a subzone for the first lines in a tooltip, without disturbing the panel.
- **Lore of Azeroth** — browse every story without opening the map: Azeroth, its two continents, their zones and each zone's areas, with a search box. From the minimap button, `/spz window`, or the button on Zone Lore.
- **Narration** — a play button beside the lore; what is being read, and what is waiting, shows in the Spoken player with Read and Report beside it.
- **Autoplay** — walking into an area you've never discovered narrates it once, tracked per character. Already explored the world? A setting narrates those areas too, still once each.
- **Works on non-English clients** — subzone lore is found by the name your client reports, so a German, French, Spanish, Portuguese, Russian, Korean or Chinese client reaches it too. The lore text itself is English for now.
- **Report a problem** — a Report button on every entry and on the playback controls. The game can't open a browser, so it hands you a short link to that exact line; the page at the other end has the text, the audio and a form.

## When there is no lore at all

Every place in the game is on the panel, but some of them nobody has written about yet. Open one and the panel says so, with a **Contribute** button right under it. Press it and it gives you a link naming the place; open it in your browser, describe the place in your own words -- what it is, who lives there, what happened there -- and press Send. Rather not see the button? **Hide the Contribute buttons** in the Spoken settings turns it off.

## Narration needs a sound pack

The voice audio is a large download, so it ships separately. **Spoken Zones works fine without one** — you read rather than listen. Without a pack the Play button simply doesn't appear, and nothing is narrated.

Two packs, the same voicelines — and there are a lot of them — differing only in quality:

| Pack | Bitrate | Download |
|---|---|---|
| **Spoken Zones Audio** | 128 kbps | ~450 MB |
| **Spoken Zones Audio 64** | VBR mono | ~220 MB |

Install Spoken Zones Audio unless the download is a problem, in which case Spoken Zones Audio 64 is half the size and close to transparent for speech. With both installed Spoken Zones plays the higher-quality one; `/spz audio` lists what you have and switches between them.

### The voice

As of 0.3.0 every line is recorded with a new narrator, and NPC and place names go through a pronunciation dictionary so they sound the same everywhere they appear. With this many lines some readings will still land flat or a name will come out wrong — press **Report** while you are hearing it; the playback controls carry the button, so you don't have to go and find the entry again. Per-line fixes follow what comes in, and [supporting the project](https://buymeacoffee.com/rustykey) pays for that generation directly.

## Commands

`/spokenzones`, or `/spz` for short.

```
/spz              status for the current zone and subzone
/spz options      open the settings panel
/spz window       open the browsable lore window
/spz panel        toggle the world map panel
/spz hover        toggle the hover preview tooltip
/spz play         read the current lore aloud
/spz voice        toggle narration on or off
/spz audio        list sound packs, or switch between them
/spz lang         list languages, or switch between them
/spz autoplay     toggle narrating areas as you discover them
/spz minimap      show or hide the minimap button
/spz help         the full list
```

## Compatibility

Built for **Classic Era 1.15.9** and the **Anniversary client (2.5.6)**. Not built for retail.

The lore covers vanilla Azeroth, which is where an Anniversary character spends most of their levelling. Outland and the blood elf and draenei starting zones have no lore yet — the panel is empty there rather than wrong.

Spoken Zones and a sound pack work together as long as they share a major version.

## Support

The narration isn't free to make — every line costs money to synthesise. If the addon is worth something to you, [buy me a coffee](https://buymeacoffee.com/rustykey); it goes straight into fixing reported lines.

## Credits

Zone and subzone lore text is derived from [warcraft.wiki.gg](https://warcraft.wiki.gg) and is licensed **CC BY-SA 4.0**, as is the narration generated from it. Thanks to the wiki's contributors — without them this addon is an empty frame.
