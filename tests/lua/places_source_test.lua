-- The Places addon speaking through the player. Audio.lua and Autoplay.lua are loaded for
-- real against a hand-built SpokenPlaces table; the queue, frame and callbacks are the real
-- Spoken ones. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local SPOKEN = here .. "/../../addons/Spoken/"
local PLACES = here .. "/../../addons/Spoken_Places/"
local Expect, Failures = H.Expecter(print)

local BOOK = [[Interface\AddOns\Spoken\Textures\Book]]

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
    stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()
    stub.ldbObjects = {}; stub.dbIcons = {}
    world.inCombat = false
    local env = stub.LoadSpoken(SPOKEN)
    env.Addon:Enable()
    _G.C_Timer.After = function() end   -- the login greeting is Autoplay's own business, not this test's
    local Z = stub.LoadPlaces(PLACES, NewZoneLore())
    Z:SetupAudio()
    Z:SetupAutoplay()
    return env, Z
end

---------------------------------------------------------------- registration and the clip shape
local env, Z = Boot()
local Spoken = _G.Spoken
Expect("the places addon registers a source with the player", Spoken:GetSource("places"), Z.source)
Expect("...headed in the minimap menu by its page's name, in the player's language", Z.source.title, Z.L.OPT_PAGE_TITLE)
-- No channel of its own: the channel is one setting, on the player.
Expect("...on the player's channel", Z.source:GetChannel(), "Master")
Expect("...SpokenPlaces' queue limit", Z.source.queueLimit, 3)
Expect("...and its own gap", Z.source.interClipGap, 0.25)

-- Durotar on Kalimdor and Orgrimmar in it, as Azeroth's Compendium nests them.
local names = { [947] = "Azeroth", [1414] = "Kalimdor", [1411] = "Durotar", [1454] = "Orgrimmar" }
local GetMapName = Z.GetMapName
Z.GetMapName = function(_, id) return names[id] end
local zone = Z:NewLoreSound(1411, nil)
Expect("a zone clip keeps the frozen line id as its key", zone.key, "z:1411")
Expect("...resolves the pack path", zone.path, [[Interface\AddOns\ZoneLoreAudio\Sounds\1411\zone.mp3]])
Expect("...and the pack's duration", zone.length, 81.9)
Expect("...headed by where the zone is, its continent, not its own name twice", zone.present.header, "Kalimdor")
local packZones = _G.ZoneLoreAudioPacks.ZoneLoreAudio.zones
for _, id in ipairs({ 1454, 1414, 947 }) do packZones[id] = { file = id .. "\\zone", len = 10 } end
local function Header(id) return tostring(Z:NewLoreSound(id, nil).present.header) end
Expect("a city is headed by the zone around it, a continent by the world, the world by nothing",
    Header(1454) .. " " .. Header(1414) .. " " .. Header(947), "Durotar Azeroth nil")
for _, id in ipairs({ 1454, 1414, 947 }) do packZones[id] = nil end
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
Z.Picture = nil
Z.GetMapName = GetMapName

---------------------------------------------------------------- playing through the player
env, Z = Boot(); Spoken = _G.Spoken
local changed = 0
Z:OnAudioChanged(function() changed = changed + 1 end)
GetMapName = Z.GetMapName
Z.GetMapName = function(_, id) return names[id] end
Expect("PlayLore plays", Z:PlayLore(1411, nil), true)
Expect("...through the player", Spoken:IsPlaying(), true)
Expect("...on the player's channel", world.playedChannels[1], "Master")
Expect("IsPlayingLore for that entry", Z:IsPlayingLore(1411, nil), true)
Expect("...not for another", Z:IsPlayingLore(1411, "valley of trials"), false)
local m, a, paused = Z:GetNowPlaying()
Expect("GetNowPlaying names it", tostring(m) .. "/" .. tostring(a) .. "/" .. tostring(paused), "1411/nil/false")
Expect("the player's AUDIO_CHANGED reaches SpokenPlaces' own listeners", changed > 0, true)
Expect("starting marks the area heard in the per-character record", Z:HasHeard(1411, nil), true)

local F = env.PlayerFrame
Expect("the player frame shows where the zone is, then its name", F.frame.container.name:GetText() .. " "
    .. tostring(F.frame.container.label:GetText()), "Kalimdor • Durotar")
