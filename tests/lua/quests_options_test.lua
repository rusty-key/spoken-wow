-- The quests addon's settings panel: sections on one canvas, laid out by the UI/Layout.lua
-- every Spoken addon carries, rather than a Blizzard category per group of an AceConfig
-- tree. The tree itself is untouched -- it still backs every /spq command and still fills
-- the window where profiles and the pack manager live. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local QUESTS = here .. "/../../addons/SpokenQuests/"
local SPOKEN = here .. "/../../addons/SpokenPlayer/"
local Expect, Failures = H.Expecter(print)

local function Boot()
    stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
    stub.settingsCategories = {}; stub.ldbObjects = {}; stub.dbIcons = {}
    stub.world.questID = 0; stub.ShowPanel(nil)
    local VO = stub.LoadQuests(QUESTS, SPOKEN)
    VO.Addon:OnInitialize()
    -- The player's own page first, as at login, so this one has a parent to nest under.
    _G.SpokenEnv.Addon:Enable()
    local SettingsPanel = stub.LoadQuestsPanel(QUESTS, VO)
    SettingsPanel:Setup()
    return VO, SettingsPanel
end

local VO, SettingsPanel = Boot()

Expect("the panel is registered as a settings page", SettingsPanel.page and SettingsPanel.page.category ~= nil, true)
-- The player registers Spoken's own entry; this addon's page is nested under it in the
-- game's settings list, rather than an entry of its own beside it.
local mine = 0
for _, registered in ipairs(stub.settingsCategories) do
    if registered.name == "Quests" then mine = mine + 1 end
end
Expect("...as an entry named Quests", mine, 1)
Expect("...nested under Spoken's", SettingsPanel.page.category.parent and SettingsPanel.page.category.parent.name, "Spoken")
Expect("...and not as a top-level entry of its own", SettingsPanel.category, nil)

local rows, headings = {}, {}
for _, child in ipairs(SettingsPanel.panel.content.children) do
    if child.layoutHeading then
        table.insert(headings, { y = child.layoutY, height = child.layoutHeight, text = child.text })
    elseif child.layoutHeight then
        table.insert(rows, { y = child.layoutY, height = child.layoutHeight, anchor = child.anchor and child.anchor.y })
    end
end

local names = {}
for _, heading in ipairs(headings) do table.insert(names, heading.text) end
Expect("the settings are grouped into sections", table.concat(names, "|"),
    "When to Read|Extras|Reading History|Voice Packs|Fix a Problem")

local function Distinct(values)
    local seen, count = {}, 0
    for _, value in ipairs(values) do
        local key = string.format("%.1f", value)
        if not seen[key] then seen[key] = true; count = count + 1 end
    end
    return count
end

-- The same rhythm the other two panels keep, from the same file.
local gaps = {}
for index = 2, table.getn(rows) do
    local previous = rows[index - 1]
    -- Two settings side by side share one line: there is no gap between them to measure.
    local crossesHeading = previous.y == rows[index].y
    for _, heading in ipairs(headings) do
        if heading.y < previous.y and heading.y > rows[index].y then crossesHeading = true end
    end
    if not crossesHeading then table.insert(gaps, previous.y - rows[index].y - previous.height) end
end
Expect("every row sits the same distance below the one above it", Distinct(gaps), 1)

local headingGaps = {}
for _, heading in ipairs(headings) do
    local above
    for _, row in ipairs(rows) do
        if row.y > heading.y and (not above or row.y < above.y) then above = row end
    end
    if above then table.insert(headingGaps, above.y - heading.y - above.height) end
end
Expect("every section heading the same distance below the section above", Distinct(headingGaps), 1)

---------------------------------------------------------------- the rows write the settings
-- A dropdown rather than a button that cycles: four named choices, and a player should be
-- able to see them and pick one rather than click through them.
local db = VO.Addon.db.profile
db.Audio.GossipFrequency = VO.Enums.GossipFrequency.Always
local greetings
for _, child in ipairs(SettingsPanel.panel.content.children) do
    if child.dropdownInit and child.layoutLabel and child.layoutLabel.text == "NPC Greetings" then
        greetings = child
    end
end
Expect("the greeting frequency is a dropdown", greetings ~= nil, true)
greetings:GetScript("OnShow")(greetings)
Expect("...showing the setting when the panel opens", greetings.dropdownText, "Every Time")

-- Autoplay is what reads greetings, so the frequency sits under it and goes grey without it.
local autoplay
for _, child in ipairs(SettingsPanel.panel.content.children) do
    if type(child.text) == "table" and child.text.text == "Read Automatically" then
        autoplay = child
    end
end
Expect("autoplay is a checkbox on the panel", autoplay ~= nil, true)
-- The labels carry the indent; every control stays in the one column the page shares.
Expect("...with the greeting frequency indented under it",
    greetings.layoutLabel.anchor.x > autoplay.text.anchor.x, true)
Expect("...live while autoplay is on", greetings.dropdownDisabled or false, false)
autoplay:SetChecked(false)
autoplay:GetScript("OnClick")(autoplay)
Expect("unticking autoplay turns it off", db.Audio.Autoplay, false)
Expect("...and greys the greeting frequency out", greetings.dropdownDisabled, true)
-- Follow-up lines are queued by autoplay alone (Followup.lua), so they grey out with it too.
local followup
for _, child in ipairs(SettingsPanel.panel.content.children) do
    if type(child.text) == "table" and child.text.text == "Follow-up Lines" then followup = child end
