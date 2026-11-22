-- Entering Spoken's settings pages with the controller's cursor. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local SPOKEN = here .. "/../../addons/Spoken/"
local QUESTS = here .. "/../../addons/Spoken_Quests/"

local refreshed = {}
-- The cursor as FocusContainer leaves it: inside the page's group, on a button not on screen.
local cursor = { inGroup = false, topLeft = 0 }
_G.SmartNavigation_CanFocusFrame = function() return true end
_G.SmartNavigation_IsFrameIgnored = function() return false end
_G.SmartNavigation = {
    UpdateParent = function(_, frame) table.insert(refreshed, frame) end,
    IsInFocusGroup = function() return cursor.inGroup end,
    GetCurrentButton = function() return cursor.current end,
    SelectTopLeftButton = function() cursor.topLeft = cursor.topLeft + 1 end,
    SetTargetButtonForFrame = function(_, frame, button) cursor.targetFor, cursor.target = frame, button end,
}
-- FocusContainer as the game's ends: on a stale button off screen.
local categoryButton = CreateFrame("Button")
_G.SettingsPanel = {
    FocusContainer = function()
        cursor.inGroup = true
        cursor.current = cursor.stale
    end,
    IsShown = function() return true end,
    GetCategoryList = function() return { GetSelectedCategoryButton = function() return categoryButton end } end,
}
local inCombat = false
_G.InCombatLockdown = function() return inCombat end

_G.UISpecialFrames = _G.UISpecialFrames or {}
stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
stub.settingsCategories = {}; stub.ldbObjects = {}; stub.dbIcons = {}
stub.world.questID = 0; stub.ShowPanel(nil)
local VO = stub.LoadQuests(QUESTS, SPOKEN)
VO.Addon:OnInitialize()
_G.SpokenEnv.Addon:Enable()
stub.LoadQuestsPanel(QUESTS, VO):Setup()
VO.GossipSettingsPanel:Setup()
stub.FireEvent("PLAYER_ENTERING_WORLD"); stub.Advance(0.1)

local function Asked(frame)
    for _, f in ipairs(refreshed) do if f == frame then return true end end
    return false
end

Expect("Spoken registers its page and the modules' pages", #stub.settingsCategories > 1, true)
-- Only a mouse can click the game's +, so Spoken opens with its pages listed.
Expect("Spoken's entry in the settings list starts unfolded", stub.settingsCategories[1].name .. " "
    .. tostring(stub.settingsCategories[1]:IsExpanded()), "Spoken true")
for _, category in ipairs(stub.settingsCategories) do
    -- Shown already, the page would get no OnShow when the window first takes it.
    Expect(category.name .. " waits hidden until the settings window shows it", category.frame.shown, false)
    refreshed = {}
    category.frame:Show()
    Expect("showing " .. category.name .. " asks the cursor to find its buttons", Asked(category.frame), true)
end

inCombat = true
for _, category in ipairs(stub.settingsCategories) do
    refreshed = {}
    category.frame:Show()
    Expect("...but not in combat, where the cursor refuses addons: " .. category.name, #refreshed, 0)
end
inCombat = false

-- Spoken's own page: its first row is Quests' card, under the page's Defaults, its search box and
-- the section's Show Welcome Window.
local page = _G.SpokenOptionsPanel
local first = page.layout.entries[2].frame
for _, category in ipairs(stub.settingsCategories) do category.frame:Hide() end
page:Show()
local hidden = CreateFrame("CheckButton"); hidden:Hide()
local function Enter(stale)
    cursor.stale, cursor.topLeft, cursor.target, cursor.targetFor = stale, 0, nil, nil
    _G.SettingsPanel:FocusContainer()
end
Enter(hidden)
Expect("entering a Spoken page off a button not on screen puts the cursor on the page's first row",
    cursor.target == first, true)
Expect("...through the settings window's target", cursor.targetFor == _G.SettingsPanel, true)
Expect("...which is the Quests card, not a button over the rows", page.layout.entries[2].label, "Quests")
-- Scrolled past the Quests card, the page's first row in view is Gossip's.
local view = page.layout.parent.layoutScroller.frame
view.verticalScroll = -page.layout.entries[2].frame.layoutY + 1
Enter(hidden)
Expect("a page scrolled down puts the cursor on its first row in view, not one scrolled away",
    cursor.target == page.layout.entries[3].frame, true)
Expect("...which is Gossip's card", page.layout.entries[3].label, "Gossip")
view.verticalScroll = 0
-- The stub's Hide fires no OnHide; the client's does.
page:Hide()
for _, fn in ipairs(page.hooks.OnHide or {}) do fn(page) end
Expect("...and leaving the page gives the window back its own target, the category's button",
    cursor.target == categoryButton, true)
page:Show()
local row = CreateFrame("CheckButton"); row:Show()
Enter(row)
Expect("...but leaves it on a button that is on screen", cursor.target, nil)
page:Hide()
Enter(hidden)
Expect("...and leaves another addon's page to the game", cursor.target, nil)
page:Show(); inCombat = true
Enter(hidden)
Expect("...and does nothing in combat", cursor.target, nil)
inCombat = false

_G.SmartNavigation, _G.InCombatLockdown, _G.SettingsPanel = nil, nil, nil
_G.SmartNavigation_CanFocusFrame, _G.SmartNavigation_IsFrameIgnored = nil, nil
os.exit(Failures() == 0 and 0 or 1)
