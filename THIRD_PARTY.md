# Third-party code and content

`LICENSE` is an MIT grant over the code this project wrote. It is not a grant over
anything on this page. Three different things are here for three different reasons,
and they are not interchangeable.

## Vendored Lua libraries

Every addon ships the libraries it loads, because a WoW addon has no package manager:
the client loads what is in the folder. They are unmodified copies, and are found under
`addons/<Addon>/Libs/` — plus `addons/<Addon>/<client>/Libs/` for the 1.12, 2.4.3 and
3.3.5 clients, which need their own build of Ace3.

| Library | Used by | License |
|---|---|---|
| LibStub | every addon | Public domain (stated in the file header) |
| CallbackHandler-1.0 | Ace3 consumers, LibDataBroker | [Ace3 license](https://www.wowace.com/projects/ace3) — BSD-style, free use with attribution |
| Ace3 (AceAddon, AceConsole, AceDB, AceDBOptions, AceEvent, AceTimer, AceGUI-3.0, AceConfig-3.0, AceCore-3.0) | SpokenQuests, Spoken | [Ace3 license](https://www.wowace.com/projects/ace3) |
| LibDataBroker-1.1 | Spoken, SpokenZones | Public domain / CC0, per its project page |
| LibDBIcon-1.0 | Spoken, SpokenZones | Public domain, by Rabbit |
| [LibDeflate](https://github.com/SafeteeWoW/LibDeflate) 1.0.2-release | Spoken | zlib License (`Libs/LibDeflate/LICENSE.txt`) |

If you are vendoring a new library, put its upstream license text beside it rather than
only adding a row here.

## The addons' own lineage

**SpokenQuests** began as a fork of **AI VoiceOver** (`AI_VoiceOver_Continued`), an
addon by Mrthinger and its later maintainers, and still carries structure from it —
the sound queue and the data-module loader most visibly. The fork adapted the removed
global addon-management APIs to `C_AddOns` and the gossip APIs to `C_GossipInfo`, was
renamed `VoiceOverRedux`, then `SpokenQuests`, and is `Spoken_Quests` today. Its sound packs deliberately
stay loadable by upstream's player, and upstream's packs stay loadable by this one.

**Spoken**'s sound queue is a port of that same queue, generalised so that
several feature addons share one window.

## Game text, lore and artwork

None of this is the project's to license, and the MIT grant does not reach it.

- **Quest and gossip text, creature and zone names, and every id the corpus is keyed
  on** are © Blizzard Entertainment. They are extracted from a [vmangos](https://github.com/vmangos/core)
  world database, which is itself a community reconstruction of that content. The
  extraction lives in `pipelines/quests/`; the exported reference tables under
  `pipelines/quests/assets/sql/exported/` come from the same place.
- **Zone and subzone lore prose** in `addons/Spoken_Zones/Data/` is derived from
  [Warcraft Wiki](https://warcraft.wiki.gg), which publishes under
  **CC BY-SA 4.0**. Re-use of that text carries the same terms, including attribution
  and share-alike. `pipelines/zones/tools/scrape.mjs` is what fetches it and records
  which article each line came from.
- **Book, letter and in-world text** for SpokenBooks comes from the same vmangos
  extraction as the quest corpus, and is likewise Blizzard's.
- **Italian quest, gossip and book text** comes from QuestIT, an Italian community
  translation by Drakanast whose addon code is MIT-licensed; the quest text it translates
  is Blizzard's. `pipelines/quests/tools/import_questit.py` imports it.
- Text submitted through `/contribute` is game text as well: a player's client is showing it and
  they are sending a copy. It sits on the same footing as the corpus above, and the same terms
  apply to it.
- **Map images, portrait frames and icons** derived from game assets
  (`PortraitFrameAtlas`, the continent maps) are Blizzard's.
- **Zone icons** (`addons/Spoken/Textures/Zones/*.tga`): the game's zone achievement icons and the
  world map's globe, copied from the game's files so every client has them; the pictures for
  Spoken Zones' lines. They are Blizzard's. Forever's own zones, which have no icon in the game
  (Zephras Isle, Darkspear Islands, Riverglades, Shen'dralas), have icons made for this project
  in the same style.
- **Zone pictures** (`addons/Spoken_Zones/Textures/Pictures/*.blp`): screenshots of the game,
  chosen by hand, mostly from each place's [Warcraft Wiki](https://warcraft.wiki.gg) page, cleaned
  up and sharpened with Gemini 3.1 Flash Image, then cropped, tinted and edged by
  `pipelines/zones/tools/pictures/prepare.py`. The game in them is Blizzard's; each picture's
  source file is listed in that folder's `CREDITS.md`, whose wiki page gives its uploader and
  terms. The edge masks (`Mask*.blp`) are made for this project.
- **Lore page art** (`addons/Spoken_Zones/Textures/Art/*.tga`): the spellbook's parchment,
  divider and backplate, and the quest log's details page and frame, cut from the game's UI
  files (Forever client) so the page looks the same on every client. They are Blizzard's.
- **Subtitle background and progress line** (`addons/Spoken/Textures/SubtitleBand.tga`,
  `SubtitleLine.tga`): the band shade and the line's gold fill from shorley's
  [Spoken Subtitles](https://github.com/shorley-gm/spoken-subtitles) (MIT), used as they are
  there.
- **Stop and Replay glyphs** (`addons/Spoken/Textures/GlyphStop.tga`, `GlyphReplay.tga`): drawn
  for this project in the gold of the player's play and pause glyphs; Stop is built from the
  pause glyph's bar.
- **Link icons** (`addons/Spoken/Textures/Link*.tga`): the GitHub, Discord, CurseForge, Wago and
  Buy Me a Coffee logos, each on a square of its brand colour. GitHub's and Discord's shapes come
  from [Dashboard Icons](https://github.com/homarr-labs/dashboard-icons), CurseForge's and Buy Me
  a Coffee's from [Simple Icons](https://github.com/simple-icons/simple-icons) (CC0), Wago's from
  the logo on addons.wago.io. The logos are trademarks of GitHub, Inc., Discord Inc., Overwolf
  (CurseForge), Wago and Buy Me a Coffee, used only to link to those sites.
- **Minimal Classic player textures** (`addons/Spoken/Textures/Minimal*.tga`)
  also derive from Blizzard UI artwork. Sources and adaptations are listed in
  [`docs/minimal-classic/ARTWORK.md`](docs/minimal-classic/ARTWORK.md).
- **The generated audio** is synthesised by [ElevenLabs](https://elevenlabs.io) and
  [fish.audio](https://fish.audio) from the text above. It is distributed through the
  sound-pack addons and is not in this repository; the terms that apply are those
  providers' and Blizzard's, not this project's.

This project is a fan work. It is not affiliated with, endorsed by, or sponsored by
Blizzard Entertainment. World of Warcraft and Blizzard Entertainment are trademarks or
registered trademarks of Blizzard Entertainment, Inc.
