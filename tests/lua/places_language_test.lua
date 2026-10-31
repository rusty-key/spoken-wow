-- The Places addon's narration across languages: an entry the active pack lacks, and where a
-- report on a clip goes. Language selection itself is older than this file and lives in
-- Language.lua. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/Spoken/"
local PLACES = here .. "/../../addons/Spoken_Places/"
local Expect, Failures = H.Expecter(print)

stub.SetClient("16001")
stub.LoadSpoken(SPOKEN)

-- What a player had saved before the settings moved into Spoken's profile. Each load below is a
-- first run, so the move is forgotten and the profile starts without Places' table.
local function Legacy(settings)
    local db = _G.SpokenEnv.Addon.db
    db.profile.Modules, db.global.ModulesLegacy = nil, nil
    _G.SpokenPlacesSettings = settings
end
stub.SetAddOns({ { folder = "Spoken_Places", meta = { Version = "9.9.9" } } })

local MAP, BOTH, ONLY_ENGLISH = 1411, "valley of trials", "sen'jin village"

-- The voice is Spoken's Voice Language and If a Voice Is Missing, as for every module; the text's
-- language is the Places page's own.
local function Voice(code, fallback)
    local language = _G.SpokenEnv.Addon.db.profile.Language
    language.Voice, language.Fallback = code, fallback
end

--- Load the addon with these packs installed.
local function Install(packs)
    Legacy({})
    _G.SpokenPlacesAudioPacks = {}
    for _, pack in ipairs(packs) do
        _G.SpokenPlacesAudioPacks[pack.addon] = pack
    end
    return H.LoadPlaces(PLACES)
end

local function Pack(addon, language, subzones)
    return { version = 1, addon = addon, language = language, bitrate = 128,
        zones = {}, subzones = { [MAP] = subzones } }
end

local ENGLISH = Pack("SpokenPlacesAudio", "enUS", {
    [BOTH] = { file = "en-valley", len = 3 }, [ONLY_ENGLISH] = { file = "en-senjin", len = 3 } })
ENGLISH.zones[MAP] = { file = "en-durotar", len = 5, times = "0 .5 1" }
local GERMAN = Pack("SpokenPlacesAudio_deDE", "deDE", { [BOTH] = { file = "de-valley", len = 3, times = "0 1" } })
local FRENCH = Pack("SpokenPlacesAudio_frFR", "frFR", { [ONLY_ENGLISH] = { file = "fr-senjin", len = 3 } })

---------------------------------------------------------------- A. the active pack, then English
local Z = Install({ ENGLISH, GERMAN, FRENCH })
stub.SetAddOns({ { folder = "SpokenPlacesAudio_deDE", meta = { ["X-SpokenPlaces-Language"] = "deDE" } } })
Z:RegisterLoreData("enUS", "zones", { [MAP] = { name = "Durotar", full = "English zone lore." } })
Z:RegisterLoreData("enUS", "subzones", { [MAP] = {
    [BOTH] = { full = "English valley lore." }, [ONLY_ENGLISH] = { full = "English village lore." } } })
Z:RegisterLoreData("deDE", "subzones", { [MAP] = { [BOTH] = { full = "Deutsche Geschichte." } } })
Expect("A. installed voice metadata retains captions before that pack loads", Z:ShouldLoadLanguage("deDE"), true)
Expect("A. unrelated languages do not allocate caption tables", Z:ShouldLoadLanguage("frFR"), false)
Expect("A. registering captions leaves the lore browser's language alone", Z:GetLore(MAP).full, "English zone lore.")
Expect("A. zones carry their full text", Z:NewLoreSound(MAP, nil).present.transcript, "English zone lore.")
Expect("A. ...timed by the take's word times",
    Z:NewLoreSound(MAP, nil).present.timings, "0 .5 1")
Voice("deDE")
Expect("A. captions are in the Text Language, not the voice's: English words under a German voice",
    Z:NewLoreSound(MAP, BOTH).present.transcript, "English valley lore.")
