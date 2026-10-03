-- The zones addon speaking through the player. Audio.lua and Autoplay.lua are loaded for
-- real against a hand-built SpokenZones table; the queue, frame and callbacks are the real
-- Spoken ones. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local SPOKEN = here .. "/../../addons/SpokenPlayer/"
local ZONES = here .. "/../../addons/SpokenZones/"
local Expect, Failures = H.Expecter(print)

local BOOK = [[Interface\AddOns\SpokenZones\Textures\Book]]

local NewZoneLore = H.NewZoneLore

_G.ZoneLoreAudioPacks = {
    ZoneLoreAudio = { version = 1, addon = "ZoneLoreAudio", quality = "high", bitrate = 128, language = "enUS",
        zones = { [1411] = { file = "1411\\zone", len = 81.9 } },
        subzones = { [1411] = { ["valley of trials"] = { file = "1411\\valley-of-trials", len = 35 } } } },
}

local function Boot()
    stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers()
    stub.ldbObjects = {}; stub.dbIcons = {}
    world.inCombat = false
    local env = stub.LoadSpoken(SPOKEN)
    env.Addon:Enable()
    _G.C_Timer.After = function() end   -- the login greeting is Autoplay's own business, not this test's
    local Z = stub.LoadZones(ZONES, NewZoneLore())
    Z:SetupAudio()
    Z:SetupAutoplay()
    return env, Z
end

---------------------------------------------------------------- registration and the clip shape
local env, Z = Boot()
local Spoken = _G.Spoken
Expect("the zones addon registers a source with the player", Spoken:GetSource("zones"), Z.source)
-- No channel of its own: the channel is one setting, on the player.
Expect("...on the player's channel", Z.source:GetChannel(), "Master")
Expect("...SpokenZones's queue limit", Z.source.queueLimit, 3)
Expect("...and its own gap", Z.source.interClipGap, 0.25)

local zone = Z:NewLoreSound(1411, nil)
Expect("a zone clip keeps the frozen line id as its key", zone.key, "z:1411")
Expect("...resolves the pack path", zone.path, [[Interface\AddOns\ZoneLoreAudio\Sounds\1411\zone.mp3]])
Expect("...and the pack's duration", zone.length, 81.9)
Expect("...header is the zone", zone.present.header, "Durotar")
Expect("...label is the zone too", zone.present.label, "Durotar")
Expect("...portrait is the book", zone.present.portrait.kind .. ":" .. zone.present.portrait.texture, "texture:" .. BOOK)
Expect("...with Report as its only action", zone.present.actions[1].id, "report")
Expect("...and nothing else", zone.present.actions[2], nil)
Expect("...remembers where it came from", zone.mapID, 1411)

local sub = Z:NewLoreSound(1411, "valley of trials")
Expect("a subzone clip keeps the frozen line id", sub.key, "s:1411:valley of trials")
Expect("...header is the zone, label the subzone", sub.present.header .. " / " .. sub.present.label, "Durotar / Valley of Trials")
Expect("no pack entry, no clip", Z:NewLoreSound(1426, nil), nil)

---------------------------------------------------------------- playing through the player
env, Z = Boot(); Spoken = _G.Spoken
local changed = 0
Z:OnAudioChanged(function() changed = changed + 1 end)
Expect("PlayLore plays", Z:PlayLore(1411, nil), true)
Expect("...through the player", Spoken:IsPlaying(), true)
Expect("...on the player's channel", world.playedChannels[1], "Master")
Expect("IsPlayingLore for that entry", Z:IsPlayingLore(1411, nil), true)
Expect("...not for another", Z:IsPlayingLore(1411, "valley of trials"), false)
local m, a, paused = Z:GetNowPlaying()
Expect("GetNowPlaying names it", tostring(m) .. "/" .. tostring(a) .. "/" .. tostring(paused), "1411/nil/false")
Expect("the player's AUDIO_CHANGED reaches SpokenZones's own listeners", changed > 0, true)
Expect("starting marks the area heard in the per-character record", Z:HasHeard(1411, nil), true)

local F = env.PlayerFrame
Expect("the player frame shows the zone", F.frame.container.name:GetText(), "Durotar")
-- Report only, as an icon in the corner. Reading the text is reached from the map, the
-- minimap menu and /spz; a button on the player that opened a window over the thing being
-- read was one way too many.
Expect("...and no strip of buttons", F.frame.actions.shown, 0)
Expect("...but Report in the corner", F.frame.actions.buttons[1].anchor.point, "TOPRIGHT")

env, Z = Boot(); Spoken = _G.Spoken
Z:PlayLore(1411, nil)
F = env.PlayerFrame
Expect("Report is an icon, in the player's round button", F.frame.actions.buttons[1].glyph ~= nil
    and F.frame.actions.buttons[1].ring ~= nil, true)
F.frame.actions.buttons[1]:Click()
Expect("...targeting what is playing", Z.copied, "https://spoken.test/r/1411/nil")

