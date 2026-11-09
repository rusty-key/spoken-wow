-- The Classic Era WatchFrame tracker adapter.
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
local classicButton = VO.QuestOverlayUI.legacyTrackerPlayButtons[748]
Expect("the Era watch frame gets a Play button", classicButton and classicButton:IsShown(), true)
Expect("the Era Play button is 18 pixels square", classicButton:GetWidth(), 18)

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

if Failures() > 0 then os.exit(1) end
print("\nAll quest tracker adapter tests passed")
