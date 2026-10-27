-- The optional tracker adapters: Classic Era's WatchFrame and Questie's pooled tracker lines.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local Expect, Failures = H.Expecter(print)
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local SPOKEN = here .. "/../../addons/Spoken/"

stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
stub.SetModernQuestLog({ { questID = 748, title = "Poison Water", level = 8 } })

-- A minimal Classic watch frame. The real client supplies these globals through WatchFrame.xml.
_G.QuestWatchFrame = CreateFrame("Frame", "QuestWatchFrame")
_G.QuestWatchLine1 = QuestWatchFrame:CreateFontString("QuestWatchLine1")
_G.MAX_QUESTWATCH_LINES = 50
_G.GetNumQuestWatches = function() return 1 end
_G.GetQuestIndexForWatch = function() return 1 end
_G.GetQuestLogTitle = function() return "Poison Water", nil, nil, nil, nil, nil, nil, 748 end
_G.QuestWatch_Update = function()
    QuestWatchLine1:SetText("Poison Water")
    QuestWatchLine1:Show()
end

-- Questie exposes its tracker modules only through QuestieLoader.
local questieLines = {}
local questiePool = {
    UpdateQuestTitleLines = function(callback)
        for _, line in ipairs(questieLines) do
            if line.mode == "quest" then callback(line) end
        end
    end,
}
local questieTracker = { Update = function() end }
_G.QuestieLoader = {
    ImportModule = function(self, name)
        return name == "TrackerLinePool" and questiePool or name == "QuestieTracker" and questieTracker
    end,
}

local VO = stub.LoadQuestsOverlay(QUESTS, SPOKEN)
VO.Addon:OnInitialize()
VO.DataModules:Register("TestPack", {
    SoundLengthLookupByFileName = { ["748-accept"] = 1, ["749-accept"] = 1 },
    GetSoundPath = function(_, fileName) return fileName .. ".ogg" end,
})
stub.Advance(2)

QuestWatch_Update()
Expect("the Era tracker adapter is installed", VO.QuestOverlayUI.legacyTrackerPlayButtons ~= nil, true)
Expect("the watch title was drawn", QuestWatchLine1:GetText(), "Poison Water")
local classicButton = VO.QuestOverlayUI.legacyTrackerPlayButtons[748]
Expect("the Era watch frame gets a Play button", classicButton and classicButton:IsShown(), true)
Expect("the Era Play button is 18 pixels square", classicButton:GetWidth(), 18)

_G.Questie_BaseFrame = CreateFrame("Frame", nil, UIParent)
local line = CreateFrame("Button", nil, _G.Questie_BaseFrame)
line.Quest = { Id = 748 }
line.mode = "quest"
line.label = line:CreateFontString()
line.playButton = CreateFrame("Button", nil, line)
line.expandQuest = CreateFrame("Button", nil, line)
table.insert(questieLines, line)
questieTracker:Update()
Expect("Questie's title line gets a separate Spoken Play button", line.spokenPlayButton:IsShown(), true)
Expect("Questie's button is bound to the quest", line.spokenPlayButton.questID, 748)
local _, anchor, anchorPoint = line.spokenPlayButton:GetPoint()
Expect("Questie's Play button is left of minimize", anchor, line.expandQuest)
Expect("...anchored to minimize's left edge", anchorPoint, "LEFT")
local _, _, _, xOffset = line.spokenPlayButton:GetPoint()
Expect("...sits right next to minimize", xOffset, -1)
Expect("...is slightly smaller", line.spokenPlayButton:GetWidth(), 18)

line.spokenPlayButton.soundData = { questID = 748 }
line.Quest = { Id = 749 }
questieTracker:Update()
Expect("a Questie line reused for another quest drops the old quest's clip", line.spokenPlayButton.soundData, nil)
line.Quest = { Id = 748 }
questieTracker:Update()

line.mode = "objective"
questieTracker:Update()
Expect("a reused Questie objective line hides its old Play button", line.spokenPlayButton:IsShown(), false)

QuestWatchLine1:Hide()
VO.QuestOverlayUI.UpdateTrackerButtons()
Expect("an Era title on a hidden line loses its Play button", classicButton:IsShown(), false)
QuestWatch_Update()
Expect("...and gets it back once the line is drawn", classicButton:IsShown(), true)

local realPrepare = VO.DataModules.PrepareSound
VO.DataModules.PrepareSound = function() error("adapter boom") end
local raised = not pcall(QuestWatch_Update)
VO.DataModules.PrepareSound = realPrepare
Expect("an adapter failure is not raised inside the tracker's update", raised, false)

VO.Addon.db.profile.TrackerPlayButton = false
VO.QuestOverlayUI.UpdateTrackerButtons()
Expect("turning Tracker off hides the Era button", classicButton:IsShown(), false)
Expect("...and hides Questie's button", line.spokenPlayButton:IsShown(), false)

if Failures() > 0 then os.exit(1) end
print("\nAll quest tracker adapter tests passed")
