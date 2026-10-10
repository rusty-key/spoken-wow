-- SpokenZones -- which places this character has found, for Azeroth's Compendium's list.
--
-- Azeroth's Compendium opens only the places found and lists the rest greyed out, each count out of
-- all, unless the player turns on Unlock Undiscovered Zones. A place counts as found when either:
--
--   * the client has it explored. Every explored area is drawn on its zone's map as an
--     exploration overlay, and asking which explored areas lie under those overlays
--     (C_MapExplorationInfo.GetExploredAreaIDsAtPosition) names them. That covers everything
--     explored before Spoken Zones was installed.
--   * the character has stood in it since. Small places and the cities' districts have no
--     overlay and never count as explored, so every zone change records where the character is
--     (SpokenZonesCharacter.visited).
--
-- A zone is found when it, or any of its areas, is; a city also when its name is explored on
-- the zone around it (Orgrimmar on Durotar's map). A continent is found only through its zones
-- (Azeroth's Compendium counts them): being on its map, at sea or on a zeppelin, finds nothing. The map scan is done once per zone a session,
-- and the zone the character is in is scanned again whenever the list is drawn, so a discovery
-- shows the next time Azeroth's Compendium is opened.

local ADDON_NAME, SpokenZones = ...

-- Points asked about across each overlay's rectangle, this many a side: an overlay's rectangle
-- can hold a smaller area of its own, which only some points land in.
local SAMPLES = 4

-- What the maps say, read once and kept until something may have changed it (RefreshFound).
local explored = {}       -- [mapID] = { zone = bool, keys = { [areaKey] = true } }
local exploredNames = {}  -- every explored area's name seen in a scan, for the cities

local function CharDB()
	if type(SpokenZonesCharacter) ~= "table" then
		SpokenZonesCharacter = {}
	end
	if type(SpokenZonesCharacter.visited) ~= "table" then
		SpokenZonesCharacter.visited = {}
	end
	return SpokenZonesCharacter
end

local function VisitKey(mapID, areaKey)
	return areaKey and (mapID .. "/" .. areaKey) or tostring(mapID)
end

--- The explored areas on the map `mapID`, read off its overlays.
local function Scan(mapID)
	local result = { zone = false, keys = {}, why = {} }
	explored[mapID] = result
	local info = C_MapExplorationInfo
	if not (info and info.GetExploredMapTextures and info.GetExploredAreaIDsAtPosition and C_Map.GetMapArtLayers) then
		return result
	end
	local ok, overlays = pcall(info.GetExploredMapTextures, mapID)
	local layers = C_Map.GetMapArtLayers(mapID)
	local layer = layers and layers[1]
	if not ok or not overlays or not layer or layer.layerWidth == 0 then
		return result
	end
	-- Found by what is explored under its overlays, not by having overlays: some maps carry one
	-- the game always draws (Moonglade's whole map), explored or not.
	for _, overlay in ipairs(overlays) do
		local r = overlay.hitRect
		if r then
			local scaleX, scaleY = 1 / layer.layerWidth, 1 / layer.layerHeight
			if r.right <= 1 and r.bottom <= 1 then scaleX, scaleY = 1, 1 end
			for i = 1, SAMPLES do
				for j = 1, SAMPLES do
					local x = (r.left + (r.right - r.left) * (i - 0.5) / SAMPLES) * scaleX
					local y = (r.top + (r.bottom - r.top) * (j - 0.5) / SAMPLES) * scaleY
					local okAt, ids = pcall(info.GetExploredAreaIDsAtPosition, mapID, CreateVector2D(x, y))
					for _, areaID in ipairs(okAt and ids or {}) do
						local name = C_Map.GetAreaInfo(areaID)
						if name then
							exploredNames[name] = exploredNames[name] or mapID
							result.zone = true
							result.why.zone = result.why.zone or ("explored on its map: " .. name)
							local key = SpokenZones:ResolveAreaKey(name)
							if key then result.keys[key] = true end
						end
					end
				end
			end
		end
	end
	return result
end

local function Explored(mapID)
	return explored[mapID] or Scan(mapID)
end

-- Every zone's map read, for /spz found's list of every place. Once until RefreshFound.
local everyZone = false
local function ScanEveryZone()
	if everyZone then return end
	everyZone = true
	for mapID in pairs(SpokenZones.Zones or {}) do
		Explored(mapID)
	end
end

--- Forget what the maps said, so they are read again when next asked: exploring anywhere since
--- (a GM's .cheat explore too) shows. Called when the world map or Azeroth's Compendium opens and when
--- the game reports something explored.
function SpokenZones:RefreshFound()
	explored, exploredNames, everyZone = {}, {}, false
end

--- Whether the character has found the zone `mapID` (areaKey nil) or its area `areaKey`, and
--- as a second value why: what /spz found prints.
function SpokenZones:IsFound(mapID, areaKey)
	if not mapID then
		return false
	end
	local visited = CharDB().visited
	if areaKey then
		if visited[VisitKey(mapID, areaKey)] then return true, "stood in" end
		if Explored(mapID).keys[areaKey] then return true, "explored on the map" end
		return false
	end
	if visited[VisitKey(mapID)] then return true, "stood in" end
	if Explored(mapID).zone then return true, Explored(mapID).why.zone end
	-- A city by its name on the zone around it, the one map that can show it explored. Read
	-- alone: every zone's map on each open costs some 50 zones' overlays, 16 calls each.
	local around = self.CityIn and self.CityIn[mapID]
	if around then Explored(around) end
	local name = self:GetMapName(mapID)
	if name and exploredNames[name] then
		return true, "its name explored on map " .. tostring(exploredNames[name])
	end
	for key in pairs(self.Subzones[mapID] or {}) do
		if visited[VisitKey(mapID, key)] then return true, "stood in its area " .. key end
	end
	return false
end

--- An area a click on the map just resolved: only an explored one resolves, so it is found, even
--- where the samples IsFound reads miss its shape (a road, a riverbank).
function SpokenZones:MarkFound(mapID, areaKey)
	if mapID and areaKey then CharDB().visited[VisitKey(mapID, areaKey)] = true end
end

--- Every place counted found, and why, for /spz found.
function SpokenZones:PrintFound()
	ScanEveryZone()
	local lines = 0
	for mapID in pairs(self.Zones or {}) do
		local name = self:GetMapName(mapID) or tostring(mapID)
		local found, why = self:IsFound(mapID)
		if found then
			self:Print("%s [%d]: %s", name, mapID, why or "?")
			lines = lines + 1
		end
		for key in pairs(self.Subzones[mapID] or {}) do
			local areaFound, areaWhy = self:IsFound(mapID, key)
			if areaFound then
				self:Print("  %s > %s: %s", name, key, areaWhy or "?")
				lines = lines + 1
			end
		end
	end
	self:Print("%d found", lines)
end

--- Whether Azeroth's Compendium lists every place or only those found.
function SpokenZones:ShowsUndiscovered()
	return self:Get("showUndiscovered") == true
end

-- Where the character stands, recorded on every zone change.
local function RecordVisit()
	local _, mapID = SpokenZones:GetLoreWithFallback(SpokenZones:GetPlayerMapID())
	if not mapID then
		return
	end
	-- Between zones (at sea, on a zeppelin) the map is the continent's or the world's: no place.
	local info = C_Map and C_Map.GetMapInfo and C_Map.GetMapInfo(mapID)
	if info and info.mapType and info.mapType < 3 then
		return
	end
	local visited = CharDB().visited
	visited[VisitKey(mapID)] = true
	local subZone = GetSubZoneText and GetSubZoneText()
	if subZone and subZone ~= "" then
		local _, key = SpokenZones:GetSubzoneLore(mapID, subZone)
		if key then visited[VisitKey(mapID, key)] = true end
	end
end

function SpokenZones:SetupDiscovery()
	local function Refresh() SpokenZones:RefreshFound() end
	-- The game says when exploration changes, where it has the event; a zone change covers the rest.
	self:OnZoneChanged(function() RecordVisit(); Refresh() end)
	if WorldMapFrame and WorldMapFrame.HookScript then WorldMapFrame:HookScript("OnShow", Refresh) end
	local events = CreateFrame and CreateFrame("Frame")
	if events then
		pcall(events.RegisterEvent, events, "MAP_EXPLORATION_UPDATED")
		events:SetScript("OnEvent", Refresh)
	end
end
