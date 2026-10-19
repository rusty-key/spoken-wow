-- Exercise flight checks with real zone and queue code.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local Expect, Failures = H.Expecter(print)
local SPOKEN = here .. "/../../addons/Spoken/"
local ZONES = here .. "/../../addons/Spoken_Places/"
local after = C_Timer.After
local onTaxi, flying = false, false

function UnitOnTaxi(unit)
    assert(unit == "player")
    return onTaxi
end
function IsFlying() return flying end

local function Boot(client, taxi, flight, greeting)
    -- A fresh flight master each boot, so an earlier boot's hook does not answer it too.
    _G.TakeTaxiNode = function() end
    stub.SetClient(client)
    stub.ResetSound(); stub.ResetTimers()
    stub.world.inCombat = false
    stub.world.playerLevel = 1
    onTaxi, flying = taxi, flight
    SpokenSettings, SpokenZonesSettings = nil, nil
    SpokenZonesCharacter = greeting and {} or { greeted = true }
    SpokenZonesAudioPacks = {
        SpokenZonesAudio = { version = 1, addon = "SpokenZonesAudio", language = "enUS",
            zones = { [1411] = { file = "1411\\zone", len = 80 } },
            subzones = { [1411] = { ["valley of trials"] = { file = "1411\\valley", len = 35 } } } },
    }
    local env = stub.LoadSpoken(SPOKEN)
    env.Addon:Enable()
    C_Timer.After = after
    local Z = H.LoadZones(ZONES)
    assert(loadfile(ZONES .. "Locale/enUS.lua"))("Spoken_Places", Z)
    assert(loadfile(ZONES .. "Autoplay.lua"))("Spoken_Places", Z)
    Z.Zones[1411] = { name = "Durotar", full = "Durotar lore." }
    Z.Subzones[1411] = { ["valley of trials"] = { name = "Valley of Trials", full = "Valley lore." } }
    stub.SetZone({ map = 1411, zone = "Durotar", subzone = "Valley of Trials" })
    stub.FireEvent("ADDON_LOADED", "Spoken_Places")
    Z:SetupAudio()
    Z:SetupAutoplay()
    return Z
end

-- IsFlying can be false on a taxi.
for _, state in ipairs({
    { name = "taxi", taxi = true, flying = false },
    { name = "flying mount", taxi = false, flying = true },
}) do
    for _, client in ipairs({ "11509", "20506", "16001" }) do
        local label = client .. " " .. state.name
        local Z = Boot(client, state.taxi, state.flying)
        stub.FireEvent("CHAT_MSG_SYSTEM", "Discovered Durotar.")
        stub.FireEvent("CHAT_MSG_SYSTEM", "Discovered Valley of Trials: 10 experience gained.")
        Expect(label .. ": discoveries queue nothing", Spoken:GetQueueSize(), 0)
        Expect(label .. ": skipped discoveries are not marked heard", Z:HeardCount(), 0)

        Z:Set("autoplayExplored", true)
        stub.FireEvent("ZONE_CHANGED_NEW_AREA")
        stub.FireEvent("ZONE_CHANGED")
        stub.FireEvent("ZONE_CHANGED_INDOORS")
        Expect(label .. ": explored zones and subzones queue nothing", Spoken:GetQueueSize(), 0)
        stub.Advance(3)
        Expect(label .. ": login's explored-area sweep queues nothing", Spoken:GetQueueSize(), 0)

        onTaxi, flying = false, false
        stub.Advance(1)
        Expect(label .. ": landing releases no flyover backlog", Spoken:GetQueueSize(), 0)
        stub.FireEvent("ZONE_CHANGED")
        Expect(label .. ": ground entry narrates the unheard zone and subzone", Spoken:GetQueueSize(), 2)
        Expect(label .. ": ground narration starts", Spoken:IsPlaying(), true)

        Z = Boot(client, state.taxi, state.flying, true)
        stub.Advance(2)
        Expect(label .. ": login greeting stays silent", Spoken:GetQueueSize(), 0)
        Expect(label .. ": skipped greeting is not spent", SpokenZonesCharacter.greeted, nil)
        onTaxi, flying = false, false
        stub.Advance(2)
        Expect(label .. ": greeting can retry on the ground", Spoken:IsPlaying(), true)
        Expect(label .. ": greeting is recorded after queueing", SpokenZonesCharacter.greeted, true)

        Z = Boot(client, state.taxi, state.flying)
        Expect(label .. ": manually requested lore still plays", Z:PlayLore(1411), true)
        Expect(label .. ": manual playback is audible", Spoken:IsPlaying(), true)
        local quests = Spoken:RegisterSource("quests", { title = "Quests", addon = "Spoken_Quests" })
        local quest = H.Clip({ length = 30 })
        -- Play while a line speaks queues behind it rather than cutting it off.
        quests:PlayNow(quest)
        Expect(label .. ": a quest waits behind the lore", Spoken:IsPlaying(quest), false)
        Spoken:Skip()
        stub.Advance(2)
        Expect(label .. ": quest playback still works", Spoken:IsPlaying(quest), true)
    end
