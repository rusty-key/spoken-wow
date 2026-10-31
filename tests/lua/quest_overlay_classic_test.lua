-- Era's named quest log is redrawn through QuestLog_Update. Leatrix Plus hooks it after Spoken
-- and rewrites the title rows, which must not put Play over the title's first glyphs.
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
-- A button's text is its font string's, as in the client.
function row:SetText(text) QuestLogTitle1NormalText:SetText(text) end
_G.GetNumQuestLogEntries = function() return 1, 1 end
_G.GetQuestLogTitle = function(index)
    if index == 1 then return "A Classic Quest", 10, nil, false, false, false, 0, 748 end
end
_G.QuestLog_Update = function() end

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

-- Leatrix's own hook is installed after Spoken's normal hook.
hooksecurefunc("QuestLog_Update", function()
    QuestLogTitle1:SetText("  [10] A Classic Quest")
end)
QuestLog_Update()

local button = VO.QuestOverlayUI.questPlayButtons[748]
Expect("Era quest keeps its Play button", button ~= nil and button:IsShown(), true)
Expect("Era quest Play button is enabled", button and button:IsEnabled(), true)
Expect("Era quest Play button sits at the title's start, clear of the party count",
    button and button.anchor and button.anchor.relativeTo, QuestLogTitle1NormalText)
Expect("Leatrix's rewritten title still makes room for Play", QuestLogTitle1NormalText:GetText(), "    [10] A Classic Quest")

QuestLog_Update()
Expect("a second redraw pads the title once", QuestLogTitle1NormalText:GetText(), "    [10] A Classic Quest")

if failures > 0 then
    print(string.format("\n%d check(s) failed", failures))
    os.exit(1)
end
print("\nall checks passed")
