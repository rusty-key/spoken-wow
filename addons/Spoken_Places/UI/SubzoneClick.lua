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
-- The same on screen, in UI units, on OpenMap's map only. A map that pans by moving its canvas with the cursor
-- (OpenMap's) keeps the cursor on the same map point all through a drag, so the normalised
-- position alone reads every drag as a click.
local DRAG_PIXELS = 8

local downX, downY, downMap, downScreenX, downScreenY

local function ScreenCursor()
	local x, y = GetCursorPosition()
	local scale = UIParent and UIParent:GetEffectiveScale() or 1
	return x / scale, y / scale
end

local function HandleClick()
	-- On a continent or world map a click is navigation to a child zone; leave that to
	-- Blizzard's own handlers rather than hijacking it. CursorArea gives no zone there.
	local mapID, x, y = SpokenPlaces:CursorArea()
	if not mapID then
		return
	end

	-- The highlight lights what this finds (SpokenPlaces:AreaAt), so a lit area is one a click opens.
	local areaName, entry, key, city = SpokenPlaces:AreaAt(mapID, x, y)
	local debug = SpokenPlaces:Get("debug")

	-- Anywhere else in a zone on OpenMap's map, the zone: its story is not on the panel already,
	-- as the map there is the continent or the zone at the view's centre.
	local zoneOnly = not entry and SpokenPlaces:OpenMap() and SpokenPlaces:GetLore(mapID)
	if zoneOnly then
		SpokenPlaces:SelectMap(mapID)
		SpokenPlaces:FitZone(mapID)
		return
	end

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
	if city and SpokenPlaces:OpenMap() then
		SpokenPlaces:SelectMap(city)
	elseif city then
		if WorldMapFrame.SetMapID then WorldMapFrame:SetMapID(city) end
	else
		SpokenPlaces:SelectSubzone(mapID, areaName, entry)
	end
	SpokenPlaces:FitZone(mapID)
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
			downScreenX, downScreenY = ScreenCursor()
			downMap = WorldMapFrame.mapID
		end
	end)

	container:HookScript("OnMouseUp", function(self, button)
		if button ~= "LeftButton" then
			return
		end
		if not SpokenPlaces:IsPartOn() or SpokenPlaces:MapLeftToOpenMap() then
			downX, downY, downMap = nil, nil, nil
			return
		end

		local startX, startY, startMap, startScreenX, startScreenY = downX, downY, downMap, downScreenX, downScreenY
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
		local screenX, screenY = ScreenCursor()
		if SpokenPlaces:OpenMap()
			and math.abs(screenX - startScreenX) + math.abs(screenY - startScreenY) > DRAG_PIXELS then
			return
		end

		HandleClick()
	end)
end
