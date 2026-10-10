-- The player is an optional dependency, so a feature addon loads without it and says so.
-- The one case worth a dialog rather than a line of chat is the player being installed and
-- switched off: that is one click to fix, and the addon manager that installed the player
-- cannot notice. Both feature addons carry their own copy of this, because the code they
-- would share lives in the addon that is missing. In the quests addon it is PlayerRequired.lua,
-- the one file that runs without Spoken's dialogue core. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local ZONES = here .. "/../../addons/Spoken_Zones/"
local Expect, Failures = H.Expecter(print)

local DISABLED = { folder = "Spoken", title = "Spoken", loadable = false, reason = "DISABLED" }
local PACK = { folder = "TestPack", meta = { ["X-VoiceOver-DataModule-Version"] = "1", Version = "1.2.1" } }

--- A login with no player loaded, and the addon list the scenario describes.
local function Login(addons)
    stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetUIActions()
    stub.SetAddOns(addons)
    _G.Spoken, _G.SpokenEnv = nil, nil
    _G.SpokenPlayerRequiredBy, _G.SpokenPlayerPrompted = nil, nil
end

local function Shown()
    for _, popup in ipairs(stub.popups) do
        if popup.key == "SPOKEN_PLAYER_REQUIRED" then
            return popup.dialog
        end
    end
end

---------------------------------------------------------------- one addon, player switched off
Login({ PACK, DISABLED })
local Q = stub.LoadQuestsAlone(QUESTS)
Q.PromptForPlayer()
local dialog = Shown()
Expect("the dialog is raised", dialog ~= nil, true)
Expect("...naming the addon that needs the player", dialog and dialog.text,
    "|cffffd200Spoken|r is required to use Spoken Quests.")
Expect("...offering to enable it", dialog and dialog.button1, "Enable")
Expect("...and to decline", dialog and dialog.button2, "Cancel")
Expect("nothing is enabled until the button is clicked", #stub.enabledAddOns, 0)
dialog.OnAccept()
Expect("accepting enables the player", stub.enabledAddOns[1], "Spoken")
Expect("...and reloads, since an addon only loads at login", stub.reloads, 1)

---------------------------------------------------------------- said once, however many addons ask
Login({ PACK, DISABLED })
Q = stub.LoadQuestsAlone(QUESTS)
local Z = stub.LoadZones(ZONES, H.NewZoneLore())
Z:SetupAudio()
Q.PromptForPlayer()
Z:PromptForPlayer()
local seen = 0
for _, popup in ipairs(stub.popups) do
    if popup.key == "SPOKEN_PLAYER_REQUIRED" then seen = seen + 1 end
end
Expect("two addons raise one dialog", seen, 1)
Expect("...naming both", Shown() and Shown().text,
    "|cffffd200Spoken|r is required to use Spoken Quests and Spoken Zones.")

---------------------------------------------------------------- the zones addon alone
Login({ PACK, DISABLED })
Z = stub.LoadZones(ZONES, H.NewZoneLore())
Z:SetupAudio()
Z:PromptForPlayer()
Expect("the zones addon raises it too", Shown() ~= nil, true)
Expect("...naming itself", Shown() and Shown().text,
    "|cffffd200Spoken|r is required to use Spoken Zones.")

---------------------------------------------------------------- the gamepad UI
-- A popup an addon opens there taints the gamepad's bindings, and closing it hangs the client
-- (#165): the same words go to chat instead.
local function Said(text)
    for _, line in ipairs(stub.chat) do
        if string.find(line, text, 1, true) then return true end
    end
    return false
end
Login({ PACK, DISABLED })
SetCVar("InputDeviceInterfaceStyle", "1")
Q = stub.LoadQuestsAlone(QUESTS)
Expect("under the gamepad UI, the quests addon raises no dialog", Q.PromptForPlayer() and Shown(), nil)
Expect("...and says it in chat", Said("|cffffd200Spoken|r is required to use Spoken Quests. Enable it in the AddOns list and reload."), true)
Expect("...once", Q.PromptForPlayer(), false)

Login({ PACK, DISABLED })
SetCVar("InputDeviceInterfaceStyle", "1")
Z = stub.LoadZones(ZONES, H.NewZoneLore())
Z:SetupAudio()
Expect("the zones addon raises none either", Z:PromptForPlayer() and Shown(), nil)
Expect("...and says it in chat", Z.printed[#Z.printed], "|cffffd200Spoken|r is required to use Spoken Zones. Enable it in the AddOns list and reload.")

-- No sound pack at all: the quests addon's other login popup. It needs the player loaded, as
-- everything but the dialog above does.
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
Expect("with no sound pack, a dialog says so", NoPacks() and string.find(NoPacks().text, "No usable sound packs", 1, true) ~= nil, true)
Login({})
SetCVar("InputDeviceInterfaceStyle", "1")
VO = stub.LoadQuests(QUESTS, SPOKEN)
VO.Addon:OnInitialize()
VO.Addon:ShowMissingDataModulePopup()
Expect("...under the gamepad UI, no dialog", NoPacks(), nil)
Expect("...but a line in chat", Said("No usable sound packs were loaded."), true)

---------------------------------------------------------------- not installed at all
-- Nothing to enable, so nothing to click. The addon's own line in chat already says it.
Login({ PACK })
Q = stub.LoadQuestsAlone(QUESTS)
Q.PromptForPlayer()
Expect("an absent player raises no dialog", Shown(), nil)

---------------------------------------------------------------- present and enabled
Login({ PACK, { folder = "Spoken", title = "Spoken" } })
Q = stub.LoadQuestsAlone(QUESTS)
Q.PromptForPlayer()
Expect("an enabled player raises no dialog", Shown(), nil)

---------------------------------------------------------------- nothing else runs without the player
-- The rest of the addon runs in Spoken's dialogue core; without it, each file returns at once.
Login({ PACK, DISABLED })
_G.VoiceOver = nil
stub.SetLoadedPlayers({})
Q = stub.LoadQuestsAlone(QUESTS)
Expect("without the player, the addon makes no environment", _G.VoiceOver, nil)
Expect("...and registers nothing", stub.aceAddons and stub.aceAddons["SpokenQuests"], nil)
Expect("...and has nothing to warn about an old player", Q.WarnOldPlayer(), false)

---------------------------------------------------------------- a player too old to carry the core
-- Loaded, so there is nothing to enable; but a Spoken from before the dialogue core gives this
-- addon nothing to run on, and that is said in chat.
Login({ PACK, { folder = "Spoken", title = "Spoken" } })
_G.VoiceOver = nil
_G.Spoken = {}
Q = stub.LoadQuestsAlone(QUESTS)
Expect("an old player is named in chat", Q.WarnOldPlayer() and Said("needs a newer |cffffd200Spoken|r. Update Spoken and reload."), true)
Expect("...and raises no dialog", Q.PromptForPlayer(), false)
Expect("...none is shown", Shown(), nil)
_G.Spoken = nil

---------------------------------------------------------------- the player actually loaded
stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetUIActions()
stub.ResetAddOns()
_G.SpokenPlayerRequiredBy, _G.SpokenPlayerPrompted = nil, nil
VO = stub.LoadQuests(QUESTS, SPOKEN)
VO.Addon:OnInitialize()
Q = dofile(QUESTS .. "PlayerRequired.lua")
Q.PromptForPlayer()
Expect("a loaded player raises no dialog", Shown(), nil)
Expect("...nor a warning that it is old", Q.WarnOldPlayer(), false)

stub.ResetAddOns()
if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll player-required tests passed")
