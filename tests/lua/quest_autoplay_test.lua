-- Turning autoplay off: opening a quest dialog reads nothing by itself, and the Play button on
-- the window is how the player starts it instead. Greetings and gossip are the gossip module's,
-- which has no autoplay of its own (gossip_frequency_test.lua). Run with `make test-player`.
--
-- Both dispatch routes are covered, because the setting has to hold on each: the 10 Hz
-- watcher a Blizzard client reads quests through, and the direct events a legacy
-- client reads them through (VoiceOver.lua's directEvents says why the two differ).
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local print = stub.print
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local SPOKEN = here .. "/../../addons/Spoken/"

local world = stub.world
local failures = 0

local function Expect(scenario, actual, expected)
    if actual == expected then
        print(string.format("ok   %s", scenario))
    else
        failures = failures + 1
        print(string.format("FAIL %s\n     expected: %s\n     actual:   %s", scenario,
            tostring(expected), tostring(actual)))
    end
end

local function Boot(client)
    stub.SetClient(client); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
    world.questID = 0
    stub.ShowPanel(nil)
    -- A fresh install each time: the previous client's run turned autoplay off.
    _G.SpokenQuestsSettings = nil
    local VO = stub.LoadQuests(QUESTS, SPOKEN)
    dofile(QUESTS .. "UI/DialogPlayButton.lua")
    VO.Addon:OnInitialize()
    -- By id and by name: the 1.12 client has no GUID for the lookup to key on.
    local gossip = { ["We stand ready."] = "gossip-hash", ["Welcome, traveller."] = "greeting-hash" }
    VO.DataModules:Register("TestPack", {
        SoundLengthLookupByFileName = { ["101-accept"] = 1, ["101-complete"] = 1,
            ["gossip-hash"] = 1, ["greeting-hash"] = 1 },
        GossipLookupByNPCID = { [12345] = gossip },
        GossipLookupByNPCName = { Guard = gossip },
        GetSoundPath = function(_, fileName) return fileName .. ".ogg" end,
    })
    world.title = "Test Quest"
    world.questText = "Go and do the thing."
    world.progressText = "Have you done the thing?"
    world.rewardText = "You have done the thing."
    world.npcName = "Guard"
    world.npcGUID = "Creature-0-0-0-0-12345-0"
    world.greetingText = "Welcome, traveller."
    -- Wait out the deferred data module load that OnInitialize schedules.
    stub.Advance(2)

    local played = {}
    _G.Spoken:RegisterCallback("CLIP_STARTED", function(clip)
        table.insert(played, clip.fileName)
    end)
    return VO, played
end

local function Played(played)
    local text = table.concat(played, ", ")
    for i = #played, 1, -1 do played[i] = nil end
    return text ~= "" and text or "(nothing)"
end

--- A quest dialog opening the way each client delivers it, left open long enough for the
--- watcher to stabilize and dispatch.
local function Open(questID, panel, event)
    world.questID = questID
    stub.ShowPanel(panel)
    _G[panel]:Show()
    stub.FireEvent(event)
    stub.Advance(3)
end

local function Close()
    world.questID = 0
    stub.ShowPanel(nil)
    stub.FireEvent("QUEST_FINISHED")
    stub.Advance(10)
    _G.Spoken:StopAll()
end

for _, client in ipairs({ "11509", "1.12" }) do
    local VO, played = Boot(client)
    local button = VO.DialogPlayButton.button

    Expect(client .. ": autoplay is on by default", VO.Addon.db.profile.Audio.Autoplay, true)

    Open(101, "QuestFrameDetailPanel", "QUEST_DETAIL")
    Expect(client .. ": autoplay on, an offer reads itself", Played(played), "101-accept")
    Expect(client .. ": autoplay on, the dialog has no Play button", button:IsShown(), false)
    Close()

    VO.Addon:SetAutoplay(false)

    Open(101, "QuestFrameDetailPanel", "QUEST_DETAIL")
    Expect(client .. ": autoplay off, an offer reads nothing", Played(played), "(nothing)")
    Expect(client .. ": autoplay off, the dialog shows Play", button:IsShown(), true)
    Expect(client .. ": ...labelled Listen", button:GetText(), "Listen")

    button:Click()
    stub.Advance(0.2)
    Expect(client .. ": Play reads the offer", Played(played), "101-accept")
    Expect(client .. ": ...and the button becomes Stop", button:GetText(), "Stop")

    button:Click()
    stub.Advance(0.2)
    Expect(client .. ": Stop stops it", _G.Spoken:GetCurrent() == nil, true)
    Expect(client .. ": ...and the button is Listen again", button:GetText(), "Listen")
    Close()
    Expect(client .. ": closing the dialog hides the button", button:IsShown(), false)

    -- The quest window's back button turns the offer into the giver's greeting, in the same
    -- window, which stays open: the greeting is the gossip module's.
    Open(101, "QuestFrameDetailPanel", "QUEST_DETAIL")
    Expect(client .. ": autoplay off, the offer shows Listen", button:IsShown(), true)
    world.questID = 0
    stub.ShowPanel("QuestFrameGreetingPanel")
    stub.FireEvent("QUEST_GREETING")
    stub.Advance(1)
    Expect(client .. ": ...and going back to the greeting takes it off", button:IsShown(), false)
    Close()

    Open(101, "QuestFrameRewardPanel", "QUEST_COMPLETE")
    Expect(client .. ": autoplay off, a turn-in reads nothing", Played(played), "(nothing)")
    button:Click()
    stub.Advance(0.2)
    Expect(client .. ": Play on a turn-in reads complete", Played(played), "101-complete")
    Close()

    -- No line in the pack for this quest: nothing to play, so no button to press.
    Open(202, "QuestFrameDetailPanel", "QUEST_DETAIL")
    Expect(client .. ": a quest with no line shows no Play button", button:IsShown(), false)
    Close()

    -- An auto-accept addon closes the dialog in the frame it opened. The snapshot that
    -- replays it is automatic playback too, and must be held back with the rest.
    if client == "11509" then
        world.questID = 101
        stub.FireEvent("QUEST_DETAIL")
        world.questID = 0
        stub.FireEvent("QUEST_FINISHED")
        stub.Advance(3)
        Expect(client .. ": autoplay off, an auto-accepted quest reads nothing", Played(played), "(nothing)")
    end
end

if failures > 0 then
    print(string.format("\n%d scenario(s) failed", failures))
    os.exit(1)
end
print("\nall scenarios passed")
