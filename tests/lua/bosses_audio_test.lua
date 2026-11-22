-- A boss's story voiced from an installed SpokenBossesAudio pack (Spoken Bosses' Audio.lua): the
-- pack in the voice language, else the fallback language's, else words alone as before; word
-- timings only under the recording's own language; the higher bitrate between two packs of one
-- language. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local ADDONS = here .. "/../../addons/"
local Expect, Failures = H.Expecter(stub.print)

dofile(ADDONS .. "Spoken/Data/Dungeons.lua")
dofile(ADDONS .. "Spoken_Bosses/Data/Bosses.lua")
dofile(ADDONS .. "Spoken_Bosses/Data/Creatures.lua")
_G.SpokenBossStories = { [36] = {} } -- the tests write their own stories, not the generated ones

stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
stub.LoadSpoken(ADDONS .. "Spoken/").Addon:Enable()
_G.C_Map = { GetMapInfo = function(id) return { name = "map " .. id, mapID = id } end,
    GetBestMapForUnit = function() return 1436 end }
_G.GetInstanceInfo = function() return "Outland", "none", 0, "", 0, 0, false, 0 end

local Bosses = {}
for _, file in ipairs({ "Locale/enUS", "Core", "Audio", "UI/Bosses", "Story" }) do
    assert(loadfile(ADDONS .. "Spoken_Bosses/" .. file .. ".lua"))("Spoken_Bosses", Bosses)
end
Bosses:InitDB()
Bosses:SetupStories()

local EDWIN = { file = "36\\edwin-vancleef", len = 41.2, times = "0 1 2" }
local function Pack(addon, language, bitrate, bosses)
    return { version = 1, addon = addon, language = language, quality = "high", bitrate = bitrate,
        packVersion = "dev", bosses = bosses or { [36] = { ["edwin vancleef"] = EDWIN } } }
end
local function Setup(locale, voice, fallback, packs, story)
    stub.SetLocale(locale)
    local language = _G.SpokenEnv.Addon.db.profile.Language
    language.Voice, language.Fallback = voice, fallback
    _G.SpokenBossesAudioPacks = packs
    _G.SpokenBossStories[36]["edwin vancleef"] = story or "He led the Brotherhood."
    return Bosses:StoryClip(36, "edwin vancleef")
end
local ENGLISH_PATH = "Interface\\AddOns\\SpokenBossesAudio\\Sounds\\36\\edwin-vancleef.mp3"

local clip = Setup("enUS", "auto", "enUS", nil)
Expect("no pack installed: the story is text only, as before", tostring(clip.path) .. "|" .. tostring(clip.textOnly) .. "|" .. clip.length,
    "nil|true|6")
