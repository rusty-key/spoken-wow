-- Every setting on every Spoken page, worked the way a player works it: each checkbox ticked
-- and unticked, each slider moved to both ends, each menu's choices picked, each button pressed
-- -- and each time, the setting read back to see that it took. Then each module switched off,
-- to see that everything on its page goes with it. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local SPOKEN = here .. "/../../addons/Spoken/"
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local BOOKS = here .. "/../../addons/Spoken_Books/"
local ZONES = here .. "/../../addons/Spoken_Zones/"
_G.UISpecialFrames = _G.UISpecialFrames or {}

stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
stub.settingsCategories = {}; stub.ldbObjects = {}; stub.dbIcons = {}
stub.world.questID = 0; stub.ShowPanel(nil)
-- Waypoint's art, as on a client that can nine-slice with the player loaded.
_G.Enum = _G.Enum or {}
_G.Enum.UITextureSliceMode = { Stretched = 0 }
_G.C_AddOns = { IsAddOnLoaded = function() return true end }

local VO = stub.LoadQuests(QUESTS, SPOKEN)
VO.Addon:OnInitialize()
local env = _G.SpokenEnv
env.Sources:Register("books", { title = "Spoken Books", addon = "Spoken_Books", order = 2,
    packs = function() return { "SpokenBooksAudio" } end })
env.Sources:Register("zones", { title = "Spoken Zones", addon = "Spoken_Zones", order = 3,
    packs = function() return { "SpokenZonesAudio" } end })
_G.Spoken:RegisterOptionalAction("report", "Report")
env.Addon:Enable()
local QuestsPanel = stub.LoadQuestsPanel(QUESTS, VO)
QuestsPanel:Setup()
local B = {}
for _, file in ipairs({ "Locale/enUS", "Checksum", "Core", "Language", "Reader", "Audio", "Playlist",
    "UI/Layout", "UI/Options", "Events", "Commands" }) do
    assert(loadfile(BOOKS .. file .. ".lua"))("Spoken_Books", B)
end
B:InitDB(); B:SetupOptions()
local Z = H.NewZoneLore()
for _, file in ipairs({ "UI/Layout", "UI/Options" }) do
    assert(loadfile(ZONES .. file .. ".lua"))("Spoken_Zones", Z)
end
Z:SetupOptions()
-- Azeroth's Compendium, with the two tabs Spoken's page shows an Unlock switch for: stand-ins
-- that keep the switch, as Places' and Writings' real tabs keep it in their settings.
assert(loadfile(ZONES .. "UI/Compendium.lua"))("Spoken_Zones", Z)
local unlocked = {}
for _, key in ipairs({ "places", "readables" }) do
    SpokenCompendium:Register(key, { label = key, order = 1, build = function() end, open = function() end,
        unlock = { get = function() return unlocked[key] == true end, set = function(v) unlocked[key] = v end } })
end
-- The Spoken_Developer module and its page.
local Dev = stub.LoadDeveloper(here .. "/../../addons/Spoken_Developer/")
Dev:SetupOptions()


-- What the test's stand-ins lack and the real addons have: the zones addon here is a stand-in
-- (queue_helpers.NewZoneLore) without its playback and language files, so the methods its page
-- calls are recorded rather than run -- every one of them is defined in SpokenZones itself.
local called = {}
for _, method in ipairs({ "StopLore", "NotifyAudioChanged", "ShowCopyLink", "RefreshLoreWindow",
    "ApplyPanelOptions", "ResetOptions", "PlayTestLine", "ShowDiagnostics", "ToggleLoreWindow",
    "ForgetAutoplayHistory" }) do
    if not Z[method] then Z[method] = function() called[method] = (called[method] or 0) + 1 end end
end
-- Stored as the real one stores it (SpokenZonesSettings.language), and read back the same way.
local zonesLanguage
Z.SetLanguage = function(_, code) zonesLanguage = code; return true end
Z.GetLanguagePreference = function() return zonesLanguage end
-- The books addon's own copy dialog.
assert(loadfile(BOOKS .. "UI/CopyLink.lua"))("Spoken_Books", B)
-- The stub client measures no text; the subtitle's sample needs a height to lay out.
do
    local build = env.Subtitle.Build
    env.Subtitle.Build = function(self)
        build(self)
        self.title.GetStringHeight = function() return 18 end
        self.measure.GetStringHeight = function() return 16 end
    end
end

-- The DialogueUI page is registered once the world is up.
env.DialogueUIOptions:Register()
local pages = { { name = "Spoken", layout = _G.SpokenOptionsPanel.layout } }
for _, page in ipairs(env.Options.pages or {}) do
    table.insert(pages, { name = page.name, layout = page.layout })
