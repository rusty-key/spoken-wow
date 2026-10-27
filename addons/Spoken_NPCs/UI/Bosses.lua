-- SpokenNPCs -- the bosses in Azeroth's Compendium (Spoken's UI/Compendium.lua): every boss of every
-- dungeon and raid, with the instance it is in and its story.
--
-- The list is laid out as the places' (Spoken Places' tab): a banner for each continent, a line for
-- each of its dungeons or raids, and in an opened dungeon its bosses. World bosses have no line of
-- their own and are listed straight under their continent. After the continents, Other Lands' banner
-- lists the dungeons on none. Which bosses a dungeon has comes from Data/Bosses.lua, and their
-- stories from Data/Stories.lua, where there is one. A boss not met yet is listed greyed, with a
-- padlock, and its page says so, until Unlock Unfound Bosses (Spoken's page) is on; Found Only
-- leaves out what holds none met. A search lists the bosses and dungeons whose name has the words,
-- each opened.

local _, NPCs = ...

local L = NPCs.L

local C = SpokenCompendium
local CONTINENTS, CITY_IN = C.CONTINENTS, C.CITY_IN
local MapName, ContinentOf = C.MapName, C.ContinentOf
local Dungeon, DungeonName = C.Dungeon, C.DungeonName

local list, page
local selection          -- { boss = true, map = map, key = key } | { dungeon = map }
                         -- | { mapID = continent } | { lands = true } | nil
local landed             -- the selection made for the player, where they stood; any other they chose
local dungeonOpen = {}   -- [map] = true: a dungeon's line, opened
local continentOpen = { [1414] = true, [1415] = true }
local bannerOpen = {}    -- .lands = true: Other Lands' banner, opened
local filter = ""

--------------------------------------------------------------------------------
-- What there is
--------------------------------------------------------------------------------

-- A boss's or a dungeon's name in the client's language, else English.
local function Name(entry)
	return entry[GetLocale and GetLocale() or "enUS"] or entry[1]
end

local index
-- zones[zone][map] = the bosses of the dungeon `map` whose entrance is in `zone`, a city's
-- dungeons filed under the zone around it; zoneOf[map] = zone; world[map] = true for the map of
-- a world boss, which has no line of its own (the map of world bosses in different zones files
-- each under its own, `bossZone["map:key"]`); byKey["map:key"] = the boss, whatever zone it stands
-- in; count = every boss listed. on[continent or "lands"], the zones, and under[continent or
-- "lands"], the banner's maps, are kept once worked out.

local function ClientHasMap(map)
	-- Spoken NPCs shares its boss data between clients. The shared API knows which instances this
	-- client can actually have, including Season of Discovery's instances on Era.
	return not Spoken or not Spoken.IsDungeonOnClient or Spoken:IsDungeonOnClient(map)
end

local function Index()
	if index then return index end
	index = { zones = {}, zoneOf = {}, world = {}, bossZone = {}, byKey = {}, on = {}, under = {}, count = 0 }
	local maps = _G.SpokenBosses and SpokenBosses.maps or {}
	local worlds = _G.SpokenDungeons and SpokenDungeons.worldBosses or {}
	for map, bosses in pairs(maps) do
		local dungeon = Dungeon(map)
		local world = worlds[map]
		local home = (dungeon or world) and (dungeon or world).zone
		if home and #bosses > 0 then
			-- Keep the complete lookup for encounters and stories. Only the lists below are
			-- client-visible, so a shared Forever boss entry remains usable by the module.
			for _, boss in ipairs(bosses) do index.byKey[map .. ":" .. boss.key] = boss end
			if not dungeon or ClientHasMap(map) then
				local zone = CITY_IN[home] or home
				if world and dungeon == nil and world.bossZones then
					for _, boss in ipairs(bosses) do
						local at = world.bossZones[boss.key] or home
						at = CITY_IN[at] or at
						index.zones[at] = index.zones[at] or {}
						index.zones[at][map] = index.zones[at][map] or {}
						table.insert(index.zones[at][map], boss)
						index.bossZone[map .. ":" .. boss.key] = at
					end
				else
					index.zones[zone] = index.zones[zone] or {}
					index.zones[zone][map] = bosses
				end
				index.zoneOf[map] = zone
				index.world[map] = world ~= nil and dungeon == nil or nil
				index.count = index.count + #bosses
			end
		end
	end
	return index
end

local function Found(map, key)
	return NPCs:IsBossFound(map, key)
end

local function Unlocked()
	return SpokenNPCsSettings ~= nil and SpokenNPCsSettings.unlockUnfound == true
end

local function OnlyFound()
	return SpokenNPCsSettings ~= nil and SpokenNPCsSettings.compendiumFoundOnly == true
end

-- Whether Found Only keeps what holds `found` bosses met.
local function Listed(found)
	return not OnlyFound() or found > 0
end

local function Matches(text)
	return filter == "" or (text and string.find(string.lower(text), filter, 1, true) ~= nil)
end

local function ByDungeonName(a, b)
	local na, nb = DungeonName(a), DungeonName(b)
	if na == nb then return a < b end
	return na < nb
end

-- The zones that have a dungeon or a raid on `continent`; nil for the zones on none, which the
-- game has a map for: a line for a map this client has never heard of would lead nowhere.
local function ZonesOn(continent)
	local memo = continent or "lands"
	if Index().on[memo] then return Index().on[memo] end
	local out = {}
	for zone in pairs(Index().zones) do
		if continent then
			if ContinentOf(zone) == continent then table.insert(out, zone) end
		elseif not ContinentOf(zone) and not (C_Map and C_Map.GetMapInfo and C_Map.GetMapInfo(zone) == nil) then
			table.insert(out, zone)
		end
	end
	Index().on[memo] = out
	return out
end

-- Bosses met of one dungeon's, or, given `zone`, of those of its map that stand in that zone.
local function TallyOf(map, zone)
	zone = zone or Index().zoneOf[map]
	local found, total = 0, 0
	for _, boss in ipairs(zone and Index().zones[zone][map] or {}) do
		total = total + 1
		if Found(map, boss.key) then found = found + 1 end
	end
	return found, total
end

-- Bosses met out of all the dungeons of `zones` hold.
local function Tally(zones)
	local found, total = 0, 0
	for _, zone in ipairs(zones) do
		for map in pairs(Index().zones[zone] or {}) do
			local f, t = TallyOf(map, zone)
			found, total = found + f, total + t
		end
	end
	return found, total
end

-- A boss's story (key = its key): a string, or the client's language beside the English that is
-- its first.
local function Story(map, key)
	local stories = _G.SpokenBossStories
	local text = stories and stories[map] and stories[map][key]
	if type(text) == "table" then text = Name(text) end
	return type(text) == "string" and text ~= "" and text or nil
end

-- What Data/Creatures.lua knows of a boss (its creature and appearance), or nil.
local function Creature(map, key)
	local known = _G.SpokenBossCreatures
	return known and known[map] and known[map][key]
end

-- Whether a boss has a story and a known appearance.
local function Complete(map, key)
	local entry = Creature(map, key)
	return Story(map, key) ~= nil and entry ~= nil and entry.display ~= nil
end

-- Every zone that has a dungeon or a raid.
local function AllZones()
	local out = {}
	for zone in pairs(Index().zones) do table.insert(out, zone) end
	return out
end

--------------------------------------------------------------------------------
-- The rows
--------------------------------------------------------------------------------

-- A dungeon's or a banner's line, with the bosses met out of those it holds.
local function Group(item, found, total)
	item.style = "group"
	item.count, item.total = found, total
	item.tick = total > 0 and found == total
	item.none = found == 0
	return item
end

-- `item`, then `inside` while it is shown.
local function Holding(item, inside, shown)
	local rows = { item }
	if shown then
		for _, row in ipairs(inside) do table.insert(rows, row) end
	end
	return rows
end

-- A dungeon's or a raid's line and, opened (or a search finds a boss in it), its bosses. `whole`:
-- what holds it was named by the search, so every boss is listed.
local function DungeonRows(zone, map, nest, whole)
	local world = Index().world[map] == true
	local name = world and "" or DungeonName(map)
	whole = whole or (filter ~= "" and not world and Matches(name))
	local found, total = TallyOf(map, zone)
	if not Listed(found) then return {} end
	local open = world or dungeonOpen[map] == true or filter ~= ""
	local inside = {}
	local at = world and nest or nest + 1
	for _, boss in ipairs(open and Index().zones[zone][map] or {}) do
		local met = Found(map, boss.key)
		if (met or not OnlyFound()) and (whole or Matches(Name(boss))) then
			table.insert(inside, { kind = "boss", leaf = true, map = map, key = boss.key, label = Name(boss), nest = at,
				locked = not met and not Unlocked(), done = met,
				missing = (met or Unlocked()) and not Complete(map, boss.key) })
		end
	end
	-- A world boss has no line of its own: its lines stand directly under the continent.
	if world then return inside end
	if filter ~= "" and #inside == 0 then return {} end
	return Holding(Group({ kind = "dungeon", dungeon = map, label = name, nest = nest, open = open },
		found, total), inside, open)
end

-- A banner's dungeons and raids by name, and its world bosses' maps with the zone each stands in,
-- as one map can hold world bosses in several.
local function MapsOn(continent)
	local memo = continent or "lands"
	if Index().under[memo] then return Index().under[memo] end
	local dungeons, worlds = {}, {}
	for _, zone in ipairs(ZonesOn(continent)) do
		for map in pairs(Index().zones[zone]) do
			if Index().world[map] then
				table.insert(worlds, { zone = zone, map = map })
			else
				table.insert(dungeons, map)
			end
		end
	end
	table.sort(dungeons, ByDungeonName)
	Index().under[memo] = { dungeons = dungeons, worlds = worlds }
	return Index().under[memo]
end

-- The lines under a banner: its dungeons and raids, then its world bosses by name.
local function RowsOn(continent, nest, whole)
	local under, rows, bosses = MapsOn(continent), {}, {}
	for _, map in ipairs(under.dungeons) do
		for _, row in ipairs(DungeonRows(Index().zoneOf[map], map, nest, whole)) do table.insert(rows, row) end
	end
	for _, at in ipairs(under.worlds) do
		for _, row in ipairs(DungeonRows(at.zone, at.map, nest, whole)) do table.insert(bosses, row) end
	end
	table.sort(bosses, function(a, b) return a.label < b.label end)
	for _, row in ipairs(bosses) do table.insert(rows, row) end
	return rows
end

-- A banner and, opened (or a search finds something under it), a line for each dungeon or raid.
local function Banner(item, continent, opened)
	local whole = filter ~= "" and Matches(item.label)
	local open = filter ~= "" or opened == true
	local rows = open and RowsOn(continent, 0, whole) or {}
	if filter ~= "" and #rows == 0 then return {} end
	local found, total = Tally(ZonesOn(continent))
	if not Listed(found) then return {} end
	Group(item, found, total).style = "banner"
	item.open = open and #rows > 0
	return Holding(item, rows, open)
end

local function Continents()
	local out = {}
	for _, continent in ipairs(CONTINENTS) do
		if #ZonesOn(continent) > 0 then table.insert(out, continent) end
	end
	return out
end

local function BuildRows()
	local out = {}
	local continents = Continents()
	table.sort(continents, function(a, b) return MapName(a) < MapName(b) end)
	for _, continent in ipairs(continents) do
		for _, row in ipairs(Banner({ kind = "continent", mapID = continent, label = MapName(continent) },
			continent, continentOpen[continent])) do
			table.insert(out, row)
		end
	end
	local lands = ZonesOn(nil)
	if #lands > 0 then
		for _, row in ipairs(Banner({ kind = "lands", label = L.GROUP_LANDS }, nil, bannerOpen.lands)) do
			table.insert(out, row)
		end
	end
	return out
end

local function IsSelected(row)
	if not selection then return false end
	if row.kind == "boss" then return selection.boss == true and selection.map == row.map and selection.key == row.key end
	if row.kind == "lands" then return selection.lands == true end
	if row.kind == "dungeon" then return selection.dungeon == row.dungeon end
	return selection.mapID == row.mapID and not selection.boss and not selection.dungeon
end

--------------------------------------------------------------------------------
-- The page
--------------------------------------------------------------------------------

-- Nothing to play or to report yet: a boss's story is words alone until it is voiced.
local PLAY = { has = function() return false end, find = function() end, start = function() end }
local REPORT = { has = function() return false end, open = function() end, title = "" }

local function Boss(map, key)
	return Index().byKey[map .. ":" .. key]
end

-- The zone a boss is filed under: its own where the map's bosses stand in several, else the map's.
local function BossZone(map, key)
	return Index().bossZone[map .. ":" .. key] or Index().zoneOf[map]
end

-- How fast a story is read, in words a second, and the least time one stays in the narrator.
local READING_SPEED, LEAST_SECONDS = 2.5, 6

local SKULL = [[Interface\Minimap\Minimap_skull_elite]]

-- The section page has no boss selected yet, so it cannot show a creature portrait. Keep its
-- header tied to the Bosses settings page instead of falling back to the Compendium's book.
local SECTION_ICON = { objectOrItem = true, icon = NPCs.ICON, bullet = "boss" }

--- The story of the boss `key` of `map` as a line for Spoken's narrator, words with no voice; nil
--- where it has none.
function NPCs:StoryClip(map, key)
	local story = Story(map, key)
	if not story then return nil end
	local boss = Boss(map, key)
	if not boss then return nil end
	local _, words = story:gsub("%S+", "")
	local entry = Creature(map, key)
	return {
		key = "boss:" .. map .. ":" .. key,
		length = math.max(LEAST_SECONDS, words / READING_SPEED),
		present = {
			header = Index().world[map] and MapName(BossZone(map, key)) or DungeonName(map),
			label = Name(boss),
			transcript = story,
			bullet = "boss",
			portrait = entry and entry.display and { kind = "model", creatureID = entry.creature, displayID = entry.display }
				or { kind = "texture", texture = SKULL },
		},
	}
end

local function Count(found, total)
	return L.BOSSES_FOUND_FMT:format(found, total)
end

local function CountLine(where, found, total)
	return L.BOSS_IN_FMT:format(where) .. " · " .. Count(found, total)
end

-- The skull in the ring's small socket, where a quest's portrait has its badge.
if Spoken and Spoken.RegisterBullet then Spoken:RegisterBullet("boss", SKULL, 16) end

-- One table for each picture, so the page draws a portrait again only for another one.
local UNKNOWN = C.UnknownIcon("boss")
local portraits = {}

-- A boss's portrait, at the left of its name on the page's header.
local function Portrait(map, key)
	local entry = Creature(map, key)
	-- A portrait only from a known appearance: asked of the client, a creature it has not met answers
	-- with the player's own face.
	if not (entry and entry.display) then return UNKNOWN end
	local id = map .. ":" .. key
	local portrait = portraits[id]
	if not (portrait and portrait.creatureID == entry.creature and portrait.displayID == entry.display) then
		portrait = { creatureID = entry.creature, displayID = entry.display, bullet = "boss" }
		portraits[id] = portrait
	end
	return portrait
end

local function ShowEntry()
	if not page then return end
	if not selection then
		page:Show({ title = L.COMPENDIUM_BOSSES, subtitle = Count(Tally(AllZones())), icon = SECTION_ICON })
		return
	end
	if selection.boss then
		local map, key = selection.map, selection.key
		local boss = Boss(map, key)
		if not boss then return end
		local where = Index().world[map] and L.BOSS_IN_FMT:format(MapName(BossZone(map, key)))
			or (L.BOSS_IN_FMT:format(DungeonName(map)) .. " · " .. MapName(Index().zoneOf[map]))
		if not Found(map, key) and not Unlocked() then
			page:Show({ title = Name(boss), subtitle = where, text = L.BOSS_NOT_FOUND, icon = UNKNOWN })
			return
		end
		local story = Story(map, key)
		page:Show({ title = Name(boss), subtitle = where, icon = Portrait(map, key),
			text = story or C.NotWritten(), unwritten = story == nil })
		return
	end
	if selection.dungeon then
		page:Show({ title = DungeonName(selection.dungeon),
			subtitle = CountLine(MapName(Index().zoneOf[selection.dungeon]), TallyOf(selection.dungeon)),
			icon = C.PlaceIcon(nil, selection.dungeon) })
		return
	end
	local continent = not selection.lands and selection.mapID or nil
	page:Show({ title = continent and MapName(continent) or L.GROUP_LANDS,
		subtitle = Count(Tally(ZonesOn(continent))), icon = continent and C.PlaceIcon(continent) or nil })
end

--------------------------------------------------------------------------------
-- The tab
--------------------------------------------------------------------------------

-- The continent the player is on where the list shows it, else the first it shows.
local function PlayerContinent()
	local listed = {}
	for _, continent in ipairs(Continents()) do
		if Listed(Tally(ZonesOn(continent))) then table.insert(listed, continent) end
	end
	return C.PlayerContinent(listed)
end

-- The dungeon or raid the player is in, and the zone it is filed under.
local function PlayerDungeon()
	local map = NPCs:InstanceMap()
	local zone = map and Index().zoneOf[map]
	if zone then return map, zone end
end

local function OpenAround(zone) C.OpenAround(zone, continentOpen, bannerOpen) end

-- Choose where the player stands: the line of the dungeon they are in, opened, else their
-- continent's banner. Never a line Found Only leaves out: the tab would show a page for no row.
local function LandOnPlayer()
	local map, zone = PlayerDungeon()
	if map and Listed(TallyOf(map, zone)) then
		selection = { dungeon = map }
		dungeonOpen[map] = true
		OpenAround(zone)
	else
		local continent = PlayerContinent()
		selection = continent and { mapID = continent } or nil
		if continent then continentOpen[continent] = true end
	end
	landed = selection
end

local function OnClick(row)
	local searching = filter ~= ""
	if row.kind == "boss" then
		selection = { boss = true, map = row.map, key = row.key }
	elseif row.kind == "lands" then
		if not searching then bannerOpen.lands = not bannerOpen.lands end
		selection = { lands = true }
	elseif row.kind == "continent" then
		if not searching then continentOpen[row.mapID] = not continentOpen[row.mapID] end
		selection = { mapID = row.mapID }
	elseif row.kind == "dungeon" then
		if not searching then dungeonOpen[row.dungeon] = not dungeonOpen[row.dungeon] or nil end
		selection = { dungeon = row.dungeon }
	end
	NPCs:RefreshBosses()
end

function NPCs:RefreshBosses(scrollToSelection)
	if not list then return end
	if not selection then
		LandOnPlayer()
		scrollToSelection = true
	end
	local items = list:Render()
	if scrollToSelection and selection then list:ScrollToChosen(items) end
	ShowEntry()
end

local function Build(panel)
	list = SpokenCompendium.NewList(panel, {
		search = L.BOSSES_SEARCH,
		none = L.BOSSES_NONE,
		only = L.BOSSES_FOUND_ONLY,
		onlyGet = OnlyFound,
		onlySet = function(on) if SpokenNPCsSettings then SpokenNPCsSettings.compendiumFoundOnly = on end end,
		locked = function() return SpokenCompendium.LockedReason("OPT_UNLOCK_BOSSES") end,
		-- Found Only left the chosen row out: back to where the player stands.
		onHidden = function()
			selection = nil
			NPCs:RefreshBosses(true)
		end,
		build = BuildRows,
		isSelected = IsSelected,
		onClick = OnClick,
		onSearch = function(text)
			filter = text
			NPCs:RefreshBosses()
		end,
		addScrollBar = function(scroll, child, inset) return SpokenTextView.AddScrollBar(scroll, child, inset) end,
	})
	panel.Refresh = function() NPCs:RefreshBosses() end
	panel.inset, panel.filterButton, panel.filterMenu, panel.noMatch = list.inset, list.filterButton, list.filterMenu, list.noMatch

	page = C.NewPage(C.PageHolder(panel, list), NPCs, PLAY, REPORT)
	-- Text Size, on Spoken's page, fires no game event: the page is drawn again at the new size.
	if Spoken and Spoken.RegisterCallback then Spoken:RegisterCallback("COMPENDIUM_FONT_CHANGED", ShowEntry) end
	panel.page = page
	NPCs.bosses, NPCs.list = panel, list
end

--- Open the bosses, on where the player stands now, unless they chose something here.
function NPCs:ShowBosses()
	if not SpokenCompendium then return end
	if selection == landed then selection = nil end
	if list then
		list:ClearSearch()
		filter = ""
	end
	SpokenCompendium:Open("bosses")
	SpokenCompendium:Expand()
	NPCs:RefreshBosses(true)
end

function NPCs:SetupBosses()
	if not SpokenCompendium or SpokenCompendium:Tab("bosses") then return end
	SpokenCompendium:Register("bosses", {
		label = L.COMPENDIUM_BOSSES,
		order = 3,
		build = Build,
		open = function() NPCs:ShowBosses() end,
		-- Come back to from another tab: where the player stands now, unless they chose here.
		onShow = function() if selection == landed then selection = nil end end,
		enabled = function() return Index().count > 0 end,
		-- Unlock Unfound Bosses, on Spoken's page.
		unlock = {
			get = function() return Unlocked() end,
			set = function(value)
				if SpokenNPCsSettings then SpokenNPCsSettings.unlockUnfound = value end
				NPCs:RefreshBosses()
			end,
		},
	})
end
