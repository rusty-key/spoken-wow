-- SpokenZones -- lights up the area under the cursor on a zone map, so it reads as clickable.
--
-- The continent map already lights the zone under the cursor (Blizzard's click-to-zoom
-- highlight); a zone map has nothing like it for its areas, which a click opens the story of
-- (SubzoneClick.lua). An area resolves under the cursor only once it is explored
-- (MapUtil.FindBestAreaNameAtMouse), and every explored area is drawn on the map as an
-- exploration overlay: a texture in the area's shape (C_MapExplorationInfo.GetExploredMapTextures).
-- The highlight is that overlay drawn again over the map, added at HIGHLIGHT_ALPHA, laid out in
-- tiles exactly as Blizzard's MapExplorationPin lays it out. It lights and goes out at once, as
-- the continent map's own highlight does.
--
-- Overlays do not say which area they belong to, and an overlay's rectangle reaches into its
-- neighbours. So each overlay is matched to an area once per map: the area a click resolves to
-- at most points of a grid over its rectangle. What lights is then the overlay of the area a
-- click at the cursor would open, never a neighbour's that happens to hold the cursor.

local ADDON_NAME, SpokenZones = ...

-- How bright the lit area is.
local HIGHLIGHT_ALPHA = 0.35
-- Points across and down an overlay's rectangle asked which area they are in.
local SAMPLES = 6

local state = { tiles = {} }
SpokenZones.mapHighlight = state

-- The smallest power of two at least `n`, from 16: the size of a tile's file where the tile is
-- only partly used.
local function FileSize(n)
	local size = 16
	while size < n do
		size = size * 2
	end
	return size
end

-- The explored overlays of the map shown, asked for once per map and again whenever it opens.
local function Overlays(mapID)
	if state.overlaysFor ~= mapID then
		state.overlaysFor = mapID
		local ok, list = pcall(C_MapExplorationInfo.GetExploredMapTextures, mapID)
		state.overlays = ok and list or {}
		state.areaOf = {}
	end
	return state.overlays
end

local function ArtLayer(mapID)
	local layers = C_Map.GetMapArtLayers and C_Map.GetMapArtLayers(mapID)
	return layers and layers[1]
end

-- Whether the overlay's hit rectangle holds the point, in the map art's pixels. Its rectangle
-- is in pixels; read as a share of the map where all four sides are within 0..1.
local function Holds(info, layer, px, py)
	local r = info.hitRect
	if not r then
		return false
	end
	local scaleX, scaleY = 1, 1
	if r.right <= 1 and r.bottom <= 1 then
		scaleX, scaleY = layer.layerWidth, layer.layerHeight
	end
	return px >= r.left * scaleX and px <= r.right * scaleX and py >= r.top * scaleY and py <= r.bottom * scaleY
end

local function Area(info)
	local r = info.hitRect
	return (r.right - r.left) * (r.bottom - r.top)
end

-- The area an overlay is of: the one most points of a grid over its rectangle resolve to. False
-- where none resolves. Asked once per overlay while the map stays the same.
local function AreaOf(info, mapID, layer)
	local known = state.areaOf[info]
	if known ~= nil then
		return known
	end
	local r = info.hitRect
	local scaleX, scaleY = 1, 1
	if r.right <= 1 and r.bottom <= 1 then
		scaleX, scaleY = layer.layerWidth, layer.layerHeight
	end
	local votes, best, most = {}, false, 0
	for i = 1, SAMPLES do
		for j = 1, SAMPLES do
			local px = (r.left + (r.right - r.left) * (i - 0.5) / SAMPLES) * scaleX
			local py = (r.top + (r.bottom - r.top) * (j - 0.5) / SAMPLES) * scaleY
			local name = SpokenZones:AreaAt(mapID, px / layer.layerWidth, py / layer.layerHeight)
			if name then
				votes[name] = (votes[name] or 0) + 1
				if votes[name] > most then
					best, most = name, votes[name]
				end
			end
		end
	end
	state.areaOf[info] = best
	return best
end

--- The overlay to light at the map's normalised position x, y, with its art layer: only over an
--- area whose story a click would open.
local function Target()
	if not SpokenZones:IsPartOn() then
		return nil
	end
	local container = WorldMapFrame.ScrollContainer
	if not container then
		return nil
	end
	-- Not while the cursor is on a pin: the pin is what a click there reaches.
	local overCanvas
	if WorldMapFrame.IsCanvasMouseFocus then
		overCanvas = WorldMapFrame:IsCanvasMouseFocus()
	else
		overCanvas = container:IsMouseOver()
	end
	local mapID = WorldMapFrame.mapID
	if not overCanvas or not mapID or not SpokenZones:IsZoneMap(mapID) then
		return nil
	end
	local x, y = container:GetNormalizedCursorPosition()
	if not x or not y then
		return nil
	end
	-- As the click finds it (SpokenZones:AreaAt), so what lights up is what a click opens.
	local name, entry = SpokenZones:AreaAt(mapID, x, y)
	if not entry then
		return nil
	end
	local layer = ArtLayer(mapID)
	if not layer then
		return nil
	end
	local px, py = x * layer.layerWidth, y * layer.layerHeight
	local best
	for _, info in ipairs(Overlays(mapID)) do
		if Holds(info, layer, px, py) and AreaOf(info, mapID, layer) == name
			and (not best or Area(info) < Area(best)) then
			best = info
		end
	end
	return best, layer
