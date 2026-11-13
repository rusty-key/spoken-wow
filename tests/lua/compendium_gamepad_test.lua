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
local C = _G.SpokenCompendium

-- A tab as the parts lay theirs out: a list of a few rows, the first chosen, and a page beside it.
local chosen = "first"
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
        addScrollBar = function(scroll, child, inset) return SpokenTextView.AddScrollBar(scroll, child, inset) end,
    })
    page = C.NewPage(C.PageHolder(panel, list), "Spoken_Quests")
    function panel:Refresh() list:Render() end
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
} }
_G.SmartNavigation = {
    RefreshButtonGroups = function(_, frame) Record("refresh", frame == C.window and "window" or "other") end,
    SetScrollFrameForFrame = function(_, frame, scroll)
        Record("stick", frame == C.window and "window" or "other", page and scroll == page.body.frame and "page" or tostring(scroll))
    end,
    SetTargetButtonForFrame = function(_, frame, button)
        Record("target", frame == C.window and "window" or "other", button and button.row and button.row.key or "none")
    end,
}
local ignored = {}
_G.SmartNavigation_MarkFrameIgnored = function(frame) ignored[frame] = true end

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
local focused
function list.searchBox:SetFocus() focused = true end
list.searchBox:OnSmartNavClick()
Expect("...by focusing it", focused, true)

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
