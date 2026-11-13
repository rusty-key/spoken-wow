-- Read Every Visit: a place is read again on arrival once the chosen wait has passed since it was
-- last read, and not before; off, a place is read once per character.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local Expect, Failures = H.Expecter(print)
local SPOKEN = here .. "/../../addons/Spoken/"
local PLACES = here .. "/../../addons/Spoken_Places/"
local after = C_Timer.After

-- The wall clock the waits are measured on, moved by hand.
local clock = 1000000
_G.time = function() return clock end

local HOUR, DAY = 3600, 24 * 3600
local RAZOR_HILL = { map = 1411, zone = "Durotar", subzone = "Razor Hill" }

local function Boot(settings, record)
    stub.SetClient("16001")
    stub.ResetSound(); stub.ResetTimers()
    stub.world.inCombat = false
    -- Past level 1, so the new-character greeting settles at once and reads nothing.
    stub.world.playerLevel = 12
    SpokenPlacesSettings = nil
    SpokenPlacesCharacter = record
    SpokenPlacesAudioPacks = {
        SpokenPlacesAudio = { version = 1, addon = "SpokenPlacesAudio", language = "enUS",
            zones = { [1411] = { file = "1411\\zone", len = 80 } },
            subzones = { [1411] = { ["razor hill"] = { file = "1411\\razor-hill", len = 35 } } } },
    }
    local env = stub.LoadSpoken(SPOKEN)
    env.Addon:Enable()
    C_Timer.After = after
    local Z = H.LoadPlaces(PLACES)
    assert(loadfile(PLACES .. "Locale/enUS.lua"))("Spoken_Places", Z)
    assert(loadfile(PLACES .. "Autoplay.lua"))("Spoken_Places", Z)
    Z.Zones[1411] = { name = "Durotar", full = "Durotar lore." }
    Z.Subzones[1411] = { ["razor hill"] = { name = "Razor Hill", full = "Razor Hill lore." } }
    stub.SetZone(RAZOR_HILL)
    stub.FireEvent("ADDON_LOADED", "Spoken_Places")
    Z:SetupAudio()
    for key, value in pairs(settings) do Z:Set(key, value) end
    Z:SetupAutoplay()
    return Z
end

-- What Core's zone-change events run. Firing the event itself would also run the callbacks of
-- every earlier Boot's addon, whose frames the stub keeps.
local function ZoneChanged(Z)
    for _, callback in ipairs(Z.zoneChangedCallbacks) do callback(Z:GetPlayerMapID()) end
end

local function ArriveAndListen(Z)
    stub.Advance(2)
    local queued = Spoken:GetQueueSize()
    stub.Advance(300)
    return queued
end

-- Off: once per character.
local Z = Boot({ autoplayExplored = true, autoplayEveryVisit = false })
Expect("off, arriving reads the zone and the area", ArriveAndListen(Z), 2)
clock = clock + 30 * DAY
ZoneChanged(Z)
Expect("...and never again, however long after", Spoken:GetQueueSize(), 0)

-- On, with the default wait of a day.
Z = Boot({ autoplayExplored = true, autoplayEveryVisit = true })
Expect("the wait is a day unless chosen", Z:EveryVisitGap(), DAY)
Expect("on, arriving reads the zone and the area", ArriveAndListen(Z), 2)
clock = clock + 12 * HOUR
ZoneChanged(Z)
Expect("...not again twelve hours later", Spoken:GetQueueSize(), 0)
clock = clock + 13 * HOUR
ZoneChanged(Z)
Expect("...but again once the day has passed", Spoken:GetQueueSize(), 2)

-- A month's wait.
Z = Boot({ autoplayExplored = true, autoplayEveryVisit = true, autoplayEveryVisitGap = 30 * DAY })
ArriveAndListen(Z)
clock = clock + 20 * DAY
ZoneChanged(Z)
Expect("with a month's wait, not twenty days later", Spoken:GetQueueSize(), 0)
clock = clock + 11 * DAY
ZoneChanged(Z)
Expect("...but thirty-one days later", Spoken:GetQueueSize(), 2)

-- A week's wait.
Z = Boot({ autoplayExplored = true, autoplayEveryVisit = true, autoplayEveryVisitGap = 7 * DAY })
ArriveAndListen(Z)
clock = clock + 2 * DAY
ZoneChanged(Z)
Expect("with a week's wait, not two days later", Spoken:GetQueueSize(), 0)
clock = clock + 6 * DAY
ZoneChanged(Z)
Expect("...but eight days later", Spoken:GetQueueSize(), 2)

-- A saved wait that is not one of the choices reads as the default.
Z = Boot({ autoplayEveryVisit = true, autoplayEveryVisitGap = 5 })
Expect("a wait that is not offered falls back to a day", Z:EveryVisitGap(), DAY)
Z = Boot({ autoplayEveryVisit = true, autoplayEveryVisitGap = 30 * 60 })
Expect("...30 minutes too", Z:EveryVisitGap(), DAY)
Z = Boot({ autoplayEveryVisit = true, autoplayEveryVisitGap = 12 * HOUR })
Expect("...and 12 hours", Z:EveryVisitGap(), DAY)

-- Read Every Visit reads on arrival by itself, with Include Places Found Before off.
Z = Boot({ autoplayExplored = false, autoplayEveryVisit = true })
Expect("on, it reads on arrival without Include Places Found Before", ArriveAndListen(Z), 2)

-- The clock set back: a time ahead of now does not silence the place.
Z = Boot({ autoplayEveryVisit = true, autoplayEveryVisitGap = DAY })
ArriveAndListen(Z)
clock = clock - DAY
ZoneChanged(Z)
Expect("a reading saved ahead of the clock counts as long ago", Spoken:GetQueueSize(), 2)
stub.Advance(300)

-- A discovery right after the zone change that read the same place reads nothing.
Z = Boot({ autoplayEveryVisit = true })
ArriveAndListen(Z)
Z:OnAreaDiscovered("Razor Hill")
Expect("a discovery of a place just read does not read it again", Spoken:GetQueueSize(), 0)

-- Forget Places Heard clears the times too.
Z = Boot({ autoplayEveryVisit = true, autoplayEveryVisitGap = 7 * DAY })
ArriveAndListen(Z)
Z:ForgetAutoplayHistory()
ZoneChanged(Z)
Expect("after Forget Places Heard, the place is read on the next arrival", Spoken:GetQueueSize(), 2)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll every-visit tests passed")
