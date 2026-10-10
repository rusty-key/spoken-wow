-- The zones addon's narration across languages: an entry the active pack lacks, and where a
-- report on a clip goes. Language selection itself is older than this file and lives in
-- Language.lua. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/Spoken/"
local ZONES = here .. "/../../addons/Spoken_Zones/"
local Expect, Failures = H.Expecter(print)

stub.SetClient("11509")
stub.LoadSpoken(SPOKEN)
stub.SetAddOns({ { folder = "Spoken_Zones", meta = { Version = "9.9.9" } } })

local MAP, BOTH, ONLY_ENGLISH = 1411, "valley of trials", "sen'jin village"

--- Load the addon with these packs installed.
local function Install(packs)
    _G.SpokenZonesSettings = {}
    _G.SpokenZonesAudioPacks = {}
    for _, pack in ipairs(packs) do
        _G.SpokenZonesAudioPacks[pack.addon] = pack
    end
    return H.LoadZones(ZONES)
end

local function Pack(addon, language, subzones)
    return { version = 1, addon = addon, language = language, bitrate = 128,
        zones = {}, subzones = { [MAP] = subzones } }
end

local ENGLISH = Pack("SpokenZonesAudio", "enUS", {
    [BOTH] = { file = "en-valley", len = 3 }, [ONLY_ENGLISH] = { file = "en-senjin", len = 3 } })
ENGLISH.zones[MAP] = { file = "en-durotar", len = 5 }
local GERMAN = Pack("SpokenZonesAudio_deDE", "deDE", { [BOTH] = { file = "de-valley", len = 3 } })
local FRENCH = Pack("SpokenZonesAudio_frFR", "frFR", { [ONLY_ENGLISH] = { file = "fr-senjin", len = 3 } })

---------------------------------------------------------------- A. the active pack, then English
local Z = Install({ ENGLISH, GERMAN, FRENCH })
stub.SetAddOns({ { folder = "SpokenZonesAudio_deDE", meta = { ["X-SpokenZones-Language"] = "deDE" } } })
Z:RegisterLoreData("enUS", "zones", { [MAP] = { name = "Durotar", full = "English zone lore." } })
Z:RegisterLoreData("enUS", "subzones", { [MAP] = {
    [BOTH] = { full = "English valley lore." }, [ONLY_ENGLISH] = { full = "English village lore." } } })
Z:RegisterLoreData("deDE", "subzones", { [MAP] = { [BOTH] = { full = "Deutsche Geschichte." } } })
Expect("A. installed voice metadata retains captions before that pack loads", Z:ShouldLoadLanguage("deDE"), true)
Expect("A. unrelated languages do not allocate caption tables", Z:ShouldLoadLanguage("frFR"), false)
Expect("A. registering captions leaves the lore browser's language alone", Z:GetLore(MAP).full, "English zone lore.")
Expect("A. zones carry their full text", Z:NewLoreSound(MAP, nil).present.transcript, "English zone lore.")
Z:SetActiveAudioPack("SpokenZonesAudio_deDE")
Expect("A. captions match the chosen voice, even when reading another language",
    Z:NewLoreSound(MAP, BOTH).present.transcript, "Deutsche Geschichte.")
Expect("A. fallback captions match the English audio",
    Z:NewLoreSound(MAP, ONLY_ENGLISH).present.transcript, "English village lore.")
local _, _, pack = Z:GetAudioClip(MAP, BOTH)
Expect("A. the active pack answers what it has", pack and pack.addon, "SpokenZonesAudio_deDE")
_, _, pack = Z:GetAudioClip(MAP, ONLY_ENGLISH)
Expect("A. an entry it lacks falls back to English, not to French", pack and pack.addon, "SpokenZonesAudio")

Z = Install({ ENGLISH, FRENCH })
Z:SetActiveAudioPack("SpokenZonesAudio")
Expect("A. an English pack falls back to nothing else", Z:GetAudioClip(MAP, "durotar coast"), nil)

---------------------------------------------------------------- B. the language narration plays in
Z = Install({ ENGLISH, GERMAN })
Z:SetActiveAudioPack("SpokenZonesAudio_deDE")
Expect("B. the active pack's language", Z:GetPackLanguage(), "deDE")
Z = Install({})
Expect("B. with no pack, the language being read", Z:GetPackLanguage(), Z:GetLanguage())

---------------------------------------------------------------- C. reports
Z = Install({ ENGLISH })
Expect("C. the lore window's report is filed under the language being read",
    Z:ReportURL(MAP, BOTH), "https://lore.rusty.one/" .. Z:GetLanguage() .. "/r/1411/valley-of-trials")