Expect("A. ...untimed, the German take's times not being those words'", Z:NewLoreSound(MAP, BOTH).present.timings, nil)
Expect("A. ...and under the English fallback",
    Z:NewLoreSound(MAP, ONLY_ENGLISH).present.transcript, "English village lore.")
local valley = Z.CaptionLore.enUS.subzones[MAP][BOTH]
Z.CaptionLore.enUS.subzones[MAP][BOTH] = nil
Expect("A. a place the Text Language has no words for is captioned in the voice's",
    Z:NewLoreSound(MAP, BOTH).present.transcript, "Deutsche Geschichte.")
Expect("A. ...and timed by its take, those being the recording's words",
    Z:NewLoreSound(MAP, BOTH).present.timings, "0 1")
Z.CaptionLore.enUS.subzones[MAP][BOTH] = valley
local _, _, pack = Z:GetAudioClip(MAP, BOTH)
Expect("A. the active pack answers what it has", pack and pack.addon, "SpokenPlacesAudio_deDE")
_, _, pack = Z:GetAudioClip(MAP, ONLY_ENGLISH)
Expect("A. an entry it lacks falls back to English, not to French", pack and pack.addon, "SpokenPlacesAudio")
Voice("deDE", "frFR")
_, _, pack = Z:GetAudioClip(MAP, ONLY_ENGLISH)
Expect("A. ...to French where If a Voice Is Missing says French", pack and pack.addon, "SpokenPlacesAudio_frFR")
Voice("deDE", "none")
Expect("A. ...and to nothing with Stay Silent", Z:GetAudioClip(MAP, ONLY_ENGLISH), nil)
Voice("frFR")
_, _, pack = Z:GetAudioClip(MAP, ONLY_ENGLISH)
Expect("A. the voice language picks the pack, whatever the text is in", pack and pack.addon, "SpokenPlacesAudio_frFR")

Z = Install({ ENGLISH, FRENCH })
Voice(nil)
Expect("A. an English pack falls back to nothing else", Z:GetAudioClip(MAP, "durotar coast"), nil)

---------------------------------------------------------------- B. the language narration plays in
Z = Install({ ENGLISH, GERMAN })
Voice("deDE")
Expect("B. the active pack's language", Z:GetPackLanguage(), "deDE")
Z = Install({})
Expect("B. with no pack, the language being read", Z:GetPackLanguage(), Z:GetLanguage())

---------------------------------------------------------------- C. reports
Z = Install({ ENGLISH })
Expect("C. the lore window's report is filed under the language being read, English unprefixed",
    Z:GetLanguage() .. " " .. Z:ReportURL(MAP, BOTH), "enUS https://spoken.rusty.one/places/r/1411/valley-of-trials")
Expect("C. a clip's report keeps the language it was narrated in",
    Z:ReportURL(MAP, BOTH, "deDE"), "https://spoken.rusty.one/deDE/places/r/1411/valley-of-trials")

---------------------------------------------------------------- D. contributions
Z = Install({ ENGLISH, GERMAN })
Voice("deDE")
Z.Zones[1537] = { name = "Ironforge", pending = true }
local envelope = Z:CaptureContribution(1537, nil)
Expect("D. the locale is the client's", envelope:match("\nlocale=enUS\n") ~= nil, true)
Expect("D. ...and the language narration plays in goes beside it", envelope:match("\npack=deDE\n") ~= nil, true)
Voice(nil)

---------------------------------------------------------------- E. pack labels
-- One pack per language now, so a pack is named by the language it narrates, the one
-- being read included; bitrate only tells apart two packs in the same language.
Z = Install({ ENGLISH, GERMAN })
Expect("E. the pack in the language being read is named too", Z:GetAudioPackLabel(ENGLISH), "English")
Expect("E. another language by its own name", Z:GetAudioPackLabel(GERMAN), "Deutsch")
local RETIRED = Pack("ZoneLoreAudio64", "enUS", {})
RETIRED.bitrate = 64
Z = Install({ ENGLISH, RETIRED, GERMAN })
Expect("E. two packs in one language are told apart by bitrate", Z:GetAudioPackLabel(ENGLISH), "English (128 kbps)")
Expect("E. ...both of them", Z:GetAudioPackLabel(RETIRED), "English (64 kbps)")
Expect("E. a language with one pack still needs no bitrate", Z:GetAudioPackLabel(GERMAN), "Deutsch")