Z.GetMapName = GetMapName
-- Report only, as an icon among the header's controls. Reading the text is reached from the map,
-- the minimap menu and /spz; a button on the player that opened a window over the thing being
-- read was one way too many.
Expect("...and Report its only action", #F.frame.actions.buttons, 1)
Expect("...but Report in the header after Skip", F.row and F.row[3] == F.frame.actions.buttons[1]
    and F.frame.actions.buttons[1]:GetParent() == F.controls, true)

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
Expect("...and SpokenPlaces sees it", Z:IsPaused(), true)
Z:ResumeLore()
Expect("ResumeLore", Spoken:IsPaused(), false)

local quests = Spoken:RegisterSource("quests", { title = "Quests", addon = "Spoken_Quests", order = 1 })
local q = H.Clip()
quests:Enqueue(q)
Z:EnqueueLore(Z:NewLoreSound(1411, "valley of trials"))
Expect("QueueLength counts only the Places addon's waiting clips", Z:QueueLength(), 1)
Z:StopLore()
Expect("StopLore removes the places clips", Z:IsPlayingLore(), false)
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
Expect("the Places addon adds its settings entry to the one button, and not the Compendium's",
    table.concat(labels, "|"), "Stop or Replay|Skip Line|Stop All|Settings|Places Settings")
-- The Compendium is Spoken's own entry, there once a part has a tab in it, and opens the window.
dofile(here .. "/../../addons/Spoken/UI/Compendium.lua")
local opened = 0
SpokenCompendium:Register("places", { label = "Places", order = 1, build = function() end,
    open = function() opened = opened + 1 end })
labels = {}
for _, entry in ipairs(env.Minimap:BuildMenu()) do table.insert(labels, entry.text) end
Expect("...which is Spoken's, before Settings, once a part has a tab", table.concat(labels, "|"),
    "Stop or Replay|Skip Line|Stop All|Open Azeroth's Compendium|Settings|Places Settings")
env.Minimap:FindEntry("Compendium").onClick()
Expect("...and opens the window through the tab", opened, 1)
SpokenCompendium.tabs.places.enabled = function() return false end
labels = {}
for _, entry in ipairs(env.Minimap:BuildMenu()) do table.insert(labels, entry.text) end
Expect("...and is gone while no tab's part is on", table.concat(labels, "|"),
    "Stop or Replay|Skip Line|Stop All|Settings|Places Settings")
SpokenCompendium = nil
Expect("...and registers no button of its own", stub.ldbObjects.SpokenPlaces, nil)

---------------------------------------------------------------- without the player
stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()
local saved = _G.Spoken
_G.Spoken = nil
local alone = stub.LoadPlaces(PLACES, NewZoneLore())
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
	_G.SpokenPlacesAudioPacks, _G.ZoneLoreAudioPacks, _G.ZoneLoreAudioData = spokenZones, zoneLore, legacy
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

found = Packs({ SpokenPlacesAudio = Pack("SpokenPlacesAudio") }, nil, nil)
Expect("a pack in the new registry is found", #found, 1)
Expect("...by its folder", found[1] and found[1].addon, "SpokenPlacesAudio")

-- A pack that ended up in both registries -- one written by an older build of this
-- pipeline, which wrote both -- is one installed folder and must be offered once.
local shared = Pack("SpokenPlacesAudio")
found = Packs({ SpokenPlacesAudio = shared }, { SpokenPlacesAudio = shared }, nil)
Expect("a pack in both registries is listed once", #found, 1)

found = Packs({ SpokenPlacesAudio = Pack("SpokenPlacesAudio", 128) },
	{ ZoneLoreAudio64 = Pack("ZoneLoreAudio64", 64) }, nil)
Expect("two packs across the two registries are both found", #found, 2)
Expect("...still ordered by bitrate", found[1] and found[1].addon, "SpokenPlacesAudio")

-- The pre-registry global, which only ever named one folder.
found = Packs(nil, nil, Pack("ZoneLoreAudio"))
Expect("a pack predating either registry is still found", #found, 1)

-- Packs released while the module was Zones write SpokenZonesAudioPacks, and are read too; one
-- beside its renamed replacement is the same pack a release older, and is not.
_G.SpokenZonesAudioPacks = { SpokenZonesAudio_deDE = Pack("SpokenZonesAudio_deDE") }
found = Packs(nil, nil, nil)
Expect("a pack released as SpokenZonesAudio is found", found[1] and found[1].addon, "SpokenZonesAudio_deDE")
_G.SpokenZonesAudioPacks.SpokenZonesAudio = Pack("SpokenZonesAudio")
found = Packs({ SpokenPlacesAudio_deDE = Pack("SpokenPlacesAudio_deDE") }, nil, nil)
local names = {}
for _, pack in ipairs(found) do table.insert(names, pack.addon) end
table.sort(names)
Expect("...but not beside its SpokenPlacesAudio replacement", table.concat(names, " "), "SpokenPlacesAudio_deDE SpokenZonesAudio")
_G.SpokenZonesAudioPacks = nil

_G.SpokenPlacesAudioPacks, _G.ZoneLoreAudioData = nil, nil
_G.ZoneLoreAudioPacks = savedPacks

---------------------------------------------------------------- the login greeting
-- Reaching GetPlayerMapID means the gate let the attempt through, and stubbing it to nil
-- ends the attempt there.
local function BootGreeting(level)
    stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()
    stub.ldbObjects = {}; stub.dbIcons = {}
    world.inCombat = false
    world.playerLevel = level
    local env = stub.LoadSpoken(SPOKEN)
    env.Addon:Enable()
    _G.C_Timer.After = StubAfter
    local Z = stub.LoadPlaces(PLACES, NewZoneLore())
    local counter = { asked = 0 }
    Z.GetPlayerMapID = function() counter.asked = counter.asked + 1 end
    Z.GetLoreWithFallback = function() return nil, nil end
    Z:SetupAudio()
    Z:SetupAutoplay()
    _G.SpokenPlacesCharacter = nil
    return counter
end


-- An intro that outlasts the greeting's attempts. On a client that plays it somewhere else,
-- with a loading screen after, every attempt during it resolves nothing; a player who
-- watched it to the end arrived after the last one and was greeted by nothing.
local cinematic = true
_G.InCinematic = function() return cinematic end
local counter = BootGreeting(1)
stub.Advance(60)
Expect("the greeting does not ask where the player is during an intro", counter.asked, 0)
cinematic = false
stub.Advance(60)
Expect("once it is over, the greeting gets all its attempts", counter.asked, 8)
_G.InCinematic = nil
_G.SpokenPlacesCharacter = nil

---------------------------------------------------------------- the pack this repo ships
-- The shipped Data/Sounds.lua, loaded for real. Everything above uses hand-built tables, so
-- nothing until here notices if the generator writes a registry name the addon does not read
-- -- which is exactly what a rename does, and the generator is the half that moves.
local PACK_FOLDER = "SpokenPlacesAudio"
local packSaved = { _G.SpokenPlacesAudioPacks, _G.ZoneLoreAudioPacks, _G.ZoneLoreAudioData }
_G.SpokenPlacesAudioPacks, _G.ZoneLoreAudioPacks, _G.ZoneLoreAudioData = nil, nil, nil

stub.SetAddOns({ { folder = PACK_FOLDER, meta = {
    ["X-SpokenPlaces-Quality"] = "high",
    ["X-SpokenPlaces-Bitrate"] = "128",
    ["X-SpokenPlaces-Language"] = "enUS",
    ["Version"] = "2.0.0",
} } })
local shipped = assert(loadfile(here .. "/../../addons/SpokenPlacesAudio/Data/Sounds.lua"))
shipped(PACK_FOLDER)

Expect("the shipped pack registers itself", type(_G.SpokenPlacesAudioPacks), "table")
local registered = _G.SpokenPlacesAudioPacks and _G.SpokenPlacesAudioPacks[PACK_FOLDER]
Expect("...under its folder name", registered and registered.addon, PACK_FOLDER)
Expect("...in a format this build reads", registered and registered.version, 1)
Expect("...reading its quality out of the .toc", registered and registered.quality, "high")
Expect("...and its language", registered and registered.language, "enUS")
Expect("...with lore to play", registered and registered.zones and registered.zones[1411] ~= nil, true)
-- Not in the pre-rename registries: writing those was dropped once the addon and the pack
-- started shipping together, and a pack that still wrote them would be found twice.
Expect("...and nowhere else", _G.ZoneLoreAudioPacks, nil)
Expect("...including the pre-registry global", _G.ZoneLoreAudioData, nil)

found = Packs(_G.SpokenPlacesAudioPacks, nil, nil)
Expect("the addon finds the shipped pack", #found, 1)
_G.SpokenPlacesAudioPacks, _G.ZoneLoreAudioPacks, _G.ZoneLoreAudioData =
    packSaved[1], packSaved[2], packSaved[3]

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll places source tests passed")
