-- Optional clicks on Leatrix Maps' dungeon pins. Leatrix keeps its overlay and pins private, but
-- each pin carries the row that created it.

local _, Bosses = ...
local M = Bosses.MapLore
local Found, IsMapOrChild, DungeonAt, DungeonInstanceByName = M.Found, M.IsMapOrChild, M.DungeonAt, M.DungeonInstanceByName
local CurrentMapID = M.CurrentMapID

local byMapCreature
local byCreature
local LEATRIX_CREATURE_ALIASES = {
	-- Leatrix's Stratholme pin uses Balnazzar's phase creature, not the creature in Spoken's data.
	[10813] = { map = 329, key = "balnazzar" },
}

local function BossFor(mapID, creatureID, bossName)
	if not byMapCreature then
		byMapCreature, byCreature = {}, {}
		for map, bosses in pairs(_G.SpokenBosses and SpokenBosses.maps or {}) do
			for _, boss in ipairs(bosses) do
				local creature = _G.SpokenBossCreatures and SpokenBossCreatures[map]
				creature = creature and creature[boss.key] and creature[boss.key].creature
				if creature then
					byMapCreature[map] = byMapCreature[map] or {}
					byMapCreature[map][creature] = Found(map, boss)
					-- False keeps a future import with a repeated id from opening the wrong boss.
					if byCreature[creature] ~= nil then
						byCreature[creature] = false
					else
						byCreature[creature] = Found(map, boss)
					end
				end
			end
		end
	end
	local alias = LEATRIX_CREATURE_ALIASES[creatureID]
	if alias and _G.SpokenBosses and SpokenBosses.maps[alias.map] then
		for _, boss in ipairs(SpokenBosses.maps[alias.map]) do
			if boss.key == alias.key then return Found(alias.map, boss) end
		end
	end
	local found = (byMapCreature[mapID] and byMapCreature[mapID][creatureID]) or byCreature[creatureID]
	if found then return found end

	-- Names are the only fallback for a creature id Spoken lacks. Prefer the current map, so a name
	-- shared by two instances (Balnazzar's is) does not open the wrong story.
	return M.BossByName(M.BossNameKey(bossName), function(map) return IsMapOrChild(mapID, map) end)
end

-- Leatrix's zone-map dungeon icons are display-only: the map container gets their click, and the
-- destination is readable only from the private tooltip's owner while the cursor is over it.
local function DungeonPOIAtCursor()
	local tooltip = _G.LeaMapsPOITooltip
	if not tooltip or type(tooltip.GetOwner) ~= "function" then return end
	-- A hidden tooltip keeps its last owner, which is not what the cursor is over now.
	if type(tooltip.IsShown) == "function" and not tooltip:IsShown() then return end
	local ok, owner = pcall(tooltip.GetOwner, tooltip)
	if not ok or not owner then return end
	local info = owner.data
	if type(info) ~= "table" or (info[1] ~= "Dungeon" and info[1] ~= "Raid" and info[1] ~= "Dunraid") then
		return
	end
	return DungeonInstanceByName(info[4])
end

local suppressPreviewFallback
local activeDungeonID

local function ShowLeatrixEntrance(mapID)
	-- During a preview the world map stays on the entrance zone. The selected dungeon goes first:
	-- instance IDs and UI map IDs are separate numberings, so equal numbers prove nothing.
	local instanceID = activeDungeonID or DungeonAt(mapID)
	local dungeonMapID = instanceID or mapID
	if instanceID then
		local shown = M.ShowDungeon(mapID, instanceID)
		if shown then suppressPreviewFallback = true; return true end
	end
	if not _G.SpokenPlaces or not SpokenPlaces.ShowMapStory or not SpokenPlaces.GetLoreWithFallback then
		return false
	end
	local zone = select(2, DungeonAt(dungeonMapID))
	local story, foundOn = zone and SpokenPlaces:GetLoreWithFallback(zone)
	if not zone or not story then return false end

	local entry = M.PlaceEntry({
		title = SpokenPlaces:GetMapName(zone) or tostring(zone),
		subtitle = SpokenPlaces.PlaceLine and SpokenPlaces:PlaceLine(zone) or "",
	}, story, zone, nil, foundOn)
	if SpokenCompendium and SpokenCompendium.PlaceIcon then entry.icon = SpokenCompendium.PlaceIcon(zone) end
	return M.Show(mapID, entry)
end

function Bosses:ShowLeatrixBoss(mapID, creatureID, bossName)
	-- A preview keeps the world map on the entrance zone while Leatrix draws the dungeon floor
	-- itself. Use its instance ID to disambiguate bosses with the same name in different dungeons.
	local found = BossFor(activeDungeonID or DungeonAt(mapID) or mapID, creatureID, bossName)
	if not found then return false end
	suppressPreviewFallback = true
	return M.ShowBoss(mapID, found)
end

local hooked = setmetatable({}, { __mode = "k" })
local watched = setmetatable({}, { __mode = "k" })
local menuHooked = setmetatable({}, { __mode = "k" })
local ScanSoon
local ShowLeatrixPreview
local HookDungeonMenuButton

local function IsDungeonOverlay(frame)
	local container = WorldMapFrame and WorldMapFrame.ScrollContainer
	if not container or not frame or type(frame.GetParent) ~= "function" or frame:GetParent() ~= container then
		return false
	end
	return type(frame.GetScript) == "function"
		and frame:GetScript("OnMouseUp") ~= nil
		and frame:GetScript("OnMouseWheel") ~= nil
end

local function ClearLeatrixDungeonStory()
	activeDungeonID = nil
	M.ClearStory()
end

local function Watch(frame)
	if watched[frame] or not frame.HookScript then return end
	watched[frame] = true
	frame:HookScript("OnShow", ScanSoon)
	if IsDungeonOverlay(frame) then
		frame:HookScript("OnHide", ClearLeatrixDungeonStory)
	end
end

local function RowOf(frame)
	local ok, row = pcall(function() return frame.row end)
	return ok and row or nil
end

HookDungeonMenuButton = function(button)
	local text = button and button.Text
	if menuHooked[button] or not button or not button.HookScript or not text or type(text) == "function" then return end
	if type(text.GetText) ~= "function" or not DungeonInstanceByName(text:GetText()) then return end
	menuHooked[button] = true
	button:HookScript("OnClick", function(self)
		local instanceID = DungeonInstanceByName(self.Text and self.Text:GetText())
		if instanceID then
			-- Wait for Leatrix's own click handler to change its private preview state.
			C_Timer.After(0, function() ShowLeatrixPreview(instanceID) end)
		end
	end)
end

local function HookPin(pin)
	if hooked[pin] or not pin.HookScript then return end
	local row = RowOf(pin)
	-- Leatrix reuses the same frame pool for map levels, bosses and entrances. Hooking only the
	-- first row misses an entrance when that frame was born as a level pin.
	if type(row) ~= "table" then return end
	hooked[pin] = true
	pin:HookScript("OnClick", function(self, button)
		if button ~= "LeftButton" then return end
		local current = RowOf(self)
		if type(current) == "table" and current[1] == "boss" then
			Bosses:ShowLeatrixBoss(CurrentMapID(), current[4], current[5])
		elseif type(current) == "table" and current[1] == "entrance" then
			ShowLeatrixEntrance(CurrentMapID())
		end
	end)
end

local function Scan(parent, seen)
	if not parent or (seen and seen[parent]) then return end
	seen = seen or {}
	seen[parent] = true
	Watch(parent)
	HookPin(parent)
	HookDungeonMenuButton(parent)
	if not parent.GetChildren then return end
	local ok, children = pcall(function() return { parent:GetChildren() } end)
	if not ok then return end
	for _, child in ipairs(children) do Scan(child, seen) end
end

local function LeatrixLoaded()
	if C_AddOns and C_AddOns.IsAddOnLoaded then return C_AddOns.IsAddOnLoaded("Leatrix_Maps") end
	return IsAddOnLoaded and IsAddOnLoaded("Leatrix_Maps") or false
end

local pending
ScanSoon = function()
	if pending or not LeatrixLoaded() then return end
	pending = true
	C_Timer.After(0, function()
		pending = false
		if WorldMapFrame then Scan(WorldMapFrame) end
	end)
end

local setup
local clickedDungeonID
local clickedX, clickedY
-- In the cursor's own units. A press on an icon that moves further than this dragged the map.
local DRAG_DISTANCE = 5

local function RememberCursor()
	clickedX, clickedY = nil, nil
	if GetCursorPosition then clickedX, clickedY = GetCursorPosition() end
end

local function CursorMoved()
	if not clickedX or not GetCursorPosition then return false end
	local x, y = GetCursorPosition()
	return math.abs(x - clickedX) > DRAG_DISTANCE or math.abs(y - clickedY) > DRAG_DISTANCE
end

ShowLeatrixPreview = function(instanceID)
	if not instanceID then return end
	activeDungeonID = instanceID
	M.ShowDungeon(CurrentMapID(), instanceID)
end

local function Setup()
	if not WorldMapFrame then return end
	if setup then return end
	setup = true
	WorldMapFrame:HookScript("OnShow", ScanSoon)
	if hooksecurefunc then
		hooksecurefunc(WorldMapFrame, "OnMapChanged", function()
			activeDungeonID = nil
			ScanSoon()
		end)
	end
	WorldMapFrame:HookScript("OnHide", function() activeDungeonID = nil end)
	if WorldMapFrame.ScrollContainer and WorldMapFrame.ScrollContainer.HookScript then
		WorldMapFrame.ScrollContainer:HookScript("OnShow", ScanSoon)
		WorldMapFrame.ScrollContainer:HookScript("OnMouseDown", function(_, button)
			-- A previous boss or entrance click may have suppressed one fallback callback. A new
			-- click must be allowed to resolve its own dungeon destination.
			if button == "LeftButton" then
				suppressPreviewFallback = nil
				clickedDungeonID = DungeonPOIAtCursor()
				RememberCursor()
			end
		end)
		-- Leatrix opens a zone-map dungeon icon's preview from this mouse-up script; wait until it has.
		WorldMapFrame.ScrollContainer:HookScript("OnMouseUp", function(_, button)
			if button == "LeftButton" then
				local dungeonID = not CursorMoved() and clickedDungeonID or nil
				C_Timer.After(0, function()
					if suppressPreviewFallback then
						suppressPreviewFallback = nil
					else
						ShowLeatrixPreview(dungeonID)
					end
					clickedDungeonID = nil
				end)
			end
		end)
	end
	ScanSoon()
end

local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_ENTERING_WORLD")
events:RegisterEvent("ADDON_LOADED")
events:SetScript("OnEvent", function(_, event, addon)
	if event == "PLAYER_ENTERING_WORLD" or addon == "Leatrix_Maps" then Setup() end
end)