---------------------------------------------------------------- F. Auto follows the client, a pick does not
-- One SavedVariables file read by the same install switched between game languages. Auto
-- is stored as no language at all, so it answers each client with its own; anything the
-- player picked stays picked, whichever language the game runs in.
local READY = { { code = "enUS", ready = true }, { code = "esES", ready = true },
    { code = "frFR", ready = true } }
-- The same table again is a reload: the profile already holds the settings, so nothing is moved.
local lastInstalled
local function InstallOn(locale, db)
    stub.SetLocale(locale)
    if db ~= lastInstalled then Legacy(db) end
    lastInstalled = db
    _G.SpokenPlacesAudioPacks = {}
    return H.LoadPlaces(PLACES, { Languages = READY })
end

local saved = {}
Z = InstallOn("esES", saved)
Expect("F. Auto is the default", Z:GetLanguagePreference(), nil)
Expect("F. ...and reads the client's language", Z:GetLanguage(), "esES")
Z = InstallOn("frFR", saved)
Expect("F. the same saved choice on a French client reads French", Z:GetLanguage(), "frFR")
Expect("F. ...and names it as what Auto reads", Z:GetAutoLanguage(), "frFR")
Z = InstallOn("koKR", saved)
Expect("F. a client whose translation is not finished reads English", Z:GetLanguage(), "enUS")
Expect("F. ...and Auto says so", Z:GetAutoLanguage(), "enUS")

Z = InstallOn("esES", saved)
Z:SetLanguage("esES")
Z = InstallOn("frFR", saved)
Expect("F. a language picked on one client stays on another", Z:GetLanguage(), "esES")
Expect("F. ...while Auto still names the client's own", Z:GetAutoLanguage(), "frFR")
Z:SetLanguage(nil)
Z = InstallOn("frFR", saved)
Expect("F. going back to Auto follows the client again", Z:GetLanguage(), "frFR")

---------------------------------------------------------------- G. a language no client runs in
-- Italian is ready on its lore alone (no client, so no aliases) and is read by choosing it.
-- Auto never lands on it, even on a client that claimed it.
local WITH_ITALIAN = { { code = "enUS", ready = true }, { code = "itIT", ready = true } }
local function InstallItalian(locale, db)
    stub.SetLocale(locale)
    Legacy(db)
    _G.SpokenPlacesAudioPacks = {}
    return H.LoadPlaces(PLACES, { Languages = WITH_ITALIAN })
end
Z = InstallItalian("enUS", {})
Expect("G. Italian is offered once its lore is in", Z:IsLanguageSelectable("itIT"), true)
Expect("G. ...but Auto on an English client reads English", Z:GetLanguage(), "enUS")
Expect("G. Italian is not a client language", Z:IsClientLanguage("itIT"), false)
Z = InstallItalian("enUS", { language = "itIT" })
Expect("G. picked, an English client reads Italian", Z:GetLanguage(), "itIT")
Z = InstallItalian("itIT", {})
Expect("G. a client claiming Italian still reads English on Auto", Z:GetAutoLanguage(), "enUS")

---------------------------------------------------------------- H. what the client's font draws
-- Another script is offered where the page's font files draw it, or the client's own font for that
-- script does.
local HANGUL, HAN, CYRILLIC = { [234] = true, [235] = true, [236] = true, [237] = true },
    { [228] = true, [229] = true, [230] = true, [231] = true, [232] = true, [233] = true },
    { [208] = true, [209] = true }
local VIETNAMESE = { [225] = true }   -- ế and ệ, U+1EBF and U+1EC7
local function With(base, extra)
    local set = {}
    for key in pairs(base) do set[key] = true end
    for _, key in ipairs(extra) do set[key] = true end
    return set
