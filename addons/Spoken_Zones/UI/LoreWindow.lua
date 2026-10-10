-- SpokenZones -- the places in Azeroth's Compendium (UI/Compendium.lua): every place's story, to
-- browse and listen to anywhere.
--
-- Opened from the minimap menu, the Zones settings page or /spz window. Independent of
-- WorldMapFrame, so it works with the map closed.
--
-- The window, its list and its rows are the Compendium's; this is what goes in them. On the left,
-- the places as a tree: Azeroth, its two continents, each continent's zones, and the opened zone's
-- areas. On the right, the story on the spellbook's parchment (UI/LorePage.lua).
--
-- Only one zone expands at a time, which caps the list at the zones plus one zone's areas, about a
-- hundred rows -- few enough that every row can be a real button. A search shows every match
-- instead, and is short by being a search.

local ADDON_NAME, SpokenZones = ...

local L = SpokenZones.L

local panel, list, page
local expandedZone = nil
-- Azeroth and its continents start open, so the zones show; each opens and closes on its own.
local worldOpen = true
local continentOpen = { [1414] = true, [1415] = true }
local selection = nil -- { mapID = , key = nil|string }
-- Sorted once, as sortedZoneIDs is: the tree is rebuilt on every click and keystroke, and the
-- data under it is fixed for the session (a language change reloads the interface).
local sortedZoneIDs = nil
local zonesOfContinent = {}
local sortedSubzoneKeys = {}
local filter = ""   -- what the list's search box holds, lowered (UI/Compendium.lua's List)

--------------------------------------------------------------------------------
-- Data ordering
--------------------------------------------------------------------------------

local function ZoneName(mapID)
	return SpokenZones:GetMapName(mapID) or (SpokenZones.Zones[mapID] and SpokenZones.Zones[mapID].name) or tostring(mapID)
end

-- The world, its continents, the cities inside the zone around each, and which continent a zone is
-- on: Compendium.lua's, which every tab lays its tree out by.
local WORLD, CONTINENTS, CITY_IN = SpokenCompendium.WORLD, SpokenCompendium.CONTINENTS, SpokenCompendium.CITY_IN
local ContinentOf = SpokenCompendium.ContinentOf
SpokenZones.CityIn = CITY_IN

local function IsContinent(mapID)
	return mapID == 1414 or mapID == 1415
end


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

--- A continent's zones, alphabetical; nil for the zones on no continent the game names.
local function ZonesOf(continent)
	if zonesOfContinent[continent] then return zonesOfContinent[continent] end
	local list = {}
	for _, mapID in ipairs(ZoneIDs()) do
		if ContinentOf(mapID) == continent and not CITY_IN[mapID] then table.insert(list, mapID) end
	end
	zonesOfContinent[continent] = list
	return list
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
	worldOpen = true
	local continent = IsContinent(mapID) and mapID or ContinentOf(mapID)
	if continent then continentOpen[continent] = true end
end

