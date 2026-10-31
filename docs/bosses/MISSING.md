# What the bosses still lack

As of 2026-10-20. The lists come from `Data/Bosses.lua`, `Data/Creatures.lua` and `Data/Stories.lua`.

Sources checked for every boss below:

- the Forever repack's world database (port 3317), by exact name, by part of the name, and by the
  ids in `pipelines/places/tools/boss-sources.json`;
- Efficient Games' data for every 1.60.1 build (`encounters`, `creature_details`, `creatures`), the
  set `export_compendium.py` pins. It holds 50 encounter records, so a boss missing from it proves
  nothing;
- the client's tables for 1.60.1.70338 (wago.tools). Its Creature table holds only companion pets, and
  its JournalEncounter tables cannot be fetched for this build;
- the retail Adventure Guide (12.1.5), for portraits the client also has.

A boss with no creature id is still found and told by the game's pull and kill (`ENCOUNTER_START`,
`BOSS_KILL`). Inside an instance the client hides a unit's name and GUID, so nothing is known from the
target there. What it lacks is its face.

## How to fill a gap

- Creature id: the sixth part of the boss's GUID. Inside an instance the client hides the GUID, so read
  it from the database or Efficient Games' records, or from the open world for a world boss.
- Portrait: the display Efficient Games' `creature_details` gives for that creature once a player has
  recorded the fight, or the repack's model once its database has the creature. Check that the client's
  CreatureDisplayInfo has it.
- Then add the boss to `pipelines/places/tools/boss-creatures-manual.json` with the evidence, and run
  `boss_creatures.py` and `write-boss-creatures.mjs` (README, "Data"), which write the `boss` table,
  then `make bosses-export`.
- Story: written from the wiki's lore, as the others are (`build-boss-stories.mjs`,
  `apply-boss-stories.mjs` into the `boss_line` table, then `make bosses-export`), Classic-era events only.

## No creature and no portrait (28)

| Dungeon | Bosses | Why |
| --- | --- | --- |
| Blackrock Depths (230) | Ribbly Screwspigot, Plugger Spazzring | The database has both (9543, 9499), each spawned once on the map, but `boss-sources.json` does not yet name them and the creature tools have not been run for them. |
| Demon Fall Canyon (2784) | Grimroot, Destructor's Wraith, Zilbagob, Pyranis, Diathorus the Seeker, Hellscream's Phantom, Azgaloth | The database has no spawns on the map and none of the wiki's ids. Efficient Games recorded no fight there. The database's Diathorus the Seeker (6072) is the Ashenvale elite. |
| Scarlet Enclave (2856) | Beatrix, Beastmaster, Solistrasza, Mason, Reborn Council, Lillian Voss, Caldoran | As for Demon Fall Canyon. The database's Beastmasters (26307, 133390) are retail creatures. |
| Scarlet Enclave (2856) | Balnazzar | The only Balnazzar in the database is Stratholme's (10813), whose model the client lacks. The wiki's id, 240811, is not in the database. |
| Karazhan Crypts (2875) | Harbinger of Sin, Creeping Malison, Dark Rider, Kharon, Unk'omon, Hans and Greta, The Ugly Goblin, Barian Maryla | As for Demon Fall Canyon. The database's Dark Riders (99871 and up) are retail creatures. Efficient Games has Kaigy and Sairuh Maryla, not Barian. |
| City of Dalaran (2959) | Mana Elemental | Efficient Games' encounter 3301 names no creature, and no build has one of that name. The database's 14689 has no spawn and wears Dire Maul's Arcane Aberration model. |
| Ruins of Lordaeron (2999) | Lordaeron Captain | The database's 32414 is a Wrath of the Lich King creature with a model the client lacks. No captain spawned on the map matches; Captain Truman (265701) is there, but not elite. The wiki calls the boss a rare. No creature, dialogue or scripted summon in the repack names it: the boss is on Forever's live server only. The client hides an instance's units from addons, so the target cannot record them. |
| Ruins of Lordaeron (2999) | Viktor the Vile | In neither the database nor Efficient Games. No ghoul spawned on the map matches, and no dialogue or scripted summon names it: the boss is on Forever's live server only. The client hides an instance's units from addons, so the target cannot record them. |

