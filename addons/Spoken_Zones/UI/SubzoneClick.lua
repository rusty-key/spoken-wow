-- SpokenZones -- detect clicks on a subzone of the displayed world map.
--
-- Subzones have no uiMapID, so C_Map.GetMapInfoAtPosition cannot see them; it
-- only reports child *maps*. MapUtil.FindBestAreaNameAtMouse is the API that
-- resolves a cursor position to an area name, and it is present on 11509
-- (Leatrix_Maps calls it on this client).

local ADDON_NAME, SpokenZones = ...

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
	if not SpokenZones:IsZoneMap(mapID) then
		return
	end

	-- The highlight lights what this finds (SpokenZones:AreaAt), so a lit area is one a click opens.
	local areaName, entry, key, city = SpokenZones:AreaAt(mapID, x, y)
	local debug = SpokenZones:Get("debug")

	if not areaName then
		if debug then
			SpokenZones:Print("no area under cursor on map %d", mapID)
		end
		return
	end

	if debug then
		SpokenZones:Print(
			'area "%s" -> key "%s" -> %s',
			areaName,
			tostring(key),
			entry and "found" or "|cffffcc00no lore|r"
		)
	end

	-- A city inside the zone (Stormwind City on Elwynn Forest's map) is a map of its own: the click
	-- opens it, as one on a zone opens the zone from its continent, and the panel tells its story.
	if city then
		if WorldMapFrame.SetMapID then WorldMapFrame:SetMapID(city) end
		return
	end

	if entry then
		SpokenZones:SelectSubzone(mapID, areaName, entry)
	end
end

function SpokenZones:SetupSubzoneClicks()
	local container = WorldMapFrame and WorldMapFrame.ScrollContainer
	if not container then
		SpokenZones:Print("|cffffcc00WorldMapFrame.ScrollContainer missing; subzone clicks disabled|r")
		return
	end

	if not (MapUtil and MapUtil.FindBestAreaNameAtMouse) then
		SpokenZones:Print("|cffffcc00MapUtil.FindBestAreaNameAtMouse missing; subzone clicks disabled|r")
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
		if not SpokenZones:IsPartOn() then
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
