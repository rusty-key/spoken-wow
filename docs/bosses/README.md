# Spoken Bosses

The bosses of the dungeons and raids and their stories, in Azeroth's Compendium: a Bosses tab after
the Readables', laid out as the Places tab is.

## The tab

A banner for each continent, a card for each of its dungeons and raids by name, and its bosses under
an opened dungeon. World bosses have no card: each is listed straight under the continent of the zone
it stands in, after the dungeons, by name. Zones are not listed; a dungeon's page names the zone of its
entrance, a city's dungeons (the Stockade, Ragefire Chasm) the zone around the city. After the
continents, Other Lands holds the dungeons in a zone on none. Each dungeon has a badge of
its own (`DUNGEON_ICONS` in `addons/Spoken/API.lua`, every name in Forever's file list).

A boss is found when its fight starts (`ENCOUNTER_START`) or is won (`ENCOUNTER_END` with success,
`BOSS_KILL`), by any difficulty's encounter id from the `ids` of `Data/Bosses.lua`, kept per character in
`SpokenBossesCharacter`. A world boss (`worldBosses` in `addons/Spoken/Data/Dungeons.lua`), whose fight
starts no encounter in Forever, is found when it dies after the player targeted it alive or saw its
nameplate: `Story.lua` keeps its GUID, as the client clears the target as the boss dies but still
reports it, dead, on a nameplate or the soft target (`UNIT_HEALTH`, and once a second `UnitTokenFromGUID`).
One not found is greyed with a padlock and its page says so, until Unlock Unfound Bosses is on (Spoken's page; `SpokenBossesSettings`).
Dungeons and banners count bosses found out of all, with the share and the bar, as the other tabs
do; Found Only, on by default, leaves out what holds none found. A found boss's page names its dungeon and zone and
tells its story, or says it is not written yet; a boss with a creature in `Data/Creatures.lua` has its portrait at the left of its name.
The search finds bosses and dungeons by name.

A boss's story also shows in Spoken's narrator (`Story.lua`), when the boss is
killed: `ENCOUNTER_END` with success, or `BOSS_KILL`, as Forever reports a won dungeon fight as
`ENCOUNTER_END` with success 0. There is no setting for it. Targeting cannot show it in an instance: the
client hides a unit's GUID, name and model from addons there, so no boss is known from the target. A
world boss is told by its death instead, as Forever sends no kill for it (seen with Lord Kazzak).
An instance boss the game announces no fight for (Baron Aquanis, Ribbly, Plugger) is not found or told:
the client hides its GUID there.
Each story shows once per character (`SpokenBossesCharacter.storiesRead`, noted when it starts), until
Forget Stories Shown. A story
is low priority, as gossip is: a voiced line arriving drops it while it waits, and it shows the next time. The stories are a part of
Spoken's, "bosses": What Spoken Reads turns them off, and a story shown as words only is not queued
where the narrator would not show it (`Spoken:ShowsNarratorFor`, Voice Only or Show Narrator off). A
voiced one is heard there all the same, as every voiced line is.

A story is voiced where an installed `SpokenBossesAudio` pack has its clip (`Audio.lua`): a pack in
Spoken's voice language first, else one in If a Voice Is Missing's language (none with Stay Silent).
Between packs of one language the higher bitrate wins, then the folder name; there is no saved choice.
The narrator times the words to the recording only where the story is shown in the pack's language.
Where no pack has the clip, the story is words alone (`textOnly`), shown for its reading time even with
the sound off.
Opened, the tab lands on the dungeon the player is in, else the continent.

The Dungeons and Raids come from `addons/Spoken/Data/Dungeons.lua`, which every tab shares
([COMPENDIUM.md](../places/COMPENDIUM.md)).

## Data

`Data/Bosses.lua`, `Data/Creatures.lua` and `Data/Stories.lua` are exports of the boss tables in the
site's database (`boss_instance`, `boss`, `boss_line` and the boss names in `entity_name`), written by
`make bosses-export` and compared with the tables by `make bosses-check`. They are committed so the addon
builds without Postgres; edit the tables, not the files. Where the data lives, how the tools write it,
and how bosses are matched and retired: [BOSSES.md](../places/BOSSES.md).

The bosses come from `pipelines/lib/bosses.mjs` (`make bosses-extract`), which writes the tables from the client's
`DungeonEncounter` table (Forever's build, wago.tools), for each instance map in
`pipelines/lib/dungeons.json`: the bosses in Forever's order (the client's difficulty 0 and 1 rows, a
boss only other difficulties list after them; Forever splits a dungeon's bosses over both on one scale),
each once, named as the difficulty that lists the most of them names it, with its name in every language
(retail's `DungeonEncounter`, by id or else English name, where wago has no strings of Forever's in a
language, as for Italian) and a `key` (its English name lowercased, without
punctuation). The client lists a boss for each difficulty, the Season of Discovery's raid-sized
Blackfathom Deeps, Gnomeregan and Sunken Temple among them; a "A and B" row is dropped where A or B is
a boss on its own, and a name the client spells two ways is one boss (`SAME`).

A boss's creature and model come from `pipelines/places/tools/boss_creatures.py` and
`write-boss-creatures.mjs`, which writes them to the `boss` table, with the wiki page and creature ids found for each boss in `pipelines/places/tools/boss-sources.json`. A boss's creature is the one of its name spawned on its map in the repack's database, else
the Classic creature of that name (a boss a script spawns, like Ragnaros); its portrait is that creature's model, else the
Adventure Guide's where Forever's client has the model. A model the client does not have is dropped, so the boss
shows the unknown boss's question mark rather than an empty portrait. Where the database has the creature under another name than the
encounter's (The Butcher is the game's The Baron, Infurnus its Magmatus, named so in the list: `pipelines/lib/boss-names.json`) or does not spawn it, its id is a hint in
`boss-sources.json`, and a boss whose only match is a namesake from another dungeon is marked `noNameMatch` there.
Where the database has no such creature at all, or Forever draws the boss with another model,
`boss-creatures-manual.json` gives the creature and model, with the evidence for each. The bosses still without a
creature, a portrait or a story, and why, are in [MISSING.md](MISSING.md).

`Data/Stories.lua` holds `SpokenBossStories[map][key]`, the words of a boss's story, from the `boss_line`
table (`apply-boss-stories.mjs` records them). A boss with no entry says its story is not written yet.

## What the sources hold

- The client's table has the 29 dungeons and raids of the Dungeons table and eight more maps Forever
  has, now listed under the zone of their entrance (`pipelines/lib/dungeons.json`): Demon Fall Canyon
  (Ashenvale), The Tainted Scar (Lord Kazzak, Blasted Lands), Storm Cliffs (Azuregos, Azshara), The
  Crystal Vale (Prince Thunderaan, Silithus), Nightmare Grove (the Emerald Dragons, each under its
  own zone by `bossZones`: Emeriss in Duskwood, Lethon in Feralas, Taerar in Ashenvale, Ysondre in
  The Hinterlands), Scarlet Enclave (filed under Eastern Plaguelands), Karazhan Crypts (Deadwind Pass) and
  Excavation Site: Wetlands. The four world-boss maps (`worldBosses` in `dungeons.json`) have no
  card: the continent lists the boss directly (Eastern Kingdoms, then Lord Kazzak). Maps 13, 2720, 2921 and 3002 hold test or unnamed encounters and are
  left out. The world database has no entrance triggers for any of them: the zones come from the
  client's area names where they have one (Ashenvale, Blasted Lands, Silithus, Wetlands) and from
  the place the boss is known in otherwise.
- Encounters the client lists that no Forever guide shows as a boss of the dungeon are left out
  (`UNCONFIRMED` in `pipelines/lib/bosses.mjs`): Mechanical Menagerie, Festering Rotslime, Atal'ai
  Defenders, The Vault, The Molten Core, Three Little Wolves and Mana Wraith. One goes back in when a
  source confirms it.
- The vmangos-style world database of the Forever repack (`world`, port 3317, the one `make compendium`
  reads) has 21,116 `creature_text` lines. 240 of the 267 bosses match a `creature_template` by name, and
  111 of them have lines of their own to say.
- Efficient Games' open data (EG Link, CC BY 4.0) has, per Forever build, `encounters` (pulls, kills,
  the creatures of each fight, where it begins) and `creatures` (the spells each casts), and the lines
  NPCs say in each language (`broadcast_text`).
- None holds a boss's lore. A story is the wiki's lore, as the places' are.

## Checks

```sh
make bosses-check                        # the three Data files match the boss tables (needs DATABASE_URL)
node pipelines/lib/bosses.mjs --check    # the boss tables are what the client's table gives (needs DATABASE_URL)
pnpm --filter @spoken/places-pipeline test
node --test pipelines/lib/bosses.test.mjs
luajit tests/lua/bosses_test.lua
```
