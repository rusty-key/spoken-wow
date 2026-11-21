-- The zone under the cursor while OpenMap draws its stitched world map: the click and the
-- highlight answer for the zone the cursor is on, including a neighbour of the map the view is
-- centred on and a zone OpenMap shows while its map is still the continent, and without OpenMap
-- (or with an API they were not written against) they read the map as before.
-- Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(print)
local PLACES = here .. "/../../addons/Spoken_Places/"

local EASTERN_KINGDOMS, DUN_MOROGH, LOCH_MODAN, IRONFORGE = 1415, 1426, 1432, 1455
-- Each map's rectangle on the stitched world (left, top, right, bottom), about as OpenMap has them.
local RECTS = {
    [DUN_MOROGH] = { 0.69, 0.46, 0.79, 0.57 },
    [LOCH_MODAN] = { 0.78, 0.43, 0.84, 0.50 },
    [IRONFORGE] = { 0.745, 0.48, 0.755, 0.50 },
}

local cursor = { 0.25, 0.75 }
WorldMapFrame = {
    mapID = EASTERN_KINGDOMS,
    ScrollContainer = { GetNormalizedCursorPosition = function() return cursor[1], cursor[2] end },
}

local Z = {
    CityIn = { [IRONFORGE] = DUN_MOROGH },
    IsZoneMap = function(_, mapID) return mapID ~= EASTERN_KINGDOMS end,
}
assert(loadfile(PLACES .. "UI/OpenMap.lua"))("Spoken_Places", Z)

local function Contains(rect, u, v)
    return u >= rect[1] and u <= rect[3] and v >= rect[2] and v <= rect[4]
end

local view = { u = 0.75, v = 0.52, zoom = 5.8 }
local under = { 0.79, 0.45 }
local function NewOpenMap()
    return {
        major = 1, version = 4,
        IsStitched = function() return true end,
        GetView = function() return view.u, view.v, view.zoom end,
        CursorPosition = function() return under[1], under[2] end,
        -- The smallest map wins, as OpenMap's chain ends at the deepest one.
        MapAt = function(u, v)
            local best, size
            for id, r in pairs(RECTS) do
                local s = (r[3] - r[1]) * (r[4] - r[2])
                if Contains(r, u, v) and (not size or s < size) then best, size = id, s end
            end
            return best or EASTERN_KINGDOMS
        end,
        WorldFromMap = function(id, x, y)
            local r = RECTS[id]
            if not r then return nil end
            return r[1] + x * (r[3] - r[1]), r[2] + y * (r[4] - r[2])
        end,
        MapFromWorld = function(id, u, v)
            local r = RECTS[id]
            if not r then return nil end
            return (u - r[1]) / (r[3] - r[1]), (v - r[2]) / (r[4] - r[2])
        end,
    }
end

local function Near(a, b) return a and b and math.abs(a - b) < 1e-9 end

-- Without OpenMap: the map shown and Blizzard's cursor, as before.
OpenMapAPI = nil
WorldMapFrame.mapID = DUN_MOROGH
local mapID, x, y = Z:CursorArea()
Expect("without OpenMap, the zone shown", mapID, DUN_MOROGH)
Expect("...at Blizzard's cursor", x == 0.25 and y == 0.75, true)
WorldMapFrame.mapID = EASTERN_KINGDOMS
Expect("...and nothing on a continent", Z:CursorArea(), nil)

-- An API this was not written against is read as no OpenMap.
OpenMapAPI = NewOpenMap()
OpenMapAPI.major = 2
WorldMapFrame.mapID = DUN_MOROGH
Expect("another major version is not used", (Z:CursorArea()), DUN_MOROGH)
Expect("...nor is OpenMap", Z:OpenMap(), nil)
OpenMapAPI = NewOpenMap()
OpenMapAPI.version = 2
Expect("a version without CursorPosition is not used", Z:OpenMap(), nil)
OpenMapAPI = NewOpenMap()
OpenMapAPI.IsStitched = function() return false end
Expect("Blizzard's own map while OpenMap's is off", (Z:CursorArea()), DUN_MOROGH)
OpenMapAPI.IsStitched = function() error("broken") end
Expect("a failing IsStitched reads as no OpenMap", Z:OpenMap(), nil)

-- On the stitched map the view sits on the continent at this zoom, as the game reports it.
OpenMapAPI = NewOpenMap()
WorldMapFrame.mapID = EASTERN_KINGDOMS
under = { 0.79, 0.45 }
mapID, x, y = Z:CursorArea()
Expect("stitched, the zone under the cursor though the map is the continent", mapID, LOCH_MODAN)
Expect("...with the cursor on that zone's map", Near(x, (0.79 - 0.78) / 0.06) and Near(y, (0.45 - 0.43) / 0.07), true)

