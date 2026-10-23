# The Places tab, the map panel and the tables behind them

## Shared code

Azeroth's Compendium is one window for the Quests, Places and Readables tabs. Spoken owns it, and the
modules add to it, so there is one copy of each piece:

| File | What it holds |
| --- | --- |
| `addons/Spoken/UI/Compendium.lua` | The window (movable, resizable, closes on Escape, folds down to the list), the list (`C.NewList`: search box, filter menu, banners, groups, rows), the page (`C.NewPage`: title, line under it, Play, Report, words, picture), `C:Register` for a tab. |
| `addons/Spoken/UI/TextView.lua` | The scrolling, wrapping text with its scroll bar and edge fade, and the picture above the words (`SetPicture`). The words are drawn at Text Size. |
| `addons/Spoken/UI/Face.lua` | The round face on the player windows, and the badge for a line's kind (`zone` uses the world map icon). |

`Compendium.lua` also holds what every tab lays places out by: `C.WORLD` (947, Azeroth, the continents' parent), `C.CONTINENTS`
(Kalimdor 1414 and the Eastern Kingdoms 1415), `C.CITY_IN`, `C.BATTLEGROUNDS`, `C.ContinentOf`,
`C.OpenAround`, `C.OpenZone` and `C.PlayerZone`. The other tabs show a place's picture through
`C.PlacePicture`.

The Places tab registers as `places` (`UI/LoreWindow.lua`, `SetupLoreWindow`), label Places, after Quests
and before Readables. Its Unlock switch, Unlock Undiscovered Places, is on Spoken's page. The spellbook
page art lives in `addons/Spoken_Places/Textures/Art`, and the other tabs draw on the same paper
when Places is installed.

`UI/LorePage.lua` makes the page for a story: the Compendium's page on the spellbook's parchment
in the window and on the quest log's details page beside the map. The beside-the-map page also
has a button that opens the place in the tab.

## The list

First Azeroth's banner, which opens the world's story. Nothing is listed or counted under it, and it is
never locked: the line under its name says how many continents and zones the tab holds. Then a banner
for each continent, Kalimdor and the Eastern Kingdoms, then two more banners:

- Other Lands, for zones on no continent the client knows (Forever's Zephras Isle).
- Battlegrounds, for the maps in `C.BATTLEGROUNDS` that have an entry in the data, wherever the
  client files their maps. On the current data that is Darkspear Islands, which has no story yet.

Each banner lists only places that are in the data on this client. Under a continent, each zone is a
line with its name and places found out of all; its icon (`Spoken:ZoneIcon`) is on its page. A zone's places are its areas,
its dungeons and raids, and its city (Stormwind City in Elwynn Forest, Orgrimmar in Durotar,
Ironforge in Dun Morogh, Thunder Bluff in Mulgore, Darnassus in Teldrassil, the Undercity in
Tirisfal Glades), which counts as one place with its own areas.

- A click on a banner or a zone chooses it and opens or closes it. Several stay open together, and
  what is open lasts for the session and is not saved.
- An open zone shows its city's line first, then a Dungeons and Raids line where it has several
  (a line each under it, or a single line where it has one), then its areas as rows with a tick on
  each one found.
- A search matches names only. It opens every zone with a match inside. A search that names a zone
  or a city lists all its areas, and one that names a banner lists its zones as the player
  left them.
- The filter menu holds Discovered Only (on by default) and Voiced Only. Voiced Only leaves out what no
  installed voice pack reads and counts only what it lists. A zone stays while an area, dungeon or
  city in it has a voice.
- A shift-click on an area or dungeon queues its story behind what is playing.
- Opening the tab lands on where the player stands: the area if it has a story, else the zone,
  opened, else the continent. `GetLoreWithFallback` walks up from an indoor or dungeon map to the
  zone, because those maps are not keys in the data. A place the player chose stays chosen.
- Under a story, links lead to the same place on the Quests and Readables tabs.

Everything else the tab does is in `UI/LoreWindow.lua`.

## What counts as found

`Discovery.lua`. A place is found for this character when either holds:

- The client has it explored. Each explored area is drawn on its zone's map as an overlay, and
  `C_MapExplorationInfo.GetExploredAreaIDsAtPosition` names the areas under each overlay. This
  covers everything explored before the addon was installed.
- The character has stood in it since. Small places and a city's districts have no overlay, so
  every zone change records where the character is (`SpokenPlacesCharacter.visited`), and a click on
  the map that resolves an area marks it. Entering a dungeon or raid marks its card, whatever the
  reading settings say: the client has no map for the player inside, so this is the only way most
  dungeon cards are found.

A zone is found when it or any of its areas is. A city is also found when its name is explored on
the zone around it. A continent is found only through its zones. `/spp found` lists what is counted
and why. The map is scanned once per zone until something may have changed it: a zone change, the
world map or the tab opening, or the game reporting exploration.

## Undiscovered places

The tab does what the Quests and Readables tabs do. Banners and zones list and open whether or not
anything in them is found, and a zone with nothing found is greyed. An area not yet found is a row
greyed with a padlock, listed by name, and it does not open. The page of a place not found (opened
from the map panel or a link) says `You have not discovered this place yet. Go there to read its
story.` under its name and line. `SpokenPlaces:IsLocked` decides, and `QueueLore` refuses a locked
place.

Unlock Undiscovered Places (`showUndiscovered`) opens every area and tells every story. The counts
and greyed zones still say what this character has found. Discovered Only, on by default, leaves out zones with
nothing found and areas not found.

## Areas listed in another zone

Stories follow the wiki, which files some areas by the map after the Cataclysm. An area is listed,
found and told where the game puts it, while its story keeps its frozen id, voice, picture and
report under the zone the story is kept under. Two tables say where:

| Table | Holds |
| --- | --- |
| `addons/Spoken/Data/Dungeons.lua` | Each dungeon and raid, by instance map: `zone`, the zone of its entrance, and `story`, the area `{ uiMapID, key }` whose story is its card. |
| `addons/Spoken_Places/Data/AreaZones.lua` | Other areas, by the zone their story is kept under, with `zone` (where the client puts the area) and `also` (more zones that have an area of that name). Kept by hand. |

`Core.lua` reads both into one index. `StoryPlace(mapID, key)` returns the map a story found on
`mapID` is kept under, `AreaZone` the zone an area is listed in, `FoundOn` the other maps it is
found on, and `AreasIn(zone)` the areas listed in a zone. `GetSubzoneLore` looks a story up where
`StoryPlace` says, so every route to a story (autoplay, `/spp play`, the map click and panel, the
Compendium) finds Strahnbrad on Alterac Mountains' map and tells `s:1424:strahnbrad`. A visit is
recorded on the map the area is found on.

Examples in the data: Strahnbrad, Ravenholdt Manor and ten more areas kept under Hillsbrad
Foothills (1424) are Alterac Mountains' (1416). The Valley of Bones, kept under Desolace, is
Shen'dralas' (2652) on Forever, and a `zone` the client has no map for is left out, so on a client
without Shen'dralas it stays in Desolace. The Great Lift, Lordamere Lake and Darrowmere Lake are
areas of two zones, listed once where the story is kept and found and told from both.
Razorfen Downs' story is kept under Thousand Needles, while its entrance is in The Barrens, so the
tab lists it in The Barrens.

`tests/lua/places_area_zones_test.lua` checks `AreaZones.lua` against the stories, and
`tests/lua/places_story_place_test.lua` checks the lookups.

### The dungeon table

`pipelines/lib/dungeons.json` is the source, with three parts: `dungeons`, `instances` (instance maps
that are no dungeon, such as the PvP halls) and `battlegrounds`. Three readers use it: the Quests
exporter (`pipelines/quests/tools/export_compendium.py`), the Readables exporter
(`pipelines/readables/tools/places.mjs`) and `pipelines/lib/dungeons.mjs`, which writes
`addons/Spoken/Data/Dungeons.lua` with each name in every language from the client's Map table.

```sh
make dungeons                          # from the repository root
node pipelines/lib/dungeons.mjs --check
```

The table lists 29 dungeons and raids, and 18 have a `story`. The rest (Stormwind Stockade,
Razorfen Kraul, Blackrock Spire, Blackrock Depths, Maraudon, the Molten Core, Blackwing Lair, both
Ahn'Qiraj instances, Naxxramas and the Hall of Thanes) have no area story, so no line. Forever's City
of Dalaran is the `dalaran` area of Alterac Mountains, and its Ruins of Lordaeron Tirisfal Glades'
`ruins of lordaeron`, the surface ruins its entrance is in. Run `make dungeons`, then the Quests and Readables exporters, after editing
the JSON. `tests/lua/places_dungeons_test.lua` checks the table against the stories and the Quests
data.

### Areas only Forever has

`Data/ForeverAreas.lua` (generated by `make places-forever-areas`) lists the areas that are in
Forever's AreaTable and not in Era's (`ForeverOnlyAreas`, left out of the list on a client that
cannot report them), Forever's spelling of a place the lore keeps under another key
(`ForeverNames`: Legashi Encampment is the frozen `legash encampment`), and places no Forever
player can reach (`NotOnForever`). The two hand-kept inputs are in
`pipelines/places/tools/seed/forever-places.json`. Forever is recognised by the client having a map
of Mount Hyjal (2482).

## The map panel

`UI/MapPanel.lua` docks a panel to the right of the world map (drawn as the quest log is) and
`UI/LorePage.lua` fills it. It shows the story of the zone the map shows, or of the area the player
clicked. Its title is Place Story, and a side tab on the map's edge reopens it after its close button
folds it.

- It is hidden while the map is maximised, while Spoken's Enable switch is off and while
  Show Story Beside Map is off. Under the gamepad UI it is a child of `UIParent` instead of the
  map, because the Forever client takes every button inside the open map into its own navigation.
  Inside the map the panel and the button fade with the map as its children. Beside it each reads
  the map's alpha in its own `OnUpdate`, only while it is beside the map: a hook on
  `WorldMapFrame:SetAlpha`, which the game's movement fader calls every frame, raised errors on
  Forever (#497).
- The panel stands clear of the side tabs down the map's right edge by the widest one's reach
  past it, and its button goes under the lowest on screen. No addon or tab is named: a tab is any
  shown child of the quest log, the map or its border frame whose left edge is within a few pixels
  (`COLUMN_SLACK`) of the map's edge, that sits mostly outside the map and is shorter than half of
  it. Tabs show and hide without the quest log doing either, so every child of those frames has its
  `OnShow` and `OnHide` hooked once, as it is first seen, and the layout runs again on the next
  frame, after every other addon's hooks. A tab parented elsewhere, such as `UIParent`, is not
  found.
- `UI/SubzoneClick.lua`: a click on a zone map resolves an area through
  `MapUtil.FindBestAreaNameAtMouse`, which returns a name and no id. A continent or world map is
  left to the game. A drag is not a click. A click on a city inside the zone opens the city's map.
- `UI/MapHighlight.lua` lights the area under the cursor when a click would open its story. The
  highlight is that area's explored overlay drawn again in additive blend, so only explored areas
  light. `SpokenPlaces:AreaAt` answers both the click and the highlight.
- A map with no story of its own shows its parent zone's, and says so on the line under the
  title. A place with no story yet says so and offers Contribute. The panel's page uses the Text
  Language, Text Size and Show Pictures settings.