end
Expect("...and Follow-up Lines, saying why", followup and followup.layoutReason, VO.L.REASON_AUTOPLAY)
autoplay:SetChecked(true)
autoplay:GetScript("OnClick")(autoplay)
Expect("ticking it again brings the frequency back", greetings.dropdownDisabled, false)
Expect("...and Follow-up Lines", followup and followup.layoutReason, nil)

local entries = stub.OpenDropdown(greetings)
local offered = {}
for _, entry in ipairs(entries) do table.insert(offered, entry.text) end
Expect("...offering every choice at once", table.concat(offered, "|"),
    "Every Time|Once per NPC with Quests|Once per NPC|Never")
Expect("...with the current one ticked", entries[1].checked, true)

Expect("picking one is possible", stub.PickDropdown(greetings, "Once per NPC"), true)
Expect("...and stores the number the addon reads", db.Audio.GossipFrequency,
    VO.Enums.GossipFrequency.OncePerNPC)
Expect("...and relabels", greetings.dropdownText, "Once per NPC")
-- Picking again from a different value: what the control shows and what it compares have
-- to be the same thing, or it can never find where in the list it is.
Expect("picking a second time works too", stub.PickDropdown(greetings, "Never"), true)
Expect("...and stores that", db.Audio.GossipFrequency, VO.Enums.GossipFrequency.Never)
Expect("...with the ticked entry moved", stub.OpenDropdown(greetings)[4].checked, true)

---------------------------------------------------------------- the gather switch stays in the player's settings
-- The switch is the player's alone: quests and books both feed the one store, so a
-- mirror here could only ever repeat it -- a player cannot have quests off and pages on.
local gather
for _, child in ipairs(SettingsPanel.panel.content.children) do
    if type(child.text) == "table" and child.text.text == "Gather missing data" then
        gather = child
    end
end
Expect("the gather switch is not on the quests panel", gather == nil, true)

---------------------------------------------------------------- packs and profiles, inline
-- Both used to be a branch of an options tree behind a button, which is two clicks and a
-- second window to answer "is my audio installed" or "which profile am I on".
local texts = {}
for _, child in ipairs(SettingsPanel.panel.content.children) do
    if type(child.text) == "string" and child.text ~= "" then table.insert(texts, child.text) end
    if child.dropdownInit and child.layoutLabel then table.insert(texts, child.layoutLabel.text) end
end
local function Mentions(needle)
    for _, text in ipairs(texts) do
        if string.find(text, needle, 1, true) then return true end
    end
    return false
end
Expect("the installed pack is named on the panel", Mentions("TestPack"), true)
Expect("profiles are not chosen on the Quests page: they are Spoken's, for every part",
    Mentions("Profile in Use"), false)
Expect("...and can be reset there, from the header's Defaults as the game's pages have it",
    SettingsPanel.panel.layout.defaults ~= nil, true)
Expect("nothing sends the player to a second window", Mentions("everything else"), false)

local profile
local home = _G.SpokenOptionsPanel.content or _G.SpokenOptionsPanel
for _, child in ipairs(home.children) do
    if child.dropdownInit and child.layoutLabel and child.layoutLabel.text == "Profile in Use" then
        profile = child
    end
end
Expect("the profile is chosen on Spoken's page", profile ~= nil, true)
Expect("...showing the one Quests is on", profile and profile.dropdownText, VO.Addon.db:GetCurrentProfile())
Expect("...and switching is possible", profile and stub.PickDropdown(profile, VO.Addon.db:GetCurrentProfile()), true)
_G.SpokenEnv.Options:SetProfile("Shared")
Expect("switching it moves Quests to that profile", VO.Addon.db:GetCurrentProfile(), "Shared")
Expect("...and the player's settings with it", _G.SpokenEnv.Addon.db:GetCurrentProfile(), "Shared")
_G.SpokenEnv.Options:SetProfile("Default")

---------------------------------------------------------------- the language choices
-- On the panel, as in SpokenBooks, rather than only in the /spq window; Auto is named with
-- the language it follows, the same way all three addons name it.
-- The voice language is chosen once, on Spoken's page, for every module; this page has none.
local function Dropdown(content, label)
    for _, child in ipairs(content.children) do
        if child.dropdownInit and child.layoutLabel and child.layoutLabel.text == label then return child end
    end
end
Expect("the Quests page has no language of its own", Dropdown(SettingsPanel.panel.content, "Voice Language"), nil)
local spoken = _G.SpokenOptionsPanel.content or _G.SpokenOptionsPanel
local voice, fallback = Dropdown(spoken, "Voice Language"), Dropdown(spoken, "If a Line Is Missing")
Expect("the voice language is chosen on Spoken's page", voice ~= nil, true)
Expect("...Auto by default, named with the client's language", voice and voice.dropdownText, "Auto (English)")
VO.Addon.db.profile.Audio.VoiceLanguage = "frFR"
Expect("...and until it is, Quests keeps the choice it had", VO.Language:GetVoiceLanguage(), "frFR")
Expect("...a language can be picked", stub.PickDropdown(voice, "Deutsch"), true)
Expect("...which Quests then speaks", VO.Language:GetVoiceLanguage(), "deDE")
Expect("...and going back to Auto is possible", stub.PickDropdown(voice, "Auto (English)"), true)
Expect("...which follows the client", VO.Language:GetVoiceLanguage(), "enUS")
Expect("the fallback language is chosen there too", fallback and fallback.dropdownText, "English")
Expect("...and can be switched off", stub.PickDropdown(fallback, "Stay Silent"), true)
Expect("...which Quests then honours", VO.Language:GetFallbackLanguage(), nil)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll quests options tests passed")
