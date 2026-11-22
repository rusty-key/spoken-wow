-- The Spoken button lives on the minimap; on the modern clients that have Blizzard's
-- addon compartment, the same button is registered there too, sharing the one menu.
-- The flag sits with the other minimap settings and defaults on. Run with
-- `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

local function Clean()
    stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()
    stub.SetNativeMenuAPI(false)
    _G.SpokenSettings = nil
    _G.AddonCompartmentFrame = nil
    stub.dbIcons = {}
end

---------------------------------------------------------------- the button joins the compartment
Clean()
-- The frame the modern clients provide, and the register/update calls the real one
-- receives.
local registered = {}
_G.AddonCompartmentFrame = {
    registeredAddons = registered,
    RegisterAddon = function(self, data) table.insert(self.registeredAddons, data) end,
    UpdateDisplay = function() end,
}
local env = stub.LoadSpoken(SPOKEN)
env.Addon:Enable() -- registers the minimap button, with the compartment flag defaulting on
local mm = env.Addon.db.profile.Minimap.LibDBIcon
Expect("the compartment flag defaults on", mm.showInCompartment, true)
Expect("...and the button is in the compartment", #registered, 1)
Expect("...under the player's name", registered[1] and registered[1].text, "Spoken")

env.Minimap:ToggleCompartment(false)
Expect("turning it off removes the button", #registered, 0)
Expect("...and stores the choice", mm.showInCompartment, false)
env.Minimap:ToggleCompartment(true)
Expect("turning it back on re-registers it", #registered, 1)
Expect("...and marks it on", mm.showInCompartment, true)

---------------------------------------------------------------- the choice survives a reload
-- The lib clears the flag when it removes the entry, which AceDB reads back as on.
env.Minimap:ToggleCompartment(false)
stub.Logout()
_G.AddonCompartmentFrame.registeredAddons = {}
env = stub.LoadSpoken(SPOKEN)
env.Addon:Enable()
Expect("turned off, the flag is still off after a reload",
    env.Addon.db.profile.Minimap.LibDBIcon.showInCompartment, false)
Expect("...and the button stays out of the compartment", #_G.AddonCompartmentFrame.registeredAddons, 0)
env.Minimap:ToggleCompartment(true)
stub.Logout()
_G.AddonCompartmentFrame.registeredAddons = {}
env = stub.LoadSpoken(SPOKEN)
env.Addon:Enable()
Expect("turned back on, the flag is still on after a reload",
    env.Addon.db.profile.Minimap.LibDBIcon.showInCompartment, true)
Expect("...and the button is in the compartment", #_G.AddonCompartmentFrame.registeredAddons, 1)

--------------------------------------------------------------- clicks open on our button, not the menu's
-- Blizzard's compartment calls the entry with its own menu frame, which is closing as
-- the click is handled. The minimap passes the real button, so that path runs now and
-- anchors to it; the compartment path waits for the close and anchors to our button.
local ldb = stub.ldbObjects["Spoken"]
local button = stub.dbIcons["Spoken"].button
local compartmentMenu = stub.Frame("SpokenCompartmentMenu")
ldb.OnClick(button, "RightButton")
Expect("a minimap click opens the menu at once", stub.openDropDown, _G.SpokenMinimapDropDown)
Expect("...anchored to the button", _G.SpokenMinimapDropDown.dropdownAnchor, button)
_G.CloseDropDownMenus()
ldb.OnClick(compartmentMenu, "RightButton")
Expect("a compartment click waits for the menu to close", stub.openDropDown, nil)
stub.Advance(0.06)
Expect("...then opens on our button", stub.openDropDown, _G.SpokenMinimapDropDown)
Expect("...never on the compartment's frame", _G.SpokenMinimapDropDown.dropdownAnchor, button)
_G.CloseDropDownMenus()
local pausedBefore = env.Addon.db.char.IsPaused
ldb.OnClick(compartmentMenu, "MiddleButton")
Expect("a compartment command waits too", env.Addon.db.char.IsPaused, pausedBefore)
stub.Advance(0.06)
Expect("...then runs after the close", env.Addon.db.char.IsPaused, not pausedBefore)

---------------------------------------------------------------- the native MenuUtil menu
Clean()
env = stub.LoadSpoken(SPOKEN)
env.Addon:Enable()
stub.SetNativeMenuAPI(true)
env.Sources:Register("quests", { title = "Quests", addon = "Spoken_Quests", order = 1 })
local nativeButton = stub.dbIcons.Spoken.button
env.Minimap:AddEntry("quests", { id = "opts", text = "Quest settings", order = 1, onClick = function() end })
local nativeLdb = stub.ldbObjects.Spoken
nativeLdb.OnClick(nativeButton, "RightButton")
Expect("the native menu opens", stub.openNativeMenu ~= nil, true)
Expect("...anchored to the minimap button", stub.nativeMenuAnchor and stub.nativeMenuAnchor[2], nativeButton)
local nativeShown = {}
for _, entry in ipairs(stub.nativeMenuEntries) do
    table.insert(nativeShown, entry.kind == "divider" and "---"
        or (entry.kind == "title" and "[" .. entry.text .. "]" or entry.text))
end
Expect("...with the same grouped entries", table.concat(nativeShown, "|"),
    "Stop or Replay|Skip Forward|Eject|Settings|---|[Quests]|Quest settings")
local tooltip = _G.GameTooltip
tooltip:SetText("stale")
tooltip:Show()
stub.OpenOtherNativeMenu()
nativeLdb.OnTooltipShow(tooltip)
Expect("a replacement native menu releases Spoken's ownership", tooltip:IsShown(), true)
nativeLdb.OnClick(nativeButton, "RightButton")
Expect("the Spoken menu can reopen after the replacement", stub.openNativeMenu ~= nil, true)
nativeLdb.OnClick(nativeButton, "RightButton")
Expect("clicking the minimap button again closes the native menu", stub.openNativeMenu, nil)

local nativeCompartment = stub.Frame("NativeSpokenCompartmentMenu")
nativeLdb.OnClick(nativeCompartment, "RightButton")
Expect("a native compartment click waits for its parent menu", stub.openNativeMenu, nil)
stub.Advance(0.06)
Expect("...then opens the native menu on the real button", stub.nativeMenuAnchor and stub.nativeMenuAnchor[2], nativeButton)
stub.ResetDropDowns()
nativeButton:Hide()
nativeLdb.OnClick(nativeCompartment, "RightButton")
stub.Advance(0.06)
Expect("a hidden minimap button still positions the native menu", stub.nativeMenuAnchor and stub.nativeMenuAnchor[2], nativeButton)
Expect("...while UIParent keeps ownership visible", stub.nativeMenuOwner, _G.UIParent)

---------------------------------------------------------------- ...and nothing where there is no frame
Clean()
env = stub.LoadSpoken(SPOKEN)
env.Addon:Enable()
env.Minimap:ToggleCompartment(false)
Expect("the choice still sticks without a compartment",
    env.Addon.db.profile.Minimap.LibDBIcon.showInCompartment, false)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll minimap compartment tests passed")
