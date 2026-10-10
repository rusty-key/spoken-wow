-- SpokenBooks -- the readables in Azeroth's Compendium (UI/Compendium.lua): every book, letter,
-- note and plaque Spoken Books reads, found or not, to read and listen to anywhere.
--
-- The tree is the places' (Spoken Zones' tab): Azeroth, its continents, their zones, a city
-- inside the zone around it; under an opened zone its readables by what they are -- books, letters,
-- notes, scrolls, tablets, plaques, gravestones, exhibits. After the continents, those had in too
-- many zones to list under each, and those whose origin is not known. With By Zone off, the tree is
-- the types alone, every readable under its own. Where each is comes from
-- Data/Places.lua; what this character has found, from SpokenBooksCharacter (Core.lua). A readable
-- not found yet is listed greyed, with a padlock, and does not open, unless Unlock Unfound
-- Readables is on. On the right its pages, on parchment, with where it comes from and Play.

local ADDON_NAME, SpokenBooks = ...

local L = SpokenBooks.L

local C = SpokenCompendium
local WORLD, CONTINENTS, CITY_IN = C.WORLD, C.CONTINENTS, C.CITY_IN
local MapName, ContinentOf = C.MapName, C.ContinentOf

local list, page
local selection          -- { book = id } | { mapID = id } | { group = "wide"|"unknown" } | nil
local expandedZone
local worldOpen = true
local continentOpen = { [1414] = true, [1415] = true }
local groupOpen = { wide = false, unknown = false }
local typeOpen = {}
local zoneTypeShut = {}       -- ["mapID:type"] = true: a zone's Books, Notes and the rest, closed
local TYPES, TYPE_NAMES = SpokenBooks.TYPES, SpokenBooks.TYPE_NAMES
local function TypeLabel(type) return L[(TYPE_NAMES[type] or TYPE_NAMES.other).all] end
local filter = ""

--------------------------------------------------------------------------------
-- What there is
--------------------------------------------------------------------------------

local function Books()
	local data = SpokenBooks:Data()
	return data and data.books or {}
end

local function Title(id)
	local book = Books()[id]
	return book and book.title or tostring(id)
end

-- Every readable by where it is: index.zones[mapID] = { [type] = { ids } }, the two groups, the
-- types, and `all`, what every count is out of. A readable Data/Places.lua does not carry is left
-- out everywhere: places.mjs drops the Deprecated and TEST items no one can find, and counting
-- them would keep every total out of reach. Built once: the data is fixed for the session.
local index
local function Index()
	if index then return index end
	index = { zones = {}, wide = {}, unknown = {}, types = {}, all = {} }
	local places = _G.SpokenBooksPlaces and SpokenBooksPlaces.books or {}
	local function Add(mapID, type, id)
		local zone = index.zones[mapID] or {}
		index.zones[mapID] = zone
		zone[type] = zone[type] or {}
		table.insert(zone[type], id)
	end
	for id in pairs(Books()) do
		local place = places[id]
		if place or not _G.SpokenBooksPlaces then
			index.all[id] = true
			local type = place and TYPE_NAMES[place.type] and place.type or "other"
			index.types[type] = index.types[type] or {}
			table.insert(index.types[type], id)
			if place and place.wide then
				table.insert(index.wide, id)
			elseif place and place.zones and #place.zones > 0 then
				for _, mapID in ipairs(place.zones) do Add(mapID, type, id) end
			else
				table.insert(index.unknown, id)
			end
		end
	end
	local function ByTitle(a, b)
		local ta, tb = Title(a), Title(b)
		if ta == tb then return a < b end
		return ta < tb
	end
	for _, zone in pairs(index.zones) do
		for _, ids in pairs(zone) do table.sort(ids, ByTitle) end
	end
	for _, ids in pairs(index.types) do table.sort(ids, ByTitle) end
	table.sort(index.wide, ByTitle)
	table.sort(index.unknown, ByTitle)
	return index
end

