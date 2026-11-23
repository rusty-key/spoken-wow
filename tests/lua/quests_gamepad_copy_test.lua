-- A sound pack's address under the controller UI: never the game's popup, which an addon opening
-- it taints, so closing it is blocked and the d-pad stops moving through the settings (#165).
-- Spoken's own copy box shows it instead, for every module that offers an address. Run with
-- `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local SPOKEN = here .. "/../../addons/Spoken/"
local QUESTS = here .. "/../../addons/Spoken_Quests/"

stub.SetClient("16001")
local VO = stub.LoadQuests(QUESTS, SPOKEN)
VO.ReportButton:Initialize()
local URL = "https://example.invalid/pack"

local shown = {}
local ShowContribution = _G.Spoken.ShowContribution
_G.Spoken.ShowContribution = function(_, payload, address, isLink)
    table.insert(shown, { payload = payload, address = address, isLink = isLink })
    return true
end
local function Popups() return #stub.popups end

SetCVar("InputDeviceInterfaceStyle", "0")
local before = Popups()
VO.ReportButton:ShowAddress(URL)
Expect("with mouse and keyboard, the address is in the game's popup", Popups() - before, 1)
Expect("...and not in Spoken's box", #shown, 0)

SetCVar("InputDeviceInterfaceStyle", "1")
before = Popups()
VO.ReportButton:ShowAddress(URL)
Expect("with the controller UI, the game's popup stays shut", Popups() - before, 0)
Expect("...Spoken's copy box shows the address, as a link", shown[1] and (shown[1].payload .. " "
    .. tostring(shown[1].isLink)), URL .. " true")

-- Places, Readables and Bosses offer their pack's address (Download) and Places and Readables
-- their Report address through a popup of their own, each in its CopyLink.lua.
local ADDONS = here .. "/../../addons/"
for _, each in ipairs({ { "Spoken_Places", "SpokenPlaces" }, { "Spoken_Readables", "SpokenReadables" },
        { "Spoken_Bosses", "Bosses" } }) do
    local ns = {}
    assert(loadfile(ADDONS .. each[1] .. "/UI/CopyLink.lua"))(each[1], ns)
    shown = {}
    SetCVar("InputDeviceInterfaceStyle", "0")
    before = Popups()
    ns:ShowCopyLink(URL, "Copy it")
    Expect(each[2] .. ": with mouse and keyboard, the game's popup", Popups() - before .. " " .. #shown, "1 0")
    SetCVar("InputDeviceInterfaceStyle", "1")
    before = Popups()
    ns:ShowCopyLink(URL, "Copy it")
    Expect("...with the controller UI, Spoken's copy box", Popups() - before .. " "
        .. tostring(shown[1] and shown[1].payload), "0 " .. URL)
end

_G.Spoken.ShowContribution = ShowContribution
SetCVar("InputDeviceInterfaceStyle", "0")
os.exit(Failures() == 0 and 0 or 1)
