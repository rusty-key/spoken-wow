-- The highlight on a zone map: the area under the cursor lights up in its exploration overlay's
-- shape when a click there would open its story, and nowhere else. On OpenMap's stitched map it
-- lights in whatever zone is under the cursor, over OpenMap's art, as a colour in the overlay's
-- shape rather than the overlay's own art. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local PLACES = here .. "/../../addons/Spoken_Places/"

stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()

-- A zone map 1002 by 668, in tiles of 256, with two explored areas: a big one, and a small one
-- inside its rectangle. The big one is two tiles wide, its second only partly used.
local BIG = { textureWidth = 300, textureHeight = 200, offsetX = 100, offsetY = 50,
    hitRect = { left = 100, right = 400, top = 50, bottom = 250 }, fileDataIDs = { 11, 12 } }
local SMALL = { textureWidth = 100, textureHeight = 80, offsetX = 200, offsetY = 100,
    hitRect = { left = 200, right = 300, top = 100, bottom = 180 }, fileDataIDs = { 21 } }
_G.C_Map = _G.C_Map or {}
C_Map.GetMapArtLayers = function() return { { layerWidth = 1002, layerHeight = 668, tileWidth = 256, tileHeight = 256 } } end
_G.C_MapExplorationInfo = { GetExploredMapTextures = function() return { BIG, SMALL } end }

local cursor, overCanvas = { 0, 0 }, true
local canvas = CreateFrame("Frame", nil, UIParent)
canvas:SetSize(1002, 668)
_G.WorldMapFrame = CreateFrame("Frame", "WorldMapFrame", UIParent)
WorldMapFrame.mapID = 1411
WorldMapFrame.GetCanvas = function() return canvas end
WorldMapFrame.IsCanvasMouseFocus = function() return overCanvas end
WorldMapFrame.ScrollContainer = { GetNormalizedCursorPosition = function() return cursor[1], cursor[2] end }
local function Point(px, py) cursor[1], cursor[2] = px / 1002, py / 668 end