local function Found(id)
	return SpokenBooks:IsBookFound(id)
end

local function Unlocked()
	return SpokenBooksSettings and SpokenBooksSettings.unlockUnfound == true
end

local function OnlyFound()
	return SpokenBooksSettings and SpokenBooksSettings.compendiumFoundOnly == true
end

-- Voiced Only, after Found Only in the filter menu: what no installed voice pack reads is left out,
-- and with it any zone, type or group left with nothing. A writing is voiced as Play finds it: its
-- first page has a recording.
local function OnlyVoiced()
	return SpokenBooksSettings ~= nil and SpokenBooksSettings.compendiumVoicedOnly == true
end

local function Voiced(id)
	local book = Books()[id]
	return book ~= nil and SpokenBooks:HasAudio(book.pages[1]) and true or false
end

-- Whether a set of writings ({ [id] = true }) has one to list under Voiced Only.
local function Listed(set)
	if not OnlyVoiced() then return true end
	for id in pairs(set) do
		if Voiced(id) then return true end
	end
	return false
end

-- By Zone, under the list: on, zones then types; off, the types alone.
local function ByZone()
	return not (SpokenBooksSettings and SpokenBooksSettings.compendiumByZone == false)
end

local function Matches(text)
	return filter == "" or (text and string.find(string.lower(text), filter, 1, true) ~= nil)
end

local function ByName(a, b)
	local na, nb = MapName(a), MapName(b)
	if na == nb then return a < b end
	return na < nb
end

-- The zones on `continent` that have readables, cities left to the zone around them.
local function ZonesOn(continent)
	local out = {}
	for mapID in pairs(Index().zones) do
		if not CITY_IN[mapID] and ContinentOf(mapID) == continent then table.insert(out, mapID) end
	end
	-- A zone with no readables of its own but a city that has some.
	for city, zone in pairs(CITY_IN) do
		if Index().zones[city] and ContinentOf(zone) == continent then
			local listed = false
			for _, z in ipairs(out) do if z == zone then listed = true end end
			if not listed then table.insert(out, zone) end
		end
	end
	table.sort(out, ByName)
	return out
end

-- Every readable under `mapID`, its city's included, each once.
local function ReadablesIn(mapID, into)
	into = into or {}
	local zone = Index().zones[mapID]
	if zone then
		for _, ids in pairs(zone) do
			for _, id in ipairs(ids) do into[id] = true end
		end
	end
	for city, around in pairs(CITY_IN) do
		if around == mapID then ReadablesIn(city, into) end
	end
	return into
end

-- Found out of all, of what is listed: under Voiced Only, what no voice pack reads is left out of
-- the count as it is of the rows, so the number is of the rows beneath it.
local function Tally(set)
	local found, total = 0, 0
	for id in pairs(set) do
		if not OnlyVoiced() or Voiced(id) then
			total = total + 1
			if Found(id) then found = found + 1 end
		end
	end
	return found, total
end

--------------------------------------------------------------------------------
-- The rows
--------------------------------------------------------------------------------

local function Leaf(id, depth)
	if OnlyFound() and not Found(id) then return nil end
	if OnlyVoiced() and not Voiced(id) then return nil end
	if filter ~= "" and not Matches(Title(id)) then return nil end
	return { kind = "readable", leaf = true, book = id, label = Title(id), depth = depth,
		locked = not Found(id) and not Unlocked() }
end

local function Leaves(ids, depth, into)
	for _, id in ipairs(ids) do
		local row = Leaf(id, depth)
		if row then table.insert(into, row) end
	end
end

