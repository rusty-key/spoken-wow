-- Entering a dungeon or raid reads its story and counts its card found. Inside an instance the
-- client gives no map for the player and announces no discovery, so the instance's own map
-- (GetInstanceInfo) is looked up in Spoken's Data/Dungeons.lua. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local Expect, Failures = H.Expecter(print)
local SPOKEN = here .. "/../../addons/Spoken/"
local PLACES = here .. "/../../addons/Spoken_Places/"
local after = C_Timer.After

local RUINS = "ruins of lordaeron"

-- Where the player is: nil outdoors, else { map = the instance's map, kind = IsInInstance's }.
local instance = nil
function IsInInstance()
    if instance then return true, instance.kind end
    return false, "none"
end
function GetInstanceInfo()
    local i = instance or { map = 0, kind = "none" }
    return "Somewhere", i.kind, 0, "", 5, 0, false, i.map
end
local bestMap = C_Map.GetBestMapForUnit
-- The client has no uiMap for the player inside any dungeon or raid.
C_Map.GetBestMapForUnit = function(unit)
    if instance then return nil end
    return bestMap(unit)
end

local function Boot(opts)
    opts = opts or {}
    stub.SetClient("16001")
    stub.ResetSound(); stub.ResetTimers()
    stub.world.inCombat = false
    stub.world.playerLevel = 30
    instance = opts.inside
    SpokenSettings, SpokenPlacesSettings = nil, nil
    SpokenPlacesCharacter = { greeted = true }
    local subzones = { [1420] = { [RUINS] = { file = "1420\\ruins-of-lordaeron", len = 85 } } }
    if opts.noClip then subzones = {} end
    SpokenPlacesAudioPacks = {
        SpokenPlacesAudio = { version = 1, addon = "SpokenPlacesAudio", language = "enUS",
            zones = { [1420] = { file = "1420\\zone", len = 80 } }, subzones = subzones },
    }
    local env = stub.LoadSpoken(SPOKEN)
    env.Addon:Enable()
    C_Timer.After = after
    local Z = H.LoadPlaces(PLACES)
    assert(loadfile(PLACES .. "Locale/enUS.lua"))("Spoken_Places", Z)
    assert(loadfile(PLACES .. "Discovery.lua"))("Spoken_Places", Z)
    assert(loadfile(PLACES .. "Autoplay.lua"))("Spoken_Places", Z)
    Z.Zones[1420] = { name = "Tirisfal Glades", full = "Tirisfal lore." }
    Z.Zones[1458] = { name = "Undercity", full = "Undercity lore." }
    Z.Subzones[1420] = { [RUINS] = { name = "Ruins of Lordaeron", full = "Ruins lore." } }
    stub.SetZone({ map = 1420, zone = "Tirisfal Glades", subzone = "" })
    stub.FireEvent("ADDON_LOADED", "Spoken_Places")
    Z:SetupAudio()
    -- Include Places Found Before also reads where the character stands, on login and on a
    -- zone change: off, so only the instance's story is measured.
    Z:Set("autoplayExplored", false)
    Z:SetupAutoplay()
    return Z
end

local Z

-- The loading screen into an instance: the world entered, then the zone change.
local function Enter(map, kind)
    instance = map and { map = map, kind = kind or "party" } or nil
    local frame = Z.autoplayFrame
    frame.scripts.OnEvent(frame, "PLAYER_ENTERING_WORLD", false, false)
    stub.FireEvent("ZONE_CHANGED_NEW_AREA")
end

local function Playing()
    local current = Spoken:GetCurrent()
    return current and Spoken:IsPlaying() and current.key or nil
end

Z = Boot()
Expect("outdoors, the instance's story is not found", Z:IsFound(1420, RUINS), false)
Enter(2999)
Expect("entering the Ruins of Lordaeron reads its story", Playing(), "s:1420:" .. RUINS)
Expect("...and counts its card found", Z:IsFound(1420, RUINS), true)
Expect("...queued once, though the world and the zone change both announce it", Spoken:GetQueueSize(), 1)
stub.Advance(90)
Enter(nil)
Enter(2999)
Expect("entering again reads nothing: once per character", Spoken:GetQueueSize(), 0)

for _, case in ipairs({
    { setting = "autoplay", label = "Read Automatically off" },
    { setting = "autoplaySubzones", label = "Include Smaller Areas off" },
    { setting = "voiceEnabled", label = "Read Stories Aloud off" },
}) do
    Z = Boot()
    Z:Set(case.setting, false)
    Enter(2999)
    Expect("with " .. case.label .. ", entering reads nothing", Spoken:GetQueueSize(), 0)
    Expect("...and still counts the card found", Z:IsFound(1420, RUINS), true)
end

Z = Boot({ noClip = true })
Enter(2999)
Expect("with no clip in the pack, entering queues nothing", Spoken:GetQueueSize(), 0)
Expect("...and still counts the card found", Z:IsFound(1420, RUINS), true)

Z = Boot()
Z:MarkHeard(1420, RUINS)
Enter(2999)
Expect("a story already heard is not read again on entering", Spoken:GetQueueSize(), 0)

Z = Boot()
Enter(34)
Expect("a dungeon with no story reads nothing", Spoken:GetQueueSize(), 0)
Enter(2999, "pvp")
Expect("a battleground's or arena's map is not looked up", Spoken:GetQueueSize(), 0)
Expect("...nor counted found", Z:IsFound(1420, RUINS), false)
instance = nil
stub.FireEvent("ZONE_CHANGED_NEW_AREA")
Expect("outdoors, a zone change reads no instance", Spoken:GetQueueSize(), 0)

-- Forever may hand the instance's map over as a secret value, which reads as nil.
Z = Boot()
stub.Secrets(2999)
local ok, err = pcall(Enter, 2999)
stub.Secrets()
Expect("a secret instance map raises no error", ok or err, true)
Expect("...and reads nothing", Spoken:GetQueueSize(), 0)

Z = Boot({ inside = { map = 2999, kind = "party" } })
stub.Advance(2)
Expect("logging in inside the instance reads its story", Playing(), "s:1420:" .. RUINS)

-- Every dungeon and raid card: entering the instance counts it found. Deadmines, Wailing Caverns,
-- the Sunken Temple, the Scarlet Monastery, Onyxia's Lair, Scholomance, Ragefire Chasm and the
-- Ruins of Lordaeron had no other way to be found.
Z = Boot({ noClip = true })
local maps = {}
for map, dungeon in pairs(SpokenDungeons.dungeons) do
    if dungeon.story then table.insert(maps, map) end
end
table.sort(maps)
Expect("Data/Dungeons.lua has dungeons with a story", #maps > 0, true)
for _, map in ipairs(maps) do
    local story = SpokenDungeons.dungeons[map].story
    SpokenPlacesCharacter = { greeted = true }
    Z:RefreshFound()
    local before = Z:IsFound(story[1], story[2]) and true or false
    Enter(map, map == 249 and "raid" or "party")
    Expect(("map %d: its card %d/%s is found by entering, not before"):format(map, story[1], story[2]),
        tostring(before) .. "|" .. tostring(Z:IsFound(story[1], story[2])), "false|true")
end

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll places instance tests passed")