Expect("C. a clip's report under the language it was narrated in",
    Z:ReportURL(MAP, BOTH, "deDE"), "https://lore.rusty.one/deDE/r/1411/valley-of-trials")

---------------------------------------------------------------- D. contributions
Z = Install({ ENGLISH, GERMAN })
Z:SetActiveAudioPack("SpokenZonesAudio_deDE")
Z.Zones[1537] = { name = "Ironforge", pending = true }
local envelope = Z:CaptureContribution(1537, nil)
Expect("D. the locale is the client's", envelope:match("\nlocale=enUS\n") ~= nil, true)
Expect("D. ...and the language narration plays in goes beside it", envelope:match("\npack=deDE\n") ~= nil, true)

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
local function InstallOn(locale, db)
    stub.SetLocale(locale)
    _G.SpokenZonesSettings = db
    _G.SpokenZonesAudioPacks = {}
    return H.LoadZones(ZONES, { Languages = READY })
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
    _G.SpokenZonesSettings = db
    _G.SpokenZonesAudioPacks = {}
    return H.LoadZones(ZONES, { Languages = WITH_ITALIAN })
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
local fontHas = {   -- the lead bytes each file draws
    ["Fonts\\FRIZQT__.TTF"] = CYRILLIC,
    ["Fonts\\QUEST.TTF"] = CYRILLIC,
    ["Fonts\\LATIN.TTF"] = {},
    ["Fonts\\FRIZQT___CYR.TTF"] = CYRILLIC,
    ["Fonts\\2002.TTF"] = HANGUL,
    ["Fonts\\ARKai_T.ttf"] = HAN,
    ["Fonts\\blei00d.TTF"] = HAN,
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
    function fs:SetFont(path) self.font = path end
    function fs:Hide() end
    function fs:GetStringWidth()
        local has = fontHas[self.font] or { [208] = true, [209] = true }   -- the object's fallbacks
        local w = 0
        for ch in self.text:gmatch("[%z\1-\127\194-\244][\128-\191]*") do
            w = w + (has[ch:byte(1)] and 7 or 10)   -- a glyph it has, or the same box as any other
        end
        return w
    end
    return fs
end
-- As a string, so code without FontFor fails these checks rather than stopping the file.
local function Font(fontObject, code) return tostring(Z.FontFor and Z:FontFor(fontObject, code)) end
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
Expect("H. a Latin language needs no asking", Z:CanRenderLanguage("frFR"), true)
Expect("H. ...and keeps the page's font", Font(_G.GameFontHighlight, "frFR"), "Fonts\\FRIZQT__.TTF")

-- The captions set a font file too: a clip of Korean lore on a German client names the one to use.
local realNormal = _G.GameFontNormal
_G.GameFontNormal = { GetFont = function() return "Fonts\\FRIZQT__.TTF", 12 end }
local KOREAN = Pack("SpokenZonesAudio_koKR", "koKR", {})
KOREAN.zones[MAP] = { file = "ko-durotar", len = 5 }
local GERMAN_ZONE = Pack("SpokenZonesAudio_deDE", "deDE", {})
GERMAN_ZONE.zones[MAP] = { file = "de-durotar", len = 5 }
local function Lore(pack)
    stub.SetLocale("deDE")
    _G.SpokenZonesSettings = { language = pack.language }
    _G.SpokenZonesAudioPacks = { [pack.addon] = pack }
    Z = H.LoadZones(ZONES, { Languages = { { code = "enUS", ready = true }, { code = "deDE", ready = true },
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

Faces("Fonts\\LATIN.TTF", "Fonts\\QUEST.TTF")
Z.drawable, Z.fonts = {}, {}
Expect("H. a font file without Cyrillic writes Russian in the client's Cyrillic font",
    tostring(Z:CanRenderLanguage("ruRU")) .. " " .. Font(_G.GameFontHighlight, "ruRU"),
    "true Fonts\\FRIZQT___CYR.TTF")
fontHas["Fonts\\2002.TTF"] = {}
Z.drawable, Z.fonts = {}, {}
Expect("H. a client whose Korean font cannot draw Korean does not offer it",
    Z:CanRenderLanguage("koKR"), false)
_G.UIParent.CreateFontString = realParent
_G.GameFontHighlight, _G.QuestFont = realHighlight, realQuest

stub.SetLocale("enUS")

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll zones language tests passed")