-- A zone's rows: itself, and when it is open (or a search finds something in it) its city, then
-- its readables by type.
local function ZoneRows(mapID, depth)
	local all = ReadablesIn(mapID)
	local found, total = Tally(all)
	if OnlyFound() and found == 0 then return {} end
	if not Listed(all) then return {} end
	local open = expandedZone == mapID or CITY_IN[expandedZone] == mapID
	local inside = {}
	if open or filter ~= "" then
		for city, around in pairs(CITY_IN) do
			if around == mapID and Index().zones[city] then
				for _, row in ipairs(ZoneRows(city, depth + 1)) do table.insert(inside, row) end
			end
		end
		local zone = Index().zones[mapID]
		for _, type in ipairs(TYPES) do
			local ids = zone and zone[type] or {}
			if #ids > 0 then
				local leaves = {}
				Leaves(ids, depth + 2, leaves)
				if #leaves > 0 then
					local set = {}
					for _, id in ipairs(ids) do set[id] = true end
					local f, t = Tally(set)
					-- Open until closed, and always while searching.
					local shut = filter == "" and zoneTypeShut[mapID .. ":" .. type]
					table.insert(inside, { kind = "group", which = type, mapID = mapID, depth = depth + 1,
						label = TypeLabel(type), count = f, total = t, open = not shut })
					if not shut then
						for _, row in ipairs(leaves) do table.insert(inside, row) end
					end
				end
			end
		end
	end
	if filter ~= "" and #inside == 0 and not Matches(MapName(mapID)) then return {} end
	local rows = { { kind = "zone", mapID = mapID, label = MapName(mapID), depth = depth,
		count = found, total = total, open = (open or filter ~= "") and #inside > 0 } }
	for _, row in ipairs(inside) do table.insert(rows, row) end
	return rows
end

local function GroupRows(key, label, ids)
	if #ids == 0 then return {} end
	local set = {}
	for _, id in ipairs(ids) do set[id] = true end
	local found, total = Tally(set)
	if OnlyFound() and found == 0 then return {} end
	if not Listed(set) then return {} end
	local leaves = {}
	if groupOpen[key] or filter ~= "" then Leaves(ids, 2, leaves) end
	if filter ~= "" and #leaves == 0 then return {} end
	local rows = { { kind = "group", which = key, depth = 1, label = label, count = found, total = total,
		open = #leaves > 0 } }
	for _, row in ipairs(leaves) do table.insert(rows, row) end
	return rows
end

-- By Zone off: each type, every readable of it under it.
local function TypeRows()
	local out = {}
	for _, type in ipairs(TYPES) do
		local ids = Index().types[type] or {}
		if #ids > 0 then
			local set = {}
			for _, id in ipairs(ids) do set[id] = true end
			local found, total = Tally(set)
			local leaves = {}
			if typeOpen[type] or filter ~= "" then Leaves(ids, 1, leaves) end
			if not (OnlyFound() and found == 0) and Listed(set) and (filter == "" or #leaves > 0) then
				table.insert(out, { kind = "type", which = type, depth = 0, label = TypeLabel(type), count = found,
					total = total, open = #leaves > 0 })
				for _, row in ipairs(leaves) do table.insert(out, row) end
			end
		end
	end
	return out
end

local function BuildRows()
	if not ByZone() then return TypeRows() end
	local out = {}
	local function Add(rows) for _, row in ipairs(rows) do table.insert(out, row) end end
	local searching = filter ~= ""
	local continents = {}
	for _, continent in ipairs(CONTINENTS) do
		local zones = ZonesOn(continent)
		if #zones > 0 then
			local set = {}
			for _, mapID in ipairs(zones) do ReadablesIn(mapID, set) end
			local found, total = Tally(set)
			local rows = {}
			if searching or continentOpen[continent] then
				for _, mapID in ipairs(zones) do
					for _, row in ipairs(ZoneRows(mapID, 2)) do table.insert(rows, row) end
				end
			end
			if not (OnlyFound() and found == 0) and Listed(set) and (not searching or #rows > 0) then
				table.insert(continents, { kind = "continent", mapID = continent, label = MapName(continent), depth = 1,
					count = found, total = total, open = searching and #rows > 0 or (not searching and continentOpen[continent]),
					rows = rows })
			end
		end
	end
	table.sort(continents, function(a, b) return a.label < b.label end)
	local found, total = Tally(Index().all)
	table.insert(out, { kind = "world", mapID = WORLD, label = MapName(WORLD), depth = 0, count = found, total = total,
		open = searching or worldOpen })
	if not (searching or worldOpen) then return out end
	for _, continent in ipairs(continents) do
		table.insert(out, continent)
		if continent.open then Add(continent.rows) end
	end
	Add(GroupRows("wide", L.GROUP_WIDE, Index().wide))
	Add(GroupRows("unknown", L.GROUP_UNKNOWN, Index().unknown))
	return out
end

local function IsSelected(row)
	if not selection then return false end
	if row.kind == "readable" then return selection.book == row.book end
	if row.kind == "group" then return selection.group == row.which and selection.mapID == row.mapID end
	if row.kind == "type" then return selection.type == row.which end
	return selection.mapID == row.mapID and not selection.book and not selection.group
end

--------------------------------------------------------------------------------
-- The page
--------------------------------------------------------------------------------

-- Play on a readable's page: the book from its first page, or stop it.
local PLAY = {
	has = function(id) local book = Books()[id] return book ~= nil and SpokenBooks:HasAudio(book.pages[1]) end,
	playing = function(id) return SpokenBooks:IsNarrating(id) end,
	-- Browsing: heard here is not heard in the world (Read Only Once), nor found.
	start = function(id) SpokenBooks:SyncTo(Books()[id].pages[1], true) end,
	stop = function(id) SpokenBooks:StopReading(id) end,
}

-- How a carried readable is had, one line each: "Dropped by Defias Messenger (Westfall)".
local HOW = {
	["drop"] = "FROM_DROP", ["pickpocket"] = "FROM_PICKPOCKET", ["quest start"] = "FROM_QUEST_START",
	["quest reward"] = "FROM_QUEST_REWARD", ["quest"] = "FROM_QUEST", ["mail"] = "FROM_MAIL",
	["object"] = "FROM_OBJECT", ["container"] = "FROM_CONTAINER", ["fishing"] = "FROM_FISHING", ["vendor"] = "FROM_VENDOR",
}

local function LocalName(index)
	local names = _G.SpokenBooksPlaces and SpokenBooksPlaces.names
	local name = names and names[index]
	if not name then return nil end
	local locale = GetLocale and GetLocale() or "enUS"
	return name[locale] or name[1]
end

local function ZoneList(zones)
	local names = {}
	for _, mapID in ipairs(zones or {}) do table.insert(names, MapName(mapID)) end
	return table.concat(names, ", ")
end

local function Sources(place)
	local lines = {}
	for _, from in ipairs(place.from or {}) do
		local key = HOW[from[1]]
		if key and L[key] then
			local name = from[2] and LocalName(from[2])
			local line = name and L[key]:format(name) or (from[1] == "fishing" and L[key] or nil)
			if line then
				local zones = {}
				for i = 3, #from do table.insert(zones, from[i]) end
				if #zones > 0 then line = L.FROM_IN_ZONES:format(line, ZoneList(zones)) end
				table.insert(lines, line)
			end
		end
	end
	return lines
end

local function Count(found, total)
	return L.FOUND_FMT:format(found, total)
end

local function ShowEntry()
	if not page then return end
	if not selection then
		page:Show({ title = L.COMPENDIUM_READABLES, subtitle = Count(Tally(Index().all)), text = L.READABLES_PICK })
		return
	end
	if selection.book then
		local id = selection.book
		local place = _G.SpokenBooksPlaces and SpokenBooksPlaces.books[id] or {}
		local where
		if place.wide then
			where = L.GROUP_WIDE
		elseif place.zones then
			where = (place.kind == "world" and L.KIND_WORLD or L.KIND_CARRIED) .. " · " .. ZoneList(place.zones)
		else
			where = L.GROUP_UNKNOWN
		end
		if not Found(id) and not Unlocked() then
			page:Show({ title = Title(id), subtitle = where, text = L.READABLE_NOT_FOUND })
			return
		end
		local parts = {}
		local sources = Sources(place)
		if #sources > 0 then table.insert(parts, table.concat(sources, "\n")) end
		local data = SpokenBooks:Data()
		for _, pageId in ipairs(Books()[id].pages) do
			local text = data.pages[pageId] and data.pages[pageId].text
			if text and text ~= "" then table.insert(parts, text) end
		end
		page:Show({ title = Title(id), subtitle = where, text = table.concat(parts, "\n\n"), target = id })
		return
	end
	-- A zone, a continent, a group, a type: what it holds.
	local set = {}
	if selection.type then
		for _, id in ipairs(Index().types[selection.type] or {}) do set[id] = true end
		page:Show({ title = TypeLabel(selection.type), subtitle = Count(Tally(set)), text = L.READABLES_PICK })
		return
	end
	if selection.group and selection.mapID and TYPE_NAMES[selection.group] then
		for _, id in ipairs((Index().zones[selection.mapID] or {})[selection.group] or {}) do set[id] = true end
		page:Show({ title = TypeLabel(selection.group), subtitle = MapName(selection.mapID) .. " · " .. Count(Tally(set)),
			text = L.READABLES_PICK })
		return
	end
	if selection.group == "wide" or selection.group == "unknown" then
		for _, id in ipairs(Index()[selection.group]) do set[id] = true end
		page:Show({ title = selection.group == "wide" and L.GROUP_WIDE or L.GROUP_UNKNOWN, subtitle = Count(Tally(set)),
			text = L.READABLES_PICK })
		return
	end
	if selection.mapID == WORLD then
		set = Index().all
	elseif selection.mapID == 1414 or selection.mapID == 1415 then
		for _, mapID in ipairs(ZonesOn(selection.mapID)) do ReadablesIn(mapID, set) end
	else
		ReadablesIn(selection.mapID, set)
	end
	page:Show({ title = MapName(selection.mapID), subtitle = Count(Tally(set)), text = L.READABLES_PICK })
end

--------------------------------------------------------------------------------
-- The tab
--------------------------------------------------------------------------------

local function OnClick(row)
	if row.kind == "readable" then
		selection = { book = row.book }
	elseif row.kind == "type" then
		if filter == "" then typeOpen[row.which] = not typeOpen[row.which] end
		selection = { type = row.which }
	elseif filter ~= "" then
		selection = { mapID = row.mapID, group = row.kind == "group" and row.which or nil }
	elseif row.kind == "world" then
		worldOpen = not worldOpen
		selection = { mapID = WORLD }
	elseif row.kind == "continent" then
		continentOpen[row.mapID] = not continentOpen[row.mapID]
		selection = { mapID = row.mapID }
	elseif row.kind == "zone" then
		if expandedZone == row.mapID or CITY_IN[expandedZone] == row.mapID then
			expandedZone = CITY_IN[row.mapID]
		else
			expandedZone = row.mapID
		end
		selection = { mapID = row.mapID }
	elseif row.kind == "group" and not row.mapID then
		groupOpen[row.which] = not groupOpen[row.which]
		selection = { group = row.which }
	else
		-- A zone's Books, Notes and the rest: closed and opened again, as the zone is.
		local key = row.mapID .. ":" .. row.which
		zoneTypeShut[key] = not zoneTypeShut[key] or nil
		selection = { mapID = row.mapID, group = row.which }
	end
	SpokenBooks:RefreshReadables()
end

function SpokenBooks:RefreshReadables(scrollToSelection)
	if not list then return end
	local items = list:Render()
	if scrollToSelection and selection then list:ScrollToSelection(items) end
	ShowEntry()
end

local function Build(panel)
	list = SpokenCompendium.NewList(panel, {
		search = L.READABLES_SEARCH,
		none = L.READABLES_NONE,
		only = L.READABLES_FOUND_ONLY,
		onlyGet = OnlyFound,
		onlySet = function(on) if SpokenBooksSettings then SpokenBooksSettings.compendiumFoundOnly = on end end,
		checks = { { label = L.READABLES_VOICED_ONLY, get = OnlyVoiced,
			set = function(on) if SpokenBooksSettings then SpokenBooksSettings.compendiumVoicedOnly = on end end } },
		-- By zone, then type; or by type alone.
		arrange = {
			values = { "zone", "type" },
			describe = function(value) return value == "type" and L.READABLES_BY_TYPE or L.READABLES_BY_ZONE end,
			get = function() return ByZone() and "zone" or "type" end,
			set = function(value) if SpokenBooksSettings then SpokenBooksSettings.compendiumByZone = value == "zone" end end,
		},
		build = BuildRows,
		isSelected = IsSelected,
		onClick = OnClick,
		onSearch = function(text)
			filter = text
			SpokenBooks:RefreshReadables()
		end,
		addScrollBar = function(scroll, child, inset) return SpokenBooks:AddScrollBar(scroll, child, inset) end,
	})
	panel.Refresh = function() SpokenBooks:RefreshReadables() end
	panel.inset, panel.filterButton, panel.filterMenu, panel.noMatch = list.inset, list.filterButton, list.filterMenu, list.noMatch

	local _, right = SpokenCompendium.Margins()
	local window = SpokenCompendium:Window()
	local ok, pageInset = pcall(CreateFrame, "Frame", nil, panel, "InsetFrameTemplate")
	if not ok or not pageInset then pageInset = CreateFrame("Frame", nil, panel) end
	pageInset:SetPoint("TOPLEFT", list.inset, "TOPRIGHT", 6, 38)
	pageInset:SetPoint("BOTTOMRIGHT", panel, "BOTTOMRIGHT", -right, window.templated and 6 or 12)
	panel.pageInset = pageInset
	local holder = CreateFrame("Frame", nil, pageInset)
	holder:SetPoint("TOPLEFT", pageInset, "TOPLEFT", 3, -3)
	holder:SetPoint("BOTTOMRIGHT", pageInset, "BOTTOMRIGHT", -3, 3)
	page = C.NewPage(holder, SpokenBooks, PLAY)
	if type(pageInset.NineSlice) == "table" and pageInset.NineSlice.SetFrameLevel then
		pageInset.NineSlice:SetFrameLevel(holder:GetFrameLevel() + 5)
	end
	panel.page = page
	SpokenBooks.readables = panel
end

--- Open the readables.
function SpokenBooks:ShowReadables()
	if not SpokenCompendium then return end
	if list then
		list:ClearSearch()
		filter = ""
	end
	SpokenCompendium:Open("readables")
	SpokenCompendium:Expand()
	SpokenBooks:RefreshReadables(true)
end

-- The window's size, with the rest of this addon's settings, for when Spoken Zones is not there
-- to keep it.
local SIZE_KEYS = { width = "compendiumWidth", height = "compendiumHeight" }

function SpokenBooks:SetupReadables()
	if not SpokenCompendium or SpokenCompendium:Tab("readables") then return end
	SpokenCompendium:Register("readables", {
		label = L.COMPENDIUM_READABLES,
		order = 2,
		title = L.COMPENDIUM_TITLE,
		build = Build,
		store = {
			get = function(key) return SpokenBooksSettings and SpokenBooksSettings[SIZE_KEYS[key]] end,
			set = function(key, value) if SpokenBooksSettings then SpokenBooksSettings[SIZE_KEYS[key]] = value end end,
		},
		open = function() SpokenBooks:ShowReadables() end,
		enabled = function() return SpokenBooks:IsPartOn() end,
		-- Unlock Unfound Books, on Spoken's page.
		unlock = {
			get = function() return SpokenBooksSettings ~= nil and SpokenBooksSettings.unlockUnfound == true end,
			set = function(value)
				if SpokenBooksSettings then SpokenBooksSettings.unlockUnfound = value end
				SpokenBooks:RefreshReadables()
			end,
		},
	})
end