-- Whether this is the Forever client, which knows its own maps (Mount Hyjal's, 2482).
local onForever
local function OnForever()
	if onForever == nil then
		onForever = C_Map and C_Map.GetMapInfo and C_Map.GetMapInfo(2482) ~= nil or false
	end
	return onForever
end

local function SubzoneKeys(mapID)
	local tbl = SpokenZones.Subzones[mapID]
	if not tbl then
		return nil
	end
	if sortedSubzoneKeys[mapID] then return sortedSubzoneKeys[mapID] end
	-- Not the areas only Forever has (Data/ForeverAreas.lua) on another client, which can never
	-- report them: listed, they would never be found.
	local foreverOnly = not OnForever() and SpokenZones.ForeverOnlyAreas and SpokenZones.ForeverOnlyAreas[mapID] or {}
	local keys = {}
	for key in pairs(tbl) do
		if not foreverOnly[key] then table.insert(keys, key) end
	end
	table.sort(keys, function(a, b)
		return (tbl[a].name or a) < (tbl[b].name or b)
	end)
	sortedSubzoneKeys[mapID] = keys
	return keys
end

local function Matches(text)
	return filter == "" or (text and string.find(string.lower(text), filter, 1, true) ~= nil)
end

-- Whether this character has found a place (Discovery.lua), whatever Unlock Undiscovered Zones
-- says: the counts and Discovered Only go by it.
local function Found(mapID, key)
	return SpokenZones:IsFound(mapID, key)
end

-- Whether a place can be opened: every place with Unlock Undiscovered Zones on, otherwise only
-- those found. The rest are listed greyed out.
local function Discovered(mapID, key)
	return SpokenZones:ShowsUndiscovered() or Found(mapID, key)
end

--- Whether a place is locked for this character: not found yet, with Unlock Undiscovered Zones
--- off. A continent is found through its zones; Azeroth always is. The page and the map's panel
--- say so in its place rather than tell its story.
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

local function Voiced(mapID, key)
	return SpokenZones.HasAudio ~= nil and SpokenZones:HasAudio(mapID, key) and true or false
end

local function AnyVoiced(mapID)
	if Voiced(mapID) then return true end
	for _, key in ipairs(SubzoneKeys(mapID) or {}) do
		if Voiced(mapID, key) then return true end
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

-- One zone's rows: itself, and under it when it is open its city (a zone of its own, with its
-- own areas) and its areas; while searching, the ones that match. Nothing when neither it nor
-- anything inside matches the search. A zone stays open while its city is. A zone not yet
-- discovered is listed locked: greyed out, and it does not open.
local function ZoneRows(mapID, depth)
	if OnlyFound() and not Found(mapID) then return {} end
	if OnlyVoiced() and not AnyVoiced(mapID) then return {} end
	local locked = not Discovered(mapID)
	local subKeys = SubzoneKeys(mapID)
	local zoneName = ZoneName(mapID)
	local open = (expandedZone == mapID or CITY_IN[expandedZone] == mapID) and not locked
	local cities = CitiesIn(mapID)
	local inside = {}
	-- Found out of all, of what is listed: under Voiced Only, what no voice pack reads is left
	-- out of the count as it is of the rows, so the number is of the rows beneath it.
	local found, total = 0, 0
	for _, city in ipairs(cities) do
		if not OnlyVoiced() or AnyVoiced(city) then
			total = total + 1
			if Found(city) then found = found + 1 end
		end
		if filter ~= "" or open then
			for _, row in ipairs(ZoneRows(city, depth + 1)) do table.insert(inside, row) end
		end
	end
	if subKeys then
		for _, key in ipairs(subKeys) do
			local isFound = Found(mapID, key)
			if not OnlyVoiced() or Voiced(mapID, key) then
				total = total + 1
				if isFound then found = found + 1 end
			end
			local entry = SpokenZones.Subzones[mapID][key]
			local name = entry.name or key
			local shown = filter == "" and open or filter ~= "" and Matches(name)
			if shown and (isFound or not OnlyFound()) and (not OnlyVoiced() or Voiced(mapID, key)) then
				table.insert(inside, { kind = "subzone", leaf = true, mapID = mapID, key = key, label = name,
					depth = depth + 1, missing = SpokenZones:IsPending(entry), locked = not Discovered(mapID, key) })
			end
		end
	end
	if filter ~= "" and not Matches(zoneName) and #inside == 0 then return {} end
	local rows = { { kind = "zone", mapID = mapID, label = zoneName, depth = depth,
		count = found, total = total,
		open = filter ~= "" and #inside > 0 or open,
		missing = Missing(mapID), locked = locked } }
	for _, row in ipairs(inside) do table.insert(rows, row) end
	return rows
end

