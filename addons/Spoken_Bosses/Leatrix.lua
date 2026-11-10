-- Optional clicks on Leatrix Maps' dungeon pins. Leatrix keeps its overlay and pins private, but
-- each pin carries the row that created it.

local _, Bosses = ...

local PLAY = {
	has = function(target)
		return Bosses.GetAudioClip ~= nil and Bosses:GetAudioClip(target[1], target[2]) ~= nil
	end,
	find = function(target) return Bosses:QueuedStory(target[1], target[2]) end,
	start = function(target) Bosses:PlayStory(target[1], target[2]) end,
}

local byMapCreature
local byCreature
local LEATRIX_CREATURE_ALIASES = {
	-- Leatrix's Stratholme pin uses Balnazzar's phase creature, not the creature in Spoken's data.
	[10813] = { map = 329, key = "balnazzar" },
}

local function BossName(boss)
	return boss[GetLocale and GetLocale() or "enUS"] or boss[1]
end

local function BossNameKey(name)
	if type(name) ~= "string" then return end
	name = name:match("^(.-)%s*<") or name
	return string.lower(name):gsub("%s+", " ")
end

local function IsMapOrChild(mapID, parentMapID)
	if mapID == parentMapID or tostring(mapID) == tostring(parentMapID) then return true end
	local mapAPI = _G.C_Map
	if not mapAPI or not mapAPI.GetMapInfo then return false end
	local seen, current = {}, mapID
	for _ = 1, 10 do
		if seen[current] then return false end
		seen[current] = true
		local ok, info = pcall(mapAPI.GetMapInfo, current)
		if not ok or type(info) ~= "table" then return false end
		current = info.parentMapID
		if not current or current == 0 then return false end
		if current == parentMapID or tostring(current) == tostring(parentMapID) then return true end
	end
	return false
end

