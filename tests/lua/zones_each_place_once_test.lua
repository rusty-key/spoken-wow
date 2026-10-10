-- Lore of Azeroth lists each place once: a zone (a city among them) is never also an area of
-- the zone around it or of itself, in any language.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(print)
local DATA = here .. "/../../addons/Spoken_Zones/Data/"

local function Load(lang)
    local Z, data = { ShouldLoadLanguage = function() return true end }, {}
    function Z:RegisterLoreData(_, kind, t) data[kind] = t end
    for _, file in ipairs({ "Zones.lua", "Subzones.lua" }) do
        local chunk = loadfile(DATA .. lang .. "/" .. file)
        if chunk then chunk("Spoken_Zones", Z) end
    end
    return data.zones or {}, data.subzones or {}
end

local zones = Load("enUS")
local zoneNames = {}
for _, entry in pairs(zones) do zoneNames[string.lower(entry.name)] = true end

for _, lang in ipairs({ "enUS", "deDE", "esES", "esMX", "frFR", "koKR", "ptBR", "ruRU", "zhCN", "zhTW" }) do
    local _, subzones = Load(lang)
    local twice = {}
    for mapID, areas in pairs(subzones) do
        for key in pairs(areas) do
            if zoneNames[key] then table.insert(twice, (zones[mapID] and zones[mapID].name or mapID) .. " > " .. key) end
        end
    end
    table.sort(twice)
    Expect(lang .. ": no zone is listed again as an area", table.concat(twice, ", "), "")
end

-- The cities, each a zone of its own in the game, are no longer areas of the zone around them.
local _, subzones = Load("enUS")
Expect("Stormwind City is not an area of Elwynn Forest", subzones[1429]["stormwind city"], nil)
Expect("Ironforge is not an area of Dun Morogh", subzones[1426]["ironforge"], nil)
-- A passage between two places stays at both ends.
Expect("Deeprun Tram stays in Stormwind City", subzones[1453]["deeprun tram"] ~= nil, true)
Expect("...and in Ironforge", subzones[1455]["deeprun tram"] ~= nil, true)
-- A border area the game has in both zones stays in both.
Expect("Southfury River stays in Durotar and the Barrens", subzones[1411]["southfury river"] ~= nil and subzones[1413]["southfury river"] ~= nil, true)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll each-place-once tests passed")
