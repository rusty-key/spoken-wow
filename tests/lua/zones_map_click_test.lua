-- Clicks on the world map: an area of the zone shown opens its story, and a click on a continent
-- that opens a zone does not also open the area under the cursor on the zone's map.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(print)
local ZONES = here .. "/../../addons/Spoken_Zones/"

local KALIMDOR, MULGORE = 1414, 1412
local hooks, cursor = {}, { 0.5, 0.5 }
WorldMapFrame = {
    mapID = KALIMDOR,
    ScrollContainer = {
        HookScript = function(_, name, fn) hooks[name] = fn end,
        GetNormalizedCursorPosition = function() return cursor[1], cursor[2] end,
    },
}
MapUtil = { FindBestAreaNameAtMouse = function() end }

local opened
local Z = {
    IsPartOn = function() return true end,
    Get = function() return false end,
    Print = function() end,
    IsZoneMap = function(_, mapID) return mapID ~= KALIMDOR end,
    AreaAt = function(_, mapID)
        if mapID ~= MULGORE then return nil end
        return "Bloodhoof Village", { name = "Bloodhoof Village" }, "bloodhoof village"
    end,
    SelectSubzone = function(_, mapID, name) opened = mapID .. ":" .. name end,
}
assert(loadfile(ZONES .. "UI/SubzoneClick.lua"))("Spoken_Zones", Z)
Z:SetupSubzoneClicks()

local container = WorldMapFrame.ScrollContainer
local function Click(mapAfter)
    opened = nil
    hooks.OnMouseDown(container, "LeftButton")
    -- Blizzard's own handler runs first and may move the map to the zone clicked.
    WorldMapFrame.mapID = mapAfter or WorldMapFrame.mapID
    hooks.OnMouseUp(container, "LeftButton")
    return opened
end

WorldMapFrame.mapID = KALIMDOR
Expect("a click on Mulgore on Kalimdor's map opens the zone, not one of its areas", Click(MULGORE), nil)

WorldMapFrame.mapID = MULGORE
Expect("a click on Mulgore's map opens the area under the cursor", Click(), MULGORE .. ":Bloodhoof Village")

-- A city inside the zone: no area of the zone's by its name, so the click opens the city's own map.
local THUNDER_BLUFF = 1456
local shownMap
WorldMapFrame.SetMapID = function(_, id) shownMap = id end
-- As SpokenZones:AreaAt gives it: the city's story and its map.
Z.AreaAt = function(_, mapID)
    if mapID == MULGORE then return "Thunder Bluff", { name = "Thunder Bluff" }, nil, THUNDER_BLUFF end
end
Expect("a click on a city inside the zone selects no area of the zone's", Click(), nil)
Expect("...and opens the city's own map, whose story the panel tells", shownMap, THUNDER_BLUFF)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll zones map click tests passed")
