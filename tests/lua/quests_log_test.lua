-- Spoken Quests in the debug log (Debug.lua): each quest window it saw and what it decided,
-- including why a line did not play; its diagnostics, as lines, for the copies; and Mock Missing
-- Voice Over on the Developer page. With the Spoken_Developer module loaded, its log on.
-- Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local Expect, Failures = H.Expecter(print)

_G.UISpecialFrames = _G.UISpecialFrames or {}
stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers()
local VO = stub.LoadQuests(here .. "/../../addons/Spoken_Quests/", here .. "/../../addons/Spoken/")
local Spoken = _G.Spoken
local Dev = stub.LoadDeveloper(here .. "/../../addons/Spoken_Developer/")
stub.FireEvent("PLAYER_ENTERING_WORLD")
local world = stub.world

VO.Addon:OnInitialize()
VO.DataModules:Register("TestPack", {
    SoundLengthLookupByFileName = { ["101-accept"] = 1 },
    GetSoundPath = function(_, fileName) return fileName .. ".ogg" end,
})
world.title = "Kobold Camp Cleanup"
world.questText = "Go and do the thing."
stub.Advance(2)
Spoken:SetLogOn(true)

local function Has(text)
    for _, line in ipairs(Spoken:LogLines()) do
        if line:find(text, 1, true) then return true end
    end
    return false
end
local function Open(questID)
    world.questID = questID
    stub.ShowPanel("QuestFrameDetailPanel")
    stub.FireEvent("QUEST_DETAIL")
    stub.Advance(3)
end
local function Close()
    world.questID = 0
    stub.ShowPanel(nil)
    stub.FireEvent("QUEST_FINISHED")
    stub.Advance(10)
end

---------------------------------------------------------------- a voiced quest
Open(101)
Expect("a quest window opening is in the log", Has("quests quest-detail: "), true)
Expect("...and the line it queued", Has("quests queued: "), true)
Expect("...as Spoken saw it", Has("player queued 101-accept [quests]"), true)
Expect("...saying which screen it came from", Has("101-accept.ogg), from the NPC's quest window (the offer), read automatically ("), true)
Close()

---------------------------------------------------------------- asked for by hand
VO.Player:PlayNow({ event = VO.Enums.SoundEvent.QuestAccept, questID = 101, title = "By hand",
    origin = "the quest log's Play button" })
Expect("a line asked for by a button says which", Has("101-accept.ogg), from the quest log's Play button"), true)
local described = false
for _, line in ipairs(Spoken:Diagnostics(true)) do
    if line:find("from the quest log's Play button", 1, true) and line:find("queue 1: ", 1, true) then described = true end
end
Expect("...and so does the snapshot's queue", described, true)
Spoken:StopAll()
stub.Advance(20)

---------------------------------------------------------------- a quest no pack has
Open(102)
Expect("a quest no pack has says so", Has("quests data-lookup-failed: "), true)
Expect("...and why", Has("no pack loaded has 102-accept"), true)
Close()

---------------------------------------------------------------- autoplay off
VO.Addon.db.profile.Audio.Autoplay = false
Open(101)
Expect("with Read Automatically off, the quest opened is noted", Has("quest 101 open, not read: Read Automatically is off"), true)
Close()
VO.Addon.db.profile.Audio.Autoplay = true

