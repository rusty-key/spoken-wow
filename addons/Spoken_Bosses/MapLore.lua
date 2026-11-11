-- What the map adapters (Leatrix.lua, OpenMap.lua) share: finding a dungeon's or a boss's story
-- and showing it in Spoken Places' map panel.

local _, Bosses = ...

local M = {}
Bosses.MapLore = M

M.PLAY = {
	has = function(target)
		return Bosses.GetAudioClip ~= nil and Bosses:GetAudioClip(target[1], target[2]) ~= nil
	end,
	find = function(target) return Bosses:QueuedStory(target[1], target[2]) end,
	start = function(target) Bosses:PlayStory(target[1], target[2]) end,
}

function M.BossName(boss)
	return boss[GetLocale and GetLocale() or "enUS"] or boss[1]
end

function M.BossNameKey(name)
	if type(name) ~= "string" then return end
	name = name:match("^(.-)%s*<") or name
	return (string.lower(name):gsub("%s+", " "))
end

local function SameID(a, b)
	return a == b or tostring(a) == tostring(b)
end

-- `mapID` and its parents, nearest first, up to ten levels.
local function MapChain(mapID)
	if not mapID then return {} end
	local chain, seen, current = { mapID }, { [mapID] = true }, mapID
	local mapAPI = _G.C_Map
	if not mapAPI or not mapAPI.GetMapInfo then return chain end
	for _ = 1, 10 do
		local ok, info = pcall(mapAPI.GetMapInfo, current)
		current = ok and type(info) == "table" and info.parentMapID
		if not current or current == 0 or seen[current] then break end
		seen[current] = true
		chain[#chain + 1] = current
	end
	return chain
end

function M.IsMapOrChild(mapID, parentMapID)
	for _, map in ipairs(MapChain(mapID)) do
		if SameID(map, parentMapID) then return true end
	end
	return false
end

-- The dungeon entry of SpokenPlaces.Dungeons for an instance, and the zone listing it.
local function DungeonEntry(instanceID)
	for zone, dungeons in pairs(_G.SpokenPlaces and SpokenPlaces.Dungeons or {}) do
		for _, dungeon in ipairs(dungeons) do
			if SameID(dungeon.dungeon, instanceID) then return dungeon, zone end
		end
	end
end

--- The instance whose map `mapID` is, walking up from a floor with its own map ID (Gnomeregan
--- 226/228). Only for a map the client has open on that instance: instance IDs and UI map IDs are
--- separate numberings, so equal numbers elsewhere prove nothing.
function M.DungeonInstance(mapID)
	for _, map in ipairs(MapChain(mapID)) do
		local dungeon = DungeonEntry(map)
		if dungeon then return dungeon.dungeon end
	end
end

--- The zone listing the dungeon whose map `mapID` is, as DungeonInstance finds it.
function M.DungeonZone(mapID)
	for _, map in ipairs(MapChain(mapID)) do
		local _, zone = DungeonEntry(map)
		if zone then return zone end
	end
end

function M.DungeonInstanceByName(name)
	if type(name) ~= "string" or not _G.SpokenDungeons or type(SpokenDungeons.dungeons) ~= "table" then
		return
	end
	local locale = GetLocale and GetLocale() or "enUS"
	for instanceID, dungeon in pairs(SpokenDungeons.dungeons) do
		if (dungeon[locale] or dungeon[1]) == name then return instanceID end
	end
end

function M.BossModel(map, key)
	local entry = _G.SpokenBossCreatures and SpokenBossCreatures[map]
	entry = entry and entry[key]
	if entry and entry.display then
		return { creatureID = entry.creature, displayID = entry.display }
	end
end

function M.CurrentMapID()
	if not WorldMapFrame then return end
	if type(WorldMapFrame.GetMapID) == "function" then
		local ok, mapID = pcall(WorldMapFrame.GetMapID, WorldMapFrame)
		if ok and mapID then return mapID end
	end
	return WorldMapFrame.mapID
end

function M.ClearStory()
	if _G.SpokenPlaces and SpokenPlaces.ClearMapStory then
		SpokenPlaces:ClearMapStory(M.CurrentMapID())
	end
end

--- Shows instance `instanceID`'s story in the panel beside map `mapID`. False where it has none.
function M.ShowDungeon(mapID, instanceID)
	if not mapID or not instanceID or not _G.SpokenPlaces or not SpokenPlaces.ShowMapStory then
		return false
	end
	local dungeon = DungeonEntry(instanceID)
	local storyMap, storyKey = dungeon and dungeon.mapID, dungeon and dungeon.key
	local story = storyMap and SpokenPlaces.Subzones and SpokenPlaces.Subzones[storyMap]
	story = story and story[storyKey]
	if not story then return false end

	local title = SpokenCompendium and SpokenCompendium.DungeonName and SpokenCompendium.DungeonName(instanceID)
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
	return SpokenPlaces:ShowMapStory(mapID, entry)
end

--- Shows a boss's story (`found`: { map, key, boss }) in the panel beside map `mapID`.
function M.ShowBoss(mapID, found)
	if not mapID or not found or not _G.SpokenPlaces or not SpokenPlaces.ShowMapStory then
		return false
	end
	local story = Bosses:StoryClip(found.map, found.key)
	local target = story and { found.map, found.key } or nil
	local text = story and story.present and story.present.transcript or SpokenCompendium.NotWritten()
	if not Bosses:IsBossFound(found.map, found.key)
		and not (SpokenBossesSettings and SpokenBossesSettings.unlockUnfound) then
		text = Bosses.L.BOSS_NOT_FOUND
		target = nil
	end
	return SpokenPlaces:ShowMapStory(mapID, {
		title = M.BossName(found.boss),
		subtitle = SpokenCompendium.DungeonName(found.map) or "",
		panelTitle = SpokenPlaces.L and SpokenPlaces.L.BOSS_LORE_TITLE or "Boss lore",
		model = M.BossModel(found.map, found.key),
		text = text,
		target = target,
		play = M.PLAY,
		reportAction = Bosses.ReportAction,
	})
end
