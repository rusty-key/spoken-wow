-- Places Forever names differently or cannot reach (Data/ForeverAreas.lua, from
-- pipelines/places/tools/seed/forever-places.json): Forever's Legashi Encampment is the lore's
-- frozen legash encampment, and Northshire Valley - Camelot and Storm Cliffs are not listed there.
-- Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local Expect, Failures = H.Expecter(print)
local PLACES = here .. "/../../addons/Spoken_Places/"

local ELWYNN, AZSHARA = 1429, 1447
local getMapInfo = C_Map.GetMapInfo

local function Boot(forever)
    stub.SetClient("11509")
    _G.C_Map.GetMapInfo = function(id)
        if id == 2482 and not forever then return nil end
        return getMapInfo(id)
    end
    local Z = H.LoadPlaces(PLACES)
    assert(loadfile(PLACES .. "Data/ForeverAreas.lua"))("Spoken_Places", Z)
    Z.Subzones[ELWYNN] = {
        goldshire = { name = "Goldshire", full = "A town." },
        ["northshire valley camelot"] = { name = "Northshire Valley - Camelot", pending = true },
    }
    Z.Subzones[AZSHARA] = {
        ["legash encampment"] = { name = "Legash Encampment", full = "A camp." },
        ["legashi encampment"] = { name = "Legashi Encampment", pending = true },
        ["storm cliffs"] = { name = "Storm Cliffs", full = "Cliffs." },
    }
    return Z
end

local function Listed(Z, zone)
    local keys = {}
    for _, area in ipairs(Z:AreasIn(zone)) do table.insert(keys, area.key) end
    table.sort(keys)
    return table.concat(keys, ", ")
end

local Z = Boot(true)
Expect("Forever's Legashi Encampment finds the lore's legash encampment",
    Z:ResolveAreaKey("Legashi Encampment"), "legash encampment")
Expect("...and its story", Z:GetSubzoneLore(AZSHARA, "Legashi Encampment").full, "A camp.")
Expect("any other name is its own key", Z:ResolveAreaKey("Storm Cliffs"), "storm cliffs")
Expect("on Forever, Azshara lists Legash Encampment once and not Storm Cliffs", Listed(Z, AZSHARA), "legash encampment")
Expect("...and Elwynn Forest not Northshire Valley - Camelot", Listed(Z, ELWYNN), "goldshire")

Z = Boot(false)
Expect("on another client, Azshara lists what the data has, Storm Cliffs included",
    Listed(Z, AZSHARA), "legash encampment, legashi encampment, storm cliffs")
Expect("...and the Era spelling is still the key", Z:ResolveAreaKey("Legash Encampment"), "legash encampment")

_G.C_Map.GetMapInfo = getMapInfo
if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll places Forever places tests passed")
