-- The zones addon's narration across languages: an entry the active pack lacks, and where a
-- report on a clip goes. Language selection itself is older than this file and lives in
-- Language.lua. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/SpokenPlayer/"
local ZONES = here .. "/../../addons/SpokenZones/"
local Expect, Failures = H.Expecter(print)

stub.SetClient("11509")
stub.LoadSpoken(SPOKEN)
stub.SetAddOns({ { folder = "SpokenZones", meta = { Version = "9.9.9" } } })

local MAP, BOTH, ONLY_ENGLISH = 1411, "valley of trials", "sen'jin village"

--- Load the addon with these packs installed.
local function Install(packs)
    _G.SpokenZonesDB = {}
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
local GERMAN = Pack("SpokenZonesAudio_deDE", "deDE", { [BOTH] = { file = "de-valley", len = 3 } })
local FRENCH = Pack("SpokenZonesAudio_frFR", "frFR", { [ONLY_ENGLISH] = { file = "fr-senjin", len = 3 } })

---------------------------------------------------------------- A. the active pack, then English
local Z = Install({ ENGLISH, GERMAN, FRENCH })
Z:SetActiveAudioPack("SpokenZonesAudio_deDE")
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
    _G.SpokenZonesDB = db
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

stub.SetLocale("enUS")

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll zones language tests passed")
