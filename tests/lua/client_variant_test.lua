-- Version.Variant: which client and realm Spoken is on, from the interface number and the active
-- season, whatever project id the client answers. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local VERSION = here .. "/../../addons/Spoken/Version.lua"

local SOD = 2
local HARDCORE = 3

local function Variant(interface, project, season)
    _G.GetBuildInfo = function() return "x", "1", "Jan 1 2026", interface end
    _G.WOW_PROJECT_ID = project
    _G.Enum = { SeasonID = { SeasonOfDiscovery = SOD, Hardcore = HARDCORE } }
    _G.C_Seasons = season ~= nil and { GetActiveSeason = function() return season end } or nil
    _G.SpokenEnv = setmetatable({}, { __index = _G })
    dofile(VERSION)
    return _G.SpokenEnv.Version.Variant
end

Expect("Forever with its own project id is forever", Variant(16001, 18), "forever")
Expect("...and when it answers the Mainline project", Variant(16001, 1), "forever")
Expect("...and when it answers the Classic project", Variant(16001, 2), "forever")
Expect("Classic Era is era", Variant(11509, 2), "era")
Expect("...with no season active too", Variant(11509, 2, 0), "era")
Expect("...a Hardcore realm too", Variant(11509, 2, HARDCORE), "era")
Expect("Era's client on a Season of Discovery realm is sod", Variant(11509, 2, SOD), "sod")
Expect("TBC Anniversary is anniversary", Variant(20506, 5), "anniversary")

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll client variant tests passed")