end

-- Lays the overlay out in tiles over the map, as MapExplorationPin does.
local function Light(info, layer)
	local tileW, tileH = layer.tileWidth or 256, layer.tileHeight or 256
	local wide, tall = math.ceil(info.textureWidth / tileW), math.ceil(info.textureHeight / tileH)
	local n = 0
	for row = 1, tall do
		local h = row < tall and tileH or info.textureHeight - tileH * (tall - 1)
		local fileH = row < tall and tileH or FileSize(h)
		for col = 1, wide do
			local w = col < wide and tileW or info.textureWidth - tileW * (wide - 1)
			local fileW = col < wide and tileW or FileSize(w)
			local file = info.fileDataIDs and info.fileDataIDs[(row - 1) * wide + col]
			if file then
				n = n + 1
				local tile = state.tiles[n]
				if not tile then
					tile = state.frame:CreateTexture(nil, "OVERLAY")
					tile:SetBlendMode("ADD")
					state.tiles[n] = tile
				end
				tile:SetTexture(file, nil, nil, "TRILINEAR")
				tile:SetSize(w, h)
				tile:SetTexCoord(0, w / fileW, 0, h / fileH)
				tile:ClearAllPoints()
				tile:SetPoint("TOPLEFT", state.frame, "TOPLEFT", info.offsetX + tileW * (col - 1),
					-(info.offsetY + tileH * (row - 1)))
				tile:Show()
			end
		end
	end
	for i = n + 1, #state.tiles do
		state.tiles[i]:Hide()
	end
end

-- Every frame, as the continent map's highlight follows the cursor; nothing done while the cursor
-- rests, since finding the area under it and its overlay is the costly part.
local function OnUpdate()
	local container = WorldMapFrame.ScrollContainer
	local x, y
	if container then x, y = container:GetNormalizedCursorPosition() end
	local focus = WorldMapFrame.IsCanvasMouseFocus and WorldMapFrame:IsCanvasMouseFocus()
	local mapID = WorldMapFrame.mapID
	if state.x ~= nil and x == state.x and y == state.y and mapID == state.mapID and focus == state.focus then
		return
	end
	state.x, state.y, state.mapID, state.focus = x, y, mapID, focus
	local info, layer = Target()
	if info and info ~= state.lit then
		Light(info, layer)
	end
	state.lit = info
	state.frame:SetShown(info ~= nil)
end

local function Reset()
	state.overlaysFor, state.lit = nil, nil
	state.x, state.y, state.mapID, state.focus = nil, nil, nil, nil
	if state.frame then state.frame:Hide() end
end

function SpokenZones:SetupMapHighlight()
	if state.driver then
		return
	end
	local canvas = WorldMapFrame and WorldMapFrame.GetCanvas and WorldMapFrame:GetCanvas()
	if not canvas or not (C_MapExplorationInfo and C_MapExplorationInfo.GetExploredMapTextures and C_Map.GetMapArtLayers) then
		return
	end
	-- Over the exploration overlays it repeats, under the pins.
	local frame = CreateFrame("Frame", nil, canvas)
	frame:SetAllPoints(canvas)
	local levels = WorldMapFrame.GetPinFrameLevelsManager and WorldMapFrame:GetPinFrameLevelsManager()
	local explored = levels and levels.GetValidFrameLevel and levels:GetValidFrameLevel("PIN_FRAME_LEVEL_MAP_EXPLORATION")
	frame:SetFrameLevel((explored or canvas:GetFrameLevel()) + 1)
	frame:SetAlpha(HIGHLIGHT_ALPHA)
	frame:Hide()
	frame:EnableMouse(false)
	state.frame = frame

	-- Parented to WorldMapFrame so OnUpdate only runs while the map is open.
	state.driver = CreateFrame("Frame", nil, WorldMapFrame)
	state.driver:SetScript("OnUpdate", OnUpdate)
	-- An area explored since the map last opened has its overlay by the next time it opens.
	WorldMapFrame:HookScript("OnShow", Reset)
	WorldMapFrame:HookScript("OnHide", Reset)
end
