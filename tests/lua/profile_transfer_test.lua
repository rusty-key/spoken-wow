-- Export Profile and Import Profile: a profile moves to another character or install as a string,
-- the importing install keeps its own defaults for what the string does not set, and a string
-- that is not a whole profile changes nothing. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local SPOKEN = here .. "/../../addons/Spoken/"
local QUESTS = here .. "/../../addons/Spoken_Quests/"

_G.UISpecialFrames = _G.UISpecialFrames or {}
stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
stub.settingsCategories = {}; stub.ldbObjects = {}; stub.dbIcons = {}
stub.world.questID = 0; stub.ShowPanel(nil)
local VO = stub.LoadQuests(QUESTS, SPOKEN)
VO.Addon:OnInitialize()
local env = _G.SpokenEnv
env.Addon:Enable()
local Options, Defaults = env.Options, env.Defaults or _G.Defaults
local function Spoken() return env.Addon.db.profile end
local function Quests() return VO.Addon.db.profile end

Spoken().Frame.FrameScale = 0.9
Spoken().Frame.HiddenActions = { report = true }
Quests().Audio.GossipFrequency = 99
local payload = Options:ProfileString()
Expect("the profile exports as a string", type(payload) == "string" and payload:sub(1, 5) == "SPP1:", true)

Spoken().Frame.FrameScale = 1.2
Spoken().Frame.BronzeTint = false
Spoken().Frame.HiddenActions = {}
Quests().Audio.GossipFrequency = 1
-- Another install, or a later version: a default the exporting one did not have, and one that
-- differs from what the exporting one had.
Defaults.profile.Frame.ImportedLater = true
Defaults.profile.Frame.LockFrame = true

Expect("the string imports", Options:ImportProfile(payload), true)
Expect("...with what the player set", Spoken().Frame.FrameScale, 0.9)
Expect("...nested tables included", Spoken().Frame.HiddenActions.report, true)
Expect("...and the modules' settings", Quests().Audio.GossipFrequency, 99)
Expect("a setting changed since the export goes back to its default", Spoken().Frame.BronzeTint, true)
Expect("a setting the string does not have keeps this install's default", Spoken().Frame.ImportedLater, true)
Expect("a default of the exporting install is not carried over as a choice", Spoken().Frame.LockFrame, true)
Defaults.profile.Frame.ImportedLater, Defaults.profile.Frame.LockFrame = nil, false

-- A value of another type than its default is left out, not written over the default.
Spoken().Frame.FrameScale = "large"
local wrongType = Options:ProfileString()
Spoken().Frame.FrameScale = 1.1
Options:ImportProfile(wrongType)
Expect("a value of the wrong type keeps the default", Spoken().Frame.FrameScale, Defaults.profile.Frame.FrameScale)

Spoken().Frame.FrameScale = 1.3
for label, bad in pairs({ empty = "", unprefixed = payload:sub(6), noise = "SPP1:not a profile",
    truncated = payload:sub(1, #payload - 8) }) do
    Expect("a " .. label .. " string is refused", Options:ImportProfile(bad), false)
end
Expect("...and the profile is untouched", Spoken().Frame.FrameScale, 1.3)

if Failures() > 0 then print(Failures() .. " failure(s)"); os.exit(1) end
