-- A dungeon whose story is kept under another zone than its entrance's: Razorfen Downs, told under
-- Thousand Needles and entered in The Barrens. Found at its entrance, it is told by its story's own
-- ids (s:1441:razorfen downs), with the real zone and queue code. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local Expect, Failures = H.Expecter(print)
local SPOKEN = here .. "/../../addons/Spoken/"
local PLACES = here .. "/../../addons/Spoken_Places/"
local after = C_Timer.After

local BARRENS, NEEDLES = 1413, 1441
local ENTRANCE = { map = BARRENS, zone = "The Barrens", subzone = "Razorfen Downs" }

local function Boot()
    stub.SetClient("16001")
    stub.ResetSound(); stub.ResetTimers()
    stub.world.inCombat = false
    stub.world.playerLevel = 40
    SpokenPlacesSettings = nil
    SpokenPlacesCharacter = { greeted = true }
    SpokenPlacesAudioPacks = {
        SpokenPlacesAudio = { version = 1, addon = "SpokenPlacesAudio", language = "enUS", zones = {},
            subzones = { [NEEDLES] = { ["razorfen downs"] = { file = "1441\\razorfen-downs", len = 40 } } } },
    }
    local env = stub.LoadSpoken(SPOKEN)
    env.Addon:Enable()
    C_Timer.After = after
    local Z = H.LoadPlaces(PLACES)
    assert(loadfile(PLACES .. "Locale/enUS.lua"))("Spoken_Places", Z)
    for _, file in ipairs({ "Autoplay", "Discovery", "UI/LoreWindow" }) do
        assert(loadfile(PLACES .. file .. ".lua"))("Spoken_Places", Z)
    end
    Z.Zones[BARRENS] = { name = "The Barrens", full = "Dry land." }
    Z.Zones[NEEDLES] = { name = "Thousand Needles", full = "Spires." }
    Z.Subzones[BARRENS] = { crossroads = { name = "Crossroads", full = "A fort." } }
    Z.Subzones[NEEDLES] = { ["razorfen downs"] = { name = "Razorfen Downs", full = "The quilboars' barrows." } }
    Z.GetMapName = function(_, mapID) return Z.Zones[mapID] and Z.Zones[mapID].name end
    stub.SetZone(ENTRANCE)
    stub.FireEvent("ADDON_LOADED", "Spoken_Places")
    Z:SetupAudio()
    Z:SetupAutoplay()
    Z:SetupDiscovery()
    return Z
end

local Z = Boot()
local entry, key, story = Z:GetSubzoneLore(BARRENS, "Razorfen Downs")
Expect("at its entrance in The Barrens, Razorfen Downs finds its story under Thousand Needles",
    (entry and entry.full) .. "|" .. tostring(key) .. "|" .. tostring(story), "The quilboars' barrows.|razorfen downs|1441")
Expect("...as it does where the story is kept", select(3, Z:GetSubzoneLore(NEEDLES, "Razorfen Downs")), NEEDLES)
Expect("any other area is told where it is found", select(3, Z:GetSubzoneLore(BARRENS, "Crossroads")), BARRENS)
Expect("StoryPlace names where a story found at a map is kept",
    table.concat({ Z:StoryPlace(BARRENS, "razorfen downs") }, "|") .. " " .. table.concat({ Z:StoryPlace(BARRENS, "crossroads") }, "|"),
    "1441|razorfen downs 1413|crossroads")

-- With Autoplay Explored Areas on, standing in it is enough.
Z:Set("autoplayExplored", true)
stub.Advance(2)
stub.FireEvent("ZONE_CHANGED")
local clip = Spoken:GetCurrent()
Expect("standing at its entrance plays its story by its own id", clip and clip.key, "s:1441:razorfen downs")
Expect("...headed by The Barrens, where its entrance is", clip and clip.present.header, "The Barrens")
Expect("...and its report names the story's map", clip and Z:ReportURL(clip.mapID, clip.areaKey),
    "https://spoken.rusty.one/places/r/1441/razorfen-downs")
Expect("...and the visit is recorded at its entrance, where it is found",
    tostring(SpokenPlacesCharacter.visited["1413/razorfen downs"]) .. "|" .. tostring(Z:IsFound(NEEDLES, "razorfen downs")),
    "true|true")

Z = Boot()
stub.FireEvent("CHAT_MSG_SYSTEM", "Discovered Razorfen Downs: 10 experience gained.")
clip = Spoken:GetCurrent()
Expect("discovering it at its entrance plays the same story", clip and clip.key, "s:1441:razorfen downs")

-- Shift-click on a story's row in Azeroth's Compendium queues it, as on Quests, choosing nothing.
Z = Boot()
Expect("Unlock Undiscovered Places is off in a fresh profile", Z:Get("showUndiscovered"), false)
Z:Set("showUndiscovered", true)
Expect("Discovered Only is on in a fresh profile", Z:Get("loreDiscoveredOnly"), true)
Z:Set("loreDiscoveredOnly", false)
Expect("...and an explicit off stays off", Z:Get("loreDiscoveredOnly"), false)
SpokenPlacesSettings.discoveredOnlyDefaultOn = nil
Z:OnSettingsBound()
Expect("an off stored before it was on by default is turned on once", Z:Get("loreDiscoveredOnly"), true)
Z:Set("loreDiscoveredOnly", false)
-- The rest is about the unfiltered list: the row is a place this character has not found.
Spoken:StopAll()
for _, file in ipairs({ "UI/LorePage" }) do assert(loadfile(PLACES .. file .. ".lua"))("Spoken_Places", Z) end
Z.Zones[1414] = { name = "Kalimdor", full = "West." }
Z:SetupLoreWindow()
Z:ToggleLoreWindow()
local function RowFor(label, frame)
    for _, child in ipairs((frame or Z.window).children or {}) do
        if child.row and child.shown ~= false and child.row.label == label then return child end
        local found = RowFor(label, child)
        if found then return found end
    end
end
local title = Z.window.page.title.text
local shift = _G.IsShiftKeyDown
_G.IsShiftKeyDown = function() return true end
local row = RowFor("Razorfen Downs")
row.scripts.OnClick(row)
clip = Spoken:GetCurrent()
Expect("a shift-click on a story's row in the Compendium queues it by its own id", clip and clip.key, "s:1441:razorfen downs")
Expect("...choosing nothing", Z.window.page.title.text, title)
row.scripts.OnClick(row)
Expect("...and a second does not queue it twice", Spoken:GetQueueSize(), 1)
_G.IsShiftKeyDown = shift
Spoken:StopAll()

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll places story place tests passed")
