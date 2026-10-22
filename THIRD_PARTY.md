# Third-party code and content

`LICENSE` is an MIT grant over the code this project wrote. It is not a grant over
anything on this page. Three different things are here for three different reasons,
and they are not interchangeable.

## Vendored Lua libraries

Spoken and Spoken_Quests ship the libraries they load, because a WoW addon has
no package manager: the client loads what is in the folder. They are unmodified copies, and are
found under `addons/<Addon>/Libs/`. Spoken_Places, Spoken_Readables and Spoken_Developer ship
none; they use Spoken's.

| Library | Used by | License |
|---|---|---|
| LibStub | Spoken, Spoken_Quests | Public domain (stated in the file header) |
| CallbackHandler-1.0 | the same two | [Ace3 license](https://www.wowace.com/projects/ace3) — BSD-style, free use with attribution |
| Ace3: AceAddon, AceConsole, AceDBOptions, AceEvent, AceGUI-3.0, AceConfig-3.0 | Spoken_Quests | [Ace3 license](https://www.wowace.com/projects/ace3) |
| Ace3: AceDB, AceTimer | Spoken, Spoken_Quests | [Ace3 license](https://www.wowace.com/projects/ace3) |
| LibDataBroker-1.1 | Spoken | Public domain / CC0, per its project page; the copy carries a README and no license text |
| LibDBIcon-1.0 | Spoken | Public domain, by Rabbit, per its project page; the file header states no license |
| [LibDeflate](https://github.com/SafeteeWoW/LibDeflate) 1.0.2-release | Spoken | zlib License (`Libs/LibDeflate/LICENSE.txt`) |

Only LibDeflate has its license text beside it so far. The Ace3 copies carry no license text, and
of the others only LibStub's header states its terms. The Ace3 license and the two public-domain
claims above come from the upstream project pages, not from files in this tree; check them
before relying on them.

If you are vendoring a new library, put its upstream license text beside it rather than
only adding a row here.

## The addons' own lineage

**Spoken Quests** began as a fork of **AI VoiceOver** (`AI_VoiceOver_Continued`), an
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
- **Zone and subzone lore prose** in `addons/Spoken_Places/Data/` is derived from
  [Warcraft Wiki](https://warcraft.wiki.gg), which publishes under
  **CC BY-SA 4.0**. Re-use of that text carries the same terms, including attribution
  and share-alike. `pipelines/zones/tools/scrape.mjs` is what fetches it and records
  which article each line came from.
- **Boss and dungeon stories** (`addons/Spoken_NPCs/Data/Stories.lua`) are written from
  Blizzard's Adventure Guide text and from Warcraft Wiki (**CC BY-SA 4.0**), rewritten
  into one voice. The file is committed;
  `pipelines/zones/tools/build-boss-stories.mjs`, `boss-history.mjs` and
  `assemble-boss-stories.mjs` make it, and `apply-boss-stories.mjs` writes it. Where the guide has no text
  for a boss, the story is that boss's History section on Warcraft Wiki, kept to Classic.
  The Forever-only dungeons' stories come from the quest text in Efficient Games' EG Link output
  (CC BY 4.0, see below), and the checks of the others use the vmangos quest corpus.
- **Book, letter and in-world text** for Spoken_Readables comes from the same vmangos
  extraction as the quest corpus, and is likewise Blizzard's.
- **Where each readable is** (`addons/Spoken_Readables/Data/Places.lua`): the spawns, loot, quests
  and vendors that place a book, letter or plaque, and the names of the creatures, quests and
  objects involved, are read from a [TrinityCore](https://github.com/TrinityCore/TrinityCore)
  world database (the one the Forever repack ships), another community reconstruction of
  Blizzard's content; the zone each spawn stands in is worked out against the client's own map
  tables, from [wago.tools](https://wago.tools). `pipelines/books/tools/places.mjs` is what reads both.
- **Italian quest, gossip and book text** comes from QuestIT, an Italian community
  translation by Drakanast whose addon code is MIT-licensed; the quest text it translates
  is Blizzard's. `pipelines/quests/tools/import_questit.py` imports it.
- **BroadcastText rows from the Forever beta** (the `broadcast_text` table) partly come from
  [EG Link output](https://github.com/JIVESCORP/eg-link-output-wowf) by JIVESCORP, published
  under **CC BY 4.0**; the text itself is Blizzard's.
- **Where Forever's quests are filed, who may take them and which quest follows which**
  (`addons/Spoken_Quests/Data/Compendium.lua`), where the world DB has none of it, and the amount
  a Craftsman's Writ asks for (`Data/QuestText.lua`), come from the quest and NPC data players'
  Forever clients recorded.
  Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.
  `pipelines/quests/tools/export_compendium.py` reads it from
  [EG Link output](https://github.com/JIVESCORP/eg-link-output-wowf).
- Text submitted through `/contribute` is game text as well: a player's client is showing it and
  they are sending a copy. It sits on the same footing as the corpus above, and the same terms
  apply to it.
- **Map images, portrait frames and icons** derived from game assets
  (`PortraitFrameAtlas`, the continent maps) are Blizzard's.
- **The older `.blp` textures** came with the AI VoiceOver fork, as it shipped them: in
  `addons/Spoken/Textures/` `BackgroundGradient`, `Book`, `MinimapButton`, `PortraitFrameAtlas`,
  `PortraitFrameBackground` and `SettingsButton` (`SettingsButtonSoft` is the same ring with its middle
  at 90%); in `Spoken_Quests/Textures/` `QuestLogPlayButton`,
  `QuestLogStopButton`, `StopGossip`, `StopGossipMore` and the four `SoundQueueBullet*` files.
  `git log --follow` takes each back to the AI VoiceOver import. The game art in them is
  Blizzard's.
- **Addon-list icons** (`icon.tga` in Spoken, Spoken_Quests, Spoken_Developer and
  SpokenContributions, `Textures/AddonIcon.tga` in
  Spoken_Readables, Spoken_Places and the two sound packs, and the badged copies the language
  packs ship): the Spoken shields, drawn for this project by Nucabe, from the sources in `pipelines/quests/assets/icon/`, `pipelines/books/assets/` and
  `pipelines/zones/assets/`.
- **Round vignette** (`addons/Spoken/Textures/RoundVignette.tga`): a black alpha gradient made for
  this project.
- **Zone icons** (`addons/Spoken/Textures/Zones/*.tga`): the game's zone achievement icons and the
  world map's globe, copied from the game's files so every client has them; the pictures for
  Spoken Places' lines. They are Blizzard's. Forever's own zones, which have no icon in the game
  (Zephras Isle, Darkspear Islands, Riverglades, Shen'dralas), have icons made for this project
  in the same style. The cities, Moonglade, and Dalaran in `Textures/Dungeons`, have icons made for this
  project in the same style. The battlegrounds have their icons from the retail game (the Dungeon
  Finder's for Arathi Basin and Warsong Gulch, the Win Alterac Valley achievement's for Alterac Valley).
- **Dungeon icons** (`addons/Spoken/Textures/Dungeons/*.tga`): the Dungeon Finder's icons of the
  retail game (`Interface\LFGFrame\LFGIcon-*`) and Dun Morogh's zone icon (for the Hall of Thanes),
  copied from the game's files so every client has them. They are
  Blizzard's.
- **Zone pictures** (`addons/Spoken_Places/Textures/Pictures/*.blp`): screenshots of the game,
  chosen by hand, mostly from each place's [Warcraft Wiki](https://warcraft.wiki.gg) page, cleaned
  up and sharpened with Gemini 3.1 Flash Image, then cropped, tinted and edged by
  `pipelines/zones/tools/pictures/prepare.py`. The game in them is Blizzard's; each picture's
  source file is listed in that folder's `CREDITS.md`, whose wiki page gives its uploader and
  terms. The edge masks (`Mask*.blp`) are made for this project.
- **Lore page art** (`addons/Spoken_Places/Textures/Art/*.tga`): the spellbook's parchment,
  divider and backplate, and the quest log's details page and frame, cut from the game's UI
  files (Forever client) so the page looks the same on every client. They are Blizzard's.
- **Small window parchment** (`addons/Spoken/Textures/MinimalParchment.tga`): a band of the same
  spellbook page, cut to the small window's shape. Blizzard's.
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
- **The Thrall Easter egg** (`addons/Spoken_Quests/Sounds/og-thrall.mp3`) is AI VoiceOver's
  reading of a Thrall line, upstream's file byte for byte. The line's text is Blizzard's. The
  terms for the recording itself are upstream's, which this repository does not record.
- **The generated audio** is synthesised by [ElevenLabs](https://elevenlabs.io) and
  [fish.audio](https://fish.audio) from the text above. It is distributed through the
  sound-pack addons and is not in this repository; the terms that apply are those
  providers' and Blizzard's, not this project's.

This project is a fan work. It is not affiliated with, endorsed by, or sponsored by
Blizzard Entertainment. World of Warcraft and Blizzard Entertainment are trademarks or
registered trademarks of Blizzard Entertainment, Inc.
