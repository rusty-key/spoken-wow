-- SpokenPlaces -- the world map while OpenMap draws its stitched map in it.
--
-- OpenMap shows every zone at once inside WorldMapFrame and points WorldMapFrame.mapID at
-- whatever map the view is centred on: a neighbouring zone under the cursor is not that map,
-- and at a zoom that already shows a whole zone the map is still the continent. Its public API
-- (OpenMapAPI, docs/api.md in its repo) tells which zone is under the cursor and where. Only
-- that API is read, and only at the major version written against, so another major, or no
-- OpenMap, leaves the map features exactly as they are without it.

local _, SpokenPlaces = ...

-- OpenMap's zoom (1: the whole world fits the view) from which areas answer the cursor. Further
-- out its click means "go to that zone" and the areas are too small to point at. One zoom for
-- every zone, not a share of the view each fills: a small zone next to a large one would
-- otherwise stay dark while the large one lights up. At 4.5 Dun Morogh fills about half the view;
-- OpenMap's map is still the continent there, and only turns to the zone at about 8.
local MIN_ZOOM = 4.5

local function API()
	local om = _G.OpenMapAPI
	-- CursorPosition, the one call everything here starts from, came in version 3.
	if type(om) ~= "table" or om.major ~= 1 or (tonumber(om.version) or 0) < 3 then
		return nil
	end
	return om
end

--- OpenMap's API while its stitched map is the one on screen, else nil. A failing call is read
--- as no OpenMap, so a bug there costs the map features OpenMap's own behaviour, not errors.
function SpokenPlaces:OpenMap()
	local om = API()
	if not om then
		return nil
	end
	local ok, stitched = pcall(om.IsStitched)
	if ok and stitched then
		return om
	end
	return nil
end

-- The zone map whose areas are at the world point: a city is a map of its own with no areas,
-- and the game names it as an area of the zone around it (SpokenPlaces.CityIn).
local function ZoneAt(om, u, v)
	local ok, mapID = pcall(om.MapAt, u, v)
	if not ok or type(mapID) ~= "number" then
		return nil
	end
	mapID = (SpokenPlaces.CityIn and SpokenPlaces.CityIn[mapID]) or mapID
	if SpokenPlaces:IsZoneMap(mapID) then
		return mapID
	end
	return nil
end

local function CloseEnough(om)
	local ok, _, _, zoom = pcall(om.GetView)
	return ok and type(zoom) == "number" and zoom >= MIN_ZOOM
end

--- The zone map under the cursor and the cursor's position on it (0..1), or nil. The click and
--- the highlight ask this rather than WorldMapFrame.mapID, so on OpenMap's map they answer for
--- the zone the cursor is on, not the one the view is centred on.
function SpokenPlaces:CursorArea()
	local om = self:OpenMap()
	if om then
		local ok, u, v = pcall(om.CursorPosition)
		if not (ok and u and v) then
			return nil
		end
		local zone = CloseEnough(om) and ZoneAt(om, u, v)
		if not zone then
			return nil
		end
		local okXY, x, y = pcall(om.MapFromWorld, zone, u, v)
		if okXY and x and y then
			return zone, x, y
		end
		return nil
	end
	local mapID = WorldMapFrame and WorldMapFrame.mapID
	local container = WorldMapFrame and WorldMapFrame.ScrollContainer
	if not mapID or not container or not self:IsZoneMap(mapID) then
		return nil
	end
	local x, y = container:GetNormalizedCursorPosition()
	if x and y then
		return mapID, x, y
	end
	return nil
end

--- Values that change whenever what is under the cursor may have: on OpenMap's map the world
--- point under it, which moves as the view pans under a resting cursor while Blizzard's
--- normalized cursor does not, and the zoom, which decides whether areas answer at all.
function SpokenPlaces:MapCursor()
	local om = self:OpenMap()
	if om then
		local ok, u, v = pcall(om.CursorPosition)
		local okView, _, _, zoom = pcall(om.GetView)
		return ok and u or nil, ok and v or nil, okView and zoom or nil
	end
	local container = WorldMapFrame and WorldMapFrame.ScrollContainer
	if container then
		local x, y = container:GetNormalizedCursorPosition()
		return x, y, nil
	end
	return nil
end

--- The frame level for a frame meant to show over the map's explored areas at `level`: OpenMap
--- puts its art in the levels just over them, so there it goes over that art instead (under
--- OpenMap's own icons, which start above it).
function SpokenPlaces:OverArtLevel(level)
	local om = self:OpenMap()
	if om and om.ArtTopLevel then
		local ok, top = pcall(om.ArtTopLevel)
		if ok and type(top) == "number" and top >= level then
			return top + 1
		end
	end
	return level
end

-- The rectangle of `zone`'s map on the map the canvas shows, in that map's 0..1.
local function ZoneRect(om, zone, host)
	local ok1, u0, v0 = pcall(om.WorldFromMap, zone, 0, 0)
	local ok2, u1, v1 = pcall(om.WorldFromMap, zone, 1, 1)
	if not (ok1 and ok2 and u0 and u1) then
		return nil
	end
	local ok3, x0, y0 = pcall(om.MapFromWorld, host, u0, v0)
	local ok4, x1, y1 = pcall(om.MapFromWorld, host, u1, v1)
	if not (ok3 and ok4 and x0 and x1) then
		return nil
	end
	return x0, y0, x1, y1
end

--- Lays `frame` over `zone`'s map on the canvas, sized in that zone's art pixels (`layer`), so
--- what is drawn on it in those pixels lands on the zone wherever OpenMap shows it. False where
--- the zone cannot be placed. Without OpenMap the zone is the map shown, which fills the canvas.
function SpokenPlaces:PlaceOverZone(frame, canvas, zone, layer)
	local om = self:OpenMap()
	local host = WorldMapFrame and WorldMapFrame.mapID
	if not om or not host or host == zone then
		frame:ClearAllPoints()
		frame:SetScale(1)
		frame:SetAllPoints(canvas)
		return true
	end
	local x0, y0, x1 = ZoneRect(om, zone, host)
	local width = x0 and (x1 - x0) * canvas:GetWidth()
	if not width or width <= 0 then
		return false
	end
	local scale = width / layer.layerWidth
	frame:ClearAllPoints()
	frame:SetScale(scale)
	frame:SetSize(layer.layerWidth, layer.layerHeight)
	-- Offsets are in the frame's own, scaled units.
	frame:SetPoint("TOPLEFT", canvas, "TOPLEFT", x0 * canvas:GetWidth() / scale, -y0 * canvas:GetHeight() / scale)
	return true
end

--- On OpenMap's map a click on a city tells its story without opening its map: OpenMap's own
--- click is already moving the view, and opening the city's map under it left the map on the
--- city while the view went back to the zone (rusty-key/spoken-wow#921).
function SpokenPlaces:SelectCity(city, entry)
	self.selected = { mapID = city, city = true, entry = entry }
	if self.RefreshPanel then
		self:RefreshPanel()
	end
end
