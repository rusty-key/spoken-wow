-- What the map adapters (Leatrix.lua, OpenMap.lua) share: finding a dungeon's or a boss's story
-- and showing it in Spoken Places' map panel.

local _, Bosses = ...

local M = {}
Bosses.MapLore = M

local PLAY = {
	has = function(target)
		return Bosses.GetAudioClip ~= nil and Bosses:GetAudioClip(target[1], target[2]) ~= nil
	end,
	find = function(target) return Bosses:QueuedStory(target[1], target[2]) end,
	start = function(target) Bosses:PlayStory(target[1], target[2]) end,
}

M.BossName = Bosses.Name

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
--- 226/228), and the zone listing it. Only for a map the client has open on that instance:
--- instance IDs and UI map IDs are separate numberings, so equal numbers elsewhere prove nothing.
function M.DungeonAt(mapID)
	for _, map in ipairs(MapChain(mapID)) do
		local dungeon, zone = DungeonEntry(map)
		if dungeon then return dungeon.dungeon, zone end
	end
end

--- A boss as the adapters pass it around.
function M.Found(map, boss)
	return { map = map, key = boss.key, boss = boss }
end

--- The boss named `name` (a key from BossNameKey): the one on a map `prefer(map)` accepts, else
--- the only one of that name, else nil.
function M.BossByName(wanted, prefer)
	if not wanted then return end
	local any
	for map, bosses in pairs(_G.SpokenBosses and SpokenBosses.maps or {}) do
		for _, boss in ipairs(bosses) do
			if M.BossNameKey(M.BossName(boss)) == wanted then
				if prefer and prefer(map) then return M.Found(map, boss) end
				if any then return end
				any = M.Found(map, boss)
			end
		end
	end
	return any
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


function M.CurrentMapID()
	if not WorldMapFrame then return end
	if type(WorldMapFrame.GetMapID) == "function" then
		local ok, mapID = pcall(WorldMapFrame.GetMapID, WorldMapFrame)
		if ok and mapID then return mapID end
	end
	return WorldMapFrame.mapID
end

-- The map the last story was shown beside: clearing it there still works after the map moved.
local shownOn

function M.Show(mapID, entry)
	shownOn = mapID
	return SpokenPlaces:ShowMapStory(mapID, entry)
end

function M.ClearStory()
	if _G.SpokenPlaces and SpokenPlaces.ClearMapStory then
		SpokenPlaces:ClearMapStory(shownOn or M.CurrentMapID())
	end
	shownOn = nil
end

--- Fills a place's story into a panel `entry`: locked, pending or told. `place, key` is the story,
--- `toldOn` the place whose words are played and reported (a zone's fallback), else `place, key`.
function M.PlaceEntry(entry, story, place, key, toldOn)
	local toldKey = key
	if toldOn then toldKey = nil else toldOn = place end
	if SpokenPlaces.IsLocked and SpokenPlaces:IsLocked(place, key) then
		entry.text = SpokenPlaces.L and SpokenPlaces.L.NOT_DISCOVERED or "You have not discovered this place yet."
	elseif SpokenPlaces.IsPending and SpokenPlaces:IsPending(story) then
		entry.contribute = { place, key }
		entry.lore = { place, key }
	else
		entry.text = story.full or story.short or ""
		entry.audio = { toldOn, toldKey }
		entry.report = { toldOn, toldKey }
		entry.lore = { toldOn, toldKey }
	end
	return entry
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
	return M.Show(mapID, M.PlaceEntry({
		title = title,
		subtitle = SpokenPlaces.PlaceLine and SpokenPlaces:PlaceLine(storyMap, storyKey) or "",
	}, story, storyMap, storyKey))
end

--- Shows a boss's story (`found`: { map, key, boss }) in the panel beside map `mapID`.
function M.ShowBoss(mapID, found)
	if not mapID or not _G.SpokenPlaces or not SpokenPlaces.ShowMapStory then
		return false
	end
	local story = Bosses:StoryClip(found.map, found.key)
	local target = story and { found.map, found.key } or nil
	local text = story and story.present and story.present.transcript or SpokenCompendium.NotWritten()
	if not Bosses:IsBossFound(found.map, found.key) and not Bosses.Unlocked() then
		text = Bosses.L.BOSS_NOT_FOUND
		target = nil
	end
	return M.Show(mapID, {
		title = M.BossName(found.boss),
		subtitle = SpokenCompendium.DungeonName(found.map) or "",
		panelTitle = SpokenPlaces.L and SpokenPlaces.L.BOSS_LORE_TITLE or "Boss lore",
		model = Bosses.Model(found.map, found.key),
		text = text,
		target = target,
		play = PLAY,
		reportAction = Bosses.ReportAction,
	})
end
