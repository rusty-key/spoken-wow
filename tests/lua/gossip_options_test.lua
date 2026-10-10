-- The gossip module's settings page: nested under Spoken's beside the other modules', laid out by
-- the UI/Layout.lua every Spoken addon carries. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local GOSSIP = here .. "/../../addons/Spoken_Gossip/"
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
stub.settingsCategories = {}; stub.ldbObjects = {}; stub.dbIcons = {}
stub.world.questID = 0; stub.ShowPanel(nil)
_G.SpokenGossipSettings = nil
-- Installed: the Gossip pack, and Alliance's, which holds no gossip.
stub.SetAddOns({
    { folder = "SpokenQuestsAudioGossip", meta = { ["X-VoiceOver-DataModule-Version"] = "1", Version = "2.2.0",
        Title = "Spoken Quests Audio: Gossip" } },
    { folder = "SpokenQuestsAudioAlliance", meta = { ["X-VoiceOver-DataModule-Version"] = "1", Version = "2.2.0",
        Title = "Spoken Quests Audio: Alliance" } },
})
local G = stub.LoadGossip(GOSSIP, SPOKEN)
G.Addon:OnInitialize()
_G.SpokenEnv.Addon:Enable()
local SettingsPanel = stub.LoadGossipPanel(GOSSIP, G)
SettingsPanel:Setup()
local L = G.L

Expect("the page is registered", SettingsPanel.page and SettingsPanel.page.category ~= nil, true)
local mine = 0
for _, registered in ipairs(stub.settingsCategories) do
    if registered.name == "Gossip" then mine = mine + 1 end
end
Expect("...as an entry named Gossip", mine, 1)
Expect("...nested under Spoken's", SettingsPanel.page.category.parent and SettingsPanel.page.category.parent.name, "Spoken")

local content = SettingsPanel.panel.content
local headings, buttons = {}, {}
for _, child in ipairs(content.children) do
    if child.layoutHeading then
        table.insert(headings, child.text)
    elseif type(child.text) == "string" and child.text ~= "" and child.scripts and child.scripts.OnClick then
        table.insert(buttons, child)
    end
end
Expect("every section is there", table.concat(headings, "|"), "When to Read|Extras|Reading History|Voice Packs|Fix a Problem")
local function Button(text)
    for _, button in ipairs(buttons) do if button.text == text then return button end end
end
Expect("Fix a Problem has the same buttons as every module's page",
    Button(L.OPT_TEST_LINE) ~= nil and Button(L.OPT_PRINT_DIAG) ~= nil and Button(L.OPT_REPORT_PROBLEM) ~= nil, true)

---------------------------------------------------------------- NPC Greetings
local db = G.Addon.db.profile
local greetings
for _, child in ipairs(content.children) do
    if child.dropdownInit and child.layoutLabel and child.layoutLabel.text == L.OPT_PANEL_GREETINGS then
        greetings = child
    end
end
Expect("NPC Greetings is a dropdown", greetings ~= nil, true)
greetings:GetScript("OnShow")(greetings)
Expect("...showing Once per NPC to start with", greetings.dropdownText, L.OPT_GREETING_LABEL_ONCE_NPC)
local offered = {}
for _, entry in ipairs(stub.OpenDropdown(greetings)) do table.insert(offered, entry.text) end
Expect("...offering every choice at once", table.concat(offered, "|"),
    "Every Time|Once per NPC with Quests|Once per NPC|Never")
-- Live whatever the quests module's autoplay is: this page has no autoplay to grey it.
Expect("...live, with no switch above it to grey it", greetings.dropdownDisabled or false, false)
Expect("picking Never is possible", stub.PickDropdown(greetings, "Never"), true)
Expect("...and stores the number the addon reads", db.Audio.GossipFrequency, G.Enums.GossipFrequency.Never)
Expect("...which the Listen button follows", G.Addon:IsNever(), true)
stub.PickDropdown(greetings, "Once per NPC")

---------------------------------------------------------------- forgetting greetings
G.Addon.db.char.hasSeenGossipForNPC = { ["Creature-0-0-0-0-12345-0"] = true }
local forget
for _, button in ipairs(buttons) do if button.text == L.OPT_FORGET_GREETINGS then forget = button end end
Expect("Forget Greetings Heard is a button", forget ~= nil, true)
forget.scripts.OnClick(forget)
Expect("...which clears this character's greetings heard", next(G.Addon.db.char.hasSeenGossipForNPC), nil)

---------------------------------------------------------------- the packs that hold gossip
local rows = {}
for _, item in ipairs(SettingsPanel.panel.layout.items) do
    if item.kind == "section" and item.text == L.OPT_SECTION_PACKS then
        for _, row in ipairs(item.rows) do
            local caption = row.regions and row.regions[4]
            if row.shown and caption and caption.text then table.insert(rows, caption.text) end
        end
    end
end
local function Name(label) return (L.OPT_PACK_NAME_FMT:gsub("%%1%$s", label)) end
Expect("the packs offered are those that hold gossip: All, and the Gossip pack",
    table.concat(rows, "|"), Name(L.OPT_PACK_ALL) .. "|" .. Name(L.OPT_PACK_GOSSIP))
Expect("...the card counts only the installed one that does", _G.Spoken:PartStatus("gossip") ~= nil, true)
local packs = _G.Spoken:GetSource("gossip").packs()
Expect("...Alliance's not among them", table.concat(packs, "|"), "Spoken Quests Audio: Gossip")

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll gossip options tests passed")
