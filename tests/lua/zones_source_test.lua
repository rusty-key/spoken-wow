-- The zones addon speaking through the player. Audio.lua and Autoplay.lua are loaded for
-- real against a hand-built SpokenZones table; the queue, frame and callbacks are the real
-- Spoken ones. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local SPOKEN = here .. "/../../addons/Spoken/"
local ZONES = here .. "/../../addons/Spoken_Zones/"
local Expect, Failures = H.Expecter(print)

local BOOK = [[Interface\AddOns\Spoken_Zones\Textures\Book]]

local NewZoneLore = H.NewZoneLore

_G.ZoneLoreAudioPacks = {
    ZoneLoreAudio = { version = 1, addon = "ZoneLoreAudio", quality = "high", bitrate = 128, language = "enUS",
        zones = { [1411] = { file = "1411\\zone", len = 81.9 } },
        subzones = { [1411] = { ["valley of trials"] = { file = "1411\\valley-of-trials", len = 35 } } } },
}

-- The stub's timers, which stub.Advance drives. Boot swaps them out; a test that wants the
-- addon's own C_Timer calls to run puts them back.
local StubAfter = _G.C_Timer.After

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
Expect("...portrait is the zone's icon, trimmed of its border", zone.present.portrait.kind .. ":" .. zone.present.portrait.texture
    .. ":" .. table.concat(zone.present.portrait.texCoord, ","), "texture:" .. [[Interface\AddOns\Spoken\Textures\Zones\Durotar]] .. ":0.08,0.92,0.08,0.92")
Expect("...and the book for a map with no icon", Z:Portrait(9999).texture, BOOK)
Expect("...with Report as its only action", zone.present.actions[1].id, "report")
Expect("...and nothing else", zone.present.actions[2], nil)
Expect("...remembers where it came from", zone.mapID, 1411)

local sub = Z:NewLoreSound(1411, "valley of trials")
Expect("a subzone clip keeps the frozen line id", sub.key, "s:1411:valley of trials")
Expect("...header is the zone, label the subzone", sub.present.header .. " / " .. sub.present.label, "Durotar / Valley of Trials")
Expect("no pack entry, no clip", Z:NewLoreSound(1426, nil), nil)
Expect("a place with no picture sends none", zone.present.picture, nil)
Z.Picture = function(_, mapID, key) if mapID == 1411 and not key then return "Pictures/1411", "Pictures/Mask3" end end
local pictured = Z:NewLoreSound(1411, nil)
Expect("...one with a picture sends it and its frayed edge, for a window to show",
    pictured.present.picture and (pictured.present.picture.file .. " " .. pictured.present.picture.mask), "Pictures/1411 Pictures/Mask3")
Expect("...and how large Place Lore draws it beside the map, its panel less its margins",
    pictured.present.picture.pixels, (Z:Get("panelWidth") - 66) * UIParent:GetEffectiveScale())
Z.Picture = nil

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

local quests = Spoken:RegisterSource("quests", { title = "Quests", addon = "Spoken_Quests", order = 1 })
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
Spoken:StopAll()

---------------------------------------------------------------- the cinematic gate
-- The greeting fires two seconds after load, and a new character's intro can start after
-- that. Holding at the door is not enough: a clip already speaking must stop for it.
env, Z = Boot(); Spoken = _G.Spoken
local cinematic = false
_G.InCinematic = function() return cinematic end
local greeting = Z:NewLoreSound(1411, "valley of trials"); greeting.autoplay = true
Z:EnqueueLore(greeting)
Expect("before the intro, the greeting speaks", Spoken:IsPlaying(greeting), true)
cinematic = true
stub.FireEvent("CINEMATIC_START")
Expect("CINEMATIC_START stops an autoplayed clip already speaking", Spoken:IsPlaying(), false)
Expect("...and keeps it queued", Spoken:GetCurrent(), greeting)
Expect("...held for the cinematic", Spoken:GetHeldReason(greeting), "Waiting for the cinematic to end.")
stub.Advance(60)
Expect("...for as long as the cinematic runs", Spoken:IsPlaying(), false)
cinematic = false
stub.Advance(1)
Expect("the intro over, it replays", Spoken:IsPlaying(greeting), true)
Spoken:StopAll()

