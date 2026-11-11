-- SpokenPlaces -- the world map while OpenMap draws its stitched map in it.
--
-- OpenMap shows every zone at once and points WorldMapFrame.mapID at the map the view is centred
-- on, which stays the continent until well past the zoom that shows a whole zone. Only its public
-- OpenMapAPI is read, at major 1, so without it the map features behave as they always have.

local _, SpokenPlaces = ...

-- OpenMap's zoom (1: the whole world fits) from which areas answer the cursor; further out its
-- click picks a zone and areas are too small to point at. One zoom for every zone: a share of the
-- view each fills would leave a small zone dark beside a large lit one. At 4.5 Dun Morogh fills
-- about half the view.
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

--- The frame level for a frame meant to show over the map's explored areas at `level`: OpenMap's
--- art takes the levels just above them, and its icons start above the art.
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

--- Chooses a zone's or a city's story for the panel on OpenMap's map, without opening its map:
--- a city's map opened under OpenMap's moving view left the map on the city while the view went
--- back to the zone.
function SpokenPlaces:SelectMap(mapID)
	self.selected = { mapID = mapID, map = true }
	if self.RefreshPanel then
		self:RefreshPanel()
	end
end

--- The map whose story the panel tells while nothing is chosen: on OpenMap's map, zoomed in to a
--- zone while the map is still the continent, the zone at the view's centre, as the panel tells
--- the zone on Blizzard's zone map.
function SpokenPlaces:ViewMap(mapID)
	local om = self:OpenMap()
	if not om or not mapID or self:IsZoneMap(mapID) or not CloseEnough(om) then
		return mapID
	end
	local ok, u, v = pcall(om.GetView)
	return ok and u and v and ZoneAt(om, u, v) or mapID
end

--- Whether the map is left to OpenMap: on its map, with the panel not beside it, nothing lights
--- and a click is OpenMap's alone. There every click already moves the view, and one that also
--- reopened the panel put back what the player had put away.
function SpokenPlaces:MapLeftToOpenMap()
	return self:OpenMap() ~= nil and not self:IsMapPanelOpen()
end

--- Calls `onView` as OpenMap's view moves and `onStitched` as its map turns on or off. Asked
--- once the addons have loaded, as OpenMap may load after this.
function SpokenPlaces:OnOpenMapView(onView, onStitched)
	local om = API()
	if not (om and om.RegisterCallback) then
		return
	end
	local owner = {}
	pcall(om.RegisterCallback, owner, "OpenMap_ViewChanged", function() onView() end)
	pcall(om.RegisterCallback, owner, "OpenMap_StitchedChanged", function() onStitched() end)
end

-- How much closer than the fit of the zone at the view's centre the view may be before a click
-- no longer fits the zone clicked: a player zoomed in on part of a zone wants to stay there. The
-- zone looked at, not the one clicked: from a small zone, a large neighbour fits much further out.
local FIT_DEEPEST = 1.5

local function WorldRect(om, mapID)
	local ok1, u0, v0 = pcall(om.WorldFromMap, mapID, 0, 0)
	local ok2, u1, v1 = pcall(om.WorldFromMap, mapID, 1, 1)
	if ok1 and ok2 and u0 and u1 then
		return u0, v0, u1, v1
	end
end

-- The view's size on the stitched world: the scroll frame's share of the canvas, which is the
-- map the view sits on.
local function ViewSize(om)
	local container = WorldMapFrame.ScrollContainer
	local canvas = WorldMapFrame.GetCanvas and WorldMapFrame:GetCanvas()
	local host = WorldMapFrame.mapID
	if not (container and canvas and host) then
		return nil
	end
	local u0, v0, u1, v1 = WorldRect(om, host)
	local cw, ch = canvas:GetWidth(), canvas:GetHeight()
	if not u0 or not cw or cw <= 0 or ch <= 0 then
		return nil
	end
	local scale = container:GetEffectiveScale() / canvas:GetEffectiveScale()
	return container:GetWidth() * scale / cw * (u1 - u0), container:GetHeight() * scale / ch * (v1 - v0)
end

--- After a click chose `zone`'s story on OpenMap's map, glides the view to fit the zone where part
--- of it is out of view: OpenMap's own click only zooms in, so a neighbour clicked at the view's
--- edge stayed cut off.
function SpokenPlaces:FitZone(zone)
	local om = self:OpenMap()
	if not (om and om.ShowWorld and zone) then
		return
	end
	local okView, cu, cv, zoom = pcall(om.GetView)
	local viewW, viewH = ViewSize(om)
	local u0, v0, u1, v1 = WorldRect(om, zone)
	if not (okView and zoom and viewW and u0) or u1 <= u0 or v1 <= v0 then
		return
	end
	-- Zoom scales the view's size down in step, so this is the zoom at which the zone just fits.
	local function Fit(left, top, right, bottom)
		return zoom * math.min(viewW / (right - left), viewH / (bottom - top))
	end
	local fit = Fit(u0, v0, u1, v1)
	-- OpenMap's click is already zooming in on the first map under it that fits closer than the
	-- view (the zone, or a city inside it), and a second glide would fight it.
	if fit > zoom * 1.05 then
		return
	end
	local looked = ZoneAt(om, cu, cv)
	-- An area of the zone looked at: the player chose how much of it to show.
	if looked == zone then
		return
	end
	local lu0, lv0, lu1, lv1
	if looked then
		lu0, lv0, lu1, lv1 = WorldRect(om, looked)
	end
	local lookedFit = lu0 and lu1 > lu0 and lv1 > lv0 and Fit(lu0, lv0, lu1, lv1) or fit
	if zoom > lookedFit * FIT_DEEPEST then
		return
	end
	local okCursor, u, v = pcall(om.CursorPosition)
	local okAt, under = false, nil
	if okCursor and u then
		okAt, under = pcall(om.MapAt, u, v)
	end
	if okAt and type(under) == "number" and under ~= zone then
		local left, top, right, bottom = WorldRect(om, under)
		if left and right > left and bottom > top and Fit(left, top, right, bottom) > zoom * 1.05 then
			return
		end
	end
	local halfW, halfH = viewW / 2, viewH / 2
	if u0 >= cu - halfW and u1 <= cu + halfW and v0 >= cv - halfH and v1 <= cv + halfH then
		return
	end
	pcall(om.ShowWorld, (u0 + u1) / 2, (v0 + v1) / 2, fit)
end
