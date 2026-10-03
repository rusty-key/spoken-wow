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

local downX, downY

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

	local areaName = SpokenZones:GetAreaNameAt(mapID, x, y)
	local debug = SpokenZones:Get("debug")

	if not areaName then
		if debug then
			SpokenZones:Print("no area under cursor on map %d", mapID)
		end
		return
	end

	local entry, key = SpokenZones:GetSubzoneLore(mapID, areaName)

	if debug then
		SpokenZones:Print(
			'area "%s" -> key "%s" -> %s',
			areaName,
			tostring(key),
			entry and "found" or "|cffffcc00no lore|r"
		)
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
		end
	end)

	container:HookScript("OnMouseUp", function(self, button)
		if button ~= "LeftButton" then
			return
		end
		if Spoken and Spoken.IsPartOn and not Spoken:IsPartOn("zones") then
			downX, downY = nil, nil
			return
		end

		local startX, startY = downX, downY
		downX, downY = nil, nil
		if not startX then
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
