-- Other addons call Places, Readables and Bosses through their globals. This keeps a refactor
-- from removing the functions they rely on. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local ADDONS = here .. "/../../addons/"
local Expect, Failures = H.Expecter(print)

-- The functions `loaded` are on the global `name`, and the UI file `ui` defines the functions
-- `drawn`. The UI files need frames this stub does not build, so those are found in the source.
local function Exposes(name, loaded, ui, drawn)
    for _, fn in ipairs(loaded) do
        Expect(name .. ":" .. fn .. " exists", type(_G[name][fn]), "function")
    end
    local file = assert(io.open(ADDONS .. ui))
    local source = file:read("*a")
    file:close()
    for _, fn in ipairs(drawn) do
        Expect(name .. ":" .. fn .. " is defined", source:find("\nfunction " .. name .. ":" .. fn .. "%(") ~= nil, true)
    end
end

stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()

---------------------------------------------------------------- places
local Z = H.LoadPlaces(ADDONS .. "Spoken_Places/")
Expect("SpokenPlaces is the Places module", _G.SpokenPlaces, Z)
Exposes("SpokenPlaces", { "GetLore", "GetSubzoneLore", "HasAudio", "PlayLore", "StopLore", "IsPlayingLore" },
    "Spoken_Places/UI/LoreWindow.lua", { "IsLocked", "ShowLoreFor" })

---------------------------------------------------------------- readables
local env = stub.LoadSpoken(ADDONS .. "Spoken/")
env.Addon:Enable()
local R = {}
for _, file in ipairs({ "Locale/enUS", "Checksum", "Core", "Language", "Reader", "Audio", "Playlist" }) do
    local chunk = assert(loadfile(ADDONS .. "Spoken_Readables/" .. file .. ".lua"))
    chunk("Spoken_Readables", R)
end
Expect("SpokenReadables is the Readables module", _G.SpokenReadables, R)
Exposes("SpokenReadables", { "PlaceOf", "BookById", "HasAudio", "PlayFrom", "StopReading", "IsNarrating" },
    "Spoken_Readables/UI/Readables.lua", { "CompendiumHas", "ShowReadables" })

---------------------------------------------------------------- bosses
local B = {}
local chunk = assert(loadfile(ADDONS .. "Spoken_Bosses/Core.lua"))
chunk("Spoken_Bosses", B)
Expect("SpokenBossesAddon is the Bosses module", _G.SpokenBossesAddon, B)

if Failures() > 0 then os.exit(1) end
print("\nAll module global tests passed")
