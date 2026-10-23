-- Era's named quest log is redrawn through QuestLog_Update.  Leatrix Plus adds its own hook to
-- that function and rewrites the title rows, so Spoken must refresh after Leatrix has finished.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local print = stub.print
stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()

_G.QuestLogFrame = CreateFrame("Frame", "QuestLogFrame")
QuestLogFrame:Show()
_G.QuestLogListScrollFrame = CreateFrame("ScrollFrame", "QuestLogListScrollFrame", QuestLogFrame)
_G.QuestLogDummyText = QuestLogFrame:CreateFontString("QuestLogDummyText")
_G.QUESTS_DISPLAYED = 1
_G.FauxScrollFrame_GetOffset = function() return 0 end

local row = CreateFrame("Button", "QuestLogTitle1", QuestLogFrame)
_G.QuestLogTitle1NormalText = row:CreateFontString("QuestLogTitle1NormalText")
_G.QuestLogTitle1Check = row:CreateTexture("QuestLogTitle1Check")
_G.GetNumQuestLogEntries = function() return 1, 1 end
_G.GetQuestLogTitle = function(index)
    if index == 1 then return "A Classic Quest", 10, nil, false, false, false, 0, 748 end
end
_G.QuestLog_Update = function() end

-- Simulate Leatrix being loaded while its QuestLog_Update hook is installed after Spoken's normal
-- hook.  The compatibility hook is deliberately deferred, matching the live addon load order.
_G.IsAddOnLoaded = function(name) return name == "Leatrix_Plus" end

local VO = stub.LoadQuestsOverlay(here .. "/../../addons/Spoken_Quests/", here .. "/../../addons/Spoken/")
local Spoken = _G.Spoken
local failures = 0
local function Expect(what, actual, expected)
    if actual == expected then
        print(string.format("ok   %s\n     %s", what, tostring(actual)))
    else
        failures = failures + 1
        print(string.format("FAIL %s\n     expected: %s\n     actual:   %s", what, tostring(expected), tostring(actual)))
    end
end

VO.Addon:OnInitialize()
VO.DataModules:Register("TestPack", {
    SoundLengthLookupByFileName = { ["748-accept"] = 1 },
    NPCIDLookupByQuestID = { [748] = 2948 },
    NPCNameLookupByNPCID = { [2948] = "Mull Thunderhorn" },
    GetSoundPath = function(_, fileName) return fileName .. ".ogg" end,
})
stub.Advance(2)

local updates = 0
local update = VO.QuestOverlayUI.Update
VO.QuestOverlayUI.Update = function(self, ...)
    updates = updates + 1
    return update(self, ...)
end

-- Leatrix's own hook is installed after Spoken's normal hook.
hooksecurefunc("QuestLog_Update", function()
    QuestLogTitle1NormalText:SetText("  [10] A Classic Quest")
end)
-- Run the deferred compatibility hook after Leatrix's hook exists.
stub.Advance(0.1)
QuestLog_Update()

Expect("Leatrix's title rewrite is followed by a Spoken refresh", updates, 2)
local button = VO.QuestOverlayUI.questPlayButtons[748]
Expect("Era quest keeps its Play button", button ~= nil and button:IsShown(), true)
Expect("Era quest Play button is enabled", button and button:IsEnabled(), true)
Expect("Era quest Play button sits in the left margin", button and button.anchor and button.anchor.relativeTo, row)
Expect("...at the row's left edge", button and button.anchor and button.anchor.point, "LEFT")
Expect("the quest title keeps its original indentation", QuestLogTitle1NormalText:GetText(), "  [10] A Classic Quest")

if failures > 0 then
    print(string.format("\n%d check(s) failed", failures))
    os.exit(1)
end
print("\nall checks passed")
