-- Upstream's players handle the same events and queue the same line, so SpokenQuests stops any
-- it finds running and disables its folder for the next login. A folder that registered
-- nothing is left alone: disabling an addon is something current clients refuse, with their
-- own "blocked from an action only available to the Blizzard UI" dialog. This project's own
-- old folder, VoiceOverRedux, is Spoken's to find (Core.lua, OLD_FOLDERS), not this addon's.
-- Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local Expect, Failures = H.Expecter(print)

local PACK = { folder = "TestPack", meta = { ["X-VoiceOver-DataModule-Version"] = "1", Version = "1.2.1" } }
local UPSTREAM = { folder = "AI_VoiceOver", title = "VoiceOver" }
local CONTINUED = { folder = "AI_VoiceOver_Continued", title = "VoiceOver Continued" }
local REDUX = { folder = "VoiceOverRedux", title = "VoiceOver Redux" }

--- A login with the addon list and the old players the scenario describes. The saved
--- variables are dropped unless the scenario is a second login of the same character.
local function Login(addons, loadedPlayers, keepSaved)
    stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetUIActions()
    stub.SetAddOns(addons)
    stub.SetLoadedPlayers(loadedPlayers)
    if not keepSaved then
        _G.SpokenQuestsSettings, _G.VoiceOverDB = nil, nil
    end
    _G.Spoken, _G.SpokenEnv = nil, nil
    _G.SpokenPlayerRequiredBy, _G.SpokenPlayerPrompted = nil, nil
    local VO = stub.LoadQuests(QUESTS, here .. "/../../addons/Spoken/")
    VO.Addon:OnInitialize()
    return VO
end

local function Shown()
    for _, popup in ipairs(stub.popups) do
        if popup.key == "VOICEOVER_REDUX_DUPLICATE_ADDON" then
            return popup.dialog
        end
    end
end

---------------------------------------------------------------- a fresh install
Login({ PACK }, {})
Expect("a fresh install raises no dialog", Shown(), nil)
Expect("...and disables nothing", #stub.disabledAddOns, 0)

---------------------------------------------------------------- an old player is really there
Login({ PACK, CONTINUED }, { "VoiceOverContinued" })
Expect("a registered old player is stopped for the session",
    stub.aceAddons["VoiceOverContinued"] and stub.aceAddons["VoiceOverContinued"].stopped, true)
Expect("...its folder disabled for the next login", stub.disabledAddOns[1], "AI_VoiceOver_Continued")
Expect("...and the dialog names it", Shown() and Shown().text:find('"AI_VoiceOver_Continued"', 1, true) ~= nil, true)

---------------------------------------------------------------- this project's own old folder
Login({ PACK, REDUX }, { "VoiceOverRedux" })
Expect("VoiceOverRedux is Spoken's to report, not a dialog here", Shown(), nil)
Expect("...and not disabled from here", #stub.disabledAddOns, 0)

---------------------------------------------------------------- upstream, under its own name
-- The AceAddon name a player registers under is not the folder it installs into, and the
-- dialog has to say the folder: that is what the player deletes or leaves switched off.
Login({ PACK, UPSTREAM }, { "VoiceOver" })
Expect("upstream's folder is disabled, not its AceAddon name", stub.disabledAddOns[1], "AI_VoiceOver")
Expect("...and the dialog names the folder", Shown() and Shown().text:find('"AI_VoiceOver"', 1, true) ~= nil, true)

---------------------------------------------------------------- installed, already switched off
-- Nothing registered, so nothing is duplicating anything. The dialog used to say it "was also
-- enabled" about a folder the player had disabled themselves.
Login({ PACK, UPSTREAM }, {})
Expect("an old player switched off raises no dialog", Shown(), nil)
Expect("...and is not disabled again", #stub.disabledAddOns, 0)

---------------------------------------------------------------- said once
Login({ PACK, CONTINUED }, { "VoiceOverContinued" })
Shown().OnAccept()
Login({ PACK, CONTINUED }, { "VoiceOverContinued" }, true)
Expect("the dialog is not repeated at the next login", Shown(), nil)
Expect("...though the duplicate is still disabled", stub.disabledAddOns[1], "AI_VoiceOver_Continued")

stub.ResetAddOns()
stub.SetLoadedPlayers({})
if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll duplicate-player tests passed")
