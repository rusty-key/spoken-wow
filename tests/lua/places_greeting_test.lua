-- The login greeting: a new character hears its starting area once, and a character whose
-- saved record was lost is still not greeted with wherever it logs in.
-- Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local Expect, Failures = H.Expecter(print)
local SPOKEN = here .. "/../../addons/Spoken/"
local PLACES = here .. "/../../addons/Spoken_Places/"
local after = C_Timer.After
local getMapInfo = C_Map.GetMapInfo

local function Boot(where, level, record)
    stub.SetClient("16001")
    stub.ResetSound(); stub.ResetTimers()
    stub.world.inCombat = false
    stub.world.playerLevel = level
    SpokenPlacesSettings = nil
    SpokenPlacesCharacter = record
    SpokenPlacesAudioPacks = {
        SpokenPlacesAudio = { version = 1, addon = "SpokenPlacesAudio", language = "enUS",
            zones = { [1411] = { file = "1411\\zone", len = 80 }, [1453] = { file = "1453\\zone", len = 80 } },
            subzones = { [1411] = {
                ["valley of trials"] = { file = "1411\\valley-of-trials", len = 35 },
                ["razor hill"] = { file = "1411\\razor-hill", len = 35 },
            } } },
    }
    local env = stub.LoadSpoken(SPOKEN)
    env.Addon:Enable()
    C_Timer.After = after
    local Z = H.LoadPlaces(PLACES)
    assert(loadfile(PLACES .. "Locale/enUS.lua"))("Spoken_Places", Z)
    assert(loadfile(PLACES .. "Autoplay.lua"))("Spoken_Places", Z)
    Z.Zones[1411] = { name = "Durotar", full = "Durotar lore." }
    Z.Zones[1453] = { name = "Stormwind City", full = "Stormwind lore." }
    Z.Subzones[1411] = {
        ["valley of trials"] = { name = "Valley of Trials", full = "Valley lore." },
        ["razor hill"] = { name = "Razor Hill", full = "Razor Hill lore." },
    }
    stub.SetZone(where)
    stub.FireEvent("ADDON_LOADED", "Spoken_Places")
    Z:SetupAudio()
    -- Include Places Found Before also reads where the character stands, on login and on a
    -- zone change: off, so only the greeting is measured.
    Z:Set("autoplayExplored", false)
    Z:SetupAutoplay()
    return Z
end

local VALLEY = { map = 1411, zone = "Durotar", subzone = "Valley of Trials" }

-- What Core's zone-change events run. Firing the event itself would also run the callbacks of
-- every earlier Boot's addon, whose frames the stub keeps.
local function ZoneChanged(Z)
    for _, callback in ipairs(Z.zoneChangedCallbacks) do callback(Z:GetPlayerMapID()) end
end

Boot(VALLEY, 1, nil)
stub.Advance(2)
Expect("a new character in its starting area is greeted", Spoken:IsPlaying(), true)
Expect("...and remembered", SpokenPlacesCharacter.greeted, true)

Boot(VALLEY, 1, { greeted = true })
stub.Advance(20)
Expect("a character greeted before is not greeted again", Spoken:GetQueueSize(), 0)

-- The record lost, as after a crash before logout.
Boot({ map = 1453, zone = "Stormwind City", subzone = "Trade District" }, 1, nil)
stub.Advance(20)
Expect("a level 1 character parked in a city is not greeted", Spoken:GetQueueSize(), 0)
Expect("...nor marked greeted", SpokenPlacesCharacter.greeted, nil)

Boot({ map = 1411, zone = "Durotar", subzone = "Razor Hill" }, 1, nil)
stub.Advance(20)
Expect("a level 1 character out of its valley is not greeted", Spoken:GetQueueSize(), 0)

Boot(VALLEY, 12, nil)
stub.Advance(20)
Expect("a levelled character back in a valley is not greeted", Spoken:GetQueueSize(), 0)

-- A new character's first answers name the continent, with no subzone yet.
local continent = true
C_Map.GetMapInfo = function(id) return { mapType = continent and 2 or 3 } end
Boot({ map = 1411, zone = "", subzone = "" }, 1, nil)
stub.Advance(6)
Expect("the greeting waits while the map is the continent", Spoken:GetQueueSize(), 0)
Expect("...without spending its turn", SpokenPlacesCharacter.greeted, nil)
continent = false
stub.SetZone(VALLEY)
stub.Advance(2)
Expect("once the map settles on the valley, it is greeted", Spoken:IsPlaying(), true)
C_Map.GetMapInfo = getMapInfo

-- With Include Places Found Before on, a new character's zone is read after its valley at login,
-- and the game's discovery of the zone, when the character walks out into it, reads nothing.
local Z = Boot(VALLEY, 1, nil)
Z:Set("autoplayExplored", true)
stub.Advance(2)
local current = Spoken:GetCurrent()
Expect("with Include Places Found Before on, the valley is read first",
    current and current.key, "s:1411:valley of trials")
Expect("...and the zone after it", Spoken:GetQueueSize(), 2)
stub.Advance(200)
Z:OnAreaDiscovered("Durotar")
Expect("...so the zone's discovery does not read it again", Spoken:GetQueueSize(), 0)

-- The map settled on the zone before the subzone is filled in: the zone waits for the greeting.
Z = Boot({ map = 1411, zone = "Durotar", subzone = "" }, 1, nil)
Z:Set("autoplayExplored", true)
stub.Advance(2)
Expect("with the subzone not known yet, the zone is not read ahead of the greeting", Spoken:GetQueueSize(), 0)
-- The game fires a zone change as the character loads in; it takes the same route.
ZoneChanged(Z)
Expect("...nor by a zone change", Spoken:GetQueueSize(), 0)
stub.SetZone(VALLEY)
stub.Advance(2)
current = Spoken:GetCurrent()
Expect("...the valley is read first once it is", current and current.key, "s:1411:valley of trials")
Expect("...and the zone after it", Spoken:GetQueueSize(), 2)
Expect("...and the greeting is remembered", SpokenPlacesCharacter.greeted, true)

-- A zone change before the greeting's first try, with the valley already known.
Z = Boot(VALLEY, 1, nil)
Z:Set("autoplayExplored", true)
ZoneChanged(Z)
Expect("a zone change before the greeting reads nothing", Spoken:GetQueueSize(), 0)
stub.Advance(2)
current = Spoken:GetCurrent()
Expect("...the valley is read first", current and current.key, "s:1411:valley of trials")
Expect("...the zone after it", Spoken:GetQueueSize(), 2)
Expect("...and the character is greeted", SpokenPlacesCharacter.greeted, true)
ZoneChanged(Z)
Expect("...a zone change once it is settled does not read them again", Spoken:GetQueueSize(), 2)

-- The valley already waiting from another route is not refused as a duplicate and left ungreeted.
Z = Boot(VALLEY, 1, nil)
Z:QueueLore(1411, "valley of trials")
stub.Advance(2)
Expect("a valley already queued still counts as the greeting", SpokenPlacesCharacter.greeted, true)
Expect("...and the greeting adds no zone to it", Spoken:GetQueueSize(), 1)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll places greeting tests passed")
