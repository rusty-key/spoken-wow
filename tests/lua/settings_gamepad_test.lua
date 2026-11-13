-- With the controller UI on, a settings row is one stop for the d-pad, as the game's own rows
-- are (Blizzard_SettingControls.lua, forever branch): the cursor lands on the row beside its
-- label, never on the box, the slider's steppers or the dropdown's arrows; left and right step a
-- slider or a dropdown, and A ticks the box or opens the list. The stub has no SmartNavigation,
-- so this test supplies the calls UI/Layout.lua makes and records what each row asked for.
-- Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local LAYOUT = here .. "/../../addons/Spoken/UI/Layout.lua"

stub.SetClient("16001"); stub.ResetFrames()
_G.UISpecialFrames = _G.UISpecialFrames or {}
_G.MenuUtil = {}
_G.MinimalSliderWithSteppersMixin = { Label = { Left = 1, Right = 2 }, Event = { OnValueChanged = "OnValueChanged" } }

-- The two templates as far as a row drives them: the slider's value runs through its callback,
-- as the game's mixin forwards it; the dropdown's steppers and its button record their clicks.
local create = _G.CreateFrame
_G.CreateFrame = function(kind, name, parent, template)
    local f = create(kind, name, parent, template)
    function f:SetEnabled(on) self.enabled = on and true or false end
    function f:IsEnabled() return self.enabled ~= false end
    if template == "MinimalSliderWithSteppersTemplate" then
        f.Slider = create("Slider", nil, f)
        local slider = f.Slider
        function f:Init(value) slider.value = value end
        function f:RegisterCallback(_, fn, owner) slider.callback = function(v) fn(owner, v) end end
        function f:SetValue(v) slider.value = v end
        function f:SetEnabled(on) slider.enabled = on and true or false end
        function slider:GetValue() return self.value end
        function slider:SetValue(v) self.value = v; if self.callback then self.callback(v) end end
        function slider:IsEnabled() return self.enabled ~= false end
    elseif template == "SettingsDropdownWithButtonsTemplate" then
        f.Dropdown = create("Frame", nil, f)
        f.IncrementButton = create("Button", nil, f)
        f.DecrementButton = create("Button", nil, f)
        f.clicks = {}
        function f.IncrementButton:Click() table.insert(f.clicks, "next") end
        function f.DecrementButton:Click() table.insert(f.clicks, "previous") end
        function f.Dropdown:SetupMenu() end
        function f.Dropdown:IsEnabled() return f.enabled ~= false end
        function f.Dropdown:MouseDown() table.insert(f.clicks, "down") end
        function f.Dropdown:MouseUp() table.insert(f.clicks, "open") end
    end
    return f
end
_G.SOUNDKIT = { IG_MAINMENU_OPTION_CHECKBOX_ON = 856, IG_MAINMENU_OPTION_CHECKBOX_OFF = 857 }
_G.PlaySound = function() end

_G.SpokenLayout = nil
assert(loadfile(LAYOUT))()
local Layout = _G.SpokenLayout

local state = { on = false, level = 0.5, choice = "b", enabled = true }
local function Page()
    local page = CreateFrame("Frame")
    page.children = {}
    function page:GetWidth() return 640 end
    local layout = Layout.New(page, 25, -16)
    local rows = {}
    rows.check = layout:Checkbox("Switch", nil, function() return state.on end, function(v) state.on = v end)
    rows.slider = layout:Slider("Level", 0, 1, 0.1, function() return state.level end,
        function(v) state.level = v end)
    rows.menu = layout:Dropdown("Choice", nil, { "a", "b", "c" }, function() return state.choice end,
        function(v) state.choice = v end)
    layout:Requires(rows.slider, function() return state.enabled end, "off")
    layout:Requires(rows.menu, function() return state.enabled end, "off")
    layout:Reflow()
    rows.layout, rows.view = layout, Layout.Scroll(CreateFrame("Frame"))
    return rows
end

---------------------------------------------------------------- a client without the controller UI
do
    local rows = Page()
    Expect("without SmartNavigation a row asks nothing of it", rows.check.layoutHit.nav, nil)
end

-- What SmartNavigation records, kept on the frame where the test can read it back. The game
-- refuses each of these from an addon while combat holds addons back.
local restricted = false
_G.Enum = _G.Enum or {}
_G.Enum.AddOnRestrictionType = { Combat = 1 }
_G.C_RestrictedActions = { IsAddOnRestrictionActive = function() return restricted end }
_G.SMART_NAV_INPUT_DIRECTION = { UP = { dirKey = "Up" }, DOWN = { dirKey = "Down" },
    LEFT = { dirKey = "Left" }, RIGHT = { dirKey = "Right" } }
