-- SpokenZones -- the places in Azeroth's Compendium (UI/Compendium.lua): every place's story, to
-- browse and listen to anywhere.
--
-- Opened from the minimap menu, the Zones settings page or /spp window. Independent of
-- WorldMapFrame, so it works with the map closed.
--
-- The window, its list and its rows are the Compendium's; this is what goes in them. On the left,
-- Azeroth's banner, which opens its page, then a banner for each continent, a line under it for
-- each of its zones (how many of its places are found, and the share), and under an opened zone its
-- city's line, one level in, with its own areas,
-- then a line for each of its dungeons and raids (under a Dungeons and Raids line where it has
-- several), then the zone's areas as rows; after the continents, a banner for the zones on none
-- (Other Lands) and one for the battlegrounds. On the right, the story on the spellbook's
-- parchment (UI/LorePage.lua).
--
-- Each zone's and city's line opens and closes on its own click, and stays as the player left it
-- for the session. A zone's areas are rows only while its line is open, so the list holds what
-- the player opened. A search opens every line with a match in it instead: one naming a zone or
-- a city lists all its areas, and one naming a banner lists its lines as the player left them.

local _, SpokenZones = ...

-- A value the game hands over as a secret, in an instance or in combat, reads as nil.
local NotSecret = Spoken and Spoken.NotSecret or function(value) return value end

local L = SpokenZones.L

local panel, list, page
-- The zones' and cities' lines open, by mapID: a city's keeps its state while its zone is closed.
local openZones = {}
-- The zones whose Dungeons and Raids line is open, by mapID.
local dungeonsOpen = {}
-- The continents start open, so the zones show; each opens and closes on its own.
local continentOpen = { [1414] = true, [1415] = true }
-- Whether the banners after the continents are open: the zones on no continent, the battlegrounds.
local groupOpen = { lands = false, battlegrounds = false }
local selection = nil -- { mapID = , key = nil|string }, { group = "lands"|"battlegrounds" }, or
                      -- { dungeons = zone } for a zone's Dungeons and Raids line
-- The selection made for the player, where they stood; any other is one they chose.
local landed = nil
-- Sorted once, as sortedZoneIDs is: the tree is rebuilt on every click and keystroke, and the
-- data under it is fixed for the session (a language change reloads the interface).
local sortedZoneIDs = nil
local zonesOfContinent = {}
local sortedAreas = {}
local filter = ""   -- what the list's search box holds, lowered (UI/Compendium.lua's List)

--------------------------------------------------------------------------------
-- Data ordering
--------------------------------------------------------------------------------

local function ZoneName(mapID)
	return SpokenZones:GetMapName(mapID) or (SpokenZones.Zones[mapID] and SpokenZones.Zones[mapID].name) or tostring(mapID)
end

-- The world, its continents, the cities inside the zone around each, and which continent a zone is
-- on: Compendium.lua's, which every tab lays its tree out by.
local C = SpokenCompendium
local WORLD, CONTINENTS, CITY_IN = C.WORLD, C.CONTINENTS, C.CITY_IN
local ContinentOf, IsContinent, IS_BATTLEGROUND = C.ContinentOf, C.IsContinent, C.IS_BATTLEGROUND
SpokenZones.CityIn = CITY_IN

local function ByName(a, b)
	local na, nb = ZoneName(a), ZoneName(b)
	if na == nb then return a < b end
	return na < nb
end

-- A map this client has never heard of: in the data for another client (Forever's 2482, 2521,
-- 2524, 2548 and 2652 on Era), it would sit loose under Azeroth, counted among its zones, and
-- lead nowhere. Only where C_Map can be asked, and only for a zone on no continent we know.
local function UnknownHere(mapID)
	if not (C_Map and C_Map.GetMapInfo) or ContinentOf(mapID) then return false end
	return C_Map.GetMapInfo(mapID) == nil
end

--- Every zone with a story, alphabetical: everything in the data but Azeroth, its continents and
--- maps this client has not got.
local function ZoneIDs()
	if sortedZoneIDs then
		return sortedZoneIDs
	end
	sortedZoneIDs = {}
	for mapID in pairs(SpokenZones.Zones) do
		if mapID ~= WORLD and not IsContinent(mapID) and not UnknownHere(mapID) then
			table.insert(sortedZoneIDs, mapID)
		end
	end
	-- Alphabetical by display name: uiMapID order is meaningless to a reader.
	table.sort(sortedZoneIDs, ByName)
	return sortedZoneIDs
end

--- The continents that have a story, alphabetical.
local function Continents()
	local list = {}
	for _, mapID in ipairs(CONTINENTS) do
		if SpokenZones.Zones[mapID] then table.insert(list, mapID) end
	end
	table.sort(list, ByName)
	return list
end

--- A continent's zones, alphabetical, its battlegrounds left to their banner.
local function ZonesOf(continent)
	if zonesOfContinent[continent] then return zonesOfContinent[continent] end
	local list = {}
	for _, mapID in ipairs(ZoneIDs()) do
		if ContinentOf(mapID) == continent and not CITY_IN[mapID] and not IS_BATTLEGROUND[mapID] then
			table.insert(list, mapID)
		end
	end
	zonesOfContinent[continent] = list
	return list
