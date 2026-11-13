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

stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()
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
    "EndMuteGameDialogueAhead",
    -- Read in Battlegrounds
    "ReadsHere",
    -- callbacks
    "RegisterCallback", "UnregisterCallback",
    -- packs
    "EnumerateAddonsWithKey",
    -- frame, settings
    "GetPlayerFrame", "GetSettingsCategory", "OpenSettings", "RefreshPlayer",
    "GetPlayerStyle", "SetPlayerHost", "AddDialogueUISettings",
    -- Azeroth's Compendium's Text Size, which Places, Readables and Quests draw their words at
    "CompendiumFontSize", "SetCompendiumFontSize",
    -- the profile a feature addon's own AceDB settings start a new character on
    "NewCharacterStartProfile",
    -- captions
    "GetCaption", "GetCaptionOptions", "SplitCaption", "CaptionWords",
    -- developer tools: the Spoken_Developer module's
    "RegisterDeveloper", "HasLog", "Log", "IsLogOn", "SetLogOn", "LogLines", "ClearLog", "ShowLog",
    "AddLogSource", "ShowLogMenu", "LogMenuHint", "AddDeveloperSettings", "GetDeveloperSettings",
    "AddDiagnostics", "Diagnostics",
    -- contributions
    "ShowContribution", "ShowReport", "SetContributeHost", "AreContributeButtonsHidden",
    -- a speaker's face on a feature addon's page
    "CreateSpeakerFace",
    -- Play, Skip and Report on DialogueUI's quest window and book view
    "CreateDialogueUIRow",
}
for _, name in ipairs(METHODS) do
    Expect("Spoken:" .. name .. " exists", type(Spoken[name]), "function")
end
Expect("CaptionWords counts the words the captions show, escapes removed",
    #Spoken:CaptionWords("aaaa |cffff0000bbbb|r |T x:0|tcccc|ndddd"), 4)
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

---------------------------------------------------------------- a speaker's face
-- The Small Window's portrait on a page of the caller's: the creature's still where the client
-- has its appearance, else the book; an object's picture; the line's badge on its disc.
do
    local E = SpokenEnv
    local BOOK = [[Interface\AddOns\Spoken\Textures\Book]]
    local page = CreateFrame("Frame", nil, UIParent)
    local face = Spoken:CreateSpeakerFace(page, 44)
    local function Drawn()
        if face.still:IsShown() then return "still " .. tostring(face.still.display) end
        local texture = face.viewport.texture
        return texture and texture:IsShown() and texture:GetTexture() or "nothing"
    end
    Expect("a face is the size asked for, on the page", face:GetWidth() .. " " .. tostring(face:GetParent() == page), "44 true")
    Expect("...in the Small Window's ring", face.ring:GetTexture(), [[Interface\AddOns\Spoken\Textures\MinimalPortraitRing]])
    Expect("...with no speaker, the book, never an empty socket", Drawn(), BOOK)
    Expect("...and no badge", tostring(face.badge:IsShown()) .. " " .. tostring(face.badgeBackground:IsShown()), "false false")

    world.creatureDisplays[197] = { 3258 }
    face:SetSpeaker({ creatureID = 197, bullet = "quest-accept" })
    Expect("a creature the client has: its still", Drawn(), "still 3258")
    Expect("...with the bullet's badge on its disc", face.badge:IsShown() and face.badgeBackground:IsShown()
        and face.badge:GetTexture(), E.Face.BADGES["quest-accept"])
    Expect("...at least 12 across on a small face", face.badge:GetWidth(), 12)

    world.creatureDisplays[240] = { 1990 }
    world.displaysUncached = true
    face:SetSpeaker({ creatureID = 240, bullet = "quest-complete" })
    Expect("a creature the client has not cached: the book meanwhile", Drawn(), BOOK)
    Expect("...asking for it while shown", type(face.scripts.OnUpdate), "function")
    world.displaysUncached = false
    world.time = world.time + 1
    face.scripts.OnUpdate(face, 1)
    Expect("...and its still once the client has it", Drawn(), "still 1990")
    Expect("...then asking no more", face.scripts.OnUpdate, nil)

    -- A model answers with the creature it held until the new one loads: each creature's face is its own.
    world.modelLags = true
    world.creatureDisplays[301], world.creatureDisplays[302], world.creatureDisplays[303] = { 4001 }, { 4002 }, { 4003 }
    local primed = {}
    for _, id in ipairs({ 301, 302, 303 }) do primed[#primed + 1] = tostring((E.StaticPortrait:Prime(id))) end
    world.time = world.time + 1
    for _, id in ipairs({ 301, 302, 303 }) do primed[#primed + 1] = tostring((E.StaticPortrait:Prime(id))) end
    world.modelLags = false
    Expect("creatures asked together keep their own appearances while the client loads them",
        table.concat(primed, " "), "nil nil nil 4001 4002 4003")

    -- A creature the client has not cached shows a stand-in face until the server replies: not a face.
    world.blankDisplay = 5555
    world.time = world.time + 0.1 -- the stand-ins are read once a frame
    world.creatureDisplays[311], world.creatureDisplays[312] = { 4011 }, { 4012 }
    world.unloaded = { [311] = true }
    local own = {}
    for _, id in ipairs({ 311, 312 }) do own[#own + 1] = tostring((E.StaticPortrait:Prime(id))) end
    world.time = world.time + 0.1
    own[#own + 1] = tostring((E.StaticPortrait:Prime(311)))
    world.unloaded = nil
    world.time = world.time + 1.1
    own[#own + 1] = tostring((E.StaticPortrait:Prime(311)))
    world.blankDisplay, world.unloaded = 5555, { [321] = true }
    local shipped = E.StaticPortrait:FromCreature(321, 4321)
    world.blankDisplay, world.unloaded = nil, nil
    Expect("a creature with a shipped appearance is drawn from it, whatever the client has cached",
        shipped and shipped.texture.display, 4321)
    Expect("an uncached creature takes the default face for no creature's, and its own once cached",
        table.concat(own, " "), "nil 4012 nil 4011")

    world.displaysUncached = true
    face:SetSpeaker({ creatureID = 6 })
    world.time = world.time + 10
    face.scripts.OnUpdate(face, 10)
    Expect("one the client never answers for keeps the book, and is no longer asked for",
        Drawn() .. " " .. tostring(face.scripts.OnUpdate), BOOK .. " nil")
    world.displaysUncached = false

    face:SetSpeaker({ objectOrItem = true, icon = [[Interface\Icons\INV_Misc_Book_08]] })
    Expect("an object or an item: its picture", Drawn(), [[Interface\Icons\INV_Misc_Book_08]])
    face:SetSpeaker({ objectOrItem = true })
    Expect("...else a posted notice", Drawn(), [[Interface\Icons\INV_Misc_Note_01]])

    -- Two faces of one NPC both show it: neither takes the other's texture.
    local other = Spoken:CreateSpeakerFace(page, 44)
    face:SetSpeaker({ creatureID = 197 })
    other:SetSpeaker({ creatureID = 197 })
    Expect("two faces of one creature each draw it", Drawn() .. " " .. tostring(other.still:IsShown()), "still 3258 true")
end

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll API contract tests passed")