end

local Z = Boot("16001", false, false)
IsFlying = nil
onTaxi = true
stub.FireEvent("CHAT_MSG_SYSTEM", "Discovered Durotar.")
Expect("without IsFlying, taxis still suppress discoveries", Spoken:GetQueueSize(), 0)
onTaxi = false
stub.FireEvent("CHAT_MSG_SYSTEM", "Discovered Durotar.")
Expect("without IsFlying, ground discovery still plays", Spoken:IsPlaying(), true)

Z = Boot("16001", false, false)
UnitOnTaxi = nil
stub.FireEvent("CHAT_MSG_SYSTEM", "Discovered Durotar.")
Expect("missing flight APIs do not break ground discovery", Spoken:IsPlaying(), true)

-- Midnight hands some chat payloads over as secret values: tainted code that indexes one
-- errors. The stand-in is a plain string whose indexing throws, as the client's would.
Z = Boot("16001", false, false)
Z:Set("debug", true)
local SECRET = "Discovered Durotar."
_G.issecretvalue = function(value) return value == SECRET end
local strings = getmetatable("")
local index = strings.__index
strings.__index = function(s, key)
    if s == SECRET then error("attempt to index a secret string value") end
    return index[key]
end
local printed = {}
Z.Print = function(_, fmt, ...) table.insert(printed, fmt:format(...)) end
-- The client fills the sender and channel fields after the text, mostly with "".
local ok, err = pcall(stub.FireEvent, "CHAT_MSG_SYSTEM", SECRET, "", "Common", "")
strings.__index = index
_G.issecretvalue = nil
Expect("a secret system message raises no error", ok or err, true)
Expect("...and discovers nothing", Spoken:GetQueueSize(), 0)
Expect("...nor prints a field after it as the message", printed[1], nil)
stub.FireEvent("CHAT_MSG_SYSTEM", "Discovered Durotar.")
Expect("the same message, not secret, still discovers", Spoken:IsPlaying(), true)

---------------------------------------------------------------- the destination, read in the air
local nodes = {
    { "Crossroads, The Barrens", "REACHABLE" },
    { "Orgrimmar, Durotar", "CURRENT" },
    { "Razor Hill, Durotar", "REACHABLE" },
    { "Booty Bay, Stranglethorn", "REACHABLE" },
    { "Orgrimmar, Durotar", "REACHABLE" },
    { "Somewhere Unnamed", "REACHABLE" },
    { "十字路口，The Barrens", "REACHABLE" },
}
function UnitOnTaxi() return onTaxi end
function IsFlying() return flying end
function TaxiNodeName(index) return nodes[index] and nodes[index][1] end
function TaxiNodeGetType(index) return nodes[index] and nodes[index][2] or "NONE" end

-- Durotar, with three places to fly to: The Barrens and Orgrimmar found, Stranglethorn not.
local function FlightBoot()
    local Z = Boot("11509", false, false)
    assert(loadfile(ZONES .. "Discovery.lua"))("Spoken_Places", Z)
    local pack = SpokenZonesAudioPacks.SpokenZonesAudio
    pack.zones[1413] = { file = "1413\\zone", len = 60 }
    pack.zones[1454] = { file = "1454\\zone", len = 30 }
    pack.zones[1434] = { file = "1434\\zone", len = 30 }
    Z.Zones[1413] = { name = "The Barrens", full = "Barrens lore." }
    Z.Zones[1454] = { name = "Orgrimmar", full = "Orgrimmar lore." }
    Z.Zones[1434] = { name = "Stranglethorn Vale", full = "Stranglethorn lore." }
    SpokenZonesCharacter.visited = { ["1411"] = true, ["1413"] = true, ["1454"] = true }
    return Z
