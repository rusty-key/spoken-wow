-- Azeroth's Compendium under Forever's controller UI. The d-pad's cursor (SmartNavigation) moves
-- only in windows the frame controls manager knows of, and this window is no UI panel the game
-- tells it of: it registers itself on show and leaves on hide, outside combat only, where the
-- manager refuses addons. From there the game drives it: B is the window's CloseButton, the right
-- stick scrolls the page, A on the search box starts typing; the resize grip and the scroll bars'
-- thumbs are no stops; the list's rows are built with no parent, so the game's hook on
-- CreateFrame never looks for stops from inside Spoken's call. The stub has no controller UI, so
-- this test supplies the calls the window makes and records each. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local SPOKEN = here .. "/../../addons/Spoken/"

stub.SetClient("16001"); stub.ResetTimers(); stub.ResetFrames()
_G.UISpecialFrames = _G.UISpecialFrames or {}

-- The portrait window's template, with the close button the game's has.
local createFrame = _G.CreateFrame
local made = {}
_G.CreateFrame = function(kind, name, parent, template)
    local frame = createFrame(kind, name, parent, template)
    table.insert(made, { frame = frame, parent = parent })
    if template == "PortraitFrameTemplate" then
        function frame:SetTitle(text) self.title = text end
        frame.CloseButton = createFrame("Button", nil, frame)
    elseif template == "MaximizeMinimizeButtonFrameTemplate" then
        frame.MaximizeButton = createFrame("Button", nil, frame)
        frame.MinimizeButton = createFrame("Button", nil, frame)
    end
    return frame
end

stub.LoadSpoken(SPOKEN)
-- Forever's menus (Blizzard_Menu): the filter is the game's dropdown button.
_G.MenuUtil = _G.MenuUtil or {}
local C = _G.SpokenCompendium

-- A tab as the parts lay theirs out: a list of a few rows, the first chosen, and a page beside it.
local chosen, onlyOn = "first", false
local list, page
C:Register("quests", { label = "Quests", order = 1, build = function(panel)
    list = C.NewList(panel, {
        build = function()
            local items = {}
            for i = 1, 3 do table.insert(items, { key = i == 1 and "first" or ("row" .. i), label = "Row " .. i }) end
            return items
        end,
        isSelected = function(item) return item.key == chosen end,
        onClick = function(item) chosen = item.key end,
        only = "Started Only", onlyGet = function() return onlyOn end, onlySet = function(on) onlyOn = on end,
        addScrollBar = function(scroll, child, inset) return SpokenTextView.AddScrollBar(scroll, child, inset) end,
    })
    page = C.NewPage(C.PageHolder(panel, list), "Spoken_Quests")
    function panel:Refresh() list:Render() end
end })
-- A second tab, for the shoulders to move between: its list's rows chosen by none.
local placesList
C:Register("places", { label = "Places", order = 2, build = function(panel)
    placesList = C.NewList(panel, {
        build = function() return { { key = "zone", label = "Zone" }, { key = "town", label = "Town" } } end,
        isSelected = function() return false end,
    })
    function panel:Refresh() placesList:Render() end
end })

-- Show and hide run the window's scripts as the client does.
local function Run(frame, script)
    local fn = frame:GetScript(script)
    if fn then fn(frame) end
    for _, hook in ipairs(frame.hooks[script] or {}) do hook(frame) end
end
local function Open()
    C:Open("quests")
    Run(C.window, "OnShow")
end
local function Close()
    C.window:Hide()
    Run(C.window, "OnHide")
end

-- What the controller UI records, as its manager and cursor would take it.
local gamepadUI, restricted = false, false
local calls = {}
local function Record(...) table.insert(calls, table.concat({ ... }, " ")) end
local function Called(text)
    for _, call in ipairs(calls) do if call == text then return true end end
    return false
