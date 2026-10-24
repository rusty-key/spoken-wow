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

-- Questie exposes its current title lines through this module, but not the module itself globally.
local questieLines = {}
local questiePool = {
    active = questieLines,
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
    SoundLengthLookupByFileName = { ["748-accept"] = 1 },
    GetSoundPath = function(_, fileName) return fileName .. ".ogg" end,
})
stub.Advance(2)

QuestWatch_Update()
Expect("the Era tracker adapter is installed", VO.QuestOverlayUI.legacyTrackerPlayButtons ~= nil, true)
Expect("the watch title was drawn", QuestWatchLine1:GetText(), "Poison Water")
Expect("the watch quest is available", GetQuestIndexForWatch(1), 1)
Expect("the watch log title is available", select(1, GetQuestLogTitle(1)), "Poison Water")
Expect("the watch log quest id is available", select(8, GetQuestLogTitle(1)), 748)
local classicButton
classicButton = VO.QuestOverlayUI.legacyTrackerPlayButtons[748]
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

line.mode = "objective"
questieTracker:Update()
Expect("a reused Questie objective line hides its old Play button", line.spokenPlayButton:IsShown(), false)

VO.Addon.db.profile.TrackerPlayButton = false
VO.QuestOverlayUI.UpdateTrackerButtons()
Expect("turning Tracker off hides the Era button", classicButton:IsShown(), false)
Expect("...and hides Questie's button", line.spokenPlayButton:IsShown(), false)

if Failures() > 0 then os.exit(1) end
print("\nAll quest tracker adapter tests passed")
