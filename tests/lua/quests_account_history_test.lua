-- Reading a quest's offer, progress and reward again on an alt is opt-in, never a change to
-- quest completion state. Remember only sounds that really began to play.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local SPOKEN = here .. "/../../addons/Spoken/"

stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()
stub.world.questID = 0; stub.ShowPanel(nil)
local VO = stub.LoadQuests(QUESTS, SPOKEN)
VO.Addon:OnInitialize()
local lookup = {}
for _, id in ipairs({ 101, 102, 103 }) do
    for _, moment in ipairs({ "accept", "progress", "complete" }) do
        lookup[id .. "-" .. moment] = 2
    end
end
VO.DataModules:Register("TestPack", {
    SoundLengthLookupByFileName = lookup,
    GetSoundPath = function(_, name) return name .. ".ogg" end,
})
stub.Advance(2)
stub.world.npcName, stub.world.npcGUID = "Quest giver", "Creature-0-0-0-0-1234-0"
stub.world.title, stub.world.questText = "A Quest", "A quest description."
stub.world.progressText, stub.world.rewardText = "Still working?", "Thank you!"
local A = VO.Addon
local S = _G.Spoken
local E = VO.Enums.SoundEvent
local global = A.db.global
global.heardQuestLines, global.SkipHeardQuestLines = nil, nil

stub.world.questID = 101
A:QUEST_DETAIL()
Expect("a first offer plays with the option off", S:GetCurrent() ~= nil, true)
Expect("a started offer is remembered", A:HasHeardQuestLine(E.QuestAccept, 101), true)
Expect("an offer is not a progress or reward read", A:HasHeardQuestLine(E.QuestProgress, 101), false)
Expect("...nor a different quest", A:HasHeardQuestLine(E.QuestAccept, 102), false)
S:StopAll()

global.SkipHeardQuestLines = true
-- A different character uses the same account-wide AceDB global, but would have its own char DB.
A.db.char = { hasSeenGossipForNPC = {}, ignoredGossipNPCs = {} }
A:QUEST_DETAIL()
Expect("an offer already read on this account does not autoplay", S:GetQueueSize(), 0)
Expect("the skipped read has its own diagnostic", VO.Debug.runtime.stage, "quest-heard")
-- The original NPC dialogue must not be muted if Spoken will suppress the quest's voice.
_G.SpokenEnv.Addon.db.profile.Audio.AutoToggleDialog = true
stub.ShowPanel("QuestFrameDetailPanel")
stub.FireEvent("QUEST_DETAIL")
Expect("a heard quest offer preserves the NPC's original greeting", GetCVar("Sound_EnableDialog"), "1")
stub.ShowPanel(nil)
stub.FireEvent("QUEST_FINISHED")
A:QUEST_DETAIL(nil, true)
Expect("manual replay still works", S:GetCurrent() ~= nil, true)
S:StopAll()

A:QUEST_PROGRESS()
Expect("progress that was never read still plays", S:GetCurrent() ~= nil, true)
Expect("progress is recorded separately", A:HasHeardQuestLine(E.QuestProgress, 101), true)
S:StopAll()
A:QUEST_COMPLETE()
Expect("completion that was never read still plays", S:GetCurrent() ~= nil, true)
Expect("completion is recorded separately", A:HasHeardQuestLine(E.QuestComplete, 101), true)
S:StopAll()
A:QUEST_PROGRESS()
Expect("a repeatable quest's progress does not replay automatically", S:GetQueueSize(), 0)
A:QUEST_COMPLETE()
Expect("a repeatable quest's reward does not replay automatically", S:GetQueueSize(), 0)

-- A waiting clip must not consume a quest before it starts. A rejected clip must not either.
global.SkipHeardQuestLines = false
stub.world.questID = 102
A:QUEST_DETAIL()
stub.world.questID = 103
A:QUEST_DETAIL()
Expect("a queued but unstarted offer is not heard", A:HasHeardQuestLine(E.QuestAccept, 103), false)
S:StopAll()
Expect("stopping the queue does not mark the dropped offer", A:HasHeardQuestLine(E.QuestAccept, 103), false)

if Failures() > 0 then stub.print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
stub.print("\nAll account quest history tests passed")