---------------------------------------------------------------- pause, skip, stop
Z:PauseLore()
Expect("PauseLore pauses the player", Spoken:IsPaused(), true)
Expect("...and SpokenZones sees it", Z:IsPaused(), true)
Z:ResumeLore()
Expect("ResumeLore", Spoken:IsPaused(), false)

local quests = Spoken:RegisterSource("quests", { title = "Quests", addon = "SpokenQuests", order = 1 })
local q = H.Clip()
quests:Enqueue(q)
Z:EnqueueLore(Z:NewLoreSound(1411, "valley of trials"))
Expect("QueueLength counts only the zones addon's waiting clips", Z:QueueLength(), 1)
Z:StopLore()
Expect("StopLore removes the zones clips", Z:IsPlayingLore(), false)
Expect("...and leaves another source's alone", Spoken:GetQueue()[1], q)
Spoken:StopAll()

---------------------------------------------------------------- the combat gate
env, Z = Boot(); Spoken = _G.Spoken
world.inCombat = true
local held = Z:NewLoreSound(1411, nil)
held.autoplay = true
Expect("an autoplayed clip is admitted", Z:EnqueueLore(held), true)
Expect("...but held in combat", Spoken:GetHeldReason(held), "Waiting for combat to end.")
Expect("...and not speaking", Spoken:IsPlaying(), false)
Expect("a clicked clip is not held", Z:PlayLore(1411, "valley of trials"), true)
Spoken:StopAll()
world.inCombat = true
held = Z:NewLoreSound(1411, nil); held.autoplay = true
Z:EnqueueLore(held)
world.inCombat = false
stub.Advance(1)
Expect("leaving combat, the retry tick starts it", Spoken:IsPlaying(held), true)

---------------------------------------------------------------- refusals
env, Z = Boot(); Spoken = _G.Spoken
Z:Set("voiceEnabled", false)
Expect("voice off: PlayLore refuses", Z:PlayLore(1411, nil), false)
Expect("...and queues nothing", Spoken:GetQueueSize(), 0)
Z:Set("voiceEnabled", true)
Expect("no clip: PlayLore refuses", Z:PlayLore(1426, nil), false)
Expect("...and says why", Z.printed[getn(Z.printed)]:find("no narration") ~= nil, true)

---------------------------------------------------------------- the minimap
env, Z = Boot()
local labels = {}
for _, entry in ipairs(env.Minimap:BuildMenu()) do table.insert(labels, entry.text) end
Expect("the zones addon adds its entries to the one button", table.concat(labels, "|"),
    "Play/Pause|Stop|Settings|Open Lore of Azeroth|Zones Settings")
Expect("...and registers no button of its own", stub.ldbObjects.SpokenZones, nil)

---------------------------------------------------------------- without the player
stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers()
local saved = _G.Spoken
_G.Spoken = nil
local alone = stub.LoadZones(ZONES, NewZoneLore())
alone:SetupAudio()
Expect("without Spoken, PlayLore refuses rather than erroring", alone:PlayLore(1411, nil), false)
Expect("...and says the player is missing", alone.printed[1] and alone.printed[1]:find("Spoken") ~= nil, true)
Expect("...IsPlayingLore is false", alone:IsPlayingLore(), false)
_G.Spoken = saved

---------------------------------------------------------------- both generations of the pack registry
-- A pack announces itself by writing into a global table, never by folder name, which is
-- why the packs kept their names through the rename. The table is being renamed, so both
-- are read, and a pack that writes into both is listed once.
local function Packs(spokenZones, zoneLore, legacy)
	_G.SpokenZonesAudioPacks, _G.ZoneLoreAudioPacks, _G.ZoneLoreAudioData = spokenZones, zoneLore, legacy
	local Z = select(2, Boot())
	return Z:GetAudioPacks(), Z
end
local function Pack(folder, bitrate)
	return { version = 1, addon = folder, quality = "high", bitrate = bitrate or 128, language = "enUS",
		zones = {}, subzones = {} }
end
local savedPacks = _G.ZoneLoreAudioPacks