Expect("...and the part counts no pack", #Bosses:PackNames(), 0)

clip = Setup("enUS", "auto", "enUS", { SpokenBossesAudio = Pack("SpokenBossesAudio", "enUS", 128) })
Expect("an English pack with the boss: the clip plays it", clip.path, ENGLISH_PATH)
Expect("...for the recording's length", clip.length, 41.2)
Expect("...not as words alone", clip.textOnly, nil)
Expect("...with the recording's word timings", clip.present.timings, "0 1 2")
Expect("...and the part counts the pack", table.concat(Bosses:PackNames(), ","), "SpokenBossesAudio")

clip = Setup("enUS", "auto", "enUS", { SpokenBossesAudio = Pack("SpokenBossesAudio", "enUS", 128, { [36] = {} }) })
Expect("a pack without the boss: text only", tostring(clip.path) .. "|" .. tostring(clip.textOnly), "nil|true")

clip = Setup("deDE", "auto", "enUS", { SpokenBossesAudio = Pack("SpokenBossesAudio", "enUS", 128) })
Expect("German client, English pack, fallback allowed: English voice, English transcript, timings",
    tostring(clip.path) .. "|" .. clip.present.transcript .. "|" .. tostring(clip.present.timings),
    ENGLISH_PATH .. "|He led the Brotherhood.|0 1 2")

do
    local WORDED = { [36] = { ["edwin vancleef"] = { file = "36\\edwin-vancleef", len = 41.2, times = "0 1", text = "Pack words." } } }
    clip = Setup("enUS", "auto", "enUS", { SpokenBossesAudio = Pack("SpokenBossesAudio", "enUS", 128, WORDED) })
    Expect("a pack's words in the client's language caption the story", clip.present.transcript, "Pack words.")
    clip = Setup("deDE", "auto", "enUS", { SpokenBossesAudio = Pack("SpokenBossesAudio", "enUS", 128, WORDED) })
    Expect("an English pack on a German client leaves the story as it was", clip.present.transcript, "He led the Brotherhood.")
    clip = Setup("deDE", "auto", "enUS", { SpokenBossesAudio_deDE = Pack("SpokenBossesAudio_deDE", "deDE", 128, WORDED) })
    Expect("a German pack on a German client captions its words, over an English-only story", clip.present.transcript, "Pack words.")
    Expect("...timed, those being the recording's", clip.present.timings, "0 1")
    local function Take(words, times)
        return { [36] = { ["edwin vancleef"] = { file = "36\\" .. words, len = 41.2, times = times, text = words } } }
    end
    clip = Setup("enUS", "auto", "enUS", { SpokenBossesAudio_low = Pack("SpokenBossesAudio_low", "enUS", 96, Take("Low take.", "0")),
        SpokenBossesAudio = Pack("SpokenBossesAudio", "enUS", 128, Take("High take.", "0 1")) })
    Expect("two packs of a language: the words are the playing take's", clip.present.transcript, "High take.")
    Expect("...and so are the times", clip.present.timings, "0 1")
    Setup("enUS", "auto", "enUS", { SpokenBossesAudio = Pack("SpokenBossesAudio", "enUS", 128, WORDED) })
    _G.SpokenBossStories[36]["edwin vancleef"] = nil
    Expect("a boss with no story in core still has no clip: new content needs a core release",
        Bosses:StoryClip(36, "edwin vancleef"), nil)
end

clip = Setup("deDE", "auto", "none", { SpokenBossesAudio = Pack("SpokenBossesAudio", "enUS", 128) })
Expect("German client, English pack, fallback none: text only", tostring(clip.path) .. "|" .. tostring(clip.textOnly), "nil|true")

clip = Setup("deDE", "auto", "enUS", { SpokenBossesAudio = Pack("SpokenBossesAudio", "enUS", 128) },
    { "He led the Brotherhood.", deDE = "Er führte die Bruderschaft." })
Expect("German story, English pack: no timings",
    tostring(clip.path) .. "|" .. clip.present.transcript .. "|" .. tostring(clip.present.timings),
    ENGLISH_PATH .. "|Er führte die Bruderschaft.|nil")

local GERMAN = { file = "36\\edwin-vancleef", len = 39.5, times = "0 3" }
clip = Setup("deDE", "auto", "enUS", {
    SpokenBossesAudio = Pack("SpokenBossesAudio", "enUS", 128),
    SpokenBossesAudio_deDE = Pack("SpokenBossesAudio_deDE", "deDE", 128, { [36] = { ["edwin vancleef"] = GERMAN } }),
}, { "He led the Brotherhood.", deDE = "Er führte die Bruderschaft." })
Expect("German client, German pack, German story: the German clip with its timings",
    clip.path .. "|" .. clip.length .. "|" .. tostring(clip.present.timings),
    "Interface\\AddOns\\SpokenBossesAudio_deDE\\Sounds\\36\\edwin-vancleef.mp3|39.5|0 3")

clip = Setup("enUS", "auto", "enUS", {
    SpokenBossesAudio = Pack("SpokenBossesAudio", "enUS", 64),
    SpokenBossesAudioCopy = Pack("SpokenBossesAudioCopy", "enUS", 128),
})
Expect("two packs for one language: the higher bitrate wins", clip.path,
    "Interface\\AddOns\\SpokenBossesAudioCopy\\Sounds\\36\\edwin-vancleef.mp3")
Expect("...and both are counted", #Bosses:PackNames(), 2)

clip = Setup("enUS", "auto", "enUS", { SpokenBossesAudio = Pack("SpokenBossesAudio", "enUS", 128), Broken = "not a pack",
    Future = { version = 2, addon = "Future", language = "enUS", bitrate = 320, bosses = { [36] = { ["edwin vancleef"] = EDWIN } } } })
Expect("a pack of another format is passed over", clip.path, ENGLISH_PATH)

---------------------------------------------------------------- a boss's story for another addon
-- Spoken:PlayStory("boss", encounterID) reaches Bosses through the teller it registers: the game's
-- encounter id names the boss, and only a voiced story of a boss met (or unlocked) counts.
do
    local S = _G.Spoken
    local EDWIN_FIGHT = 2747
    Setup("enUS", "auto", "enUS", { SpokenBossesAudio = Pack("SpokenBossesAudio", "enUS", 128) })
    SpokenBossesCharacter.found = {}
    SpokenBossesSettings.unlockUnfound = false
    Expect("a boss not met has no story to play", S:HasStory("boss", EDWIN_FIGHT), false)
    SpokenBossesSettings.unlockUnfound = true
    Expect("...unless Unlock Unfound Bosses is on", S:HasStory("boss", EDWIN_FIGHT), true)
    SpokenBossesSettings.unlockUnfound = false
    Bosses:FoundEncounter(EDWIN_FIGHT)
    Expect("a boss met, voiced, has one", S:HasStory("boss", EDWIN_FIGHT), true)
    Expect("...an unknown encounter has none", S:HasStory("boss", 1), false)

    local Named = H.CaptionStory
    Expect("PlayStory plays it", S:PlayStory("boss", EDWIN_FIGHT), true)
    Expect("...the boss's story", S:GetNowPlaying().key, "boss:36:edwin vancleef")
    Expect("...which GetCaption names as PlayStory took it", Named(), "boss " .. EDWIN_FIGHT)
    Expect("...and IsPlayingStory says so", S:IsPlayingStory("boss", EDWIN_FIGHT), true)
    Expect("...as it does not of another fight", S:IsPlayingStory("boss", 2748), false)
    S:Pause()
    Expect("...nor while paused", S:IsPlayingStory("boss", EDWIN_FIGHT), false)
    S:Resume()
    Expect("PlayStory does not mark it read, so the boss still tells it when it falls",
        Bosses:IsStoryRead(36, "edwin vancleef"), false)
    Expect("StopStory stops it", tostring(S:StopStory("boss", EDWIN_FIGHT)) .. " " .. S:GetQueueSize(), "true 0")
    Expect("...and a second stop finds nothing", S:StopStory("boss", EDWIN_FIGHT), false)

    Setup("enUS", "auto", "enUS", nil)
    Expect("words alone are no story to play", tostring(S:HasStory("boss", EDWIN_FIGHT)) .. " "
        .. tostring(S:PlayStory("boss", EDWIN_FIGHT)), "false false")
    S:GetSource("bosses"):Enqueue(Bosses:StoryClip(36, "edwin vancleef"))
    Expect("...and the story Bosses shows itself is no story PlayStory played", Named(), "none")
    S:StopAll()
    Setup("enUS", "auto", "enUS", { SpokenBossesAudio = Pack("SpokenBossesAudio", "enUS", 128) })
    S:SetPartOn("bosses", false)
    Expect("with Bosses switched off there is none", S:HasStory("boss", EDWIN_FIGHT), false)
    S:SetPartOn("bosses", true)

    -- Dreamscythe has an encounter for each difficulty, one of them fought together with the Weaver.
    _G.SpokenBossStories[109] = { weaver = "It weaves.", dreamscythe = "It reaps." }
    Setup("enUS", "auto", "enUS", { SpokenBossesAudio = Pack("SpokenBossesAudio", "enUS", 128,
        { [109] = { weaver = EDWIN, dreamscythe = EDWIN } }) })
    SpokenBossesSettings.unlockUnfound = true
    local function Told(id)
        S:StopAll()
        S:PlayStory("boss", id)
        return Named()
    end
    Expect("a boss of several encounters is named by the one PlayStory was given",
        Told(486) .. ", " .. Told(3588) .. ", " .. Told(2955), "boss 486, boss 3588, boss 2955")
    S:StopAll()
    Expect("...and no line, no caption", Named(), "none")
    SpokenBossesSettings.unlockUnfound = false
end

-- Voices: the stimmen team's German pack beside the plain one, its team in its .toc.
do
    stub.SetAddOns({
        { folder = "SpokenBossesAudio_deDE_stimmen", meta = { ["X-SpokenBosses-Language"] = "deDE",
            ["X-Spoken-Team"] = "stimmen", ["X-Spoken-TeamName"] = "Stimmen" } },
        { folder = "SpokenBossesAudio_deDE", meta = { ["X-SpokenBosses-Language"] = "deDE" } },
    })
    _G.SpokenEnv.Languages:Reset()
    local TEAM = { file = "36\\edwin-team", len = 30 }
    local function Packs(team, plain)
        return {
            SpokenBossesAudio = Pack("SpokenBossesAudio", "enUS", 128),
            SpokenBossesAudio_deDE_stimmen = Pack("SpokenBossesAudio_deDE_stimmen", "deDE", 128,
                { [36] = { ["edwin vancleef"] = team } }),
            SpokenBossesAudio_deDE = Pack("SpokenBossesAudio_deDE", "deDE", 128, { [36] = { ["edwin vancleef"] = plain } }),
        }
    end
    local function Path(voices, team, plain)
        Setup("deDE", nil, nil, Packs(team, plain))
        _G.Spoken:SetVoiceOrder(voices)
        local found = Bosses:GetAudioClip(36, "edwin vancleef")
        return found and (found.packFolder .. ":" .. found.voice) or nil
    end
    Expect("voices: the team's first", Path({ "deDE_stimmen", "deDE", "enUS" }, TEAM, GERMAN),
        "SpokenBossesAudio_deDE_stimmen:deDE_stimmen")
    Expect("voices: the plain pack where the team lacks the boss", Path({ "deDE_stimmen", "deDE", "enUS" }, nil, GERMAN),
        "SpokenBossesAudio_deDE:deDE")
    Expect("voices: English where neither German pack has it", Path({ "deDE_stimmen", "deDE", "enUS" }, nil, nil),
        "SpokenBossesAudio:enUS")
    Expect("voices: plain German never plays the team's pack", Path({ "deDE" }, TEAM, nil), nil)
    -- The plain pack at a higher bitrate is the language's best, but the team's take is the one heard.
    local packs = Packs({ file = "36\\edwin-team", len = 30, times = "0 1", text = "Team words." },
        { file = "36\\edwin-plain", len = 40, times = "0 1 2", text = "Plain pack words." })
    packs.SpokenBossesAudio_deDE.bitrate = 192
    Setup("deDE", nil, nil, packs)
    _G.Spoken:SetVoiceOrder({ "deDE_stimmen", "deDE", "enUS" })
    clip = Bosses:StoryClip(36, "edwin vancleef")
    Expect("voices: the team's take is captioned with its own words and times",
        tostring(clip.path) .. "|" .. clip.present.transcript .. "|" .. tostring(clip.present.timings),
        "Interface\\AddOns\\SpokenBossesAudio_deDE_stimmen\\Sounds\\36\\edwin-team.mp3|Team words.|0 1")
    local language = _G.SpokenEnv.Addon.db.profile.Language
    language.Voices = nil
    stub.ResetAddOns()
    _G.SpokenEnv.Languages:Reset()
end

stub.SetLocale("enUS")
if Failures() > 0 then os.exit(1) end
