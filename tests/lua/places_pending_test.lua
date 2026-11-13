-- The shipped corpus, read the way the addon reads it.
--
-- A pending entry is a place the client can name that nobody has written about yet. It
-- ships with empty text and a marker, and the marker is the whole contract: in Lua the
-- empty string is truthy, so a UI that asked `entry.full or fallback` would draw a blank
-- panel for one of these instead of saying anything. These tests are what keeps an export
-- from quietly shipping an entry that is empty without saying so.
--
-- Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(print)

local DATA = here .. "/../../addons/Spoken_Places/Data/enUS/"

-- Data files register themselves through the addon table and guard on the language.
local registered = {}
local SpokenPlaces = {
    RegisterLoreData = function(_, _, kind, table_) registered[kind] = table_ end,
    ShouldLoadLanguage = function() return true end,
}
for _, file in ipairs({ "Zones.lua", "Subzones.lua" }) do
    assert(loadfile(DATA .. file))("Spoken_Places", SpokenPlaces)
end

Expect("Zones.lua registered", type(registered.zones), "table")
Expect("Subzones.lua registered", type(registered.subzones), "table")

local function IsEmpty(entry)
    return (entry.full or "") == "" and (entry.short or "") == ""
end

local pending, emptyWithoutMarker, markerWithText = 0, {}, {}
local function Check(entry, label)
    if entry.pending then
        pending = pending + 1
        if not IsEmpty(entry) then table.insert(markerWithText, label) end
    elseif IsEmpty(entry) then
        table.insert(emptyWithoutMarker, label)
    end
end

for mapID, entry in pairs(registered.zones) do
    Check(entry, "z:" .. mapID)
end
for mapID, zone in pairs(registered.subzones) do
    for key, entry in pairs(zone) do
        Check(entry, "s:" .. mapID .. ":" .. key)
    end
end

Expect("no entry is empty without saying so", table.concat(emptyWithoutMarker, ", "), "")
Expect("no entry claims to be pending while holding text", table.concat(markerWithText, ", "), "")
Expect("the corpus does carry pending entries", pending > 0, true)

-- The five zones the Camelot sweep found. Named rather than counted: a count passes just
-- as well when the wrong five ship.
for _, mapID in ipairs({ 2482, 2521, 2524, 2548, 2652 }) do
    local entry = registered.zones[mapID]
    Expect("zone " .. mapID .. " ships", entry ~= nil, true)
    Expect("...named", entry and (entry.name or "") ~= "", true)
end

-- Every subzone hangs off a zone the addon knows, pending or not: the panel reaches a
-- subzone only through its parent, so one keyed to an absent zone can never be shown.
local orphans = {}
for mapID in pairs(registered.subzones) do
    if not registered.zones[mapID] then table.insert(orphans, tostring(mapID)) end
end
Expect("no subzone hangs off an unknown zone", table.concat(orphans, ", "), "")

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll places pending tests passed")