local function Nav(frame)
    frame.nav = frame.nav or { overrides = {} }
    return frame.nav
end
_G.SmartNavigation_MarkFrameIgnored = function(frame) Nav(frame).ignored = true end
_G.SmartNavigation_SetCustomCursorAnchorPointForFrame = function(frame, anchor) Nav(frame).anchor = anchor end
_G.SmartNavigation_AddJumpNavigationOverride = function(frame, dir, to) Nav(frame).overrides[dir.dirKey] = to end
_G.SmartNavigation_AddIgnoreInputNavigationOverride = function(frame, dir) Nav(frame).overrides[dir.dirKey] = true end
_G.CreateAnchor = function(point, relativeTo, relativePoint, x, y)
    return { point = point, relativeTo = relativeTo, relativePoint = relativePoint, x = x, y = y }
end
local function Press(frame, dirKey)
    local override = frame.nav and frame.nav.overrides[dirKey]
    if type(override) == "function" then return override() end
    return override
end
local function Ignored(frame) return frame.nav and frame.nav.ignored or false end

---------------------------------------------------------------- one stop per row
local rows = Page()
local check, slider, menu = rows.check, rows.slider, rows.menu

do
    local hit = check.layoutHit
    Expect("a checkbox's box is no stop of its own", Ignored(check), true)
    Expect("...its row is", Ignored(hit), false)
    local anchor = hit.nav and hit.nav.anchor or {}
    Expect("...with the cursor just left of the label, where the game's rows have it",
        tostring(anchor.point) .. " " .. tostring(anchor.relativeTo == check.layoutLabel) .. " "
        .. tostring(anchor.relativePoint) .. " " .. tostring(anchor.x), "RIGHT true LEFT -7")
    Expect("...right goes nowhere, as from the game's checkbox", Press(hit, "Right"), true)
    Expect("...left still leaves the page for the list of pages", Press(hit, "Left"), nil)
end

do
    local hit = slider.layoutHit
    Expect("a slider's steppers are no stops", Ignored(slider), true)
    Expect("...its row is", Ignored(hit), false)
    Expect("...with the cursor beside the label", hit.nav and hit.nav.anchor.relativeTo == slider.layoutLabel, true)
    state.level = 0.5
    Expect("right steps it up, and the cursor stays on the row", Press(hit, "Right"), true)
    Expect("...the setting takes the step", ("%.2f"):format(state.level), "0.60")
    Press(hit, "Left"); Press(hit, "Left")
    Expect("left steps it down", ("%.2f"):format(state.level), "0.40")
    state.level = 1; slider.layoutSlider.value = 1
    Press(hit, "Right")
    Expect("...never past its end", state.level, 1)
    state.enabled = false; rows.layout:Refresh()
    state.level = 0.5; slider.layoutSlider.value = 0.5
    Expect("greyed out, it keeps the cursor", Press(hit, "Right"), true)
    Expect("...and its value", state.level, 0.5)
    state.enabled = true; rows.layout:Refresh()
end

do
    local hit = menu.layoutHit
    Expect("a dropdown's arrows and button are no stops", Ignored(menu), true)
    Expect("...its row is", Ignored(hit), false)
    Expect("...with the cursor beside the label", hit.nav and hit.nav.anchor.relativeTo == menu.layoutLabel, true)
    Expect("right takes the next choice, the cursor staying", Press(hit, "Right"), true)
    Press(hit, "Left")
    Expect("left the one before, by the dropdown's own arrows", table.concat(menu.clicks, " "), "next previous")
    menu.clicks = {}
    hit:OnSmartNavClick()
    Expect("A opens the list, as a click on the dropdown does", table.concat(menu.clicks, " "), "down open")
    menu.clicks = {}
    state.enabled = false; rows.layout:Refresh()
    hit:OnSmartNavClick()
    Expect("...but not while it is greyed out", table.concat(menu.clicks, " "), "")
    state.enabled = true; rows.layout:Refresh()
end

Expect("the scroll bar's thumb is no stop: the cursor scrolls the page itself", Ignored(rows.view.thumb), true)