WorldMapFrame.mapID = DUN_MOROGH
under = { 0.80, 0.47 }
Expect("a neighbour of the zone the view is on", (Z:CursorArea()), LOCH_MODAN)

under = { 0.75, 0.49 }
mapID, x, y = Z:CursorArea()
Expect("over a city, the zone around it, where the city is one of its areas", mapID, DUN_MOROGH)
Expect("...with the cursor on the zone's map, not the city's", Near(x, (0.75 - 0.69) / 0.10) and Near(y, (0.49 - 0.46) / 0.11), true)

under = { 0.5, 0.2 }
Expect("off every zone, nothing", Z:CursorArea(), nil)

-- Far out, OpenMap's click is "go to that zone": areas do not answer the cursor yet.
under = { 0.72, 0.50 }
view.zoom = 3
Expect("zoomed out to where a click picks a zone, nothing", Z:CursorArea(), nil)
view.zoom = 5.8
Expect("...and the zone once its areas are large enough to point at", (Z:CursorArea()), DUN_MOROGH)

under = { nil, nil }
Expect("the cursor off the map, nothing, whatever Blizzard's cursor says", Z:CursorArea(), nil)
under = { 0.72, 0.50 }
OpenMapAPI.MapAt = function() error("broken") end
Expect("a failing call is nothing, not an error", Z:CursorArea(), nil)

-- After a click, the zone it chose fitted in the view when part of it is out of view.
local WETLANDS = 1437
RECTS[WETLANDS] = { 0.70, 0.33, 0.82, 0.47 }
OpenMapAPI = NewOpenMap()
local glided
OpenMapAPI.ShowWorld = function(u, v, zoom) glided = { u, v, zoom } end
-- The view sits on Dun Morogh's map, showing 1 / viewScale of it, centred on it.
local viewScale = 1.1
WorldMapFrame.mapID = DUN_MOROGH
WorldMapFrame.ScrollContainer.GetWidth = function() return 1002 end
WorldMapFrame.ScrollContainer.GetHeight = function() return 668 end
WorldMapFrame.ScrollContainer.GetEffectiveScale = function() return 1 end
local canvas = {
    GetWidth = function() return 1002 end, GetHeight = function() return 668 end,
    GetEffectiveScale = function() return viewScale end,
}
WorldMapFrame.GetCanvas = function() return canvas end
view = { u = 0.74, v = 0.515, zoom = 9 }
local function Fit(zone)
    glided = nil
    Z:FitZone(zone)
    return glided
end

under = { 0.75, 0.40 }
local g = Fit(WETLANDS)
Expect("a neighbour cut off at the view's edge glides into view",
    g and Near(g[1], 0.76) and Near(g[2], 0.40), true)
Expect("...zoomed to just fit it", g and Near(g[3], 9 * math.min((0.1 / 1.1) / 0.12, (0.11 / 1.1) / 0.14)), true)
under = { 0.81, 0.45 }
Expect("a neighbour OpenMap's own click zooms in on is left to it", Fit(LOCH_MODAN), nil)
under = { 0.75, 0.49 }
Expect("...as is a city OpenMap's click zooms in on", Fit(DUN_MOROGH), nil)
under = { 0.72, 0.50 }
Expect("an area of the zone looked at, cut off at the edge, keeps the player's zoom", Fit(DUN_MOROGH), nil)
viewScale = 0.98
Expect("a zone the view already shows whole stays as it is", Fit(DUN_MOROGH), nil)
-- Loch Modan fitted, at the zoom of a zone half Dun Morogh's size: Dun Morogh, clicked at the
-- edge, fits much further out, and still glides into view.
view = { u = 0.81, v = 0.465, zoom = 18 }
viewScale = 1
WorldMapFrame.mapID = LOCH_MODAN
under = { 0.775, 0.48 }
g = Fit(DUN_MOROGH)
Expect("from a small zone, fitted, a large neighbour clicked at the edge glides into view",
    g and Near(g[1], 0.74) and Near(g[2], 0.515), true)
WorldMapFrame.mapID = DUN_MOROGH
view = { u = 0.74, v = 0.515, zoom = 9 }
viewScale = 2.2
under = { 0.75, 0.40 }
Expect("zoomed well inside a zone, the view stays where the player put it", Fit(WETLANDS), nil)
OpenMapAPI = nil
Expect("without OpenMap, nothing moves", Fit(WETLANDS), nil)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll places OpenMap tests passed")