end
-- Han, and private-use glyphs (U+E000 on) as wide as them, as a Big5 font can have.
local HAN_AND_PRIVATE = With(HAN, { 238 })
local fontHas = {   -- the lead bytes each file draws
    ["Fonts\\FRIZQT__.TTF"] = CYRILLIC,
    ["Fonts\\QUEST.TTF"] = CYRILLIC,
    ["Fonts\\LATIN.TTF"] = {},
    ["Fonts\\FRIZQT___CYR.TTF"] = CYRILLIC,
    ["Fonts\\2002.TTF"] = HANGUL,
    ["Fonts\\ARKai_T.ttf"] = HAN,
    ["Fonts\\blei00d.TTF"] = HAN_AND_PRIVATE,
    ["Fonts\\ARIALN.TTF"] = VIETNAMESE,
}
local realParent = _G.UIParent.CreateFontString
local realHighlight, realQuest = _G.GameFontHighlight, _G.QuestFont
local function Faces(highlight, quest)
    _G.GameFontHighlight = { GetFont = function() return highlight, 12 end }
    _G.QuestFont = { GetFont = function() return quest, 12 end }
end
_G.UIParent.CreateFontString = function()
    local fs = { text = "", font = nil }
    function fs:SetText(t) self.text = t end
    -- A file the client cannot load is refused, and the font stays the object's own.
    function fs:SetFont(path) self.font = path; return fontHas[path] ~= nil end
    function fs:Hide() end
    function fs:GetStringWidth()
        local has = fontHas[self.font] or { [208] = true, [209] = true }   -- the object's fallbacks
        local w = 0
        for ch in self.text:gmatch("[%z\1-\127\194-\244][\128-\191]*") do
            w = w + ((has[ch:byte(1)] or has[ch]) and 7 or 10)   -- a glyph it has, or the same box as any other
        end
        return w
    end
    return fs
end
-- As a string, so code without FontFor fails these checks rather than stopping the file.
local function Font(fontObject, code) return tostring(Z.FontFor and Z:FontFor(fontObject, code)) end
-- Forgets what the fonts were found to draw, after a test changes them.
local function Reset() Z.drawable, Z.fonts = {}, {} end
Faces("Fonts\\FRIZQT__.TTF", "Fonts\\QUEST.TTF")
Z = InstallOn("deDE", nil)
Z.drawable = {}
Expect("H. a German client whose font has Cyrillic offers Russian", Z:CanRenderLanguage("ruRU"), true)
Expect("H. ...written in that font", Font(_G.GameFontHighlight, "ruRU"), "Fonts\\FRIZQT__.TTF")
Expect("H. it offers Korean, which its font cannot draw, in the client's Korean font",
    tostring(Z:CanRenderLanguage("koKR")) .. " " .. Font(_G.GameFontHighlight, "koKR"),
    "true Fonts\\2002.TTF")
Expect("H. ...and Chinese in its Chinese fonts", Font(_G.QuestFont, "zhCN") .. " "
    .. Font(_G.QuestFont, "zhTW"), "Fonts\\ARKai_T.ttf Fonts\\blei00d.TTF")
Expect("H. Traditional Chinese is offered though its font has private-use glyphs as wide as its Han",
    Z:CanRenderLanguage("zhTW"), true)
Expect("H. ...by Spoken's own probe, which the Voice Language lists use too",
    tostring(Spoken:LanguageDraws("zhTW", "Fonts\\blei00d.TTF")) .. " "
    .. tostring(Spoken:LanguageDraws("zhTW", "Fonts\\FRIZQT__.TTF")), "true false")
-- A font with some Hanja draws the name of Traditional Chinese and still lacks most of its characters.
fontHas["Fonts\\2002.TTF"] = With(HANGUL, { "中", "文", "繁", "體", "這", "國" })
Faces("Fonts\\2002.TTF", "Fonts\\2002.TTF")
Reset()
Expect("H. a Korean font with Hanja does not write Traditional Chinese, so the client's own font does",
    Font(_G.GameFontHighlight, "zhTW"), "Fonts\\blei00d.TTF")
