-- Which places a character has found, for Lore of Azeroth's list: explored areas read off the
-- zone maps, places stood in since, and a city found by its name on the zone around it. Run
-- with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local ZONES = here .. "/../../addons/Spoken_Zones/"

stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()

-- Durotar's map, 1000 by 500, with two explored overlays: the Valley of Trials, and Orgrimmar's
-- gate at the top. Nothing explored on Dun Morogh's map, and none on Orgrimmar's own (cities have
-- no overlays).
local AREAS = { [1] = "Valley of Trials", [2] = "Orgrimmar", [3] = "Dalaran" }
local OVERLAYS = {
    [1411] = {
        { hitRect = { left = 100, right = 300, top = 300, bottom = 450 }, area = 1 },
        { hitRect = { left = 400, right = 600, top = 0, bottom = 100 }, area = 2 },
    },
    -- Moonglade's map: one overlay the game always draws, with nothing under it explored.
    [1450] = { { hitRect = { left = 0, right = 1000, top = 0, bottom = 500 } } },
    -- Alterac's map: Dalaran, which the Forever client reports explored for every character.
    [1416] = { { hitRect = { left = 0, right = 200, top = 0, bottom = 200 }, area = 3 } },
}
_G.CreateVector2D = function(x, y) return { x = x, y = y } end
_G.C_Map = _G.C_Map or {}
C_Map.GetMapArtLayers = function() return { { layerWidth = 1000, layerHeight = 500 } } end
C_Map.GetAreaInfo = function(id) return AREAS[id] end
local read = {}
_G.C_MapExplorationInfo = {
    GetExploredMapTextures = function(mapID) read[mapID] = true; return OVERLAYS[mapID] or {} end,
    GetExploredAreaIDsAtPosition = function(mapID, at)
        for _, o in ipairs(OVERLAYS[mapID] or {}) do
            local r = o.hitRect
            local px, py = at.x * 1000, at.y * 500
            if px >= r.left and px <= r.right and py >= r.top and py <= r.bottom then return { o.area } end
        end
        return nil
    end,
}

local where = { map = 1411, subzone = "" }
_G.GetSubZoneText = function() return where.subzone end
local Z = { Zones = { [1411] = {}, [1426] = {}, [1454] = {}, [1450] = {}, [1416] = {} }, Subzones = { [1411] = { ["valley of trials"] = {}, ["razor hill barracks"] = {}, ["orgrimmar"] = {} },
    [1426] = { ["coldridge valley"] = {} } }, CityIn = { [1454] = 1411 } }
local names = { [1411] = "Durotar", [1426] = "Dun Morogh", [1454] = "Orgrimmar", [1450] = "Moonglade" }
local settings = {}
function Z:Get(key) return settings[key] end
function Z:GetMapName(mapID) return names[mapID] end
function Z:ResolveAreaKey(name) return name and string.lower(name) end
function Z:GetPlayerMapID() return where.map end
function Z:GetLoreWithFallback(mapID) return {}, mapID end
function Z:GetSubzoneLore(mapID, name)
    local key = string.lower(name)
    if self.Subzones[mapID] and self.Subzones[mapID][key] then return {}, key end
end
local onZone
function Z:OnZoneChanged(fn) onZone = fn end
_G.SpokenZonesCharacter = nil
assert(loadfile(ZONES .. "Discovery.lua"))("SpokenZones", Z)
Z:SetupDiscovery()

-- The city first, before anything has read Durotar's map.
Expect("a city is found by its name explored on the zone around it, whichever is asked first", Z:IsFound(1454), true)
Expect("an explored area is found", Z:IsFound(1411, "valley of trials"), true)
Expect("...and its zone", Z:IsFound(1411), true)
Expect("an area with no overlay is not found before it is stood in", Z:IsFound(1411, "razor hill barracks"), false)
Z:MarkFound(1411, "razor hill barracks")
Expect("...or clicked on the map, which resolves only an explored one", Z:IsFound(1411, "razor hill barracks"), true)
SpokenZonesCharacter.visited["1411/razor hill barracks"] = nil
Expect("a zone with nothing explored is not found", Z:IsFound(1426), false)
Expect("...read off its own map alone, not every zone's", read[1450] or read[1416] or false, false)
Expect("...nor one whose map has an overlay always drawn, nothing under it explored", Z:IsFound(1450), false)
-- The game's word is followed: the Forever client reports Dalaran explored for every character.
Expect("an area the client reports explored is found, whoever reports it", Z:IsFound(1416, "dalaran"), true)
Expect("...and its zone", Z:IsFound(1416), true)
-- Explored after the maps were read (a GM's .cheat explore): found once they are read again.
Expect("an area not explored is not found", Z:IsFound(1426, "coldridge valley"), false)
OVERLAYS[1426] = { { hitRect = { left = 0, right = 1000, top = 0, bottom = 500 }, area = 4 } }
AREAS[4] = "Coldridge Valley"
Expect("...explored since, it is not seen before the maps are read again", Z:IsFound(1426, "coldridge valley"), false)
Z:RefreshFound()
Expect("...and is found once they are", Z:IsFound(1426, "coldridge valley"), true)
OVERLAYS[1426], AREAS[4] = nil, nil
Z:RefreshFound()
Expect("why a place is found is said", select(2, Z:IsFound(1411, "valley of trials")), "explored on the map")

where.subzone = "Razor Hill Barracks"
onZone()
Expect("standing in a place finds it", Z:IsFound(1411, "razor hill barracks"), true)
Expect("...kept for the character", SpokenZonesCharacter.visited["1411/razor hill barracks"], true)

where.map, where.subzone = 1426, "Coldridge Valley"
onZone()
Expect("standing in an unexplored zone finds it", Z:IsFound(1426), true)
Expect("...and the area stood in", Z:IsFound(1426, "coldridge valley"), true)

-- At sea or on a zeppelin the map is the continent's: that finds no place.
C_Map.GetMapInfo = function(id) return { mapID = id, mapType = (id == 1415 and 2 or 3) } end
where.map, where.subzone = 1415, ""
onZone()
Expect("being on a continent's map, between zones, records no visit", SpokenZonesCharacter.visited["1415"], nil)
where.map = 1426
onZone()
Expect("...a zone's still does", SpokenZonesCharacter.visited["1426"], true)

Expect("undiscovered places hidden unless the setting says", Z:ShowsUndiscovered(), false)
settings.showUndiscovered = true
Expect("...shown when it does", Z:ShowsUndiscovered(), true)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll discovery tests passed")