-- A movie is shown by MovieFrame's own PLAY_MOVIE handler, which may run after this
-- addon's, so the recheck is repeated a frame later.
env, Z = Boot(); Spoken = _G.Spoken
_G.InCinematic = function() return false end
local movie = Z:NewLoreSound(1411, nil); movie.autoplay = true
Z:EnqueueLore(movie)
_G.C_Timer.After = StubAfter
_G.MovieFrame = CreateFrame("Frame")
_G.MovieFrame:Hide()
stub.FireEvent("PLAY_MOVIE", 1)
Expect("PLAY_MOVIE before the movie frame is up stops nothing yet", Spoken:IsPlaying(movie), true)
_G.MovieFrame:Show()
stub.Advance(0.05)
Expect("...the recheck a frame later does", Spoken:IsPlaying(), false)
Spoken:StopAll()
_G.MovieFrame = nil

env, Z = Boot(); Spoken = _G.Spoken
cinematic = false
_G.InCinematic = function() return cinematic end
Expect("a clicked clip plays", Z:PlayLore(1411, nil), true)
cinematic = true
stub.FireEvent("CINEMATIC_START")
Expect("...and is not cut off by a cinematic", Spoken:IsPlaying(), true)
Spoken:StopAll()
_G.InCinematic = nil

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
Expect("the zones addon adds its settings entry to the one button, and not the Compendium's",
    table.concat(labels, "|"), "Stop or Replay|Stop All|Settings|Zones Settings")
-- The Compendium is Spoken's own entry, there once a part has a tab in it, and opens the window.
assert(loadfile(ZONES .. "UI/Compendium.lua"))("Spoken_Zones", Z)
local opened = 0
SpokenCompendium:Register("places", { label = "Zones", order = 1, build = function() end,
    open = function() opened = opened + 1 end })
labels = {}
for _, entry in ipairs(env.Minimap:BuildMenu()) do table.insert(labels, entry.text) end
Expect("...which is Spoken's, before Settings, once a part has a tab", table.concat(labels, "|"),
    "Stop or Replay|Stop All|Open Azeroth's Compendium|Settings|Zones Settings")
env.Minimap:FindEntry("Compendium").onClick()
Expect("...and opens the window through the tab", opened, 1)
SpokenCompendium.tabs.places.enabled = function() return false end
labels = {}
for _, entry in ipairs(env.Minimap:BuildMenu()) do table.insert(labels, entry.text) end
Expect("...and is gone while no tab's part is on", table.concat(labels, "|"),
    "Stop or Replay|Stop All|Settings|Zones Settings")
SpokenCompendium = nil
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
-- Boots the greeting with GetPlayerMapID counting how often it is asked. Answering nil ends
-- each attempt on the next line, which is all these need: the question is whether the gate
-- let an attempt get this far, not what it would have narrated.
local function BootGreeting(restored, level)
    stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers()
    stub.ldbObjects = {}; stub.dbIcons = {}
    world.inCombat = false
    world.playerLevel = level
    local env = stub.LoadSpoken(SPOKEN)
    env.Addon:Enable()
    _G.C_Timer.After = StubAfter
    local Z = stub.LoadZones(ZONES, NewZoneLore())
    Z.savedVariablesRestored = restored
    local counter = { asked = 0 }
    Z.GetPlayerMapID = function() counter.asked = counter.asked + 1 end
    Z.GetLoreWithFallback = function() return nil, nil end
    Z:SetupAudio()
    Z:SetupAutoplay()
    _G.SpokenZonesCharacter = nil
    return counter
end

-- One attempt: the first runs two seconds after setup.
local function GreetingAsked(restored, level)
    local counter = BootGreeting(restored, level)
    stub.Advance(2)
    _G.SpokenZonesCharacter = nil
    return counter.asked > 0
end

Expect("a client that restored nothing is not greeted", GreetingAsked(false, 60), false)
-- The case the greeting exists for: a character standing in the valley it woke up in, which
-- the client never announces. Worth hearing once per login on a client that cannot remember.
Expect("...unless the character is new", GreetingAsked(false, 1), true)
Expect("a greeting runs as before once something was restored", GreetingAsked(true, 60), true)

-- An intro that outlasts the greeting's attempts. On a client that plays it somewhere else,
-- with a loading screen after, every attempt during it resolves nothing; a player who
-- watched it to the end arrived after the last one and was greeted by nothing.
local cinematic = true
_G.InCinematic = function() return cinematic end
local counter = BootGreeting(true, 1)
stub.Advance(60)
Expect("the greeting does not ask where the player is during an intro", counter.asked, 0)
cinematic = false
stub.Advance(60)
Expect("once it is over, the greeting gets all its attempts", counter.asked, 8)
_G.InCinematic = nil
_G.SpokenZonesCharacter = nil

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
