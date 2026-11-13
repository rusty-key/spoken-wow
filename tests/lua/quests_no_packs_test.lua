-- The quests module with no sound pack at all: a dialog says so at login, or under the gamepad UI,
-- where a popup an addon opens taints the gamepad's bindings and closing it hangs the client
-- (#165), a line in chat. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local Expect, Failures = H.Expecter(print)

local function Login(addons)
    stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers(); stub.ResetUIActions()
    stub.SetAddOns(addons)
    _G.Spoken, _G.SpokenEnv = nil, nil
end

local function Said(text)
    for _, line in ipairs(stub.chat) do
        if string.find(line, text, 1, true) then return true end
    end
    return false
end

local function NoPacks()
    for _, popup in ipairs(stub.popups) do
        if popup.key == "VOICEOVER_NO_REGISTERED_DATA_MODULES" then return popup.dialog end
    end
end
local SPOKEN = here .. "/../../addons/Spoken/"
Login({})
local VO = stub.LoadQuests(QUESTS, SPOKEN)
VO.Addon:OnInitialize()
VO.Addon:ShowMissingDataModulePopup()
Expect("with no voice pack, a dialog says so", NoPacks() and string.find(NoPacks().text, "No usable voice packs", 1, true) ~= nil, true)
Login({})
SetCVar("InputDeviceInterfaceStyle", "1")
VO = stub.LoadQuests(QUESTS, SPOKEN)
VO.Addon:OnInitialize()
VO.Addon:ShowMissingDataModulePopup()
Expect("...under the gamepad UI, no dialog", NoPacks(), nil)
Expect("...but a line in chat", Said("No usable voice packs were loaded."), true)

stub.ResetAddOns()
if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll no-sound-pack tests passed")