end
_G.InputUtil = { IsGamepadUIEnabled = function() return gamepadUI end }
_G.Enum = _G.Enum or {}
_G.Enum.AddOnRestrictionType = { Combat = 1 }
_G.C_RestrictedActions = { IsAddOnRestrictionActive = function() return restricted end }
_G.GamepadMode = { FrameControlsManager = {
    FrameShown = function(_, frame) Record("shown", frame == C.window and "window" or "other") end,
    FrameHidden = function(_, frame) Record("hidden", frame == C.window and "window" or "other") end,
    HandlePopupShown = function(_, frame) Record("popup shown", frame == _G.SpokenCompendiumWindowFilterPad and "filter" or "other") end,
    HandlePopupHide = function(_, frame) Record("popup hidden", frame == _G.SpokenCompendiumWindowFilterPad and "filter" or "other") end,
} }
_G.SmartNavigation = {
    RefreshButtonGroups = function(_, frame) Record("refresh", frame == C.window and "window" or "other") end,
    SetScrollFrameForFrame = function(_, frame, scroll)
        Record("stick", frame == C.window and "window" or "other", page and scroll == page.body.frame and "page" or tostring(scroll))
    end,
    SetTargetButtonForFrame = function(_, frame, button)
        local what = button and (button.row and button.row.key or button.label and button.label:GetText()) or "none"
        Record("target", frame == C.window and "window" or "other", what)
    end,
}
local ignored = {}
_G.SmartNavigation_MarkFrameIgnored = function(frame) ignored[frame] = true end
-- The window's own override bindings, as the client keeps them: key to button, by owner.
local lockdown = false
local overrides = {}
_G.InCombatLockdown = function() return lockdown end
_G.SetOverrideBindingClick = function(owner, priority, key, button)
    assert(not lockdown, "override bindings cannot change in combat")
    overrides[key] = { owner = owner, priority = priority, button = button }
end
_G.ClearOverrideBindings = function(owner)
    assert(not lockdown, "override bindings cannot change in combat")
    for key, binding in pairs(overrides) do if binding.owner == owner then overrides[key] = nil end end
end
local function Press(key)
    local binding = overrides[key]
    if not binding then return false end
    _G[binding.button]:Click()
    return true
end

