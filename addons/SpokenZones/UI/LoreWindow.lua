-- SpokenZones -- the lore window, Lore of Azeroth: every place's story, to browse and listen to
-- anywhere.
--
-- Opened from the minimap menu, the Zones settings page or /spz window. Independent of
-- WorldMapFrame, so it works with the map closed.
--
-- A panel the way the game draws its own -- the spellbook, the character sheet: a portrait
-- frame with the map's icon in its corner, its title along the top and the game's close button
-- (PortraitFrameTemplate). On the left, in an inset, the places as a tree: Azeroth, its two
-- continents, each continent's zones, and the opened zone's areas, with a search box over it. On the right, the story on the
-- spellbook's parchment (UI/LorePage.lua).
--
-- Only one zone expands at a time, which caps the list at the zones plus one zone's areas, about a
-- hundred rows -- few enough that every row can be a real button. A search shows every match
-- instead, and is short by being a search.

local ADDON_NAME, SpokenZones = ...

local L = SpokenZones.L
local Art = SpokenZones.Art

local WINDOW_WIDTH = 880
local WINDOW_HEIGHT = 600
local LIST_WIDTH = 270
local ZONE_ROW = 24
local AREA_ROW = 20
local DEPTH_STEP = 14         -- each level in, under the one it belongs to
local SCROLL_STEP = 60
local ICON = [[Interface\Icons\INV_Misc_Map_01]]

local window, listScroll, listChild, searchBox, page
local rows = {}
local expandedZone = nil
-- Azeroth and its continents start open, so the zones show; each opens and closes on its own.
local worldOpen = true
local continentOpen = { [1414] = true, [1415] = true }
local selection = nil -- { mapID = , key = nil|string }
local sortedZoneIDs = nil
local filter = ""

--------------------------------------------------------------------------------
-- Data ordering
--------------------------------------------------------------------------------

local function ZoneName(mapID)
	return SpokenZones:GetMapName(mapID) or (SpokenZones.Zones[mapID] and SpokenZones.Zones[mapID].name) or tostring(mapID)
end