fontHas["Fonts\\2002.TTF"] = HANGUL
Faces("Fonts\\FRIZQT__.TTF", "Fonts\\QUEST.TTF")
Reset()
-- A file the client cannot load keeps the object's own font in the probe, whose fallbacks draw.
Expect("H. a font file the client cannot load draws nothing, whatever the fonts it falls back to",
    tostring(Spoken:LanguageDraws("ruRU", "Fonts\\MISSING.TTF")) .. " "
    .. tostring(Spoken:LanguageDraws("ruRU", "Fonts\\FRIZQT___CYR.TTF")), "false true")
local blei = fontHas["Fonts\\blei00d.TTF"]
fontHas["Fonts\\blei00d.TTF"] = nil
fontHas["Fonts\\bKAI00M.TTF"] = HAN
Reset()
Expect("H. Traditional Chinese is written in bKAI00M.TTF where the client lacks blei00d.TTF, as on Forever",
    Font(_G.QuestFont, "zhTW"), "Fonts\\bKAI00M.TTF")
fontHas["Fonts\\bKAI00M.TTF"] = nil
Reset()
Expect("H. ...and in no stock font where the client has neither",
    Font(_G.QuestFont, "zhTW"), "nil")
fontHas["Fonts\\blei00d.TTF"] = blei
Reset()
Expect("H. a Latin language needs no asking", Z:CanRenderLanguage("frFR"), true)
Expect("H. ...and keeps the page's font", Font(_G.GameFontHighlight, "frFR"), "Fonts\\FRIZQT__.TTF")
Expect("H. Vietnamese, which the page's font cannot draw, is written in Arial Narrow",
    tostring(Z:CanRenderLanguage("viVN")) .. " " .. Font(_G.GameFontHighlight, "viVN"),
    "true Fonts\\ARIALN.TTF")

-- The captions set a font file too: a clip of Korean lore on a German client names the one to use.
local realNormal = _G.GameFontNormal
_G.GameFontNormal = { GetFont = function() return "Fonts\\FRIZQT__.TTF", 12 end }
local KOREAN = Pack("SpokenPlacesAudio_koKR", "koKR", {})
KOREAN.zones[MAP] = { file = "ko-durotar", len = 5 }
local GERMAN_ZONE = Pack("SpokenPlacesAudio_deDE", "deDE", {})
GERMAN_ZONE.zones[MAP] = { file = "de-durotar", len = 5 }
local function Lore(pack)
    Voice(pack.language)
    stub.SetLocale("deDE")
    Legacy({ language = pack.language })
    _G.SpokenPlacesAudioPacks = { [pack.addon] = pack }
    Z = H.LoadPlaces(PLACES, { Languages = { { code = "enUS", ready = true }, { code = "deDE", ready = true },
        { code = "koKR", ready = true } } })
    local clip = Z:NewLoreSound(MAP, nil)
    return clip and clip.present
end
local korean = Lore(KOREAN)
Expect("H. Korean lore on a German client is captioned in the client's Korean font",
    tostring(korean and korean.font), "Fonts\\2002.TTF")
local german = Lore(GERMAN_ZONE)
Expect("H. ...German lore names no font, so the window's own is kept",
    tostring(german ~= nil) .. " " .. tostring(german and german.font), "true nil")
_G.GameFontNormal = realNormal
Voice(nil)

Faces("Fonts\\LATIN.TTF", "Fonts\\QUEST.TTF")
Reset()
Expect("H. a font file without Cyrillic writes Russian in the client's Cyrillic font",
    tostring(Z:CanRenderLanguage("ruRU")) .. " " .. Font(_G.GameFontHighlight, "ruRU"),
    "true Fonts\\FRIZQT___CYR.TTF")
fontHas["Fonts\\2002.TTF"] = {}
Reset()
Expect("H. a client whose Korean font cannot draw Korean does not offer it",
    Z:CanRenderLanguage("koKR"), false)
fontHas["Fonts\\ARIALN.TTF"] = {}
Reset()
Expect("H. ...nor Vietnamese where no font draws its accents", Z:CanRenderLanguage("viVN"), false)
_G.UIParent.CreateFontString = realParent
_G.GameFontHighlight, _G.QuestFont = realHighlight, realQuest

stub.SetLocale("enUS")

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll places language tests passed")