---------------------------------------------------------------- Mock Missing Voice Over
Expect("the Developer page has Spoken Quests' section", #Spoken:GetDeveloperSettings() >= 1, true)
local mockRow
for _, item in ipairs(Dev.optionsPanel.layout.items) do
    if item.kind == "section" then
        for _, row in ipairs(item.rows) do
            local control = row.control
            local text = control and control.layoutLabel and control.layoutLabel.text or control and control.text
            if text == VO.L.OPT_DEV_MOCK_MISSING then mockRow = row end
        end
    end
end
Expect("...with Mock Missing Voice Over", mockRow ~= nil, true)
Expect("mocking is off at first", VO.Debug:IsMockingMissingVoice(), false)
VO.Addon.db.profile.Developer = { MockMissingVoice = true }
local found, why = VO.DataModules:PrepareSound({ event = VO.Enums.SoundEvent.QuestAccept, questID = 101 })
Expect("mocked, a voiced quest is answered as missing", found, false)
Expect("...saying why", why ~= nil and why:find("Mock Missing Voice Over", 1, true) ~= nil, true)
Open(101)
Expect("...and the log says so for the quest opened", Has("Mock Missing Voice Over is on"), true)
Close()
VO.Addon.db.profile.Developer.MockMissingVoice = false
Expect("turned off, the quest is voiced again", (VO.DataModules:PrepareSound({ event = VO.Enums.SoundEvent.QuestAccept, questID = 101 })), true)

---------------------------------------------------------------- its diagnostics, as lines
-- The loader stands Options in for the real one, which needs AceConfig; this prints as the real
-- PrintDiagnostics does, from Spoken Quests' environment and with a colour code, which is what
-- the capture has to deal with.
local PrintDiagnostics = assert(loadstring([[
    print(format("|cFF00CCFFSpoken Quests %s|r - client test", AddonVersion))
    print("Data modules: 1 detected, 1 loaded")
]]))
setfenv(PrintDiagnostics, VO)
VO.Options.PrintDiagnostics = PrintDiagnostics
local lines = Spoken:Diagnostics(true)
local function In(text)
    for _, line in ipairs(lines) do if line:find(text, 1, true) then return true end end
    return false
end
Expect("Spoken's diagnostics carry Spoken Quests'", In("Spoken Quests:"), true)
Expect("...what /spq diagnostics says, without colour codes", In("  Spoken Quests " .. VO.AddonVersion), true)
Expect("...the packs", In("  Data modules: 1 detected, 1 loaded"), true)
Expect("...and with detail, the settings that decide", In("  read automatically on"), true)
Expect("...the last stage and its age", In("  last stage "), true)
Open(101)
lines = Spoken:Diagnostics(true)
Expect("...and the window open, with what it would read", In("would read 101-accept"), true)
Expect("...what the screen shows, read off the frames", In("  on screen: NPC quest frame shown, detail panel"), true)
Expect("...the quest log too", In("; quest log hidden; gossip frame hidden"), true)
Expect("...and the last window Spoken Quests read", In("  last window read, "), true)
Close()
-- A quest read in the quest log, no NPC: the title the details draw is put in the log, not the
-- NPC's frame, which shares the same title header.
stub.SetModernQuestLog({ { questID = 7, title = "Kobold Camp Cleanup", level = 2 } })
_G.QuestMapFrame:Show()
_G.QuestMapFrame.DetailsFrame:Show()
local header = CreateFrame("Frame", nil, _G.QuestMapFrame.DetailsFrame)
header:SetText("Kobold Camp Cleanup")
header:Show()
local QuestInfoTitleHeader = _G.QuestInfoTitleHeader
_G.QuestInfoTitleHeader = header
lines = Spoken:Diagnostics(true)
Expect("a quest in the quest log is said to be there",
    In([[  on screen: NPC quest frame hidden; quest log shown, a quest's details, quest "Kobold Camp Cleanup"]]), true)
_G.QuestInfoTitleHeader = QuestInfoTitleHeader
_G.QuestMapFrame:Hide()

-- Every Contribute button opens the debug log's menu on a right-click, as Report's do: one is up
-- exactly when a line did not play.
local menuFor
local ShowLogMenu = Spoken.ShowLogMenu
Spoken.ShowLogMenu = function(_, anchor) menuFor = anchor end
-- The stub loads the files the TOC lists for the oldest client; this one is loaded by hand, as
-- quests_contribute_test does.
dofile(here .. "/../../addons/Spoken/Dialogue/ContributeButton.lua")
local button = VO.ContributeButton:Setup()
Expect("the quest window's Contribute is hooked", button and button.offersLogMenu, true)
local function RightClick(b, mouse)
    for _, fn in ipairs(b.hooks and b.hooks.OnMouseUp or {}) do fn(b, mouse) end
end
RightClick(button, "LeftButton")
Expect("...a left click is left to Contribute", menuFor, nil)
RightClick(button, "RightButton")
Expect("...a right-click opens the menu on it", menuFor, button)
local row = CreateFrame("Button")
VO.Contribute:OfferLogMenu(row)
menuFor = nil
RightClick(row, "RightButton")
Expect("...as any button Contribute:OfferLogMenu is given", menuFor, row)
Spoken.ShowLogMenu = ShowLogMenu

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll Spoken Quests log tests passed")