---------------------------------------------------------------- the controller UI switched off
calls = {}
Open()
Close()
Expect("with the controller UI switched off the window tells the game nothing", #calls, 0)
gamepadUI = true

---------------------------------------------------------------- the window joins the controller
calls = {}
Open()
Expect("shown under the controller UI, the window tells the frame controls manager", Called("shown window"), true)
Close()
Expect("...and leaves it on hide", Called("hidden window"), true)

calls = {}
Close()
Expect("a window already hidden does not leave twice", Called("hidden window"), false)

calls = {}
gamepadUI = false
Open()
Expect("with the controller UI switched off since, nothing is told", Called("shown window"), false)
Close()
gamepadUI = true

---------------------------------------------------------------- B and the right stick
Expect("B has a close button to press", type(C.window.CloseButton), "table")
calls = {}
Open()
Expect("the window has its focus handler", type(rawget(C.window, "FocusGamepad")), "function")
C.window:FocusGamepad()
Expect("focused, the right stick scrolls the page's words", Called("stick window page"), true)
Expect("...and the cursor starts on the chosen row", Called("target window first"), true)
Close()

---------------------------------------------------------------- the shoulders and View
overrides = {}
Open()
Expect("shown but not yet focused, the window holds no keys", next(overrides), nil)
C.window:FocusGamepad()
Expect("focused, the right shoulder is the window's, over the game's own binding",
    overrides.PADRSHOULDER and overrides.PADRSHOULDER.owner == C.window and overrides.PADRSHOULDER.priority, true)
Expect("...the left shoulder too", overrides.PADLSHOULDER ~= nil, true)
Expect("...and View", overrides.PADBACK ~= nil, true)
calls = {}
Press("PADRSHOULDER")
Expect("the right shoulder shows the next tab", C:Active(), "places")
Expect("...with the cursor on its first row, off the tab just hidden", Called("target window zone"), true)
Press("PADRSHOULDER")
Expect("...and from the last tab, round to the first", C:Active(), "quests")
Press("PADLSHOULDER")
Expect("the left shoulder goes back, round to the last", C:Active(), "places")
Press("PADLSHOULDER")
local box, hasFocus = list.searchBox, false
function box:HasFocus() return hasFocus end
function box:SetFocus() hasFocus = true end
function box:ClearFocus() hasFocus = false end
Press("PADBACK")
Expect("View starts typing in the shown tab's search", hasFocus, true)
Press("PADBACK")
Expect("...and again leaves it", hasFocus, false)
local filter, presses = list.filterButton, {}
Expect("the quests' list has its filter menu", filter ~= nil, true)
function filter:MouseDown() table.insert(presses, "down") end
function filter:MouseUp() table.insert(presses, "up") end
filter:Show()
calls = {}
Press("PADFORWARD")
local pad = _G.SpokenCompendiumWindowFilterPad
Expect("Menu opens the controller's own filter, not the game's menu, which never takes the cursor",
    #presses, 0)
Expect("...shown", pad ~= nil and pad:IsShown(), true)
Expect("...as a popup, so the cursor moves into it", Called("popup shown filter"), true)
Expect("...a row for each switch", pad.rows[1].label:GetText(), "Started Only")
Expect("...unticked as the switch is", pad.rows[1].tick:IsShown(), false)
Expect("B has a close button to press", pad.CloseButton ~= nil, true)
calls = {}
pad:FocusGamepad()
Expect("the cursor starts on its first row", Called("target other Started Only"), true)
pad.rows[1]:Click()
Expect("A on a row flips its switch", onlyOn, true)
Expect("...and ticks the row", pad.rows[1].tick:IsShown(), true)
calls = {}
pad.CloseButton:Click()
Run(pad, "OnHide")
Expect("B closes it", pad:IsShown(), false)
Expect("...and the cursor goes back to the window", Called("popup hidden filter"), true)
calls = {}
filter:OnSmartNavClick()
Expect("A on the filter arrow opens it too", pad:IsShown() and Called("popup shown filter"), true)
Press("PADFORWARD")
Run(pad, "OnHide")
Expect("...and Menu again closes it", pad:IsShown(), false)
onlyOn = false
gamepadUI = false
filter:OnSmartNavClick()
Expect("with the controller UI off, the game's menu opens as the mouse opens it", table.concat(presses, " "), "down up")
Expect("...and not the controller's", pad:IsShown(), false)
gamepadUI = true
presses = {}
Press("PADRSHOULDER")
Press("PADFORWARD")
Expect("...and on a tab without one does nothing", #presses + (pad:IsShown() and 1 or 0), 0)
Press("PADLSHOULDER")
C.window:UnfocusGamepad()
Expect("the controller on another window, the keys are the game's again", next(overrides), nil)
C.window:FocusGamepad()
Close()
Expect("closed, the keys are the game's again", next(overrides), nil)

-- Combat: the keys go as it starts, while the game still lets them, and come back after.
Open()
C.window:FocusGamepad()
stub.FireEvent("PLAYER_REGEN_DISABLED")
lockdown, restricted = true, true
Expect("as combat starts the keys are the game's again", next(overrides), nil)
lockdown, restricted = false, false
stub.FireEvent("PLAYER_REGEN_ENABLED")
Expect("...and the window's once combat ends, still focused", overrides.PADRSHOULDER ~= nil, true)
stub.FireEvent("PLAYER_REGEN_DISABLED")
lockdown, restricted = true, true
C.window:UnfocusGamepad()
Close()
lockdown, restricted = false, false
stub.FireEvent("PLAYER_REGEN_ENABLED")
Expect("closed in combat, it takes no keys back after", next(overrides), nil)

---------------------------------------------------------------- what is no stop
local resizer
for _, entry in ipairs(made) do
    if entry.parent == C.window and entry.frame.frameType == "Button" and entry.frame ~= C.window.CloseButton
        and entry.frame.scripts.OnMouseDown then
        resizer = entry.frame
    end
end
Open()
Expect("the resize grip, a drag the cursor cannot make, is no stop", resizer ~= nil and ignored[resizer] == true, true)
Expect("the list's scroll bar is no stop: moving down the rows scrolls it", ignored[list.bar.bar] == true, true)
Expect("the page's scroll bar is no stop: the right stick scrolls it", ignored[page.body.bar] == true, true)
Close()

---------------------------------------------------------------- the search box
Expect("A on the search box starts typing in it", type(rawget(list.searchBox, "OnSmartNavClick")), "function")
local search, typing, caught = list.searchBox, false, false
function search:SetFocus() typing = true; Run(self, "OnEditFocusGained") end
function search:ClearFocus() if typing then typing = false; Run(self, "OnEditFocusLost") end end
function search:EnableGamePadButton(on)
    assert(not lockdown, "an edit box takes the controller's buttons only out of combat")
    caught = on
end
Open()
Expect("not typing, the box has no script for the controller's buttons, which would take them all",
    search.handlers and search.handlers.OnGamePadButtonDown, nil)
search:OnSmartNavClick()
Expect("...by focusing it", typing, true)
Expect("typing, the box takes the controller's buttons: the game's bindings are dead there", caught, true)
search.handlers.OnGamePadButtonDown(search, "PADDDOWN")
Expect("any of them leaves the box", typing, false)
Expect("...and gives the buttons back", caught, false)
Expect("...script and all", search.handlers.OnGamePadButtonDown, nil)
search:SetFocus()
stub.FireEvent("PLAYER_REGEN_DISABLED")
Expect("combat starting leaves the box while the buttons can still be given back", typing or caught, false)
lockdown = true
search:SetFocus()
Expect("typing in combat, the box takes no buttons", caught, false)
search:ClearFocus()
lockdown = false
stub.FireEvent("PLAYER_REGEN_ENABLED")
gamepadUI = false
search:SetFocus()
Expect("with the controller UI off, the box takes no buttons", caught, false)
search:ClearFocus()
gamepadUI = true
Close()

---------------------------------------------------------------- rows built in sight of the cursor
Open()
local before = #made
calls = {}
list.opts.build = function()
    local items = {}
    for i = 1, 6 do table.insert(items, { key = "row" .. i, label = "Row " .. i }) end
    return items
end
list:Render()
local underParent = 0
for i = before + 1, #made do
    if made[i].parent ~= nil then underParent = underParent + 1 end
end
Expect("new rows are built with no parent, out of the game's hook on CreateFrame", underParent, 0)
Expect("...each put in the list after", list.rows[6]:GetParent(), list.child)
Expect("...and the cursor looks for its stops again", Called("refresh window"), true)
calls = {}
list:Render()
Expect("a redraw that adds no row asks nothing", Called("refresh window"), false)
Close()

---------------------------------------------------------------- combat
calls = {}
restricted = true
Open()
Expect("in combat the window waits: the manager refuses addons then", Called("shown window"), false)
restricted = false
stub.FireEvent("PLAYER_REGEN_ENABLED")
Expect("...and joins once combat ends, still open", Called("shown window"), true)
calls = {}
restricted = true
Close()
Expect("closed in combat, it waits to leave", Called("hidden window"), false)
restricted = false
stub.FireEvent("PLAYER_REGEN_ENABLED")
Expect("...and leaves once combat ends", Called("hidden window"), true)

calls = {}
restricted = true
Open()
Close()
restricted = false
stub.FireEvent("PLAYER_REGEN_ENABLED")
Expect("opened and closed within one fight, it never joins", Called("shown window") or Called("hidden window"), false)

local failures = Failures()
if failures > 0 then
    error(string.format("%d compendium gamepad test(s) failed", failures))
end
stub.print("compendium gamepad tests passed")