end

--- The zones on neither continent with a story, alphabetical (Forever's Zephras Isle).
local function LooseZones()
	local listed = {}
	for _, continent in ipairs(Continents()) do listed[continent] = true end
	local list = {}
	for _, mapID in ipairs(ZoneIDs()) do
		if not listed[ContinentOf(mapID) or 0] and not CITY_IN[mapID] and not IS_BATTLEGROUND[mapID] then
			table.insert(list, mapID)
		end
	end
	return list
end

--- The battlegrounds with a story on this client, alphabetical.
local function Battlegrounds()
	local list = {}
	for _, mapID in ipairs(ZoneIDs()) do
		if IS_BATTLEGROUND[mapID] then table.insert(list, mapID) end
	end
	return list
end

-- The banners after the continents, in order: what each holds and is called.
local GROUPS = {
	{ key = "lands", zones = LooseZones, label = function() return L.OTHER_LANDS end },
	{ key = "battlegrounds", zones = Battlegrounds, label = function() return L.BATTLEGROUNDS end },
}
local function Group(key)
	for _, group in ipairs(GROUPS) do
		if group.key == key then return group end
	end
end

--- The cities inside the zone `mapID`, alphabetical.
local function CitiesIn(mapID)
	local list = {}
	for _, city in ipairs(ZoneIDs()) do
		if CITY_IN[city] == mapID then table.insert(list, city) end
	end
	return list
end

--- Open what holds `mapID`, so opening on a place shows it.
local function Reveal(mapID)
	if IsContinent(mapID) then
		continentOpen[mapID] = true
	elseif mapID ~= WORLD then
		C.OpenAround(mapID, continentOpen, groupOpen)
	end
end

local function OpenZone(mapID) C.OpenZone(mapID, openZones) end

--- Open what holds the place `mapID`, or its area `key`: a dungeon's entrance zone and the line its
--- line is under, any other area's zone, the one the client puts it in (SpokenZones:AreaZone).
local function OpenPlace(mapID, key)
	local entrance = SpokenZones:DungeonOf(mapID, key)
	if entrance then
		dungeonsOpen[entrance] = true
		mapID = entrance
	elseif key then
		mapID = SpokenZones:AreaZone(mapID, key)
	end
	OpenZone(mapID)
	Reveal(mapID)
end

-- Whether this is the Forever client, which knows its own maps (Mount Hyjal's, 2482).
local onForever
local function OnForever()
	if onForever == nil then
		onForever = C_Map and C_Map.GetMapInfo and C_Map.GetMapInfo(2482) ~= nil or false
	end
	return onForever
end

-- The areas that are dungeons and raids (SpokenZones.Dungeons, from Spoken's Data/Dungeons.lua), by
-- where their story is kept: the zone of the entrance, whose line lists them, and the instance's map.
local dungeonAt, dungeonsFrom = {}, nil
local function DungeonIndex()
	if dungeonsFrom ~= SpokenZones.Dungeons then
		dungeonsFrom, dungeonAt = SpokenZones.Dungeons, {}
		for zone, list in pairs(dungeonsFrom or {}) do
			for _, dungeon in ipairs(list) do
				dungeonAt[dungeon.mapID] = dungeonAt[dungeon.mapID] or {}
				dungeonAt[dungeon.mapID][dungeon.key] = { zone = zone, dungeon = dungeon.dungeon }
			end
		end
	end
	return dungeonAt
end

--- For a dungeon's or a raid's area, the zone of its entrance, whose line lists it, and the
--- instance's map; nil for any other area.
function SpokenZones:DungeonOf(mapID, key)
	local at = key and DungeonIndex()[mapID]
	local dungeon = at and at[key]
	if dungeon then return dungeon.zone, dungeon.dungeon end
end

-- The dungeons and raids whose entrance is in `zone` and whose story this client has, by name.
local dungeonsIn = {}
local function DungeonsIn(zone)
	if dungeonsIn[zone] then return dungeonsIn[zone] end
	local list = {}
	for _, dungeon in ipairs(SpokenZones.Dungeons and SpokenZones.Dungeons[zone] or {}) do
		local entry = SpokenZones.Subzones[dungeon.mapID] and SpokenZones.Subzones[dungeon.mapID][dungeon.key]
		if entry then
			table.insert(list, { mapID = dungeon.mapID, key = dungeon.key, name = entry.name or dungeon.key, entry = entry,
				dungeon = dungeon.dungeon })
		end
	end
	table.sort(list, function(a, b) return a.name < b.name end)
	dungeonsIn[zone] = list
	return list
end

-- A zone's areas listed as rows, by name, each { mapID = the map its story is kept under, key =,
-- entry = }: those the client puts in the zone (SpokenZones:AreasIn), not its dungeons and raids,
-- which are lines.
local function Areas(mapID)
	local own = SpokenZones.Subzones[mapID]
	if own and sortedAreas[mapID] then return sortedAreas[mapID] end
	local list = {}
	for _, area in ipairs(SpokenZones:AreasIn(mapID)) do
		-- Not the areas only Forever has (Data/ForeverAreas.lua) on another client, which can never
		-- report them: listed, they would never be found.
		local foreverOnly = not OnForever() and SpokenZones.ForeverOnlyAreas and SpokenZones.ForeverOnlyAreas[area.mapID]
		local dungeons = DungeonIndex()[area.mapID]
		if not (foreverOnly and foreverOnly[area.key]) and not (dungeons and dungeons[area.key]) then
			table.insert(list, { mapID = area.mapID, key = area.key, entry = SpokenZones.Subzones[area.mapID][area.key] })
		end
	end
	table.sort(list, function(a, b)
		local na, nb = a.entry.name or a.key, b.entry.name or b.key
		if na == nb then return a.mapID < b.mapID end
		return na < nb
	end)
	-- Kept for a zone whose stories have loaded; one with none of its own yet is asked again.
	if own then sortedAreas[mapID] = list end
	return list
end

local function Matches(text)
	return filter == "" or (text and string.find(string.lower(text), filter, 1, true) ~= nil)
end

-- Whether a search names what holds `label`: then all it holds is listed, each area matching or not.
local function Named(label, whole)
	return whole or (filter ~= "" and Matches(label))
end

-- Set while the lines under a banner whose name the search matches are built: each is listed,
-- closed or open as the player left it, and opens and closes on a click as it does unsearched. A
-- continent's every area at once would be too long a list to read.
local asLeft = false

-- What a search opened and the player closed again with a click, by line; a new search opens all.
local searchClosed = {}

-- The rows `build` returns, built with asLeft set where `named`.
local function AsLeft(named, build)
	local before = asLeft
	asLeft = before or named
	local rows = build()
	asLeft = before
	return rows
end

local function SetFilter(text)
	filter = text
	searchClosed = {}
end

-- Whether this character has found a place (Discovery.lua), whatever Unlock Undiscovered Zones
-- says: the counts and Discovered Only go by it.
local function Found(mapID, key)
	return SpokenZones:IsFound(mapID, key)
end

-- Whether an area's row opens: every area with Unlock Undiscovered Zones on, otherwise only those
-- found. The rest are listed greyed out, with the padlock, as the Quests and Readables tabs list what
-- is not found yet.
local function Discovered(mapID, key)
	return SpokenZones:ShowsUndiscovered() or Found(mapID, key)
end

--- Whether a place's story is locked for this character: not found yet, with Unlock Undiscovered
--- Zones off. A continent is found through its zones; Azeroth always is. The page and the map's
--- panel say so in its place rather than tell its story; the list still opens its banner or line.
function SpokenZones:IsLocked(mapID, key)
	if self:ShowsUndiscovered() or mapID == WORLD then return false end
	if not key and IsContinent(mapID) then
		for _, zone in ipairs(ZonesOf(mapID)) do
			if self:IsFound(zone) then return false end
		end
		return true
	end
	return not self:IsFound(mapID, key)
end

-- Discovered Only, in the filter menu: the places not found are left out of the list.
local function OnlyFound()
	return SpokenZones:Get("loreDiscoveredOnly") == true
end

-- Voiced Only, under it: the places no installed voice pack reads are left out. A zone stays while
-- it, an area in it or its city has a recording, so a voiced area is still reached through it.
local function OnlyVoiced()
	return SpokenZones:Get("loreVoicedOnly") == true
end

-- Asked of every row on every render: kept until the next render, when a pack may have come or gone.
local voiced = {}
local function Voiced(mapID, key)
	local at = mapID .. ":" .. (key or "")
	if voiced[at] == nil then
		voiced[at] = SpokenZones.HasAudio ~= nil and SpokenZones:HasAudio(mapID, key) and true or false
	end
	return voiced[at]
end

local function AnyVoiced(mapID)
	if Voiced(mapID) then return true end
	for _, area in ipairs(Areas(mapID)) do
		if Voiced(area.mapID, area.key) then return true end
	end
	for _, dungeon in ipairs(DungeonsIn(mapID)) do
		if Voiced(dungeon.mapID, dungeon.key) then return true end
	end
	for _, city in ipairs(CitiesIn(mapID)) do
		if AnyVoiced(city) then return true end
	end
	return false
end

local function Missing(mapID)
	local entry = SpokenZones:GetLore(mapID)
	return not entry or SpokenZones:IsPending(entry)
end

-- A place lacking anything: its story, a recording or its picture.
local function Lacks(mapID, key, pending)
	if pending then return true end
	local pictures = SpokenZones.pictures and SpokenZones.pictures[mapID]
	return not Voiced(mapID, key) or not (pictures and pictures[key or ""])
end

-- What a zone holds, found out of all: its areas, each of its dungeons and raids, and its city as
-- one place more with the city's own. Of what is listed: under Voiced Only, what no voice pack
-- reads is left out of the count as it is of the rows, so the line's number is of the rows beneath
-- it. Its page counts the same.
local function Places(mapID)
	local found, total = 0, 0
	for _, city in ipairs(CitiesIn(mapID)) do
		if not OnlyVoiced() or AnyVoiced(city) then
			local f, t = Places(city)
			found, total = found + f, total + t + 1
			if Found(city) then found = found + 1 end
		end
	end
	for _, dungeon in ipairs(DungeonsIn(mapID)) do
		if not OnlyVoiced() or Voiced(dungeon.mapID, dungeon.key) then
			total = total + 1
			if Found(dungeon.mapID, dungeon.key) then found = found + 1 end
		end
	end
	for _, area in ipairs(Areas(mapID)) do
		if not OnlyVoiced() or Voiced(area.mapID, area.key) then
			total = total + 1
			if Found(area.mapID, area.key) then found = found + 1 end
		end
	end
	return found, total
end

-- Whether nothing in a zone is found, the zone itself, its areas, dungeons and city included: its
-- line is then greyed and Discovered Only leaves it out, as a line with nothing found or started in
-- it is on the Quests and Readables tabs.
local function NothingFound(mapID)
	return not Found(mapID) and (Places(mapID)) == 0
end

-- A zone's dungeons and raids found out of all, of those Voiced Only lists.
local function DungeonCount(zone)
	local found, total = 0, 0
	for _, dungeon in ipairs(DungeonsIn(zone)) do
		if not OnlyVoiced() or Voiced(dungeon.mapID, dungeon.key) then
			total = total + 1
			if Found(dungeon.mapID, dungeon.key) then found = found + 1 end
		end
	end
	return found, total
end

-- A zone's dungeons and raids: one a line of its own, several under a Dungeons and Raids line that
-- counts them. A dungeon's story is its area's, so nothing opens under its line. A search lists the
-- dungeons that match, or all of them where it names what holds them (`whole`).
local function DungeonRows(zone, nest, whole)
	local listed = DungeonsIn(zone)
	if #listed == 0 then return {} end
	local several = #listed > 1
	if several then whole = Named(L.DUNGEONS, whole) end
	local dungeonRows = {}
	local found, total = DungeonCount(zone)
	for _, dungeon in ipairs(listed) do
		local isFound = Found(dungeon.mapID, dungeon.key) and true or false
		if not OnlyVoiced() or Voiced(dungeon.mapID, dungeon.key) then
			if (isFound or not OnlyFound()) and (filter == "" or whole or Matches(dungeon.name)) then
				table.insert(dungeonRows, { leaf = true, kind = "dungeon", mapID = dungeon.mapID, key = dungeon.key,
					label = dungeon.name, nest = several and nest + 1 or nest, done = isFound,
					missing = Lacks(dungeon.mapID, dungeon.key, not isFound or SpokenZones:IsPending(dungeon.entry)) })
			end
		end
	end
	if #dungeonRows == 0 then return {} end
	if not several then return dungeonRows end
	local closeKey = "d" .. zone
	local shown
	if filter ~= "" and not asLeft then shown = not searchClosed[closeKey] else shown = dungeonsOpen[zone] == true end
	local rows = { { style = "group", kind = "dungeons", zone = zone, label = L.DUNGEONS, nest = nest,
		count = found, total = total, tick = total > 0 and found == total,
		none = found == 0, open = shown, closeKey = closeKey, asLeft = asLeft } }
	if shown then
		for _, row in ipairs(dungeonRows) do table.insert(rows, row) end
	end
	return rows
end

-- One zone's line, and under it when it is open its city's line (a zone of its own, with
-- its own areas), its dungeons' and raids' lines and its areas' rows. A search opens every line
-- with a match inside and lists the areas that match, or all of them where it names the zone or a
-- line around it (`whole`); a line it opened closes and opens again on a click. Nothing when
-- neither the zone nor anything inside matches the search. A city's line opens on its own, and
-- shows only while its zone is open. A zone not yet discovered is greyed, as a line with none found
-- is on the other tabs, and opens all the same: its areas are listed, those not found locked.
local function ZoneRows(mapID, nest, whole)
	if OnlyFound() and NothingFound(mapID) then return {} end
	if OnlyVoiced() and not AnyVoiced(mapID) then return {} end
	local zoneName = ZoneName(mapID)
	whole = Named(zoneName, whole)
	local searched = filter ~= "" and not asLeft
	local closeKey = "z" .. mapID
	local open = openZones[mapID] == true
	local inside = {}
	local found, total = Places(mapID)
	if open or searched then
		for _, city in ipairs(CitiesIn(mapID)) do
			for _, row in ipairs(ZoneRows(city, nest + 1, whole)) do table.insert(inside, row) end
		end
		for _, row in ipairs(DungeonRows(mapID, nest + 1, whole)) do table.insert(inside, row) end
		for _, area in ipairs(Areas(mapID)) do
			local isFound = Found(area.mapID, area.key)
			local name = area.entry.name or area.key
			if (filter == "" or whole or Matches(name)) and (isFound or not OnlyFound())
				and (not OnlyVoiced() or Voiced(area.mapID, area.key)) then
				table.insert(inside, { kind = "subzone", leaf = true, mapID = area.mapID, key = area.key, label = name,
					nest = nest + 1, missing = Lacks(area.mapID, area.key, SpokenZones:IsPending(area.entry)),
					locked = not Discovered(area.mapID, area.key), done = isFound and true or false })
			end
		end
	end
	if filter ~= "" and not whole and #inside == 0 then return {} end
	-- Closed with a click during this search: the line alone.
	local shown
	if searched then shown = not searchClosed[closeKey] else shown = open end
	local rows = { { style = "group", kind = "zone", mapID = mapID, label = zoneName, nest = nest,
		count = found, total = total, tick = total > 0 and found == total,
		none = found == 0 and not Found(mapID),
		open = searched and shown and #inside > 0 or not searched and shown,
		closeKey = closeKey, asLeft = asLeft, missing = Lacks(mapID, nil, Missing(mapID)) } }
	if shown then
		for _, row in ipairs(inside) do table.insert(rows, row) end
	end
	return rows
end

-- What a banner counts: the places its zones' lines count, found out of all, of the lines Discovered
-- Only and Voiced Only list. Also how many lines it lists, and whether any of its zones is found,
-- listed or not, without which Discovered Only leaves it out.
local function BannerCount(zones)
	local found, total, listed, anyFound = 0, 0, 0, false
	for _, mapID in ipairs(zones) do
		local isFound = not NothingFound(mapID)
		anyFound = anyFound or isFound
		if not (OnlyFound() and not isFound) and not (OnlyVoiced() and not AnyVoiced(mapID)) then
			local f, t = Places(mapID)
			found, total, listed = found + f, total + t, listed + 1
		end
	end
	return found, total, listed, anyFound
end

-- The list: a banner for each continent, its zones' lines under it, and the opened zones'
-- areas. While searching, every match a click could reach, with what holds it opened to show it.
local function BuildRowList()
	voiced = {}
	local list = {}
	local function Add(rows) for _, row in ipairs(rows) do table.insert(list, row) end end
	local searching = filter ~= ""

	-- Azeroth first, a banner as its continents are, with nothing under it to open or count: a click
	-- shows its page. Never locked, so Discovered Only keeps it.
	if SpokenZones.Zones[WORLD] then
		local name = ZoneName(WORLD)
		if (not searching or Matches(name)) and (not OnlyVoiced() or Voiced(WORLD)) then
			table.insert(list, { style = "banner", kind = "world", mapID = WORLD, label = name, missing = Missing(WORLD) })
		end
	end
	for _, continent in ipairs(Continents()) do
		local name = ZoneName(continent)
		local found, total, listed, anyFound = BannerCount(ZonesOf(continent))
		-- A continent opens whether or not any of its zones is found; with none found, Discovered
		-- Only leaves it out. Found through its zones alone: finding Brill finds the Eastern Kingdoms.
		local unfound = not anyFound
		-- A closed continent's zones are never shown, and its count comes from ZonesOf: only a
		-- search, which can open it, needs them built. Named by the search, its every zone's line is
		-- listed as the player left it.
		local zones = {}
		local named = searching and Matches(name)
		if searching or continentOpen[continent] then
			AsLeft(named, function()
				for _, mapID in ipairs(ZonesOf(continent)) do
					for _, row in ipairs(ZoneRows(mapID, 0, named)) do table.insert(zones, row) end
				end
			end)
		end
		local voiced = not OnlyVoiced() or listed > 0
		if (not searching or Matches(name) or #zones > 0) and not (unfound and OnlyFound()) and voiced then
			local open = searching and #zones > 0 or (not searching and continentOpen[continent])
			table.insert(list, { style = "banner", kind = "continent", mapID = continent, label = name,
				count = found, total = total, open = open and true or false, missing = Missing(continent) })
			if open then Add(zones) end
		end
	end
	-- Zones on neither continent with a story, then the battlegrounds, each under a banner of
	-- their own after them, counted and opened as a continent is.
	for _, group in ipairs(GROUPS) do
		local members = group.zones()
		local label = group.label()
		local found, total, listed, anyFound = BannerCount(members)
		local zones = {}
		local named = searching and Matches(label)
		if searching or groupOpen[group.key] then
			AsLeft(named, function()
				for _, mapID in ipairs(members) do
					for _, row in ipairs(ZoneRows(mapID, 0, named)) do table.insert(zones, row) end
				end
			end)
		end
		local voiced = not OnlyVoiced() or listed > 0
		if #members > 0 and (not searching or Matches(label) or #zones > 0) and not (not anyFound and OnlyFound())
			and voiced then
			local open = searching and #zones > 0 or (not searching and groupOpen[group.key])
			table.insert(list, { style = "banner", kind = "group", group = group.key, label = label, count = found,
				total = total, open = open and true or false })
			if open then Add(zones) end
		end
	end
	return list
end

--------------------------------------------------------------------------------
-- The page
--------------------------------------------------------------------------------

-- The zone the player is standing in, resolved to something we actually have lore for.
-- C_Map.GetBestMapForUnit can return an indoor or micro map (an inn, a dungeon) that is not
-- itself a key in Zones, so walk up to its parent.
local function CurrentZoneID()
	local playerMap = SpokenZones:GetPlayerMapID()
	if not playerMap then
		return nil
	end
	local _, resolved = SpokenZones:GetLoreWithFallback(playerMap)
	return resolved
end

-- The continent the player is on, else the first: where the tab lands when no zone of theirs has
-- a story.
local function PlayerContinent()
	local map = SpokenZones:GetPlayerMapID()
	local continent = map and (IsContinent(map) and map or ContinentOf(map))
	if continent and SpokenZones.Zones[continent] then return continent end
	return Continents()[1]
end

-- Choose where the player stands: the area they are in where it has a story of its own, else its
-- zone, opened; their continent where neither resolves. The tab never shows a page with nothing
-- chosen.
local function LandOnPlayer()
	local current = CurrentZoneID()
	if not current or current == WORLD or IsContinent(current) then
		local continent = current and IsContinent(current) and current or PlayerContinent()
		if continent then Reveal(continent) end
		selection = continent and { mapID = continent, key = nil } or nil
		landed = selection
		return
	end
	local subZone = NotSecret(GetSubZoneText())
	local subEntry, subKey, storyMapID
	if subZone and subZone ~= "" then
		subEntry, subKey, storyMapID = SpokenZones:GetSubzoneLore(current, subZone)
	end
	-- In an area whose story is kept under another zone (Razorfen Downs' entrance, Strahnbrad), its
	-- line or row is chosen, by its story's keys.
	if subEntry then current = storyMapID end
	OpenPlace(current, subEntry and subKey or nil)
	selection = { mapID = current, key = subEntry and subKey or nil }
	landed = selection
end

-- Where a place sits, and what its line or banner counts found out of all, as "1 of 7
-- discovered"; no count where there is nothing to count.
local function InAndCount(where, found, total)
	local line = string.format(L.IN_ZONE_FMT, ZoneName(where))
	if total > 0 then line = line .. " · " .. string.format(L.DISCOVERED_FMT, found, total) end
	return line
end

-- An area's portrait: a dungeon's key for a dungeon's, else its zone's.
local function AreaIcon(mapID, key)
	return SpokenCompendium.PlaceIcon(SpokenZones:AreaZone(mapID, key), select(2, SpokenZones:DungeonOf(mapID, key)))
end

local function ShowEntry()
	if selection.dungeons then
		local zone = selection.dungeons
		page:Show({ title = L.DUNGEONS, subtitle = InAndCount(zone, DungeonCount(zone)) })
		return
	end
	if selection.group then
		local group = Group(selection.group)
		local found, total = BannerCount(group.zones())
		page:Show({ title = group.label(), subtitle = InAndCount(WORLD, found, total) })
		return
	end
	local mapID, key = selection.mapID, selection.key
	-- Chosen from elsewhere (the map's panel), a place not found yet: named, and no more.
	if SpokenZones:IsLocked(mapID, key) then
		local entry = key and SpokenZones.Subzones[mapID] and SpokenZones.Subzones[mapID][key]
		-- Where it sits: a zone's or a continent's line counts what is found in it, as every line's
		-- page does.
		page:Show({ title = entry and (entry.name or key) or ZoneName(mapID), subtitle = SpokenZones:PlaceLine(mapID, key),
			text = L.NOT_DISCOVERED, icon = key and AreaIcon(mapID, key) or SpokenCompendium.PlaceIcon(mapID) })
		return
	end
	if key then
		local entry = SpokenZones.Subzones[mapID] and SpokenZones.Subzones[mapID][key]
		if entry then
			local name = entry.name or key
			local line = SpokenZones:PlaceLine(mapID, key)
			if SpokenZones:IsPending(entry) then
				page:Show({ title = name, subtitle = line, icon = AreaIcon(mapID, key),
					contribute = { mapID, name } })
				return
			end
			-- Rows are keyed by the canonical form already, so this needs no normalising --
			-- unlike the map panel, which starts from the name the client reports.
			page:Show({ title = name, subtitle = line, icon = AreaIcon(mapID, key),
				text = entry.full or entry.short or "", audio = { mapID, key }, report = { mapID, key } })
			return
		end
	end

	local entry = SpokenZones:GetLore(mapID)
	local name = ZoneName(mapID)
	local subtitle = SpokenZones:PlaceLine(mapID)
	if not entry or SpokenZones:IsPending(entry) then
		page:Show({ title = name, subtitle = subtitle,
			contribute = { mapID, nil }, icon = SpokenCompendium.PlaceIcon(mapID) })
		return
	end
	page:Show({ title = name, subtitle = subtitle, text = entry.full or entry.short or "",
		audio = { mapID, nil }, report = { mapID, nil }, icon = SpokenCompendium.PlaceIcon(mapID) })
end

local function Count(n, many, one) return n == 1 and one or string.format(many, n) end

--- The line under a place's name: where it sits and what its line or banner counts. An area sits in
--- the zone it is listed in (SpokenZones:AreaZone): a dungeon's entrance's, Strahnbrad's Alterac
--- Mountains. Azeroth sits in nothing, so its line says what it holds.
function SpokenZones:PlaceLine(mapID, key)
	if key then return string.format(L.IN_ZONE_FMT, ZoneName(self:AreaZone(mapID, key))) end
	if mapID == WORLD then
		return Count(#Continents(), L.CONTINENT_COUNT_FMT, L.CONTINENT_COUNT_ONE) .. ", "
			.. Count(#ZoneIDs(), L.ZONE_COUNT_FMT, L.ZONE_COUNT_ONE)
	end
	local parent = self:PlaceAbove(mapID)
	if IsContinent(mapID) then
		local found, total = BannerCount(ZonesOf(mapID))
		return InAndCount(parent, found, total)
	end
	return InAndCount(parent, Places(mapID))
end

--------------------------------------------------------------------------------
-- The list
--------------------------------------------------------------------------------

local function IsSelected(row)
	if not selection then
		return false
	end
	if row.kind == "subzone" or row.kind == "dungeon" then
		return selection.mapID == row.mapID and selection.key == row.key
	end
	if row.kind == "dungeons" then return selection.dungeons == row.zone end
	if row.kind == "group" or selection.group then return row.kind == "group" and selection.group == row.group end
	return selection.mapID == row.mapID and selection.key == nil
end

local function OnRowClick(row)
	-- Shift-click on a story's row queues it behind what is playing, as on Quests, and chooses nothing.
	if (row.kind == "subzone" or row.kind == "dungeon") and IsShiftKeyDown and IsShiftKeyDown() then
		SpokenZones:QueueLore(row.mapID, row.key)
		return
	end
	-- While searching, a banner shows what the search found in it whatever is open: a toggle would
	-- change nothing there, only leave the tree folded when the search is cleared.
	if row.kind == "group" then
		if filter == "" then groupOpen[row.group] = not groupOpen[row.group] end
		selection = { group = row.group }
	elseif row.kind == "continent" then
		-- Each continent opens and closes on its own; a click also chooses it.
		if filter == "" then continentOpen[row.mapID] = not continentOpen[row.mapID] end
		selection = { mapID = row.mapID, key = nil }
	elseif row.kind == "zone" then
		-- Clicking a zone or a city both chooses it and opens or closes its line alone: one the
		-- search opened for this search only, one under a banner it named as unsearched.
		if filter ~= "" and not row.asLeft then
			searchClosed[row.closeKey] = not searchClosed[row.closeKey] or nil
		else
			openZones[row.mapID] = not openZones[row.mapID] or nil
		end
		selection = { mapID = row.mapID, key = nil }
	elseif row.kind == "dungeons" then
		-- Opens or closes the lines under it, as a zone's line does, and chooses its page.
		if filter ~= "" and not row.asLeft then
			searchClosed[row.closeKey] = not searchClosed[row.closeKey] or nil
		else
			dungeonsOpen[row.zone] = not dungeonsOpen[row.zone] or nil
		end
		selection = { dungeons = row.zone }
	else
		selection = { mapID = row.mapID, key = row.key }
	end
	SpokenZones:RefreshLoreWindow()
end

-- What holds a selection, one level up the list, or nil for a continent or a banner: an area's or a
-- dungeon's zone, a Dungeons and Raids line's zone, a city's zone, a zone's continent, Other Lands
-- or Battlegrounds.
local function Holder(chosen)
	if chosen.group then return nil end
	if chosen.dungeons then return { mapID = chosen.dungeons } end
	local mapID, key = chosen.mapID, chosen.key
	if key then return { mapID = SpokenZones:DungeonOf(mapID, key) or SpokenZones:AreaZone(mapID, key) } end
	if not mapID or mapID == WORLD or IsContinent(mapID) then return nil end
	if CITY_IN[mapID] then return { mapID = CITY_IN[mapID] } end
	if IS_BATTLEGROUND[mapID] then return { group = "battlegrounds" } end
	local continent = ContinentOf(mapID)
	if continent then return { mapID = continent } end
	return { group = "lands" }
end

-- Whether the list as last drawn shows `chosen`'s row.
local function Shows(chosen)
	local was = selection
	selection = chosen
	local shown = list:ListsAny(IsSelected)
	selection = was
	return shown
end

-- A filter in the menu left the chosen row out of the list. Where the tab chose it for the player,
-- it lands again; where the player chose it, the nearest row above it the list still shows is
-- chosen, else it lands. As the Quests tab does.
local function OnHidden()
	if selection ~= landed then
		local up = selection and Holder(selection)
		while up and not Shows(up) do up = Holder(up) end
		selection = up
	else
		selection = nil
	end
	SpokenZones:RefreshLoreWindow(true)
end

function SpokenZones:RefreshLoreWindow(scrollToSelection)
	if not list then
		return
	end
	if not selection then
		LandOnPlayer()
		scrollToSelection = true
	end
	local items = list:Render()
	if scrollToSelection and selection then
		list:ScrollToChosen(items)
	end
	if selection then ShowEntry() end
end

--------------------------------------------------------------------------------
-- Construction
--------------------------------------------------------------------------------

-- The places' tab: the tree down the left, the story on the spellbook's page beside it.
local function BuildPanel(p)
	panel = p
	list = SpokenCompendium.NewList(p, {
		search = L.LORE_SEARCH,
		none = L.LORE_SEARCH_NONE,
		only = L.LORE_DISCOVERED_ONLY,
		onlyGet = OnlyFound,
		onlySet = function(on) SpokenZones:Set("loreDiscoveredOnly", on) end,
		checks = { { label = L.LORE_VOICED_ONLY, get = OnlyVoiced,
			set = function(on) SpokenZones:Set("loreVoicedOnly", on) end } },
		build = BuildRowList,
		isSelected = IsSelected,
		onClick = OnRowClick,
		locked = function() return L.NOT_DISCOVERED end,
		onHidden = OnHidden,
		onSearch = function(text)
			SetFilter(text)
			SpokenZones:RefreshLoreWindow()
		end,
		addScrollBar = function(scroll, child, inset) return SpokenTextView.AddScrollBar(scroll, child, inset) end,
	})
	p.Refresh = function() SpokenZones:RefreshLoreWindow() end
	p.inset, p.filterButton, p.filterMenu, p.noMatch, p.listBar = list.inset, list.filterButton, list.filterMenu, list.noMatch, list.bar

	-- The story: the spellbook's page down the rest of the window.
	page = SpokenZones:CreateLorePage(C.PageHolder(p, list), "book")
	p.page = page

	-- Toggling "Hide Contribute Buttons" in Spoken's settings fires no game event.
	if _G.Spoken and Spoken.RegisterCallback then
		Spoken:RegisterCallback("CONTRIBUTE_SETTINGS_CHANGED", function()
			SpokenZones:RefreshLoreWindow()
		end)
		-- Nor does Hide Report Buttons.
		Spoken:RegisterCallback("REPORT_SETTINGS_CHANGED", function()
			SpokenZones:RefreshLoreWindow()
		end)
	end

	SpokenZones.window = p
end

--------------------------------------------------------------------------------
-- Public
--------------------------------------------------------------------------------

-- The tab's list, built now where Zones was off at login and has been switched on since; nil
-- while Zones is off.
local function Built()
	if not list then SpokenCompendium:Select("places") end
	return list
end

function SpokenZones:ToggleLoreWindow()
	if SpokenCompendium:IsOpen("places") then
		SpokenCompendium:Hide()
		return
	end
	if not Built() then
		return
	end

	-- Opened on where the player stands now, unless they chose a place here: the refresh lands
	-- again on a selection that was only ever where they stood.
	if selection == landed then selection = nil end

	list:ClearSearch()
	SetFilter("")
	SpokenCompendium:Open("places")
	-- A window closed folded would reopen as the bare list.
	SpokenCompendium:Expand()
	SpokenZones:RefreshLoreWindow(true)
end

-- Open on a named entry rather than on the player's location. Not routed through
-- ToggleLoreWindow, which can land on where the player stands: narration outlives the zone you
-- started it in.
function SpokenZones:ShowLoreFor(mapID, areaKey)
	if not mapID or not Built() then
		return
	end
	OpenPlace(mapID, areaKey)
	selection = { mapID = mapID, key = areaKey }
	list:ClearSearch()
	SetFilter("")
	SpokenCompendium:Open("places")
	-- Asked for an entry, so show it: a window closed collapsed would reopen as the bare list.
	SpokenCompendium:Expand()
	SpokenZones:RefreshLoreWindow(true)
end


function SpokenZones:SetupLoreWindow()
	if list then
		return
	end
	SpokenCompendium:Register("places", {
		label = L.COMPENDIUM_PLACES,
		order = 1,
		build = BuildPanel,
		-- A place found since the window last opened is listed now. Come back to from another tab,
		-- the tab is on where the player stands now, unless they chose a place here.
		onShow = function()
			if SpokenZones.RefreshFound then SpokenZones:RefreshFound() end
			if selection == landed then selection = nil end
		end,
		-- Opened from Spoken's menu and page on where the player stands, as from the map.
		open = function() SpokenZones:ToggleLoreWindow() end,
		enabled = function() return SpokenZones:IsPartOn() end,
		-- Unlock Undiscovered Zones, on Spoken's page.
		unlock = {
			get = function() return SpokenZones:Get("showUndiscovered") == true end,
			set = function(value)
				SpokenZones:Set("showUndiscovered", value)
				if SpokenZones.ApplyPanelOptions then SpokenZones:ApplyPanelOptions() end
				SpokenZones:RefreshLoreWindow()
			end,
		},
	})
	-- Text Size, on Spoken's page, fires no game event: the story here and beside the map drawn
	-- again at the new size.
	if _G.Spoken and Spoken.RegisterCallback then
		Spoken:RegisterCallback("COMPENDIUM_FONT_CHANGED", function()
			if SpokenZones.ApplyPanelOptions then SpokenZones:ApplyPanelOptions() end
			SpokenZones:RefreshLoreWindow()
		end)
	end
	-- Built now, hidden, so the map's panel and the settings can open it at once, as the Compendium
	-- builds a tab's panel. Not chosen: Select would make it the tab the window first opens on,
	-- not the first tab.
	local tab = SpokenCompendium:Tab("places")
	if SpokenZones:IsPartOn() and not tab.panel then
		local window = SpokenCompendium:Window()
		local p = CreateFrame("Frame", nil, window)
		p:SetAllPoints(window)
		p:Hide()
		tab.panel = p
		BuildPanel(p)
		p:Refresh()
	end
end