---------------------------------------------------------------- one column
-- The cursor counts a stop as where its anchor points, else at its middle, and goes up or down
-- only to a stop within 45 degrees. Every stop in the page's column is counted at its left, by
-- the label, or a page's rows and buttons are two columns the d-pad skips between (Readables:
-- down from Defaults to the voice pack, up from there to Enable).
local function At(frame)
    local anchor = frame.nav and frame.nav.anchor
    return anchor and anchor.relativeTo, anchor and anchor.relativePoint
end
do
    local page = CreateFrame("Frame")
    page.children = {}
    function page:GetWidth() return 640 end
    local layout = Layout.New(page, 25, -16)
    layout:Intro(nil, "Readables")
    local defaults = layout:Defaults(function() end)
    local enable = layout:Checkbox("Enable", nil, function() return true end, function() end)
    local heading = layout:Section("Voice Packs")
    local got = 0
    local pack = layout:Download("English", function() return "ok", "2.3.1" end, "Download", function() got = got + 1 end)
    local missing = layout:Download("German", function() end, "Download", function() got = got + 1 end)
    local badge = layout:Badge("Lines", function() return "ok", "12" end)
    local key = layout:Key("Replay", function() return "neutral", "F" end, function() end, nil,
        { press = "Press a key", none = "None" })
    local test = layout:Button("Play a Test Line", 200, function() end)
    local cycle = layout:Cycle("Mode: %s", nil, { "a", "b" }, function() return "a" end, function() end)
    local status = layout:Status(function() return "ok", "Fine" end)
    local link = layout:Link({ title = "Site", url = "https://example.invalid", icon = 1 })
    layout:Section("Reading History")
    local again = layout:HeadingButton("Clear", function() end)
    local forget = layout:Button("Forget Readables Heard", 200, function() end)
    layout:Reflow(); layout:Refresh()

    Expect("a voice pack's row is one stop: its field is none",
        tostring(Ignored(pack)) .. " " .. tostring(Ignored(pack.layoutButton)), "true true")
    Expect("...counted by its label, as a setting's row is", At(pack.layoutHit), pack.layoutLabel)
    pack.layoutHit:OnSmartNavClick()
    Expect("...A on a pack already there downloads nothing", got, 0)
    missing.layoutHit:OnSmartNavClick()
    Expect("...A on a missing pack is its Download button", got, 1)
    Expect("a badge's row is one stop, by its label", tostring(Ignored(badge)) .. " "
        .. tostring(At(badge.layoutHit) == badge.layoutLabel), "true true")
    Expect("a key's row is one stop, by its label", tostring(Ignored(key)) .. " "
        .. tostring(At(key.layoutHit) == key.layoutLabel), "true true")
    for name, frame in pairs({ button = test, cycle = cycle, status = status, link = link }) do
        local to, point = At(frame)
        Expect("a " .. name .. " in the column is counted at its left", tostring(to == frame) .. " "
            .. tostring(point), "true LEFT")
    end
    Expect("...a link's address box is no stop of its own", Ignored(link.box), true)
    Expect("down from Defaults is the page's first row", Press(defaults, "Down"), enable.layoutHit)
    Expect("down from a section's button is the section's first row", Press(again, "Down"), forget)
    Expect("...not the heading's own", heading ~= nil, true)
end

---------------------------------------------------------------- built in combat
do
    restricted = true
    local fought = Page()
    restricted = false
    Expect("a page built while combat holds addons back asks nothing the game would refuse",
        tostring(fought.check.nav) .. " " .. tostring(fought.check.layoutHit.nav) .. " "
        .. tostring(fought.view.thumb.nav), "nil nil nil")
end