## A creature but no portrait (1)

| Dungeon | Boss | Why |
| --- | --- | --- |
| Stratholme (329) | Crimson Hammersmith | Creature 11120, named Risen Hammersmith in the database. Its model, 34497, is not in the client, and no creature of either name has one the client has. |

## Filled, to confirm in game

| Dungeon | Boss | What was chosen, and why it is not certain |
| --- | --- | --- |
| Ruins of Lordaeron (2999) | The Butcher | The Baron, 250660: the only unclaimed elite there, an abomination casting Ramstein's Trample and Knockout, "Fresh meat for the block!" on aggro. The wiki lists The Baron as the dungeon's abomination boss. Shown as The Baron (`pipelines/lib/boss-names.json`), in English in every language: the database has no other. |
| The Hall of Thanes (3065) | Infurnus | Magmatus, 261316: the only other elite there, a fire elemental. The wiki lists Magmatus among the dungeon's encounters. Shown as Magmatus (`boss-names.json`), in English in every language. |
| Excavation Site: Wetlands (2998) | Highland Horror | 260808, model 9010, by name in Efficient Games. No encounter record. |
| Karazhan Crypts (2875) | Kaigy Maryla, Sairuh Maryla | 256275 and 256273, by name in Efficient Games. The database spawns Kaigy only in the open world (map 0), and the wiki gives other ids (238233, 238213). |

## No story (25)

No story was written for these: neither the Adventure Guide nor the wiki article in `boss-sources.json`
gave lore for them.

| Dungeon | Bosses | Note |
| --- | --- | --- |
| Deadmines (36) | Miner Johnson | |
| Razorfen Downs (129) | Ragglesnout | |
| Blackrock Depths (230) | Ribbly Screwspigot, Plugger Spazzring | Not yet looked for. |
| Stratholme (329) | Skul, Stonespine | |
| Ahn'Qiraj Temple (531) | Viscidus | |
| Karazhan Crypts (2875) | Creeping Malison, Hans and Greta, The Ugly Goblin, Barian Maryla | The wiki has event pages (Opera of Malediction, The Failed Apprentice), not the bosses'. |
| City of Dalaran (2959) | Arcane Anomaly, Fel Ancient, Mana Devourer, Mana Elemental, Unstable Sentinel, Shade of the Archmage, Lyn the Ignored | The wiki has only the dungeon's page. |
| Excavation Site: Wetlands (2998) | Saltspine, Shadetooth, Relic Guardian | The wiki has only the dungeon's page. |
| Ruins of Lordaeron (2999) | The Butcher, Lordaeron Captain | The wiki's Othmar Garithos article says The Baron is Garithos, raised as an abomination: The Butcher's story can come from it. |
| The Hall of Thanes (3065) | Infurnus, Plunder | The wiki has only the dungeon's page. |

## Stories to look at again

Four stories touch on lore from after Classic. None tells events of a later expansion; each is a
judgement call.

| Boss | Stories.lua | What to check |
| --- | --- | --- |
| Edwin VanCleef (36) | line 29 | "learned a rogue's trade alongside his childhood friend Mathias Shaw": the friendship looks like later lore. Not verified. |
| Lethon (2832) | line 316 | "he wields the Void": Classic Lethon casts shadow; the Void is later framing. |
| Lillian Voss (2856) | line 325 | Lillian Voss and Putress come from Cataclysm and Wrath of the Lich King. Season of Discovery reuses both, and the story tells nothing of their later fates. |
| Baron Geddon, Ragnaros (409) | lines 219, 226 | "the Firelands": the name predates Cataclysm in the tabletop books, but players know it from the Cataclysm raid. |

Three Emerald Dragons are filed under one zone (`bossZones` in `pipelines/lib/dungeons.json`) while
their story says they first appear in another. Ysondre agrees.

| Dragon | Story says (Stories.lua) | Filed under |
| --- | --- | --- |
| Emeriss | Ashenvale, Bough Shadow (315) | Duskwood |
| Lethon | Duskwood, Twilight Grove (316) | Feralas |
| Taerar | Feralas, Dream Bough (317) | Ashenvale |