end
local function Playing()
    local current = Spoken:GetCurrent()
    return current and Spoken:IsPlaying() and current.key or nil
end
local function Fly(index, settle)
    onTaxi = false
    _G.TakeTaxiNode(index)
    onTaxi = true
    stub.Advance(settle or 1)
end

local Z = FlightBoot()
Z:Set("debug", true)
_G.TakeTaxiNode(1)
Expect("taking a flight reads nothing before the player is in the air", Spoken:GetQueueSize(), 0)
onTaxi = true
stub.Advance(1)
Expect("in the air, the story of the zone the flight lands in is read", Playing(), "z:1413")
Z:Set("autoplayExplored", true)
stub.FireEvent("CHAT_MSG_SYSTEM", "Discovered Valley of Trials: 10 experience gained.")
stub.FireEvent("ZONE_CHANGED")
Expect("places flown over are still not read", Spoken:GetQueueSize(), 1)
stub.Advance(62)
onTaxi = false
stub.SetZone({ map = 1413, zone = "The Barrens", subzone = "" })
stub.FireEvent("ZONE_CHANGED_NEW_AREA")
stub.FireEvent("CHAT_MSG_SYSTEM", "Discovered The Barrens.")
Expect("landing does not read the destination again", Spoken:GetQueueSize(), 0)
Z:Set("autoplayExplored", false)
stub.SetZone({ map = 1411, zone = "Durotar", subzone = "" })
stub.FireEvent("ZONE_CHANGED_NEW_AREA")
stub.SetZone({ map = 1413, zone = "The Barrens", subzone = "" })
stub.FireEvent("ZONE_CHANGED_NEW_AREA")
stub.FireEvent("CHAT_MSG_SYSTEM", "Discovered The Barrens.")
Expect("once the player has been on the ground elsewhere, the zone is read on discovery again", Playing(), "z:1413")

Z = FlightBoot()
Fly(5)
Expect("a flight to a city reads the city", Playing(), "z:1454")

Z = FlightBoot()
Fly(7)
Expect("a full-width comma separates the place from its zone", Playing(), "z:1413")

Z = FlightBoot()
Z:Set("flightLore", false)
Fly(1)
Expect("with Read Flight Destination off, a flight reads nothing", Spoken:GetQueueSize(), 0)

Z = FlightBoot()
Z:Set("voiceEnabled", false)
Fly(1)
Expect("with Read Stories Aloud off, a flight reads nothing", Spoken:GetQueueSize(), 0)

Z = FlightBoot()
Fly(2)
Expect("a node the flight master cannot fly to reads nothing", Spoken:GetQueueSize(), 0)

Z = FlightBoot()
Fly(3)
Expect("a flight inside the zone the player is in reads nothing", Spoken:GetQueueSize(), 0)

Z = FlightBoot()
Fly(4)
Expect("a zone Azeroth's Compendium keeps locked is not read", Spoken:GetQueueSize(), 0)
Z:Set("showUndiscovered", true)
Fly(4)
Expect("...and is with undiscovered places unlocked, matched by the start of its name", Playing(), "z:1434")

Z = FlightBoot()
onTaxi = false
_G.TakeTaxiNode(1)
stub.Advance(15)
onTaxi = true
stub.Advance(1)
Expect("a flight that never starts reads nothing, even on a later taxi", Spoken:GetQueueSize(), 0)

Z = FlightBoot()
Fly(6)
Expect("without C_TaxiMap, a node whose name matches no zone reads nothing", Spoken:GetQueueSize(), 0)
local getMapInfo = C_Map.GetMapInfo
C_Map.GetMapInfo = function(id)
    if id == 1414 then return { mapType = 2 } end
    return { mapType = 3, parentMapID = 1414 }
end
C_Map.GetMapInfoAtPosition = function(mapID, x, y)
    assert(mapID == 1414)
    return x > 0.5 and { mapID = 1413 } or { mapID = 1411 }
end
_G.C_TaxiMap = { GetAllTaxiNodes = function(mapID)
    return { { slotIndex = 3, position = { x = 0.2, y = 0.5 } }, { slotIndex = 6, position = { x = 0.7, y = 0.5 } } }
end }
Fly(6)
Expect("...with it, the node's place on the continent's map names the zone", Playing(), "z:1413")
C_Map.GetMapInfo, C_Map.GetMapInfoAtPosition, _G.C_TaxiMap = getMapInfo, nil, nil

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll zones flight tests passed")
