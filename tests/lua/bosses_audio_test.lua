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

stub.SetLocale("enUS")
if Failures() > 0 then os.exit(1) end
