-- Gossip's settings page: nested under Spoken's beside the other parts', laid out by Spoken's
-- UI/Layout.lua, with its own switch above everything. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
stub.settingsCategories = {}; stub.ldbObjects = {}; stub.dbIcons = {}
stub.world.questID = 0; stub.ShowPanel(nil)
_G.SpokenQuestsSettings = nil
-- Installed: the Gossip pack, and Alliance's, which holds no gossip.
stub.SetAddOns({
    { folder = "SpokenQuestsAudioGossip", meta = { ["X-VoiceOver-DataModule-Version"] = "1", Version = "2.2.0",
        Title = "Spoken Audio: Gossip" } },
    { folder = "SpokenQuestsAudioAlliance", meta = { ["X-VoiceOver-DataModule-Version"] = "1", Version = "2.2.0",
        Title = "Spoken Audio: Quests - Alliance" } },
})
local VO = stub.LoadQuests(QUESTS, SPOKEN)
VO.Addon:OnInitialize()
_G.SpokenEnv.Addon:Enable()
local QuestsPanel = stub.LoadQuestsPanel(QUESTS, VO)
QuestsPanel:Setup()
local Panel = VO.GossipSettingsPanel
Panel:Setup()
local L, Spoken = VO.L, _G.Spoken
local W = Spoken:Words()

Expect("the page is registered", Panel.page and Panel.page.category ~= nil, true)
local mine = 0
for _, registered in ipairs(stub.settingsCategories) do
    if registered.name == L.OPT_GOSSIP_PAGE_TITLE then mine = mine + 1 end
end
Expect("...as one entry named for the part", mine, 1)
Expect("...nested under Spoken's", Panel.page.category.parent and Panel.page.category.parent.name, "Spoken")

local content = Panel.panel.content
local headings, buttons, boxes = {}, {}, {}
for _, child in ipairs(content.children) do
    if child.layoutHeading then
        table.insert(headings, child.text)
    elseif type(child.text) == "string" and child.text ~= "" and child.scripts and child.scripts.OnClick then
        table.insert(buttons, child)
    elseif type(child.text) == "table" and child.text.text then
        boxes[child.text.text] = child
    end
end
Expect("the sections are When to Read and Reading History", table.concat(headings, "|"),
    W.MODULE_WHEN .. "|" .. W.MODULE_HISTORY)
-- Voice packs, the test line and Report a Problem are on the Quests page and Spoken's, for every part.
Expect("no voice pack rows and no test line on this page", #buttons, 1)

---------------------------------------------------------------- the part's own switch
local switch = boxes[W.MODULE_SWITCH]
Expect("the page opens with the part's switch", switch ~= nil, true)
Expect("...on, as the part is", switch:GetChecked(), true)
local greetings
for _, child in ipairs(content.children) do
    if child.dropdownInit and child.layoutLabel and child.layoutLabel.text == L.OPT_PANEL_GREETINGS then greetings = child end
end
Expect("the rows under it are live", greetings.dropdownDisabled or false, false)
switch:SetChecked(false)
switch:GetScript("OnClick")(switch)
Expect("clicking it turns the part off for Spoken", Spoken:IsPartOn("gossip"), false)
Expect("...and leaves the quests part on", Spoken:IsPartOn("quests"), true)
Panel.panel.layout:Refresh()
Expect("...greying what is under it, saying why", greetings.layoutReason, W.REASON_PART_OFF)
Expect("...but not the switch itself", switch.layoutReason, nil)
switch:SetChecked(true)
switch:GetScript("OnClick")(switch)
Expect("turning it on again makes the part read", Spoken:IsPartOn("gossip"), true)

---------------------------------------------------------------- shared rows on the Quests page
-- Read Automatically and Stop When Window Closes cover the Gossip window too, so the Quests page
-- keeps them live while Gossip is on, whatever Quests is.
local function QuestsRow(text)
    for _, child in ipairs(QuestsPanel.panel.content.children) do
        if type(child.text) == "table" and child.text.text == text then return child end
    end
end
local autoplayRow, stopRow, followupRow = QuestsRow(L.OPT_PANEL_AUTOPLAY), QuestsRow(L.OPT_PANEL_STOP_ON_CLOSE),
    QuestsRow(L.OPT_PANEL_FOLLOWUP)
Spoken:SetPartOn("quests", false)
QuestsPanel.panel.layout:Refresh()
Expect("with Quests off and Gossip on, Read Automatically stays live", autoplayRow.layoutReason, nil)
Expect("...and so does Stop When Window Closes", stopRow.layoutReason, nil)
Expect("...while quest-only rows grey", followupRow.layoutReason ~= nil, true)
Spoken:SetPartOn("gossip", false)
QuestsPanel.panel.layout:Refresh()
Expect("with both off, Read Automatically greys too", autoplayRow.layoutReason, W.REASON_PART_OFF)
Spoken:SetPartOn("gossip", true)
Spoken:SetPartOn("quests", true)
QuestsPanel.panel.layout:Refresh()

---------------------------------------------------------------- forgetting greetings
local db = VO.Addon.db
db.char.hasSeenGossipForNPC = { ["Creature-0-0-0-0-12345-0"] = true }
local forget
for _, button in ipairs(buttons) do if button.text == L.OPT_FORGET_GREETINGS then forget = button end end
Expect("Forget Greetings Heard is a button", forget ~= nil, true)
-- It only matters while a greeting is read once.
stub.PickDropdown(greetings, "Every Time"); Panel.panel.layout:Refresh()
Expect("...greyed while every greeting is read each time, saying why", forget.layoutReason, L.REASON_FORGET_GREETINGS)
stub.PickDropdown(greetings, "Once per Greeting"); Panel.panel.layout:Refresh()
Expect("...and live with a greeting read once", forget.layoutReason, nil)
forget.scripts.OnClick(forget)
Expect("...which clears this character's greetings heard", next(db.char.hasSeenGossipForNPC), nil)

---------------------------------------------------------------- the packs that hold gossip
Expect("the part lists the packs that hold gossip, not Alliance's", table.concat(Spoken:GetSource("gossip").packs(), "|"),
    "Spoken Audio: Gossip")
Expect("the minimap menu heads its entries with the page's name", Spoken:GetSource("gossip").title, L.OPT_GOSSIP_PAGE_TITLE)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll gossip page tests passed")
