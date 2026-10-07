-- The area under the pointer on a zone map, found one way for the click and the map highlight
-- (SpokenZones:AreaAt), so what lights up is what a click opens. A child map under the pointer --
-- a cave or a dungeon entrance with a story of its own -- does not hide the area around it from
-- the highlight while a click there still opens it. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local ZONES = here .. "/../../addons/Spoken_Zones/"

stub.SetClient("11509")
local DUROTAR, CAVE = 1411, 9999
local Z = H.LoadZones(ZONES)
_G.MapUtil = { FindBestAreaNameAtMouse = function() return "Razor Hill" end }
-- A cave map with its own story under the same spot.
_G.C_Map = _G.C_Map or {}
_G.C_Map.GetMapInfoAtPosition = function() return { mapID = CAVE, name = "Dustwind Cave" } end
Z.GetLore = function(_, id) if id == CAVE then return { name = "Dustwind Cave" } end end
Z.GetSubzoneLore = function(_, mapID, name)
    if mapID == DUROTAR and name == "Razor Hill" then return { name = "Razor Hill" }, "razor hill" end
end

local name, entry, key = Z:AreaAt(DUROTAR, 0.4, 0.4)
Expect("the area under the pointer is found by its name, as the click finds it", name, "Razor Hill")
Expect("...with its story, though a cave with a story of its own is under the same spot",
    entry and entry.name, "Razor Hill")
Expect("...and its key", key, "razor hill")
_G.MapUtil.FindBestAreaNameAtMouse = function() return nil end
Expect("no area there, nothing", Z:AreaAt(DUROTAR, 0.4, 0.4), nil)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll zones area tests passed")
