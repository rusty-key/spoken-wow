-- The public surface of the player, as the plan's section 3.1 wrote it out. Every symbol a
-- feature addon may rely on exists here with its documented arity, and the ones with
-- observable behaviour are exercised once through the public seam rather than the
-- internals. Cheap, and it is what stops a refactor from silently deleting a function a
-- feature addon depends on. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers()
stub.LoadSpoken(SPOKEN)
local Spoken = _G.Spoken

---------------------------------------------------------------- version
Expect("API_VERSION is 1", Spoken.API_VERSION, 1)
-- Read out of the .toc rather than written here, which is the whole claim this makes: the
-- literal in Environment.lua loads before the addon has any metadata API, so nothing in the
-- game checks the two agree. A hardcoded expectation only asserts that a version bump touched
-- three files instead of two.
local toc = assert(io.open(SPOKEN .. "Spoken.toc")):read("*a")
Expect("ADDON_VERSION matches the TOC", Spoken.ADDON_VERSION, toc:match("## Version:%s*([^\r\n]+)"))
Expect("IsCompatible(1)", Spoken:IsCompatible(1), true)
Expect("not IsCompatible(2)", Spoken:IsCompatible(2), false)

---------------------------------------------------------------- every documented method exists
local METHODS = {
    -- sources
    "RegisterSource", "GetSource", "IterateSources",
    -- presentation registries
    "RegisterOptionalAction", "RegisterBullet", "RegisterPortraitRenderer",
    -- player-wide queue
    "GetCurrent", "GetNowPlaying", "GetQueue", "GetQueueSize", "GetWaitingCount",
    "IsPlaying", "IsPaused", "GetHeldReason",
    "Pause", "Resume", "TogglePause", "Skip", "StopAll", "AddGate", "MuteChannel", "MuteGameDialogueAhead",
    -- callbacks
    "RegisterCallback", "UnregisterCallback",
    -- packs
    "EnumerateAddonsWithKey",
    -- frame, settings
    "GetPlayerFrame", "GetSettingsCategory", "OpenSettings", "AddSettingsLink", "RefreshPlayer",
    "GetPlayerStyle", "SetPlayerHost", "AddDialogueUISettings",
    -- captions
    "GetCaption", "GetCaptionOptions", "SplitCaption",
    -- developer tools: the Spoken_Developer module's
    "RegisterDeveloper", "HasLog", "Log", "IsLogOn", "SetLogOn", "LogLines", "ClearLog", "ShowLog",
    "AddLogSource", "ShowLogMenu", "LogMenuHint", "AddDeveloperSettings", "GetDeveloperSettings",
    "AddDiagnostics", "Diagnostics",
    -- contributions
    "ShowContribution", "SetContributeHost", "AreContributeButtonsHidden",
}
for _, name in ipairs(METHODS) do
    Expect("Spoken:" .. name .. " exists", type(Spoken[name]), "function")
end
Expect("Spoken.Packs.Register exists", type(Spoken.Packs and Spoken.Packs.Register), "function")
Expect("Spoken.Packs.Get exists", type(Spoken.Packs and Spoken.Packs.Get), "function")
Expect("Spoken.Minimap.AddEntry exists", type(Spoken.Minimap and Spoken.Minimap.AddEntry), "function")
Expect("Spoken.Minimap.RemoveEntry exists", type(Spoken.Minimap and Spoken.Minimap.RemoveEntry), "function")

local SOURCE_METHODS = { "Enqueue", "PlayNow", "Remove", "StopAll", "AddGate", "RecheckGates", "CanPlay", "SetQueueLimit", "SetInterClipGap" }
local src = Spoken:RegisterSource("contract", { title = "Contract", addon = "X", order = 1 })
for _, name in ipairs(SOURCE_METHODS) do
    Expect("source:" .. name .. " exists", type(src[name]), "function")
end

---------------------------------------------------------------- behaviour through the seam
Expect("GetSource finds it", Spoken:GetSource("contract"), src)
local keys = {}
for key in Spoken:IterateSources() do table.insert(keys, key) end
Expect("IterateSources yields it", keys[1], "contract")

local started
local handle = Spoken:RegisterCallback("CLIP_STARTED", function(clip) started = clip end)
local clip = H.Clip()
src:Enqueue(clip)
Expect("a callback registered through the API fires", started, clip)
Expect("GetCurrent is the head", Spoken:GetCurrent(), clip)
Expect("GetNowPlaying is the speaking head", Spoken:GetNowPlaying(), clip)
Expect("IsPlaying", Spoken:IsPlaying(), true)
Expect("GetQueueSize", Spoken:GetQueueSize(), 1)
Expect("GetWaitingCount", Spoken:GetWaitingCount(), 0)
Expect("GetQueue is a copy", Spoken:GetQueue()[1] == clip and Spoken:GetQueue() ~= Spoken:GetQueue(), true)
Expect("GetHeldReason is nil when free", Spoken:GetHeldReason(clip), nil)

Spoken:UnregisterCallback(handle)
started = nil
src:Enqueue(H.Clip())
Spoken:Skip()
Expect("an unregistered callback stays quiet", started, nil)

Spoken:Pause()
Expect("Pause", Spoken:IsPaused(), true)
Spoken:Resume()
Expect("Resume", Spoken:IsPaused(), false)
Spoken:TogglePause()
Expect("TogglePause", Spoken:IsPaused(), true)
Spoken:StopAll()
Expect("StopAll empties", Spoken:GetQueueSize(), 0)
Expect("...and unpauses", Spoken:IsPaused(), false)

Spoken:AddGate(function() return "held by the player" end)
local held = H.Clip()
src:Enqueue(held)
Expect("a player-wide gate holds every source", Spoken:GetHeldReason(held), "held by the player")

---------------------------------------------------------------- registries
Spoken:RegisterBullet("contract-bullet", "Interface\\X", 12)
Expect("a registered bullet is retrievable", Spoken:GetBullet("contract-bullet").texture, "Interface\\X")
Spoken:RegisterPortraitRenderer("contract", { Acquire = function() end, Update = function() end, Release = function() end })
Expect("a registered renderer is retrievable", type(Spoken:GetPortraitRenderer("contract")), "table")

Spoken.Packs:Register("contract", "SomePackFolder", { version = 1 })
Expect("Packs.Get returns what was registered", Spoken.Packs:Get("contract")[1].version, 1)
Expect("Packs.Get for an unknown source is empty", getn(Spoken.Packs:Get("nothing")), 0)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll API contract tests passed")
