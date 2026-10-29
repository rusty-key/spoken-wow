-- SpokenPlaces -- detect clicks on a subzone of the displayed world map.
--
-- Subzones have no uiMapID, so C_Map.GetMapInfoAtPosition cannot see them; it
-- only reports child *maps*. MapUtil.FindBestAreaNameAtMouse is the API that
-- resolves a cursor position to an area name, and it is present on 11509
-- (Leatrix_Maps calls it on this client).

local _, SpokenPlaces = ...

-- Normalised-coordinate slop allowed between mouse-down and mouse-up before the
-- gesture counts as a map drag rather than a click. IsPanning() is unreliable by
-- the time OnMouseUp fires, so compare positions instead.
local DRAG_TOLERANCE = 0.01

local downX, downY, downMap

local function HandleClick(x, y)
	local mapID = WorldMapFrame.mapID
	if not mapID then
		return
	end

	-- On a continent or world map a click is navigation to a child zone; leave
	-- that to Blizzard's own handlers rather than hijacking it.
	if not SpokenPlaces:IsZoneMap(mapID) then
		return
	end

	-- The highlight lights what this finds (SpokenPlaces:AreaAt), so a lit area is one a click opens.
	local areaName, entry, key, city = SpokenPlaces:AreaAt(mapID, x, y)
	local debug = SpokenPlaces:Get("debug")

	if not areaName then
		if debug then
			SpokenPlaces:Print("no area under cursor on map %d", mapID)
		end
		return
	end

	if debug then
		SpokenPlaces:Print(
			'area "%s" -> key "%s" -> %s',
			areaName,
			tostring(key),
			entry and "found" or "|cffffcc00no lore|r"
		)
	end

	if not entry then
		return
	end
	-- Clicked, so explored: found, whatever the map's samples say (Discovery.lua).
	if key and SpokenPlaces.MarkFound then SpokenPlaces:MarkFound(mapID, key) end
	-- A city inside the zone (Stormwind City on Elwynn Forest's map) is a map of its own: the click
	-- opens it, as one on a zone opens the zone from its continent, and the panel tells its story.
	if city then
		if WorldMapFrame.SetMapID then WorldMapFrame:SetMapID(city) end
	else
		SpokenPlaces:SelectSubzone(mapID, areaName, entry)
	end
	-- Closed beside the map, the panel opens on what was clicked: the click asked for its story.
	-- Not where the player turned the panel off in the settings.
	if SpokenPlaces:Get("showMapPanel") and SpokenPlaces:Get("mapPanelCollapsed") then
		SpokenPlaces:SetMapPanelCollapsed(false)
	end
end

function SpokenPlaces:SetupSubzoneClicks()
	local container = WorldMapFrame and WorldMapFrame.ScrollContainer
	if not container then
		SpokenPlaces:Print("|cffffcc00WorldMapFrame.ScrollContainer missing; subzone clicks disabled|r")
		return
	end

	if not (MapUtil and MapUtil.FindBestAreaNameAtMouse) then
		SpokenPlaces:Print("|cffffcc00MapUtil.FindBestAreaNameAtMouse missing; subzone clicks disabled|r")
		return
	end

	container:HookScript("OnMouseDown", function(self, button)
		if button == "LeftButton" then
			downX, downY = self:GetNormalizedCursorPosition()
			downMap = WorldMapFrame.mapID
		end
	end)

	container:HookScript("OnMouseUp", function(self, button)
		if button ~= "LeftButton" then
			return
		end
		if not SpokenPlaces:IsPartOn() then
			downX, downY, downMap = nil, nil, nil
			return
		end

		local startX, startY, startMap = downX, downY, downMap
		downX, downY, downMap = nil, nil, nil
		if not startX then
			return
		end
		-- A click on a continent that opened a zone (Mulgore from Kalimdor) has already moved the
		-- map when this runs: it chose the zone, not the area now under the cursor on its map.
		if WorldMapFrame.mapID ~= startMap then
			return
		end

		local x, y = self:GetNormalizedCursorPosition()
		if not x then
			return
		end

		if math.abs(x - startX) + math.abs(y - startY) > DRAG_TOLERANCE then
			return -- the player was panning the map
		end

		HandleClick(x, y)
	end)
end
