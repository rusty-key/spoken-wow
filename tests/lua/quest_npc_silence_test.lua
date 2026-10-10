-- Silence NPC Voices: only an NPC whose greeting a pack reads is silenced as its window opens;
-- a quest-giver no pack voices keeps its own greeting. A quest window
-- whose quest is not known yet is silenced at once. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local SPOKEN = here .. "/../../addons/Spoken/"

stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
_G.SpokenQuestsSettings = nil
local VO = stub.LoadQuests(QUESTS, SPOKEN)
VO.Addon:OnInitialize()
VO.DataModules:Register("TestPack", {
    SoundLengthLookupByFileName = {},
    GetSoundPath = function(_, fileName) return fileName .. ".ogg" end,
})
stub.Advance(2)
_G.SpokenEnv.Addon.db.profile.Audio.AutoToggleDialog = true
_G.SpokenEnv.Addon.db.profile.Audio.SoundChannel = "Master"
stub.world.npcName, stub.world.npcGUID = "Marshal", "Creature-0-0-0-0-12345-0"

local quests = { available = 0, active = 0 }
_G.GetNumGossipAvailableQuests = function() return quests.available end
_G.GetNumGossipActiveQuests = function() return quests.active end
_G.GetNumAvailableQuests = function() return quests.available end
_G.GetNumActiveQuests = function() return quests.active end

local function Open(event)
    stub.ShowGossip("Well met.")
    stub.FireEvent(event)
    -- Read in the same frame the window opened: before anything has had time to play.
    return GetCVar("Sound_EnableDialog")
end
local function Close()
    stub.HidePanels()
    stub.FireEvent("GOSSIP_CLOSED")
    stub.Advance(3)
    _G.Spoken:StopAll()
end

quests.available = 1
Expect("a quest-giver no pack voices keeps its greeting", Open("GOSSIP_SHOW"), "1")
Close()

quests.available, quests.active = 0, 1
Expect("...so does one with a quest to take back", Open("GOSSIP_SHOW"), "1")
Close()

Expect("...and one whose greeting window lists quests", Open("QUEST_GREETING"), "1")
Close()

-- A quest window whose quest cannot be told yet (no ID this early) mutes all the same, and the
-- mute lifts itself with no line coming.
stub.world.questID = 0
stub.ShowPanel("QuestFrameDetailPanel")
stub.FireEvent("QUEST_DETAIL")
Expect("a quest window with no quest known yet mutes the NPC at once", GetCVar("Sound_EnableDialog"), "0")
stub.Advance(2)
Expect("...and gives its voice back when no line comes", GetCVar("Sound_EnableDialog"), "1")
stub.ShowPanel(nil)
stub.FireEvent("QUEST_FINISHED")

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll quest NPC silence tests passed")