-- Flatten the tree into display rows: Azeroth, each continent under it, each continent's zones
-- under that, and the expanded zone's areas. While searching, every match with what holds it,
-- opened to show it.
local function BuildRowList()
	local list = {}
	local function Add(rows) for _, row in ipairs(rows) do table.insert(list, row) end end
	local searching = filter ~= ""

	local continents = {}
	for _, continent in ipairs(Continents()) do
		-- A closed continent's zones are never shown, and its count comes from ZonesOf: only
		-- a search, which can open it, needs them built.
		local zones = {}
		if searching or continentOpen[continent] then
			for _, mapID in ipairs(ZonesOf(continent)) do
				local rows = ZoneRows(mapID, 2)
				for _, row in ipairs(rows) do table.insert(zones, row) end
			end
		end
		local name = ZoneName(continent)
		-- Counted as a zone's are, of the zones listed; locked by all of them, listed or not.
		local found, total, anyFound = 0, 0, false
		for _, mapID in ipairs(ZonesOf(continent)) do
			local isFound = Found(mapID)
			anyFound = anyFound or isFound
			if not OnlyVoiced() or AnyVoiced(mapID) then
				total = total + 1
				if isFound then found = found + 1 end
			end
		end
		-- A continent with none of its zones found yet is listed locked, and does not open; with
		-- Discovered Only it is left out. Found through its zones alone: finding Brill finds the
		-- Eastern Kingdoms.
		local unfound = not anyFound
		local locked = unfound and not SpokenZones:ShowsUndiscovered()
		local voiced = not OnlyVoiced() or total > 0
		if (not searching or Matches(name) or #zones > 0) and not (unfound and OnlyFound()) and voiced then
			table.insert(continents, { kind = "continent", mapID = continent, label = name, depth = 1,
				count = found, total = total,
				open = searching and #zones > 0 or (not searching and continentOpen[continent] and not locked),
				missing = Missing(continent), zones = zones, locked = locked })
		end
	end
	-- Zones on neither continent with a story, under Azeroth after them.
	local listed = {}
	for _, continent in ipairs(Continents()) do listed[continent] = true end
	local loose = {}
	for _, mapID in ipairs(ZoneIDs()) do
		if not listed[ContinentOf(mapID) or 0] then
			for _, row in ipairs(ZoneRows(mapID, 1)) do table.insert(loose, row) end
		end
	end

	local worldName = ZoneName(WORLD)
	local any = #continents > 0 or #loose > 0
	if SpokenZones.Zones[WORLD] and (not searching or Matches(worldName) or any) then
		local open = searching and any or (not searching and worldOpen)
		table.insert(list, { kind = "world", mapID = WORLD, label = worldName, depth = 0,
			count = #Continents(), open = open, missing = Missing(WORLD) })
		if not open then return list end
	end
	for _, continent in ipairs(continents) do
		table.insert(list, continent)
		if continent.open then Add(continent.zones) end
	end
	Add(loose)
	return list
end

--------------------------------------------------------------------------------
-- The page
--------------------------------------------------------------------------------

local function ShowEntry()
	if not selection then
		page:Show({ title = L.LORE_PICK, text = L.LORE_WINDOW_EMPTY, empty = true })
		return
	end

	local mapID, key = selection.mapID, selection.key
	-- Chosen from elsewhere (the map's panel), a place not found yet: named, and no more.
	if SpokenZones:IsLocked(mapID, key) then
		local entry = key and SpokenZones.Subzones[mapID] and SpokenZones.Subzones[mapID][key]
		-- Where it sits, a click away: the zone for an area, the continent for a zone.
		local up = key and mapID or (IsContinent(mapID) and WORLD or ContinentOf(mapID) or WORLD)
		local line = string.format(L.IN_ZONE_FMT, ZoneName(up))
		page:Show({ title = entry and (entry.name or key) or ZoneName(mapID), subtitle = line,
			onSubtitle = up and function()
				selection = { mapID = up, key = nil }
				SpokenZones:RefreshLoreWindow()
			end or nil,
			text = L.NOT_DISCOVERED, missing = true })
		return
	end
	if key then
		local entry = SpokenZones.Subzones[mapID] and SpokenZones.Subzones[mapID][key]
		if entry then
			local name = entry.name or key
			local line = SpokenZones:PlaceLine(mapID, key)
			local back = function()
				selection = { mapID = mapID, key = nil }
				SpokenZones:RefreshLoreWindow()
			end
			if SpokenZones:IsPending(entry) then
				page:Show({ title = name, subtitle = line, onSubtitle = back,
					text = L.LORE_NOT_WRITTEN:format(name), missing = true, contribute = { mapID, name } })
				return
			end
			-- Rows are keyed by the canonical form already, so this needs no normalising --
			-- unlike the map panel, which starts from the name the client reports.
			page:Show({ title = name, subtitle = line, onSubtitle = back,
				text = entry.full or entry.short or "", audio = { mapID, key }, report = { mapID, key } })
			return
		end
	end

	local entry = SpokenZones:GetLore(mapID)
	local name = ZoneName(mapID)
	local subtitle, up = SpokenZones:PlaceLine(mapID)
	local onSubtitle = up and function()
		selection = { mapID = up, key = nil }
		SpokenZones:RefreshLoreWindow()
	end or nil
	if not entry or SpokenZones:IsPending(entry) then
		page:Show({ title = name, subtitle = subtitle, onSubtitle = onSubtitle, text = L.LORE_NOT_WRITTEN:format(name),
			missing = true, contribute = { mapID, nil } })
		return
	end
	page:Show({ title = name, subtitle = subtitle, onSubtitle = onSubtitle, text = entry.full or entry.short or "",
		audio = { mapID, nil }, report = { mapID, nil } })
end

local function Count(n, many, one) return n == 1 and one or string.format(many, n) end

--- The line under a place's name: where it sits and how many places it holds. Also returns the
--- map one level up, which a click on the line opens (nil for Azeroth).
function SpokenZones:PlaceLine(mapID, key)
	if key then return string.format(L.IN_ZONE_FMT, ZoneName(mapID)), mapID end
	if mapID == WORLD then
		return Count(#Continents(), L.CONTINENT_COUNT_FMT, L.CONTINENT_COUNT_ONE) .. ", "
			.. Count(#ZoneIDs(), L.ZONE_COUNT_FMT, L.ZONE_COUNT_ONE), nil
	elseif IsContinent(mapID) then
		return string.format(L.IN_ZONE_FMT, ZoneName(WORLD)) .. " · "
			.. Count(#ZonesOf(mapID), L.ZONE_COUNT_FMT, L.ZONE_COUNT_ONE), WORLD
	end
	local parent = CITY_IN[mapID] or ContinentOf(mapID) or WORLD
	local subKeys = SubzoneKeys(mapID)
	local line = string.format(L.IN_ZONE_FMT, ZoneName(parent))
	if subKeys then
		line = line .. " · " .. Count(#subKeys, L.SUBZONE_COUNT_FMT, L.SUBZONE_COUNT_ONE)
	end
	return line, parent
end

--------------------------------------------------------------------------------
-- The list
--------------------------------------------------------------------------------

local function IsSelected(row)
	if not selection then
		return false
	end
	if row.kind == "subzone" then
		return selection.mapID == row.mapID and selection.key == row.key
	end
	return selection.mapID == row.mapID and selection.key == nil
end

local function OnRowClick(row)
	-- While searching the list shows every match opened, whatever is open: a toggle would change
	-- nothing there, only leave the tree folded when the search is cleared. Choose, and no more.
	if filter ~= "" then
		selection = { mapID = row.mapID, key = row.kind == "subzone" and row.key or nil }
	elseif row.kind == "world" then
		-- Azeroth and each continent open and close on their own; a click also chooses them.
		worldOpen = not worldOpen
		selection = { mapID = row.mapID, key = nil }
	elseif row.kind == "continent" then
		continentOpen[row.mapID] = not continentOpen[row.mapID]
		selection = { mapID = row.mapID, key = nil }
	elseif row.kind == "zone" then
		-- Clicking a zone both chooses it and opens or closes its areas: one zone at a time. Not
		-- `open and nil or mapID`, which is mapID either way, so an open zone never closed.
		-- A city closes back to the zone around it, which stays open; that zone closes with it.
		if expandedZone == row.mapID or CITY_IN[expandedZone] == row.mapID then
			expandedZone = CITY_IN[row.mapID]
		else
			expandedZone = row.mapID
		end
		selection = { mapID = row.mapID, key = nil }
	else
		selection = { mapID = row.mapID, key = row.key }
	end
	SpokenZones:RefreshLoreWindow()
end

function SpokenZones:RefreshLoreWindow(scrollToSelection)
	if not list then
		return
	end
	local items = list:Render()
	if scrollToSelection and selection then
		list:ScrollToSelection(items)
	end
	ShowEntry()
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
		onSearch = function(text)
			filter = text
			SpokenZones:RefreshLoreWindow()
		end,
		addScrollBar = function(scroll, child, inset) return SpokenZones:AddScrollBar(scroll, child, inset) end,
	})
	p.Refresh = function() SpokenZones:RefreshLoreWindow() end
	p.inset, p.filterButton, p.filterMenu, p.noMatch, p.listBar = list.inset, list.filterButton, list.filterMenu, list.noMatch, list.bar

	-- The story: the spellbook's page down the rest of the window, in an inset of its own as the
	-- list is -- the way the game's split windows frame each pane (the professions window), so the
	-- two are parted by their borders rather than one running into the other.
	local _, right = SpokenCompendium.Margins()
	local window = SpokenCompendium:Window()
	local okPage, pageInset = pcall(CreateFrame, "Frame", nil, p, "InsetFrameTemplate")
	if not okPage or not pageInset then pageInset = CreateFrame("Frame", nil, p) end
	pageInset:SetPoint("TOPLEFT", list.inset, "TOPRIGHT", 6, 38)
	pageInset:SetPoint("BOTTOMRIGHT", p, "BOTTOMRIGHT", -right, window.templated and 6 or 12)
	p.pageInset = pageInset
	local holder = CreateFrame("Frame", nil, pageInset)
	holder:SetPoint("TOPLEFT", pageInset, "TOPLEFT", 3, -3)
	holder:SetPoint("BOTTOMRIGHT", pageInset, "BOTTOMRIGHT", -3, 3)
	page = SpokenZones:CreateLorePage(holder, "book")
	-- The inset's border over the parchment's edge, not under it.
	if type(pageInset.NineSlice) == "table" and pageInset.NineSlice.SetFrameLevel then
		pageInset.NineSlice:SetFrameLevel(holder:GetFrameLevel() + 5)
	end
	p.page = page

	-- Toggling "Hide Contribute Buttons" in Spoken's settings fires no game event.
	if _G.Spoken and Spoken.RegisterCallback then
		Spoken:RegisterCallback("CONTRIBUTE_SETTINGS_CHANGED", function()
			SpokenZones:RefreshLoreWindow()
		end)
	end

	SpokenZones.window = p
end

--------------------------------------------------------------------------------
-- Public
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

function SpokenZones:ToggleLoreWindow()
	if not list then
		return
	end
	if SpokenCompendium:IsOpen("places") then
		SpokenCompendium:Hide()
		return
	end

	-- Re-sync to where the player is standing on every open, not just the first: opening from the
	-- minimap should land on the current zone, not wherever the last browse ended.
	local current = CurrentZoneID()
	if current then
		-- Standing in an area with lore of its own is more specific than the zone, so prefer it.
		-- Either way the zone is opened.
		local subZone = GetSubZoneText()
		local subEntry, subKey
		if subZone and subZone ~= "" then
			subEntry, subKey = SpokenZones:GetSubzoneLore(current, subZone)
		end
		expandedZone = current
		Reveal(current)
		selection = { mapID = current, key = subEntry and subKey or nil }
	end

	list:ClearSearch()
	filter = ""
	SpokenCompendium:Open("places")
	SpokenZones:RefreshLoreWindow(true)
end

-- Open on a named entry rather than on the player's location. Not routed through
-- ToggleLoreWindow, which re-syncs to where the player stands: narration outlives the zone you
-- started it in.
function SpokenZones:ShowLoreFor(mapID, areaKey)
	if not list or not mapID then
		return
	end
	expandedZone = mapID
	Reveal(mapID)
	selection = { mapID = mapID, key = areaKey }
	list:ClearSearch()
	filter = ""
	SpokenCompendium:Open("places")
	-- Asked for an entry, so show it: a window closed collapsed would reopen as the bare list.
	SpokenCompendium:Expand()
	SpokenZones:RefreshLoreWindow(true)
end

-- The window's size, kept with the rest of Zones' settings as it was when it was Lore of Azeroth.
local SIZE_KEYS = { width = "loreWindowWidth", height = "loreWindowHeight" }

function SpokenZones:SetupLoreWindow()
	if list then
		return
	end
	SpokenCompendium:Register("places", {
		label = L.COMPENDIUM_PLACES,
		order = 1,
		title = L.LORE_WINDOW_TITLE,
		build = BuildPanel,
		-- A place found since the window last opened is listed now.
		onShow = function() if SpokenZones.RefreshFound then SpokenZones:RefreshFound() end end,
		store = {
			get = function(key) return SpokenZones:Get(SIZE_KEYS[key]) end,
			set = function(key, value) SpokenZones:Set(SIZE_KEYS[key], value) end,
		},
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
	-- Built now, hidden, so the map's panel and the settings can open it at once.
	SpokenCompendium:Select("places")
end
