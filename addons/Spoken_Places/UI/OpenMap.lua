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