end
-- The DialogueUI page (the stub reports every addon loaded) and the Developer page, which the
-- Spoken_Developer module adds.
Expect("Spoken, the three modules' pages, the DialogueUI page and the Developer page are all here", #pages, 6)

local function Controls(layout)
    local list = {}
    for _, item in ipairs(layout.items) do
        if item.kind == "row" then table.insert(list, item.control)
        elseif item.rows then for _, row in ipairs(item.rows) do table.insert(list, row.control) end end
    end
    return list
end
local function Name(control)
    local label = control.layoutLabel and control.layoutLabel.text or control.text
    if type(label) == "table" then label = label.text end
    return type(label) == "string" and label ~= "" and label or tostring(control.frameType or control.kind)
end
-- The same choice: a number near enough, or a locale by its code -- a list built afresh each
-- time it is read hands back an equal entry, not the same table.
local function Same(a, b)
    if type(a) == "number" and type(b) == "number" then return math.abs(a - b) < 0.001 end
    if type(a) == "table" and type(b) == "table" and a.code ~= nil then return a.code == b.code end
    return a == b
end

local broken, worked = {}, { checkbox = 0, slider = 0, menu = 0, button = 0 }
local function Broken(page, name, what) table.insert(broken, page.name .. " > " .. name .. ": " .. what) end
local function Try(page, name, fn)
    local ok, err = pcall(fn)
    if not ok then Broken(page, name, "error: " .. tostring(err)) end
    return ok
end

-- Settings first, buttons after: a reset button would put every setting back part way through.
local buttons = {}
for _, page in ipairs(pages) do
    for _, control in ipairs(Controls(page.layout)) do
        local name = Name(control)
        if control.layoutChoose then
            -- A menu: every choice it offers, picked in turn, then the one it had back.
            Try(page, name, function()
                local values = control.layoutValues
                if type(values) == "function" then values = values() end
                local before = control.layoutRead()
                for _, value in ipairs(values or {}) do
                    control.layoutChoose(value)
                    if not Same(control.layoutRead(), value) then
                        Broken(page, name, "chose " .. tostring(value) .. ", reads " .. tostring(control.layoutRead()))
                    end
                end
                if before ~= nil then control.layoutChoose(before) end
                worked.menu = worked.menu + 1
            end)
        elseif control.layoutRange then
            -- A slider: to each end, then back where it was.
            Try(page, name, function()
                local slider, range = control.layoutSlider, control.layoutRange
                local before = control.layoutRead()
                local function Move(value)
                    slider:SetValue(value)
                    if slider.scripts.OnValueChanged then slider.scripts.OnValueChanged(slider, value) end
                end
                for _, value in ipairs({ range[1], range[2] }) do
                    Move(value)
                    if not Same(control.layoutRead(), value) then
                        Broken(page, name, "moved to " .. value .. ", reads " .. tostring(control.layoutRead()))
                    end
                end
                Move(before)
                worked.slider = worked.slider + 1
            end)
        elseif control.layoutRead and control.SetChecked then
            -- A checkbox: ticked the other way, then back.
            Try(page, name, function()
                local before = control.layoutRead() and true or false
                for _, value in ipairs({ not before, before }) do
                    control:SetChecked(value)
                    control.scripts.OnClick(control)
                    if (control.layoutRead() and true or false) ~= value then
                        Broken(page, name, "ticked " .. tostring(value) .. ", reads " .. tostring(control.layoutRead()))
                    end
                end
                worked.checkbox = worked.checkbox + 1
            end)
        elseif control.layoutButton then
            table.insert(buttons, { page = page, control = control.layoutButton, name = name })
        elseif control.scripts and control.scripts.OnClick and not control.layoutCard and not control.layoutHit then
            table.insert(buttons, { page = page, control = control, name = name })
        end
    end
end
for _, entry in ipairs(buttons) do
    if Try(entry.page, entry.name, function() entry.control.scripts.OnClick(entry.control, "LeftButton") end) then
        worked.button = worked.button + 1
    end
end

Expect("checkboxes, sliders and menus were all worked", worked.checkbox > 20 and worked.slider > 3 and worked.menu > 5, true)
Expect("buttons were pressed", worked.button > 5, true)
Expect("every setting took, read back the way it was set, and nothing threw", table.concat(broken, "\n  "), "")
Expect("nothing went wrong in a callback", table.concat(env.Callbacks.errors, "\n  "), "")
stub.print(string.format("settings_audit: %d checkboxes, %d sliders, %d menus, %d buttons",
    worked.checkbox, worked.slider, worked.menu, worked.button))

---------------------------------------------------------------- a module switched off is off
local PAGE_FOR = { quests = 2, books = 3, zones = 4 }
for _, key in ipairs({ "quests", "books", "zones" }) do
    local page = pages[PAGE_FOR[key]]
    _G.Spoken:SetPartOn(key, false)
    env.Options:UpdateRows()
    page.layout:Refresh()
    local live = {}
    for _, control in ipairs(Controls(page.layout)) do
        local name = Name(control)
        if not control.layoutReason and name ~= "Enable Module" then table.insert(live, name) end
    end
    Expect(page.name .. ", switched off, greys out everything on it but its switch", table.concat(live, ", "), "")
    _G.Spoken:SetPartOn(key, true)
    env.Options:UpdateRows()
    page.layout:Refresh()
end

---------------------------------------------------------------- Reset All and the Unlock switches
-- Kept with each part's settings, so Spoken's profile reset would not reach them.
unlocked.places, unlocked.readables = true, true
local reset = _G.SpokenOptionsPanel.layout.defaults
reset.scripts.OnClick(reset)
stub.popups[#stub.popups].dialog.OnAccept()
Expect("Reset All turns both Unlock switches off", (unlocked.places or unlocked.readables) and true or false, false)

os.exit(Failures() == 0 and 0 or 1)
