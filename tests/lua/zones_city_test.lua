-- A city on the map of the zone around it: each city is a map of its own under its continent in
-- the game's map tree, so on its zone's map the game reports it by its area name alone, and the
-- zone no longer lists it as one of its areas. CityAt finds the city, and AreaAt -- what the click
-- and the highlight both ask -- gives its own story and its map. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local ZONES = here .. "/../../addons/Spoken_Zones/"

stub.SetClient("11509")
local ELWYNN, STORMWIND, DUROTAR, ORGRIMMAR = 1429, 1453, 1411, 1454
local names = { [ELWYNN] = "Elwynn Forest", [STORMWIND] = "Stormwind City", [DUROTAR] = "Durotar", [ORGRIMMAR] = "Orgrimmar" }
_G.C_Map = _G.C_Map or {}
_G.C_Map.GetMapInfo = function(id) return names[id] and { mapID = id, name = names[id] } or nil end
_G.C_Map.GetMapInfoAtPosition = function() return nil end

local Z = H.LoadZones(ZONES)
Z.CityIn = { [STORMWIND] = ELWYNN, [ORGRIMMAR] = DUROTAR }
local lore = { [STORMWIND] = { name = "Stormwind City", full = "The human capital." } }
Z.GetLore = function(_, id) return lore[id] end
Z.GetSubzoneLore = function() return nil end

Expect("a city's area on the zone around it is that city", Z:CityAt(ELWYNN, "Stormwind City"), STORMWIND)
Expect("...whatever its case", Z:CityAt(ELWYNN, "stormwind city"), STORMWIND)
Expect("...but not on another zone's map", Z:CityAt(DUROTAR, "Stormwind City"), nil)
Expect("...nor an area that is no city", Z:CityAt(ELWYNN, "Goldshire"), nil)

-- The click and the highlight: the city's own story and its map, so it lights up and opens.
Z.GetAreaNameAt = function() return "Stormwind City" end
local name, entry, key, mapID = Z:AreaAt(ELWYNN, 0.3, 0.3)
Expect("the city on its zone's map is the city's own story", entry, lore[STORMWIND])
Expect("...as the city's map, which a click opens", mapID, STORMWIND)
Expect("...under the area's name, with no area key of the zone's", name == "Stormwind City" and key == nil, true)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll zones city tests passed")
