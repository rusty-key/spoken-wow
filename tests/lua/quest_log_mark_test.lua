-- The mark beside a quest in the quest log that a voice pack reads: the old quest log, with its
-- numbered title rows, as Classic Era draws it. Its tooltip, a click on it, and the setting
-- that turns it off. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local Expect, Failures = H.Expecter(print)
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local SPOKEN = here .. "/../../addons/Spoken/"

_G.UISpecialFrames = _G.UISpecialFrames or {}
stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
stub.settingsCategories = {}; stub.ldbObjects = {}; stub.dbIcons = {}

-- The client's quest log: a header and three quests, one row each. 101 has its accept line in
-- the pack, 102 only its turn-in, 103 nothing at all.
local log = {
    { "Durotar", true },
    { "Kobold Camp Cleanup", false, 101 },
    { "Thazz'ril's Pick", false, 102 },
    { "Sarkoth", false, 103 },
}
_G.QUESTS_DISPLAYED = 4
_G.QuestLogFrame = CreateFrame("Frame", "QuestLogFrame")
_G.QuestLogListScrollFrame = CreateFrame("ScrollFrame", "QuestLogListScrollFrame")
_G.QuestLogDummyText = QuestLogFrame:CreateFontString()
function _G.FauxScrollFrame_GetOffset() return 0 end
function _G.GetNumQuestLogEntries() return table.getn(log), 3 end
function _G.GetQuestLogTitle(index)
    local entry = log[index]
    return entry[1], 10, nil, entry[2], false, false, 0, entry[3]
end
local selected
for i = 1, QUESTS_DISPLAYED do
    local row = CreateFrame("Button", "QuestLogTitle" .. i, QuestLogListScrollFrame)
    row:SetScript("OnClick", function() selected = i end)
    local text = row:CreateFontString("QuestLogTitle" .. i .. "NormalText")
    _G["QuestLogTitle" .. i .. "NormalText"] = text
    local check = row:CreateFontString("QuestLogTitle" .. i .. "Check")
    _G["QuestLogTitle" .. i .. "Check"] = check
end
local function Row(i) return _G["QuestLogTitle" .. i] end
local function Draw()
    for i, entry in ipairs(log) do _G["QuestLogTitle" .. i .. "NormalText"]:SetText(entry[1]) end
    QuestLogFrame:Show()
    VoiceOver.QuestOverlayUI:Update()
end

local VO = stub.LoadQuestsOverlay(QUESTS, SPOKEN)
VO.Addon:OnInitialize()
VO.DataModules:Register("TestPack", {
    SoundLengthLookupByFileName = { ["101-accept"] = 1, ["102-complete"] = 1 },
    GetSoundPath = function(_, fileName) return fileName .. ".ogg" end,
})
stub.Advance(2)

local UI = VO.QuestOverlayUI
local function MarkOn(i)
    local mark = UI.voicedMarks[Row(i)]
    return mark ~= nil and mark.shown == true
end

Draw()
Expect("a quest whose accept line a pack has is marked", MarkOn(2), true)
Expect("...so is one with only its turn-in", MarkOn(3), true)
Expect("a quest no pack reads is not", MarkOn(4), false)
Expect("nor is a header", MarkOn(1), false)

local mark = UI.voicedMarks[Row(2)]
Expect("the mark sits after the title's tracking check", mark.anchor and mark.anchor.relativeTo,
    _G.QuestLogTitle2Check)
mark.scripts.OnEnter(mark)
Expect("its tooltip says a voice pack reads the quest", GameTooltip.text, VO.L.OPT_VOICED_MARK_TIP)
Expect("...in English, the base strings", VO.L.OPT_VOICED_MARK_TIP, "A voice pack reads this quest aloud.")
mark:Click()
Expect("a click on the mark selects its quest, as a click on the title does", selected, 2)

-- A row scrolled to another quest leaves no mark behind.
log[2], log[4] = log[4], log[2]
Draw()
Expect("a row that now shows an unvoiced quest has its mark hidden", MarkOn(2), false)
Expect("...and the voiced quest's new row has it", MarkOn(4), true)

-- The setting, on the Quests page, on by default.
local QuestsPanel = stub.LoadQuestsPanel(QUESTS, VO)
QuestsPanel:Setup()
local layout = _G.SpokenQuestsOptionsPanel.layout
local box
for _, entry in ipairs(layout.entries) do
    if entry.label == VO.L.OPT_PANEL_VOICED_MARK then box = entry.frame end
end
Expect("Mark Voiced Quests is on the Quests page", box ~= nil, true)
Expect("...ticked by default", box and box:GetChecked(), true)
box:SetChecked(false)
box.scripts.OnClick(box)
Expect("unticking it turns the setting off", VO.Addon.db.profile.QuestLogMark, false)
Expect("...and takes the marks off the open log at once", MarkOn(4) or MarkOn(3), false)
box:SetChecked(true)
box.scripts.OnClick(box)
Expect("ticking it brings them back", MarkOn(4) and MarkOn(3), true)

-- The player's switch for this part takes the marks with the Play buttons.
_G.Spoken:SetPartOn("quests", false)
Draw()
Expect("with the module switched off, nothing is marked", MarkOn(3) or MarkOn(4), false)
_G.Spoken:SetPartOn("quests", true)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll quest log mark tests passed")
