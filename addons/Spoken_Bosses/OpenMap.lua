-- Optional clicks on OpenMap's private dungeon boss rows. OpenMap does not expose the row
-- widgets through its public API, but each row keeps the item used to build it on the button.

local _, Bosses = ...

local PLAY = {
	has = function(target)
		return Bosses.GetAudioClip ~= nil and Bosses:GetAudioClip(target[1], target[2]) ~= nil
	end,
	find = function(target) return Bosses:QueuedStory(target[1], target[2]) end,
	start = function(target) Bosses:PlayStory(target[1], target[2]) end,
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
	local seen, current = {}, mapID
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
		if (dungeon[locale] or dungeon[1]) == name then return instanceID end
	end
end

local function BossModel(map, key)
	local entry = _G.SpokenBossCreatures and SpokenBossCreatures[map]
	entry = entry and entry[key]
	if entry and entry.display then
		return { creatureID = entry.creature, displayID = entry.display }
	end
end

local currentInfo
local activeDungeonID

local function InstanceForOpenMapBoss(name)
	if type(currentInfo) ~= "table" or type(currentInfo.instances) ~= "table" then return end
	local wanted = BossNameKey(name)
	for _, instance in ipairs(currentInfo.instances) do
		for _, bossName in ipairs(instance.bosses or {}) do
			if BossNameKey(bossName) == wanted then
				return DungeonInstanceByName(instance.name)
			end
		end
	end
end

local function BossFor(mapID, bossName, bossIndex)
	local wanted = BossNameKey(bossName)
	if not wanted then return end
	local preferred = activeDungeonID or InstanceForOpenMapBoss(bossName) or DungeonInstance(mapID)
	local positionMatch
	if preferred and bossIndex then
		local bosses = _G.SpokenBosses and SpokenBosses.maps[preferred]
		local boss = bosses and bosses[bossIndex]
		if boss then positionMatch = { map = preferred, key = boss.key, boss = boss } end
	end
	local found
	for map, bosses in pairs(_G.SpokenBosses and SpokenBosses.maps or {}) do
		for _, boss in ipairs(bosses) do
			if BossNameKey(BossName(boss)) == wanted then
				local candidate = { map = map, key = boss.key, boss = boss }
				if preferred and (map == preferred or tostring(map) == tostring(preferred)) then
					return candidate
				end
				if IsMapOrChild(mapID, map) then return candidate end
				if found then
					-- The same localized name exists in more than one dungeon and the current map did
					-- not disambiguate it. Do not open a story for the wrong boss.
					return
				end
				found = candidate
			end
		end
	end
	return found or positionMatch
end

local function CurrentMapID()
	if not WorldMapFrame then return end
	if type(WorldMapFrame.GetMapID) == "function" then
		local ok, mapID = pcall(WorldMapFrame.GetMapID, WorldMapFrame)
		if ok and mapID then return mapID end
	end
	return WorldMapFrame.mapID
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

function Bosses:ShowOpenMapDungeon(mapID, instanceID)
	if not instanceID or not _G.SpokenPlaces or not SpokenPlaces.ShowMapStory then return false end
	local storyMap, storyKey = DungeonStory(instanceID)
	local story = storyMap and SpokenPlaces.Subzones and SpokenPlaces.Subzones[storyMap]
		and SpokenPlaces.Subzones[storyMap][storyKey]
	if not story then return false end

	local title = SpokenCompendium.DungeonName(instanceID)
		or SpokenPlaces.GetMapName and SpokenPlaces:GetMapName(instanceID)
		or tostring(instanceID)
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
	return SpokenPlaces:ShowMapStory(mapID or instanceID, entry)
end

local function RowBossName(item)
	if type(item) ~= "table" or type(item[1]) ~= "string" then return end
	local text = item[1]
	text = text:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")
	local index, name = text:match("^%s*(%d+)%.%s+(.+)$")
	return name, tonumber(index)
end

function Bosses:ShowOpenMapBoss(mapID, bossName, bossIndex)
	local found = BossFor(mapID, bossName, bossIndex)
	if not found or not _G.SpokenPlaces or not SpokenPlaces.ShowMapStory then return false end

	local story = self:StoryClip(found.map, found.key)
	local target = story and { found.map, found.key } or nil
	local text = story and story.present and story.present.transcript
		or SpokenCompendium.NotWritten()
	if not self:IsBossFound(found.map, found.key)
		and not (SpokenBossesSettings and SpokenBossesSettings.unlockUnfound) then
		text = self.L.BOSS_NOT_FOUND
		target = nil
	end

	return SpokenPlaces:ShowMapStory(mapID or found.map, {
		title = BossName(found.boss),
		subtitle = SpokenCompendium.DungeonName(found.map) or "",
		panelTitle = SpokenPlaces.L and SpokenPlaces.L.BOSS_LORE_TITLE or "Boss lore",
		model = BossModel(found.map, found.key),
		text = text,
		target = target,
		play = PLAY,
		reportAction = false,
	})
end

local hooked = setmetatable({}, { __mode = "k" })
local watched = setmetatable({}, { __mode = "k" })
local activityHooked = setmetatable({}, { __mode = "k" })
local dungeonViews = setmetatable({}, { __mode = "k" })
local ScanSoon

local function RowOf(frame)
	local ok, item = pcall(function() return frame.item end)
	return ok and item or nil
end

local function HookRow(frame)
	if hooked[frame] or not frame.HookScript then return end
	local item = RowOf(frame)
	if type(item) ~= "table" or item.kind ~= "row" then return end
	hooked[frame] = true
	frame:HookScript("OnClick", function(self, button)
		if button ~= "LeftButton" then return end
		local name, index = RowBossName(RowOf(self))
		if name then Bosses:ShowOpenMapBoss(CurrentMapID(), name, index) end
	end)
end

local function HookDungeonView(frame)
	if frame ~= _G.OpenMapDungeonView or dungeonViews[frame] or not frame.HookScript then return end
	dungeonViews[frame] = true
	frame:HookScript("OnShow", function(self)
		local inst = self.inst
		local instanceID = type(inst) == "table" and inst[1]
		activeDungeonID = instanceID
		if instanceID then Bosses:ShowOpenMapDungeon(CurrentMapID(), instanceID) end
	end)
	frame:HookScript("OnHide", function()
		activeDungeonID = nil
		if _G.SpokenPlaces and SpokenPlaces.ClearMapStory then SpokenPlaces:ClearMapStory(CurrentMapID()) end
	end)
	if frame:IsShown() then
		local inst = frame.inst
		local instanceID = type(inst) == "table" and inst[1]
		activeDungeonID = instanceID
		if instanceID then Bosses:ShowOpenMapDungeon(CurrentMapID(), instanceID) end
	end
end

local function Watch(frame)
	if watched[frame] or not frame.HookScript then return end
	watched[frame] = true
	frame:HookScript("OnShow", ScanSoon)
	if not activityHooked[frame] and frame.GetObjectType and frame:GetObjectType() == "Button" then
		activityHooked[frame] = true
		-- OpenMap creates its dungeon view in the click handler for an entrance. Scan after every
		-- map button click so the newly created private view is hooked before the next interaction.
		frame:HookScript("OnClick", ScanSoon)
	end
end

local function Scan(parent, seen)
	if not parent or (seen and seen[parent]) then return end
	seen = seen or {}
	seen[parent] = true
	Watch(parent)
	HookRow(parent)
	HookDungeonView(parent)
	if not parent.GetChildren then return end
	local ok, children = pcall(function() return { parent:GetChildren() } end)
	if not ok then return end
	for _, child in ipairs(children) do Scan(child, seen) end
end

local function OpenMapLoaded()
	if C_AddOns and C_AddOns.IsAddOnLoaded then return C_AddOns.IsAddOnLoaded("OpenMap") end
	return IsAddOnLoaded and IsAddOnLoaded("OpenMap") or false
end

local pending
ScanSoon = function()
	if pending or not OpenMapLoaded() then return end
	pending = true
	local passes = 5
	local function pass()
		if WorldMapFrame then Scan(WorldMapFrame) end
		passes = passes - 1
		if passes > 0 and WorldMapFrame and WorldMapFrame:IsShown() then
			C_Timer.After(0.1, pass)
		else
			pending = nil
		end
	end
	C_Timer.After(0, pass)
end

function Bosses:OpenMapDungeonMapShown(info)
	currentInfo = info
	ScanSoon()
	local instance = info and info.instances and info.instances[1]
	local instanceID = instance and DungeonInstanceByName(instance.name)
	activeDungeonID = instanceID
	if instanceID then self:ShowOpenMapDungeon(info.mapID or CurrentMapID(), instanceID) end
end

function Bosses:OpenMapDungeonMapHidden()
	currentInfo = nil
	activeDungeonID = nil
	if _G.SpokenPlaces and SpokenPlaces.ClearMapStory then SpokenPlaces:ClearMapStory(CurrentMapID()) end
end

local setup
local function Setup()
	if setup or not WorldMapFrame or not OpenMapLoaded() then return end
	setup = true
	WorldMapFrame:HookScript("OnShow", ScanSoon)
	WorldMapFrame:HookScript("OnHide", function() currentInfo = nil end)
	if _G.OpenMapAPI and OpenMapAPI.RegisterCallback then
		-- CallbackHandler's RegisterCallback is called with the owner first, not as a method on
		-- the library. Calling it with ':' makes the owner table look like the event name.
		OpenMapAPI.RegisterCallback(Bosses, "OpenMap_DungeonMapShown", "OpenMapDungeonMapShown")
		OpenMapAPI.RegisterCallback(Bosses, "OpenMap_DungeonMapHidden", "OpenMapDungeonMapHidden")
	end
	ScanSoon()
end

local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_ENTERING_WORLD")
events:RegisterEvent("ADDON_LOADED")
events:SetScript("OnEvent", function(_, event, addon)
	if event == "PLAYER_ENTERING_WORLD" or addon == "OpenMap" then Setup() end
end)