local function BossFor(mapID, creatureID, bossName)
	if not byMapCreature then
		byMapCreature, byCreature = {}, {}
		for map, bosses in pairs(_G.SpokenBosses and SpokenBosses.maps or {}) do
			for _, boss in ipairs(bosses) do
				local creature = _G.SpokenBossCreatures and SpokenBossCreatures[map]
				creature = creature and creature[boss.key] and creature[boss.key].creature
				if creature then
					byMapCreature[map] = byMapCreature[map] or {}
					byMapCreature[map][creature] = { map = map, key = boss.key, boss = boss }
					-- False keeps a future import with a repeated id from opening the wrong boss.
					if byCreature[creature] ~= nil then
						byCreature[creature] = false
					else
						byCreature[creature] = { map = map, key = boss.key, boss = boss }
					end
				end
			end
		end
	end
	local alias = LEATRIX_CREATURE_ALIASES[creatureID]
	if alias and _G.SpokenBosses and SpokenBosses.maps[alias.map] then
		for _, boss in ipairs(SpokenBosses.maps[alias.map]) do
			if boss.key == alias.key then
				return { map = alias.map, key = boss.key, boss = boss }
			end
		end
	end
	local found = (byMapCreature[mapID] and byMapCreature[mapID][creatureID]) or byCreature[creatureID]
	if found then return found end

	-- Names are the only fallback for a creature id Spoken lacks. Prefer the current map, so a name
	-- shared by two instances (Balnazzar's is) does not open the wrong story.
	local wanted = BossNameKey(bossName)
	if not wanted then return end
	local any
	for map, bosses in pairs(_G.SpokenBosses and SpokenBosses.maps or {}) do
		for _, boss in ipairs(bosses) do
			if BossNameKey(BossName(boss)) == wanted then
				local candidate = { map = map, key = boss.key, boss = boss }
				if IsMapOrChild(mapID, map) then return candidate end
				if any then return end
				any = candidate
			end
		end
	end
	return any
end

local function DungeonZone(mapID)
	local function Find(map)
		for zone, dungeons in pairs(_G.SpokenPlaces and SpokenPlaces.Dungeons or {}) do
			for _, dungeon in ipairs(dungeons) do
				if dungeon.dungeon == map or tostring(dungeon.dungeon) == tostring(map) then return zone end
			end
		end
	end
	local zone = Find(mapID)
	if zone then return zone end
	-- Some dungeon floors have their own map ID (Gnomeregan 226/228), so walk up to the instance.
	if not C_Map or not C_Map.GetMapInfo then return end
	local seen = {}
	local current = mapID
	for _ = 1, 10 do
		if seen[current] then return end
		seen[current] = true
		local ok, info = pcall(C_Map.GetMapInfo, current)
		if not ok or type(info) ~= "table" then return end
		current = info.parentMapID
		if not current or current == 0 then return end
		zone = Find(current)
		if zone then return zone end
	end
end

local function DungeonInstance(mapID)
	local function Find(map)
		for _, dungeons in pairs(_G.SpokenPlaces and SpokenPlaces.Dungeons or {}) do
			for _, dungeon in ipairs(dungeons) do
				if dungeon.dungeon == map or tostring(dungeon.dungeon) == tostring(map) then
					return dungeon.dungeon
				end
			end
		end
	end
	local instanceID = Find(mapID)
	if instanceID then return instanceID end
	if not C_Map or not C_Map.GetMapInfo then return end
	local seen = {}
	local current = mapID
	for _ = 1, 10 do
		if seen[current] then return end
		seen[current] = true
		local ok, info = pcall(C_Map.GetMapInfo, current)
		if not ok or type(info) ~= "table" then return end
		current = info.parentMapID
		if not current or current == 0 then return end
		instanceID = Find(current)
		if instanceID then return instanceID end
	end
end

local function DungeonInstanceByName(name)
	if type(name) ~= "string" or not _G.SpokenDungeons or type(SpokenDungeons.dungeons) ~= "table" then
		return
	end
	local locale = GetLocale and GetLocale() or "enUS"
	for instanceID, dungeon in pairs(SpokenDungeons.dungeons) do
		local localized = dungeon[locale] or dungeon[1]
		if localized == name then return instanceID end
	end
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

local function BossModel(map, key)
	local entry = _G.SpokenBossCreatures and SpokenBossCreatures[map]
	entry = entry and entry[key]
	if entry and entry.display then
		return { creatureID = entry.creature, displayID = entry.display }
	end
end

local ShowLeatrixDungeon
local suppressPreviewFallback
local activeDungeonID

local function CurrentMapID()
	if not WorldMapFrame then return end
	if type(WorldMapFrame.GetMapID) == "function" then
		local ok, mapID = pcall(WorldMapFrame.GetMapID, WorldMapFrame)
		if ok and mapID then return mapID end
	end
	return WorldMapFrame.mapID
end

local function ShowLeatrixEntrance(mapID)
	-- During a preview the world map stays on the entrance zone. The selected dungeon goes first:
	-- instance IDs and UI map IDs are separate numberings, so equal numbers prove nothing.
	local instanceID = activeDungeonID or DungeonInstance(mapID)
	local dungeonMapID = instanceID or mapID
	if instanceID then
		local shown = ShowLeatrixDungeon(mapID, instanceID)
		if shown then suppressPreviewFallback = true; return true end
	end
	if not _G.SpokenPlaces or not SpokenPlaces.ShowMapStory or not SpokenPlaces.GetLoreWithFallback then
		return false
	end
	local zone = DungeonZone(dungeonMapID)
	local story, foundOn = zone and SpokenPlaces:GetLoreWithFallback(zone)
	if not zone or not story then return false end

	local entry = {
		title = SpokenPlaces:GetMapName(zone) or tostring(zone),
		subtitle = SpokenPlaces.PlaceLine and SpokenPlaces:PlaceLine(zone) or "",
	}
	if SpokenPlaces.IsLocked and SpokenPlaces:IsLocked(zone) then
		entry.text = SpokenPlaces.L and SpokenPlaces.L.NOT_DISCOVERED or "You have not discovered this place yet."
	elseif SpokenPlaces.IsPending and SpokenPlaces:IsPending(story) then
		entry.contribute = { zone, nil }
		entry.lore = { zone, nil }
	else
		entry.text = story.full or story.short or ""
		entry.audio = { foundOn, nil }
		entry.report = { foundOn, nil }
		entry.lore = { foundOn, nil }
	end
	if SpokenCompendium and SpokenCompendium.PlaceIcon then entry.icon = SpokenCompendium.PlaceIcon(zone) end
	return SpokenPlaces:ShowMapStory(mapID, entry)
end

local function DungeonStory(instanceID)
	for _, dungeons in pairs(_G.SpokenPlaces and SpokenPlaces.Dungeons or {}) do
		for _, dungeon in ipairs(dungeons) do
			if dungeon.dungeon == instanceID or tostring(dungeon.dungeon) == tostring(instanceID) then
				return dungeon.mapID, dungeon.key
			end
		end
	end
end

ShowLeatrixDungeon = function(mapID, instanceID)
	if not mapID or not instanceID or not _G.SpokenPlaces or not SpokenPlaces.ShowMapStory then
		return false
	end
	local storyMap, storyKey = DungeonStory(instanceID)
	local story = storyMap and SpokenPlaces.Subzones and SpokenPlaces.Subzones[storyMap]
	story = story and story[storyKey]
	if not story then return false end

	local title = SpokenCompendium and SpokenCompendium.DungeonName and SpokenCompendium.DungeonName(instanceID)
		or SpokenPlaces:GetMapName(instanceID) or tostring(instanceID)
	local entry = {
		title = title,
		subtitle = SpokenPlaces.PlaceLine and SpokenPlaces:PlaceLine(storyMap, storyKey) or "",
	}
	if SpokenPlaces.IsLocked and SpokenPlaces:IsLocked(storyMap, storyKey) then
		entry.text = SpokenPlaces.L and SpokenPlaces.L.NOT_DISCOVERED or "You have not discovered this place yet."
	elseif SpokenPlaces.IsPending and SpokenPlaces:IsPending(story) then
		entry.contribute = { storyMap, storyKey }
		entry.lore = { storyMap, storyKey }
	else
		entry.text = story.full or story.short or ""
		entry.audio = { storyMap, storyKey }
		entry.report = { storyMap, storyKey }
		entry.lore = { storyMap, storyKey }
	end
	return SpokenPlaces:ShowMapStory(mapID, entry)
end

function Bosses:ShowLeatrixBoss(mapID, creatureID, bossName)
	-- A preview keeps the world map on the entrance zone while Leatrix draws the dungeon floor
	-- itself. Use its instance ID to disambiguate bosses with the same name in different dungeons.
	local found = BossFor(activeDungeonID or DungeonInstance(mapID) or mapID, creatureID, bossName)
	if not found or not _G.SpokenPlaces or not SpokenPlaces.ShowMapStory then
		return false
	end

	local story = self:StoryClip(found.map, found.key)
	local target = story and { found.map, found.key } or nil
	local text = story and story.present.transcript or SpokenCompendium.NotWritten()
	local revealed = self:IsRevealed(found.map, found.key)
	if not revealed then
		text = self.L.BOSS_NOT_FOUND
		target = nil
	end
	suppressPreviewFallback = true

	return SpokenPlaces:ShowMapStory(mapID, {
		title = BossName(found.boss),
		subtitle = self:Where(found.map, found.key),
		panelTitle = SpokenPlaces.L and SpokenPlaces.L.BOSS_LORE_TITLE or "Boss lore",
		icon = self:Portrait(found.map, found.key),
		face = true,
		-- The page of a boss not shown has no row to land on.
		open = revealed and function() self:ShowBoss(found.map, found.key) end or nil,
		-- A boss not met shows no model, as its page in the Compendium shows none.
		model = revealed and BossModel(found.map, found.key) or nil,
		text = text,
		target = target,
		play = PLAY,
		reportAction = Bosses.ReportAction,
	})
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
	if _G.SpokenPlaces and SpokenPlaces.ClearMapStory then
		SpokenPlaces:ClearMapStory(CurrentMapID())
	end
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
	ShowLeatrixDungeon(CurrentMapID(), instanceID)
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