---------------------------------------------------------------- questions under the controller UI
-- A StaticPopup an addon shows taints the game's gamepad popup handling: once it closed the
-- d-pad no longer moved on the settings page. Under the controller UI the question goes to
-- Spoken's own dialog, which takes the controller's focus as Blizzard's popups do.
do
    local stubPopups = #stub.popups
    local calls, restricted = {}, false
    _G.InputUtil = { IsGamepadUIEnabled = function() return true end }
    _G.GamepadMode = { FrameControlsManager = {
        HandlePopupShown = function(_, frame) table.insert(calls, { "shown", frame }) end,
        HandlePopupHide = function(_, frame) table.insert(calls, { "hide", frame }) end,
    } }
    _G.Enum = _G.Enum or {}
    _G.Enum.AddOnRestrictionType = { Combat = 1 }
    _G.C_RestrictedActions = { IsAddOnRestrictionActive = function() return restricted end }

    local ran = 0
    Layout.Confirm("Reset?", "Reset", "Cancel", function() ran = ran + 1 end)
    local frame = _G.SpokenLayoutPrompt
    Expect("a confirmation is no StaticPopup", #stub.popups, stubPopups)
    Expect("...but Spoken's own dialog", frame and frame:IsShown(), true)
    -- The stub fires OnShow hooks but not OnHide ones; the client fires both.
    local stubHide = frame.Hide
    function frame:Hide()
        local was = self:IsShown()
        stubHide(self)
        if was then for _, fn in ipairs(self.hooks.OnHide or {}) do fn(self) end end
    end
    Expect("...which takes the controller's focus as a popup", calls[1] and calls[1][1], "shown")
    Expect("...for itself", calls[1] and calls[1][2], frame)
    Expect("B presses Cancel", frame.CloseButton and frame.CloseButton.text, "Cancel")
    frame.CloseButton.scripts.OnClick(frame.CloseButton)
    Expect("cancelling runs nothing", ran, 0)
    Expect("...closes the dialog", frame:IsShown(), false)
    Expect("...and hands the focus back", calls[2] and calls[2][1], "hide")

    Layout.Confirm("Reset?", "Reset", "Cancel", function() ran = ran + 1 end)
    local accept
    for _, child in ipairs(frame.children or {}) do
        if child.text == "Reset" then accept = child end
    end
    Expect("the dialog has the accept button", accept ~= nil, true)
    accept.scripts.OnClick(accept)
    Expect("accepting runs it once", ran, 1)
    Expect("...and closes the dialog", frame:IsShown(), false)

    local named
    Expect("asking for a name is taken on", Layout.Ask("Name it:", "Accept", "Cancel",
        function(name) named = name end), true)
    Expect("...with no StaticPopup either", #stub.popups, stubPopups)
    local input
    for _, child in ipairs(frame.children or {}) do
        if child.frameType == "EditBox" then input = child end
    end
    Expect("...and a box to type in", input and input:IsShown(), true)
    input:SetText("Mine")
    accept.scripts.OnClick(accept)
    Expect("accepting hands over what was typed", named, "Mine")

    Layout.Confirm("Reset?", "Reset", "Cancel", function() end)
    Expect("a confirmation has no box to type in", input:IsShown(), false)
    frame:Hide()

    calls, restricted = {}, true
    Layout.Confirm("Reset?", "Reset", "Cancel", function() end)
    frame:Hide()
    Expect("in combat the focus manager is left alone, as it refuses addons then", #calls, 0)
    restricted = false
    stub.FireEvent("PLAYER_REGEN_ENABLED")
    Expect("...and a dialog it never took is not handed back after", #calls, 0)

    -- Open before combat, closed in it (B, or Escape): the manager still lists it as shown,
    -- and would not move the focus to it the next time it opens.
    calls = {}
    Layout.Confirm("Reset?", "Reset", "Cancel", function() end)
    restricted = true
    frame:Hide()
    Expect("a dialog closed in combat hands nothing back then", #calls, 1)
    restricted = false
    stub.FireEvent("PLAYER_REGEN_ENABLED")
    Expect("...but once combat ends", calls[2] and calls[2][1], "hide")
    stub.FireEvent("PLAYER_REGEN_ENABLED")
    Expect("...once", #calls, 2)

    -- Closed in combat and opened again before it ends: still the manager's popup, kept.
    calls = {}
    Layout.Confirm("Reset?", "Reset", "Cancel", function() end)
    restricted = true
    frame:Hide()
    Layout.Confirm("Reset?", "Reset", "Cancel", function() end)
    restricted = false
    stub.FireEvent("PLAYER_REGEN_ENABLED")
    Expect("a dialog open again by then stays the manager's", #calls, 1)
    frame:Hide()
    Expect("...and hands the focus back when it closes", calls[2] and calls[2][1], "hide")

    _G.InputUtil.IsGamepadUIEnabled = function() return false end
    Expect("without the controller UI the caller asks as before", Layout.Ask("Name it:", "Accept", "Cancel",
        function() end), false)
    Layout.Confirm("Reset?", "Reset", "Cancel", function() end)
    Expect("...and a confirmation is a StaticPopup", #stub.popups, stubPopups + 1)
    _G.InputUtil, _G.GamepadMode, _G.C_RestrictedActions = nil, nil, nil
end

os.exit(Failures() == 0 and 0 or 1)
