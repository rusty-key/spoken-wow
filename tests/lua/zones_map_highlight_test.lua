-- The highlight on a zone map: the area under the cursor lights up in its exploration overlay's
-- shape when a click there would open its story, and nowhere else. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local ZONES = here .. "/../../addons/Spoken_Zones/"

stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()

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
_G.WorldMapFrame = CreateFrame("Frame", "WorldMapFrame", UIParent)
WorldMapFrame.mapID = 1411
WorldMapFrame.GetCanvas = function() return canvas end
WorldMapFrame.IsCanvasMouseFocus = function() return overCanvas end
WorldMapFrame.ScrollContainer = { GetNormalizedCursorPosition = function() return cursor[1], cursor[2] end }
local function Point(px, py) cursor[1], cursor[2] = px / 1002, py / 668 end

-- The areas a click opens, as SpokenZones:AreaAt finds them: Razor Hill in the left of the small
-- rectangle (its overlay's rectangle reaches past it), the Valley of Trials in the rest of the
-- big one, and an area with no story beyond.
local Z = {}
function Z:IsPartOn() return true end
function Z:IsZoneMap(mapID) return mapID == 1411 end
local asked = 0
function Z:AreaAt(_, x, y)
    asked = asked + 1
    local px, py = x * 1002, y * 668
    if px >= 200 and px <= 265 and py >= 100 and py <= 180 then return "Razor Hill", { name = "Razor Hill" } end
    if px >= 100 and px <= 400 and py >= 50 and py <= 250 then return "Valley of Trials", { name = "Valley" } end
    return "Kolkar Crag", nil
end
assert(loadfile(ZONES .. "UI/MapHighlight.lua"))("SpokenZones", Z)
Z:SetupMapHighlight()
local state = Z.mapHighlight
local tick = state.driver:GetScript("OnUpdate")
local function Run() tick(state.driver, 0.016) end
local function Shown()
    local list = {}
    for _, tile in ipairs(state.tiles) do if tile:IsShown() then list[#list + 1] = tile end end
    return list
end

Expect("built over the map's canvas", state.frame:GetParent(), canvas)
Expect("dark until the cursor is over an area", state.frame:IsShown(), false)

Point(250, 140)
Run()
local lit = Shown()
Expect("over an area with a story it lights up at once", state.frame:IsShown() and state.frame:GetAlpha(), 0.35)
Expect("...in the overlay of the area a click there opens", #lit == 1 and lit[1]:GetTexture(), 21)
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

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll map highlight tests passed")
