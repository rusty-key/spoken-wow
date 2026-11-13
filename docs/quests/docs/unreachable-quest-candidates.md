# Quests that may be unreachable in game

Candidates only. **Nothing here is ignored yet** - each entry is a claim by
[Questie's quest blacklist](https://github.com/Questie/Questie/blob/master/Database/Corrections/QuestieQuestBlacklist.lua),
which is curated by hand against the live Classic Era client, and it is worth one look before
a line goes quiet. Tick **ignore** on the rows you agree with; the reason column is the
sentence to paste in.

How this list was made: take every plain `[id] = true` entry from that file whose comment says
removed, not in the game, UNUSED, NYI or duplicate, and intersect with the corpus. Most of that
blacklist is *not* about reachability - 597 of its ids are corpus quests, but the bulk are world
events, the war effort, AQ and battlegrounds, all of which a player really can do. Those are
hidden from Questie's map, not missing from the game.

`tools/scan_unreachable_quests.py` answers the same question from the vmangos world DB, which
is the authority rather than a third party's list - its findings are the last section here.
Where the two agree the case is closed; where only one of them claims something, read the
quest first.

Counts are corpus lines and how many of them already have audio in the local store.


## Not in the game

| Quest | Title | Lines | Audio | Reason |
| --- | --- | --- | --- | --- |
| [787](https://spoken.rusty.one/quests?q=787&filter=quest&progress=1) | The New Horde | 2 | 2 | Eitrigg does not offer it. Questie #830 |
| [6606](https://spoken.rusty.one/quests?q=6606&filter=quest&progress=1) | A Little Luck | 3 | 3 | Not in the game. Questie #1338 |
| [6072](https://spoken.rusty.one/quests?q=6072&filter=quest&progress=1) | The Hunter's Path | 2 | 2 | Ayanna Everstride does not start it. Questie #700 |
| [7668](https://spoken.rusty.one/quests?q=7668&filter=quest&progress=1) | The Darkreaver Menace | 3 | 2 | Replaced by 8258 in phase 4. Questie #1805 |
| [1155](https://spoken.rusty.one/quests?q=1155&filter=quest&progress=1) | <NYI> <TXT> bug crystal side quest | 1 | 0 | Never implemented; the text is the single letter "x" |

- 787: `q:787:accept`, `q:787:complete`
- 6606: `q:6606:accept`, `q:6606:accept`, `q:6606:complete`
- 6072: `q:6072:accept`, `q:6072:complete`
- 7668: `q:7668:accept`, `q:7668:complete`, `q:7668:progress`
- 1155: `q:1155:accept`


## Blizzard's own debris

| Quest | Title | Lines | Audio | Reason |
| --- | --- | --- | --- | --- |
| [1](https://spoken.rusty.one/quests?q=1&filter=quest&progress=1) | The "Chow" Quest (123)aa | 1 | 0 | A test quest. Already ignored by migration 0017 |
| [3482](https://spoken.rusty.one/quests?q=3482&filter=quest&progress=1) | <NYI> <TXT> The Pocked Black Box | 1 | 0 | Never implemented |
| [620](https://spoken.rusty.one/quests?q=620&filter=quest&progress=1) | The Monogrammed Sash | 1 | 0 | Marked UNUSED |

- 1: `q:1:accept`
- 3482: `q:3482:accept`
- 620: `q:620:accept`


## Duplicate of a quest that is in the game

| Quest | Title | Lines | Audio | Reason |
| --- | --- | --- | --- | --- |
| [7462](https://spoken.rusty.one/quests?q=7462&filter=quest&progress=1) | The Treasure of the Shen'dralar | 1 | 0 | Duplicate of 7877, which the corpus has. Questie #1583 |
| [615](https://spoken.rusty.one/quests?q=615&filter=quest&progress=1) | The Captain's Cutlass | 1 | 1 | Duplicate of 8553, which the corpus has. Questie #2215 |
| [618](https://spoken.rusty.one/quests?q=618&filter=quest&progress=1) | Facing Negolash | 1 | 1 | Duplicate of 8554, which the corpus has |
| [934](https://spoken.rusty.one/quests?q=934&filter=quest&progress=1) | Crown of the Earth | 3 | 2 | Duplicate of 7383, which the corpus has. Questie #2386 |
| [4601](https://spoken.rusty.one/quests?q=4601&filter=quest&progress=1) | The Sparklematic 5200! | 3 | 0 | Duplicate of 2951, which the corpus has |
| [4602](https://spoken.rusty.one/quests?q=4602&filter=quest&progress=1) | The Sparklematic 5200! | 3 | 0 | Duplicate of 2951, which the corpus has |
| [4603](https://spoken.rusty.one/quests?q=4603&filter=quest&progress=1) | More Sparklematic Action | 2 | 0 | Duplicate of 2953, which the corpus has |
| [4604](https://spoken.rusty.one/quests?q=4604&filter=quest&progress=1) | More Sparklematic Action | 2 | 0 | Duplicate of 2953, which the corpus has |
| [4605](https://spoken.rusty.one/quests?q=4605&filter=quest&progress=1) | The Sparklematic 5200! | 1 | 0 | Duplicate of 2952, which the corpus has |
| [4606](https://spoken.rusty.one/quests?q=4606&filter=quest&progress=1) | The Sparklematic 5200! | 1 | 0 | Duplicate of 2952, which the corpus has |

- 7462: `q:7462:complete`
- 615: `q:615:complete`
- 618: `q:618:accept`
- 934: `q:934:accept`, `q:934:complete`, `q:934:progress`
- 4601: `q:4601:accept`, `q:4601:complete`, `q:4601:progress`
- 4602: `q:4602:accept`, `q:4602:complete`, `q:4602:progress`
- 4603: `q:4603:complete`, `q:4603:progress`
- 4604: `q:4604:complete`, `q:4604:progress`
- 4605: `q:4605:complete`
- 4606: `q:4606:complete`


## Blacklisted with no reason given — check before ignoring

| Quest | Title | Lines | Audio | Reason |
| --- | --- | --- | --- | --- |
| [8556](https://spoken.rusty.one/quests?q=8556&filter=quest&progress=1) | Signet of Unyielding Strength | 3 | 2 | Signet of Unyielding Strength |
| [8557](https://spoken.rusty.one/quests?q=8557&filter=quest&progress=1) | Drape of Unyielding Strength | 3 | 2 | Drape of Unyielding Strength |
| [8558](https://spoken.rusty.one/quests?q=8558&filter=quest&progress=1) | Sickle of Unyielding Strength | 3 | 2 | Sickle of Unyielding Strength |

- 8556: `q:8556:accept`, `q:8556:complete`, `q:8556:progress`
- 8557: `q:8557:accept`, `q:8557:complete`, `q:8557:progress`
- 8558: `q:8558:accept`, `q:8558:complete`, `q:8558:progress`

## What the world DB says

From `python3 tools/scan_unreachable_quests.py` against the vmangos dump at patch 10 (1.12).
Nine quests, and the two lists agree on 615 and 618 - Questie calls them duplicates, vmangos
says their questgiver relations are out of patch. Both are safe to ignore.

| Quest | Title | Lines | Reason | How sure |
| --- | --- | --- | --- | --- |
| 236 | Awaiting Word | 1 | every questgiver relation is outside patch 10 | certain |
| 615 | The Captain's Cutlass | 1 | every questgiver relation is outside patch 10 | certain |
| 618 | Facing Negolash | 1 | every questgiver relation is outside patch 10 | certain |
| 2399 | The Sprouted Fronds | 1 | no questgiver spawns at patch 10 | likely |
| 2701 | Heroes of Old | 2 | no questgiver spawns at patch 10 | likely |
| 4742 | Seal of Ascension | 3 | no questgiver spawns at patch 10 | likely |
| 4743 | Seal of Ascension | 3 | no questgiver spawns at patch 10 | likely |
| 6846 | Begin the Attack! | 2 | no questgiver spawns at patch 10 | likely |
| 6901 | Launch the Attack! | 2 | no questgiver spawns at patch 10 | likely |

**Read the `likely` ones before ignoring them.** 6846 and 6901 are Alterac Valley quests whose
questgivers the battleground's own scripts put in the world, and the Seal of Ascension giver is
summoned - none of them is in the `creature` table, and all of them are reachable. That is the
known blind spot of the spawn gate, not a bug in the scan.

Also worth noting: Questie hides 236 in Era for its own reasons, which is a third agreement.

`--gossip` adds 47 NPCs and 88 gossip lines, all of them `likely`, and none is listed here on
purpose: the ones spot-checked are script-spawned rather than missing — Finkle Einhorn appears
out of the Beast's corpse, Vaelan is summoned in Blackwing Lair, the Darrowshire spirits belong
to an event, Ysida Harmon to Alterac Valley, and the Cleansed Songflower objects to Felwood's
plant transformations. Run it yourself if you want the list; it needs a person who knows the
content, not a filter.

## What is not on this list

Quest 7124 `You captured a mine!` holds a stray `>` from a botched `$N` token and is reachable -
rewrite it, do not ignore it. The war-effort tallies are already ignored by migration 0017 and
are a different problem: the quest is real, the number is not knowable.