local found = Packs(nil, { ZoneLoreAudio = Pack("ZoneLoreAudio") }, nil)
Expect("a pack in the inherited registry is found", #found, 1)
Expect("...by its folder", found[1] and found[1].addon, "ZoneLoreAudio")

found = Packs({ SpokenZonesAudio = Pack("SpokenZonesAudio") }, nil, nil)
Expect("a pack in the new registry is found", #found, 1)
Expect("...by its folder", found[1] and found[1].addon, "SpokenZonesAudio")

-- A pack that ended up in both registries -- one written by an older build of this
-- pipeline, which wrote both -- is one installed folder and must be offered once.
local shared = Pack("SpokenZonesAudio")
found = Packs({ SpokenZonesAudio = shared }, { SpokenZonesAudio = shared }, nil)
Expect("a pack in both registries is listed once", #found, 1)

found = Packs({ SpokenZonesAudio = Pack("SpokenZonesAudio", 128) },
	{ ZoneLoreAudio64 = Pack("ZoneLoreAudio64", 64) }, nil)
Expect("two packs across the two registries are both found", #found, 2)
Expect("...still ordered by bitrate", found[1] and found[1].addon, "SpokenZonesAudio")

-- The pre-registry global, which only ever named one folder.
found = Packs(nil, nil, Pack("ZoneLoreAudio"))
Expect("a pack predating either registry is still found", #found, 1)

_G.SpokenZonesAudioPacks, _G.ZoneLoreAudioData = nil, nil
_G.ZoneLoreAudioPacks = savedPacks

---------------------------------------------------------------- the login greeting
-- The greeting is the one thing here that needs a memory: "have I greeted this character"
-- is not a question the client can answer. On a client that restores no saved variables --
-- the 1.60.1 beta writes both files every logout and reads neither back, for every addon --
-- that memory is always empty, and the greeting stops being a greeting: it narrates the
-- current zone at every login instead of once per character.
--
-- Asked by the question the greeting puts first, rather than by what ends up in the queue:
-- reaching GetPlayerMapID is exactly "the gate let me through", and stubbing it to nil ends
-- the attempt there without needing lore, audio or a map behind it.
local function GreetingAsked(restored, level)
    stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers()
    stub.ldbObjects = {}; stub.dbIcons = {}
    world.inCombat = false
    world.playerLevel = level
    local seed
    local env = stub.LoadSpoken(SPOKEN)
    env.Addon:Enable()
    _G.C_Timer.After = function(_, fn) seed = seed or fn end
    local Z = stub.LoadZones(ZONES, NewZoneLore())
    Z.savedVariablesRestored = restored
    local asked = false
    Z.GetPlayerMapID = function() asked = true end
    -- Answering nil ends the attempt on the next line, which is all this needs: the
    -- question is whether the gate let it get this far, not what it would have narrated.
    Z.GetLoreWithFallback = function() return nil, nil end
    Z:SetupAudio()
    Z:SetupAutoplay()
    _G.SpokenZonesCharDB = nil
    seed()
    _G.SpokenZonesCharDB = nil
    return asked
end

Expect("a client that restored nothing is not greeted", GreetingAsked(false, 60), false)
-- The case the greeting exists for: a character standing in the valley it woke up in, which
-- the client never announces. Worth hearing once per login on a client that cannot remember.
Expect("...unless the character is new", GreetingAsked(false, 1), true)
Expect("a greeting runs as before once something was restored", GreetingAsked(true, 60), true)

---------------------------------------------------------------- the pack this repo ships
-- The shipped Data/Sounds.lua, loaded for real. Everything above uses hand-built tables, so
-- nothing until here notices if the generator writes a registry name the addon does not read
-- -- which is exactly what a rename does, and the generator is the half that moves.
local PACK_FOLDER = "SpokenZonesAudio"
local packSaved = { _G.SpokenZonesAudioPacks, _G.ZoneLoreAudioPacks, _G.ZoneLoreAudioData }
_G.SpokenZonesAudioPacks, _G.ZoneLoreAudioPacks, _G.ZoneLoreAudioData = nil, nil, nil

stub.SetAddOns({ { folder = PACK_FOLDER, meta = {
    ["X-SpokenZones-Quality"] = "high",
    ["X-SpokenZones-Bitrate"] = "128",
    ["X-SpokenZones-Language"] = "enUS",
    ["Version"] = "2.0.0",
} } })
local shipped = assert(loadfile(here .. "/../../addons/SpokenZonesAudio/Data/Sounds.lua"))
shipped(PACK_FOLDER)

Expect("the shipped pack registers itself", type(_G.SpokenZonesAudioPacks), "table")
local registered = _G.SpokenZonesAudioPacks and _G.SpokenZonesAudioPacks[PACK_FOLDER]
Expect("...under its folder name", registered and registered.addon, PACK_FOLDER)
Expect("...in a format this build reads", registered and registered.version, 1)
Expect("...reading its quality out of the .toc", registered and registered.quality, "high")
Expect("...and its language", registered and registered.language, "enUS")
Expect("...with lore to play", registered and registered.zones and registered.zones[1411] ~= nil, true)
-- Not in the pre-rename registries: writing those was dropped once the addon and the pack
-- started shipping together, and a pack that still wrote them would be found twice.
Expect("...and nowhere else", _G.ZoneLoreAudioPacks, nil)
Expect("...including the pre-registry global", _G.ZoneLoreAudioData, nil)

found = Packs(_G.SpokenZonesAudioPacks, nil, nil)
Expect("the addon finds the shipped pack", #found, 1)
_G.SpokenZonesAudioPacks, _G.ZoneLoreAudioPacks, _G.ZoneLoreAudioData =
    packSaved[1], packSaved[2], packSaved[3]

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll zones source tests passed")