-- The areas a click opens, as SpokenPlaces:AreaAt finds them: Razor Hill in the left of the small
-- rectangle (its overlay's rectangle reaches past it), the Valley of Trials in the rest of the
-- big one, and an area with no story beyond.
local Z = {}
local settings = { highlightOpacity = 0.35 }
function Z:Get(key) return settings[key] end
function Z:IsPartOn() return true end
local panelOpen = true
function Z:IsMapPanelOpen() return panelOpen end
function Z:IsZoneMap(mapID) return mapID == 1411 end
local asked = 0
function Z:AreaAt(_, x, y)
    asked = asked + 1
    local px, py = x * 1002, y * 668
    if px >= 200 and px <= 265 and py >= 100 and py <= 180 then return "Razor Hill", { name = "Razor Hill" } end
    if px >= 100 and px <= 400 and py >= 50 and py <= 250 then return "Valley of Trials", { name = "Valley" } end
    return "Kolkar Crag", nil
end
assert(loadfile(PLACES .. "UI/OpenMap.lua"))("Spoken_Places", Z)
assert(loadfile(PLACES .. "UI/MapHighlight.lua"))("Spoken_Places", Z)
Z:SetupMapHighlight()
local state = Z.mapHighlight
-- A tile shows a file or a colour, whichever was set last, through the masks added to it; a mask
-- keeps how its file wraps at the edges.
local CreateTexture, CreateMaskTexture = state.frame.CreateTexture, state.frame.CreateMaskTexture
function state.frame:CreateTexture(...)
    local tile = CreateTexture(self, ...)
    tile.masks = {}
    function tile:SetColorTexture(r, g, b, a) self.color, self.texture = { r, g, b, a }, nil end
    function tile:SetTexture(file) self.texture, self.color = file, nil end
    function tile:AddMaskTexture(mask) self.masks[mask] = true end
    function tile:RemoveMaskTexture(mask) self.masks[mask] = nil end
    return tile
end
function state.frame:CreateMaskTexture(...)
    local mask = CreateMaskTexture(self, ...)
    function mask:SetTexture(file, wrapX, wrapY) self.texture, self.wrap = file, { wrapX, wrapY } end
    return mask
end
local tick = state.driver:GetScript("OnUpdate")
local function Run() tick(state.driver, 0.016) end
local function Shown()
    local list = {}
    for _, tile in ipairs(state.tiles) do if tile:IsShown() then list[#list + 1] = tile end end
    return list
end
-- The file a tile is cut to the shape of, on OpenMap's map.
local function Shape(tile) return tile.masks[tile.mask] and tile.mask:GetTexture() or nil end
-- Whether the glow fades out at the overlay's rectangle, which the overlay's own shape does not.
local function Feathered(tile)
    local edge = state.edge
    return edge ~= nil and tile.masks[edge] == true and edge:GetTexture():match("HighlightEdge$") ~= nil
end

Expect("built over the map's canvas", state.frame:GetParent(), canvas)
Expect("dark until the cursor is over an area", state.frame:IsShown(), false)

Point(250, 140)
Run()
local lit = Shown()
Expect("over an area with a story it lights up at once", state.frame:IsShown() and state.frame:GetAlpha(), 0.35)
Expect("...in the overlay of the area a click there opens", #lit == 1 and lit[1]:GetTexture(), 21)
Expect("...the overlay's own art, unmasked", Shape(lit[1]), nil)
Expect("...at the overlay's place on the map", select(4, lit[1]:GetPoint(1)) == 200 and select(5, lit[1]:GetPoint(1)) == -100, true)
Expect("...its size the overlay's", lit[1]:GetWidth() == 100 and lit[1]:GetHeight() == 80, true)
local u = lit[1].texCoord
Expect("...cut from the part of its tile the overlay uses", u[2] == 100 / 128 and u[4] == 80 / 128, true)

-- Inside the small overlay's rectangle, but where a click opens the Valley of Trials: the
-- Valley's overlay lights, not the small one around the cursor.
Point(290, 140)
Run()
lit = Shown()
Expect("where an overlay reaches into a neighbour, the neighbour a click opens lights", #lit == 2 and lit[1]:GetTexture(), 11)

Point(120, 60)
Run()
lit = Shown()
Expect("over the big area, its two tiles", #lit == 2 and lit[1]:GetTexture() == 11 and lit[2]:GetTexture() == 12, true)
Expect("...the second as wide as what is left of it", lit[2]:GetWidth(), 44)
Expect("...side by side", select(4, lit[2]:GetPoint(1)), 100 + 256)

asked = 0
Run()
Run()
Expect("the cursor resting, nothing is asked again", asked, 0)
Expect("...and what is lit stays lit", state.frame:IsShown() and #Shown(), 2)

Point(800, 500)
Run()
Expect("off any area with a story it goes out at once", state.frame:IsShown(), false)

Point(250, 140)
overCanvas = false
Run()
Expect("not while the cursor is on a pin", state.frame:IsShown(), false)
overCanvas = true

WorldMapFrame.mapID = 1414
Run()
Expect("not on a continent map, which has Blizzard's own", state.frame:IsShown(), false)
WorldMapFrame.mapID = 1411
Run()
Expect("back on the zone map it lights again", state.frame:IsShown(), true)

-- Without OpenMap the panel folded away changes nothing: a click there reopens it.
panelOpen = false
Point(250, 141)
Run()
Expect("without OpenMap, the panel folded away, it still lights", state.frame:IsShown(), true)
panelOpen = true

-- Area Highlight, on the Places page: how bright, and nothing at all at 0.
settings.highlightOpacity = 0.6
Z:RefreshMapHighlight()
Run()
Expect("Area Highlight sets how brightly the area lights", state.frame:GetAlpha(), 0.6)
settings.highlightOpacity = 0
Z:RefreshMapHighlight()
Expect("at 0 it is out and nothing follows the cursor", state.frame:IsShown() or state.driver:IsShown(), false)
settings.highlightOpacity = 0.35
Z:RefreshMapHighlight()
Run()
Expect("raised again, it lights again", state.frame:IsShown() and state.frame:GetAlpha(), 0.35)

-- OpenMap's stitched map, its map Kalimdor while the view shows Durotar whole: Durotar's
-- rectangle on the stitched world, and Kalimdor's.
local RECTS = { [1411] = { 0.6, 0.5, 0.7, 0.6 }, [1414] = { 0.4, 0.3, 0.9, 0.8 } }
local under, zoom = { 0.6 + 0.1 * 250 / 1002, 0.5 + 0.1 * 140 / 668 }, 6
OpenMapAPI = {
    major = 1, version = 4,
    IsStitched = function() return true end,
    GetView = function() return 0.65, 0.55, zoom end,
    CursorPosition = function() return under[1], under[2] end,
    MapAt = function() return 1411 end,
    ArtTopLevel = function() return 2083 end,
    WorldFromMap = function(id, x, y)
        local r = RECTS[id]
        return r[1] + x * (r[3] - r[1]), r[2] + y * (r[4] - r[2])
    end,
    MapFromWorld = function(id, u, v)
        local r = RECTS[id]
        return (u - r[1]) / (r[3] - r[1]), (v - r[2]) / (r[4] - r[2])
    end,
}
state.frame.SetFrameLevel = function(self, level) self.level = level end
WorldMapFrame.mapID = 1414
Run()
lit = Shown()
Expect("stitched, the area of the zone under the cursor lights on the continent's map",
    state.frame:IsShown() and #lit == 1 and Shape(lit[1]), 21)
Expect("...in a colour cut to the overlay's shape, not Blizzard's art over OpenMap's",
    lit[1]:GetTexture() == nil and lit[1].color ~= nil, true)
Expect("...its mask not faded to black at the edges, which drew a line along each seam",
    lit[1].mask.wrap[1] == "CLAMP" and lit[1].mask.wrap[2] == "CLAMP", true)
Expect("...faded out at the overlay's rectangle, whose art does not fade there on Forever", Feathered(lit[1]), true)
Expect("...the fade laid over the overlay's whole rectangle",
    select(4, state.edge:GetPoint(1)) == 200 and select(5, state.edge:GetPoint(1)) == -100
    and state.edge:GetWidth() == 100 and state.edge:GetHeight() == 80, true)
u = lit[1].mask.texCoord
Expect("...cut from the part of its tile the overlay uses", u[2] == 100 / 128 and u[4] == 80 / 128, true)
Expect("...over OpenMap's art, which covers the explored areas", state.frame.level, 2084)
Expect("...drawn at the zone's scale on the continent's canvas", math.abs(state.frame:GetScale() - 0.2) < 1e-9, true)
local _, _, _, ax, ay = state.frame:GetPoint(1)
Expect("...over the zone's place on it", math.abs(ax - 0.4 * 1002 / 0.2) < 1e-6 and math.abs(ay + 0.4 * 668 / 0.2) < 1e-6, true)
panelOpen = false
under[2] = under[2] + 1e-6
Run()
Expect("stitched, with the panel folded away, nothing lights: the map is OpenMap's", state.frame:IsShown(), false)
panelOpen = true
under[2] = under[2] - 1e-6
Run()
Expect("...and it lights again once the panel is back", state.frame:IsShown(), true)

-- The view pans under a resting cursor: Blizzard's cursor on the canvas stays, the world point moves.
under[1] = 0.6 + 0.1 * 120 / 1002
under[2] = 0.5 + 0.1 * 60 / 668
Run()
Expect("the view moving under a resting cursor lights what is now under it", #Shown(), 2)
zoom = 2
Run()
Expect("zoomed out to where OpenMap's click picks a zone, dark", state.frame:IsShown(), false)
zoom = 6
WorldMapFrame.mapID = 1411
Run()
Expect("on the zone's own map, laid over the whole canvas again", state.frame:GetScale(), 1)

-- OpenMap turned off with the same area under the cursor: the tiles go back to the overlay's art.
OpenMapAPI.IsStitched = function() return false end
Point(120, 60)
Run()
lit = Shown()
Expect("off OpenMap's map, the same tiles show the overlay's art again, unmasked",
    #lit == 2 and lit[1]:GetTexture() == 11 and Shape(lit[1]) == nil and not Feathered(lit[1]), true)
OpenMapAPI = nil

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll map highlight tests passed")
