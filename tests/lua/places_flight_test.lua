-- Exercise flight checks with real zone and queue code.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local Expect, Failures = H.Expecter(print)
local SPOKEN = here .. "/../../addons/Spoken/"
local PLACES = here .. "/../../addons/Spoken_Places/"
local after = C_Timer.After
local onTaxi, flying = false, false

function UnitOnTaxi(unit)
    assert(unit == "player")
    return onTaxi
end
function IsFlying() return flying end

local function Boot(client, taxi, flight, greeting)
    stub.SetClient(client)
    stub.ResetSound(); stub.ResetTimers()
    stub.world.inCombat = false
    stub.world.playerDead = false
    stub.world.playerLevel = 1
    onTaxi, flying = taxi, flight
    SpokenPlacesSettings = nil
    SpokenPlacesCharacter = greeting and {} or { greeted = true }
    SpokenPlacesAudioPacks = {
        SpokenPlacesAudio = { version = 1, addon = "SpokenPlacesAudio", language = "enUS",
            zones = { [1411] = { file = "1411\\zone", len = 80 } },
            subzones = { [1411] = { ["valley of trials"] = { file = "1411\\valley", len = 35 } } } },
    }
    local env = stub.LoadSpoken(SPOKEN)
    env.Addon:Enable()
    C_Timer.After = after
    local Z = H.LoadPlaces(PLACES)
    assert(loadfile(PLACES .. "Locale/enUS.lua"))("Spoken_Places", Z)
    assert(loadfile(PLACES .. "Autoplay.lua"))("Spoken_Places", Z)
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
        Expect(label .. ": skipped greeting is not spent", SpokenPlacesCharacter.greeted, nil)
        onTaxi, flying = false, false
        stub.Advance(2)
        Expect(label .. ": greeting can retry on the ground", Spoken:IsPlaying(), true)
        Expect(label .. ": greeting is recorded after queueing", SpokenPlacesCharacter.greeted, true)

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

-- Dead or a ghost, only autoplay is silent: a story the player asks for still plays.
Z = Boot("16001", false, false)
Z:Set("autoplayExplored", true)
world.playerDead = true
stub.Advance(2)
stub.FireEvent("CHAT_MSG_SYSTEM", "Discovered Durotar.")
Expect("a dead player gets no discovery narration", Spoken:GetQueueSize(), 0)
stub.FireEvent("ZONE_CHANGED_NEW_AREA")
Expect("a dead player gets no explored-zone narration", Spoken:GetQueueSize(), 0)
Expect("manual lore still plays while dead", Z:PlayLore(1411), true)
Spoken:StopAll()

-- A line queued before death is held too, or it starts during the ghost run.
local function DieWhileNarrating()
    Z = Boot("16001", false, false)
    Z:Set("autoplayExplored", true)
    stub.Advance(2)
    stub.FireEvent("ZONE_CHANGED")
    Expect("autoplay starts before death", Spoken:IsPlaying(), true)
    world.playerDead = true
    stub.FireEvent("PLAYER_DEAD")
    Expect("death stops active autoplay", Spoken:IsPlaying(), false)
end

DieWhileNarrating()
local current = Spoken:GetCurrent()
Expect("dead autoplay is held", current and Spoken:GetHeldReason(current) or nil, Z.L.QUEUE_HELD_DEAD)
stub.FireEvent("PLAYER_ALIVE")
stub.Advance(1.1)
Expect("releasing the corpse keeps autoplay held", Spoken:IsPlaying(), false)
world.playerDead = false
stub.FireEvent("PLAYER_UNGHOST")
stub.Advance(1.1)
Expect("autoplay resumes after becoming alive", Spoken:IsPlaying(), true)

-- A res taken on the corpse, before releasing, fires PLAYER_ALIVE and never PLAYER_UNGHOST.
DieWhileNarrating()
world.playerDead = false
stub.FireEvent("PLAYER_ALIVE")
stub.Advance(1.1)
Expect("a res before releasing resumes autoplay", Spoken:IsPlaying(), true)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll places flight tests passed")