-- The world, its two continents, and which continent each zone is on.
local WORLD = 947
local CONTINENTS = { 1414, 1415 } -- Kalimdor, the Eastern Kingdoms
-- Where the client cannot say (C_Map's parents), Classic's own map ids: Kalimdor's zones and
-- cities, then the Eastern Kingdoms'.
local KNOWN_CONTINENT = {}
for _, id in ipairs({ 1411, 1412, 1413, 1438, 1439, 1440, 1441, 1442, 1443, 1444, 1445, 1446, 1447,
	1448, 1449, 1450, 1451, 1452, 1454, 1456, 1457 }) do KNOWN_CONTINENT[id] = 1414 end
for _, id in ipairs({ 1416, 1417, 1418, 1419, 1420, 1421, 1422, 1423, 1424, 1425, 1426, 1427, 1428,
	1429, 1430, 1431, 1432, 1433, 1434, 1435, 1436, 1437, 1453, 1455, 1458 }) do KNOWN_CONTINENT[id] = 1415 end

local function IsContinent(mapID)
	return mapID == 1414 or mapID == 1415
end

local continentCache = {}
--- The continent a zone is on: up the game's map tree until one is reached, else Classic's ids.
local function ContinentOf(mapID)
	local cached = continentCache[mapID]
	if cached ~= nil then return cached or nil end
	local found
	local current, steps = mapID, 0
	while current and steps < 8 and C_Map and C_Map.GetMapInfo do
		local info = C_Map.GetMapInfo(current)
		local parent = info and info.parentMapID
		if not parent or parent == 0 then break end
		if IsContinent(parent) then found = parent break end
		current, steps = parent, steps + 1
	end
	found = found or KNOWN_CONTINENT[mapID]
	continentCache[mapID] = found or false
	return found
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
	local list = {}
	for _, mapID in ipairs(ZoneIDs()) do
		if ContinentOf(mapID) == continent then table.insert(list, mapID) end
	end
	return list
end

--- Open what holds `mapID`, so opening on a place shows it.
local function Reveal(mapID)
	worldOpen = true
	local continent = IsContinent(mapID) and mapID or ContinentOf(mapID)
	if continent then continentOpen[continent] = true end
end

local function SubzoneKeys(mapID)
	local tbl = SpokenZones.Subzones[mapID]
	if not tbl then
		return nil
	end
	local keys = {}
	for key in pairs(tbl) do
		table.insert(keys, key)
	end
	table.sort(keys, function(a, b)
		return (tbl[a].name or a) < (tbl[b].name or b)
	end)
	return keys
end

local function Matches(text)
	return filter == "" or (text and string.find(string.lower(text), filter, 1, true) ~= nil)
end

local function Missing(mapID)
	local entry = SpokenZones:GetLore(mapID)
	return not entry or SpokenZones:IsPending(entry)
end

-- One zone's rows: itself, and its areas under it when it is open (or, while searching, the
-- areas that match). Nothing when neither it nor any area matches the search.
local function ZoneRows(mapID, depth)
	local subKeys = SubzoneKeys(mapID)
	local zoneName = ZoneName(mapID)
	local areas = {}
	if subKeys then
		for _, key in ipairs(subKeys) do
			local entry = SpokenZones.Subzones[mapID][key]
			local name = entry.name or key
			if filter == "" and expandedZone == mapID or filter ~= "" and Matches(name) then
				table.insert(areas, { kind = "subzone", mapID = mapID, key = key, label = name, depth = depth + 1,
					missing = SpokenZones:IsPending(entry) })
			end
		end
	end
	if filter ~= "" and not Matches(zoneName) and #areas == 0 then return {} end
	local rows = { { kind = "zone", mapID = mapID, label = zoneName, depth = depth,
		count = subKeys and #subKeys or 0, open = filter ~= "" and #areas > 0 or expandedZone == mapID,
		missing = Missing(mapID) } }
	for _, area in ipairs(areas) do table.insert(rows, area) end
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
		local zones = {}
		for _, mapID in ipairs(ZonesOf(continent)) do
			local rows = ZoneRows(mapID, 2)
			for _, row in ipairs(rows) do table.insert(zones, row) end
		end
		local name = ZoneName(continent)
		if not searching or Matches(name) or #zones > 0 then
			table.insert(continents, { kind = "continent", mapID = continent, label = name, depth = 1,
				count = #ZonesOf(continent), open = searching and #zones > 0 or (not searching and continentOpen[continent]),
				missing = Missing(continent), zones = zones })
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
	if key then
		local entry = SpokenZones.Subzones[mapID] and SpokenZones.Subzones[mapID][key]
		if entry then
			local name = entry.name or key
			local zoneName = ZoneName(mapID)
			local back = function()
				selection = { mapID = mapID, key = nil }
				SpokenZones:RefreshLoreWindow()
			end
			if SpokenZones:IsPending(entry) then
				page:Show({ title = name, subtitle = string.format(L.IN_ZONE_FMT, zoneName), onSubtitle = back,
					text = L.LORE_NOT_WRITTEN:format(name), missing = true, contribute = { mapID, name } })
				return
			end
			-- Rows are keyed by the canonical form already, so this needs no normalising --
			-- unlike the map panel, which starts from the name the client reports.
			page:Show({ title = name, subtitle = string.format(L.IN_ZONE_FMT, zoneName), onSubtitle = back,
				text = entry.full or entry.short or "", audio = { mapID, key }, report = { mapID, key } })
			return
		end
	end

	local entry = SpokenZones:GetLore(mapID)
	local name = ZoneName(mapID)
	-- What it holds, and for a continent or a zone where it sits, a click away: Azeroth its two
	-- continents and every zone; a continent its zones; a zone its areas.
	local function Count(n, many, one) return n == 1 and one or string.format(many, n) end
	local subtitle, up
	if mapID == WORLD then
		subtitle = Count(#Continents(), L.CONTINENT_COUNT_FMT, L.CONTINENT_COUNT_ONE) .. ", "
			.. Count(#ZoneIDs(), L.ZONE_COUNT_FMT, L.ZONE_COUNT_ONE)
	elseif IsContinent(mapID) then
		subtitle = string.format(L.IN_ZONE_FMT, ZoneName(WORLD)) .. " · "
			.. Count(#ZonesOf(mapID), L.ZONE_COUNT_FMT, L.ZONE_COUNT_ONE)
		up = WORLD
	else
		local parent = ContinentOf(mapID) or WORLD
		local subKeys = SubzoneKeys(mapID)
		subtitle = string.format(L.IN_ZONE_FMT, ZoneName(parent))
		if subKeys then
			subtitle = subtitle .. " · " .. Count(#subKeys, L.SUBZONE_COUNT_FMT, L.SUBZONE_COUNT_ONE)
		end
		up = parent
	end
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

local function OnRowClick(self)
	local row = self.row
	if not row then
		return
	end
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
		-- Clicking a zone both chooses it and opens or closes its areas: one zone at a time.
		expandedZone = (expandedZone == row.mapID) and nil or row.mapID
		selection = { mapID = row.mapID, key = nil }
	else
		selection = { mapID = row.mapID, key = row.key }
	end
	if PlaySound and SOUNDKIT then PlaySound(SOUNDKIT.U_CHAT_SCROLL_BUTTON) end
	SpokenZones:RefreshLoreWindow()
end

-- A row's light: the professions list's own, faint under the pointer and full when chosen, with a
-- gold edge on the chosen one. A flat wash where the client has not got it.
local function Light(row)
	local wash = row.wash
	if row.selected then
		wash:Show(); wash:SetAlpha(1); row.edge:Show()
	elseif row.over then
		wash:Show(); wash:SetAlpha(0.55); row.edge:Hide()
	else
		wash:Hide(); row.edge:Hide()
	end
end

local function AcquireRow(index)
	local row = rows[index]
	if row then
		return row
	end

	row = CreateFrame("Button", nil, listChild)

	row.wash = row:CreateTexture(nil, "BACKGROUND")
	row.wash:SetAllPoints()
	if not Art.Atlas(row.wash, "Professions_Recipe_Hover", false) then
		row.wash:SetColorTexture(1, 1, 1, 0.1)
	end
	row.wash:Hide()

	row.edge = row:CreateTexture(nil, "ARTWORK")
	row.edge:SetWidth(2)
	row.edge:SetPoint("TOPLEFT")
	row.edge:SetPoint("BOTTOMLEFT")
	row.edge:SetColorTexture(1, 0.82, 0, 0.9)
	row.edge:Hide()

	row.toggle = row:CreateTexture(nil, "ARTWORK")
	row.toggle:SetSize(14, 14)
	row.toggle:SetPoint("LEFT", row, "LEFT", 8, 0)

	row.label = row:CreateFontString(nil, "ARTWORK", "GameFontNormal")
	row.label:SetJustifyH("LEFT")
	if row.label.SetWordWrap then row.label:SetWordWrap(false) end

	row.count = row:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
	row.count:SetPoint("RIGHT", row, "RIGHT", -10, 0)
	row.count:SetJustifyH("RIGHT")

	row:SetScript("OnClick", OnRowClick)
	row:SetScript("OnEnter", function(self) self.over = true; Light(self) end)
	row:SetScript("OnLeave", function(self) self.over = false; Light(self) end)

	rows[index] = row
	return row
end

local function RenderList()
	local list = BuildRowList()
	local y = 0
	for i, item in ipairs(list) do
		local row = AcquireRow(i)
		row.row = item
		local height = item.kind == "subzone" and AREA_ROW or ZONE_ROW
		row:SetHeight(height)
		row:ClearAllPoints()
		row:SetPoint("TOPLEFT", listChild, "TOPLEFT", 0, -y)
		row:SetPoint("TOPRIGHT", listChild, "TOPRIGHT", 0, -y)
		y = y + height

		row.label:ClearAllPoints()
		row.label:SetPoint("RIGHT", row.count, "LEFT", -6, 0)
		local indent = (item.depth or 0) * DEPTH_STEP
		if item.kind ~= "subzone" then
			row.label:SetFontObject("GameFontNormal")
			row.label:SetPoint("LEFT", row, "LEFT", 28 + indent, 0)
			row.toggle:ClearAllPoints()
			row.toggle:SetPoint("LEFT", row, "LEFT", 8 + indent, 0)
			-- The game's own plus and minus, for anything with something inside to open.
			if item.count > 0 then
				row.toggle:SetTexture(item.open and [[Interface\Buttons\UI-MinusButton-Up]] or [[Interface\Buttons\UI-PlusButton-Up]])
				row.toggle:Show()
			else
				row.toggle:Hide()
			end
			row.count:SetText(item.count > 0 and item.count or "")
			if item.missing then row.label:SetTextColor(0.62, 0.55, 0.36) else row.label:SetTextColor(1, 0.82, 0) end
		else
			row.label:SetFontObject("GameFontHighlightSmall")
			row.label:SetPoint("LEFT", row, "LEFT", 36 + indent, 0)
			row.toggle:Hide()
			row.count:SetText("")
			-- A place with no story yet, greyed: still there to choose, and to write.
			if item.missing then row.label:SetTextColor(0.5, 0.5, 0.5) else row.label:SetTextColor(0.92, 0.92, 0.92) end
		end
		row.label:SetText(item.label)

		row.selected = IsSelected(item)
		Light(row)
		row:Show()
	end

	for i = #list + 1, #rows do
		rows[i]:Hide()
		rows[i].row = nil
	end

	listChild:SetHeight(math.max(y, 1))
	window.noMatch:SetShown(#list == 0)
	return list
end

-- Bring the selected row into view. Only used when opening the window: doing it on every refresh
-- would yank the list out from under a click.
local function ScrollToSelection(list)
	if not selection then
		return
	end
	local y = 0
	for _, item in ipairs(list) do
		local height = item.kind == "subzone" and AREA_ROW or ZONE_ROW
		if IsSelected(item) then
			local viewHeight = listScroll:GetHeight() or 0
			-- GetVerticalScrollRange is stale until the next layout pass, right after
			-- listChild:SetHeight, so derive the range instead.
			local range = math.max(0, (listChild:GetHeight() or 0) - viewHeight)
			local target = y - (viewHeight / 2) + (height / 2)
			listScroll:SetVerticalScroll(math.max(0, math.min(range, target)))
			return
		end
		y = y + height
	end
end

function SpokenZones:RefreshLoreWindow(scrollToSelection)
	if not window then
		return
	end
	local list = RenderList()
	if scrollToSelection then
		ScrollToSelection(list)
	end
	ShowEntry()
end

--------------------------------------------------------------------------------
-- Construction
--------------------------------------------------------------------------------

-- The game's portrait frame where the client has it: its border, title bar, portrait and close
-- button. The plain dialog box this window used to be where it does not.
local function NewWindow()
	local ok, frame = pcall(CreateFrame, "Frame", "SpokenZonesWindow", UIParent, "PortraitFrameTemplate")
	if ok and frame and frame.SetTitle then
		frame:SetTitle(L.LORE_WINDOW_TITLE)
		if frame.SetPortraitToAsset then frame:SetPortraitToAsset(ICON) end
		frame.templated = true
		return frame
	end
	frame = CreateFrame("Frame", "SpokenZonesWindow", UIParent, "BackdropTemplate")
	frame:SetBackdrop({
		bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background-Dark",
		edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
		tile = true, tileSize = 32, edgeSize = 32,
		insets = { left = 11, right = 12, top = 12, bottom = 11 },
	})
	local title = frame:CreateFontString(nil, "ARTWORK", "GameFontNormal")
	title:SetPoint("TOP", frame, "TOP", 0, -14)
	title:SetText(L.LORE_WINDOW_TITLE)
	local close = CreateFrame("Button", nil, frame, "UIPanelCloseButton")
	close:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -8, -8)
	close:SetScript("OnClick", function() frame:Hide() end)
	return frame
end

local function BuildWindow()
	window = NewWindow()
	window:SetSize(WINDOW_WIDTH, WINDOW_HEIGHT)
	window:SetPoint("CENTER")
	window:SetFrameStrata("HIGH")
	window:SetToplevel(true)
	window:EnableMouse(true)
	window:SetMovable(true)
	window:SetClampedToScreen(true)
	window:RegisterForDrag("LeftButton")
	window:SetScript("OnDragStart", window.StartMoving)
	window:SetScript("OnDragStop", window.StopMovingOrSizing)
	window:SetScript("OnShow", function()
		if PlaySound and SOUNDKIT and SOUNDKIT.IG_SPELLBOOK_OPEN then PlaySound(SOUNDKIT.IG_SPELLBOOK_OPEN) end
	end)
	window:SetScript("OnHide", function()
		if PlaySound and SOUNDKIT and SOUNDKIT.IG_SPELLBOOK_CLOSE then PlaySound(SOUNDKIT.IG_SPELLBOOK_CLOSE) end
	end)
	window:Hide()

	-- Inside the frame's border and under its title bar; a templated frame's portrait takes the
	-- top-left corner, so the search box starts to its right.
	local top = window.templated and -24 or -36
	local left = window.templated and 6 or 14

	-- The places: an inset down the left, the game's own, with the search box over it.
	searchBox = CreateFrame("EditBox", nil, window, "SearchBoxTemplate")
	searchBox:SetSize(LIST_WIDTH - 66, 20)
	searchBox:SetPoint("TOPLEFT", window, "TOPLEFT", left + 66, top - 8)
	if type(searchBox.Instructions) == "table" then searchBox.Instructions:SetText(L.LORE_SEARCH) end
	searchBox:HookScript("OnTextChanged", function(self)
		filter = string.lower(strtrim and strtrim(self:GetText() or "") or (self:GetText() or ""))
		listScroll:SetVerticalScroll(0)
		SpokenZones:RefreshLoreWindow()
	end)

	local ok, inset = pcall(CreateFrame, "Frame", nil, window, "InsetFrameTemplate")
	if not ok or not inset then inset = CreateFrame("Frame", nil, window) end
	inset:SetPoint("TOPLEFT", window, "TOPLEFT", left, top - 38)
	inset:SetPoint("BOTTOMLEFT", window, "BOTTOMLEFT", left, 6)
	inset:SetWidth(LIST_WIDTH)
	window.inset = inset

	listScroll = CreateFrame("ScrollFrame", nil, inset)
	listScroll:SetPoint("TOPLEFT", inset, "TOPLEFT", 4, -4)
	listScroll:SetPoint("BOTTOMRIGHT", inset, "BOTTOMRIGHT", -4, 4)
	if listScroll.SetClipsChildren then
		listScroll:SetClipsChildren(true)
	end
	listScroll:EnableMouseWheel(true)
	listScroll:SetScript("OnMouseWheel", function(self, delta)
		local range = math.max(0, (listChild:GetHeight() or 0) - (self:GetHeight() or 0))
		local target = self:GetVerticalScroll() - (delta * SCROLL_STEP)
		self:SetVerticalScroll(math.max(0, math.min(range, target)))
	end)

	listChild = CreateFrame("Frame", nil, listScroll)
	listChild:SetSize(LIST_WIDTH - 8, 1)
	listScroll:SetScrollChild(listChild)
	-- The page's scroll bar, the game's minimal one, down the list's right side.
	window.listBar = SpokenZones:AddScrollBar(listScroll, listChild, inset)

	window.noMatch = inset:CreateFontString(nil, "ARTWORK", "GameFontDisable")
	window.noMatch:SetPoint("TOP", inset, "TOP", 0, -24)
	window.noMatch:SetText(L.LORE_SEARCH_NONE)
	window.noMatch:Hide()

	-- The story: the spellbook's page down the rest of the window, in an inset of its own as the
	-- list is -- the way the game's split windows frame each pane (the professions window), so the
	-- two are parted by their borders rather than one running into the other.
	local okPage, pageInset = pcall(CreateFrame, "Frame", nil, window, "InsetFrameTemplate")
	if not okPage or not pageInset then pageInset = CreateFrame("Frame", nil, window) end
	pageInset:SetPoint("TOPLEFT", inset, "TOPRIGHT", 6, 38)
	pageInset:SetPoint("BOTTOMRIGHT", window, "BOTTOMRIGHT", window.templated and -6 or -12, window.templated and 6 or 12)
	window.pageInset = pageInset
	local holder = CreateFrame("Frame", nil, pageInset)
	holder:SetPoint("TOPLEFT", pageInset, "TOPLEFT", 3, -3)
	holder:SetPoint("BOTTOMRIGHT", pageInset, "BOTTOMRIGHT", -3, 3)
	page = SpokenZones:CreateLorePage(holder, "book")
	-- The inset's border over the parchment's edge, not under it.
	if type(pageInset.NineSlice) == "table" and pageInset.NineSlice.SetFrameLevel then
		pageInset.NineSlice:SetFrameLevel(holder:GetFrameLevel() + 5)
	end
	window.page = page

	-- Toggling "Hide Contribute Buttons" in Spoken's settings fires no game event.
	if _G.Spoken and Spoken.RegisterCallback then
		Spoken:RegisterCallback("CONTRIBUTE_SETTINGS_CHANGED", function()
			SpokenZones:RefreshLoreWindow()
		end)
	end

	SpokenZones.window = window
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

--- Close the lore window, as switching the part off does.
function SpokenZones:HideLoreWindow()
	if window then
		window:Hide()
	end
end

function SpokenZones:ToggleLoreWindow()
	if not window then
		return
	end
	if window:IsShown() then
		window:Hide()
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

	if searchBox and searchBox:GetText() ~= "" then searchBox:SetText("") end
	window:Show()
	SpokenZones:RefreshLoreWindow(true)
end

-- Open on a named entry rather than on the player's location. Not routed through
-- ToggleLoreWindow, which re-syncs to where the player stands: narration outlives the zone you
-- started it in.
function SpokenZones:ShowLoreFor(mapID, areaKey)
	if not window or not mapID then
		return
	end
	expandedZone = mapID
	Reveal(mapID)
	selection = { mapID = mapID, key = areaKey }
	if searchBox and searchBox:GetText() ~= "" then searchBox:SetText("") end
	window:Show()
	SpokenZones:RefreshLoreWindow(true)
end

function SpokenZones:SetupLoreWindow()
	if window then
		return
	end
	BuildWindow()
	tinsert(UISpecialFrames, "SpokenZonesWindow") -- close on Escape
end
