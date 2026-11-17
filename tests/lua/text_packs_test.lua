-- Text packs (Spoken's Texts.lua): an addon of a language's words with no voice, declared in its
-- .toc, loaded with Spoken where its language is the Text Language, and read by every module.
-- Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

local FOLDER = "WoWPoPolsku_Spoken"
local realHighlight = _G.GameFontHighlight
local loads = 0
local function Pack(meta, onLoad)
    local base = H.TextPackMeta("plPL")
    for key, value in pairs(meta or {}) do base[key] = value end
    return { folder = FOLDER, meta = base, loadOnDemand = true, onLoad = function()
        loads = loads + 1
        if onLoad then onLoad() end
        return true
    end }
end

--- Spoken loaded with these addons installed, its Text Language `text` (nil for Auto), as a reload
--- with that setting saved finds it.
local function Boot(addons, text)
    _G.Spoken, _G.SpokenEnv = nil, nil
    _G.SpokenSettings = text and { profileKeys = {}, profiles = { Default = { Language = { Text = text } } } } or nil
    stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers(); stub.SetLocale("enUS")
    stub.SetAddOns(addons)
    loads = 0
    local env = stub.LoadSpoken(SPOKEN)
    -- The game's font draws Polish, as it does: the row lists only what the client can draw
    -- (places_language_test covers the drawing itself).
    _G.GameFontHighlight = { GetFont = function() return "Fonts\\FRIZQT__.TTF", 12 end }
    env.Options.LanguageDraws = function(_, code) return code == "plPL" end
    return env, _G.Spoken
end

local function Has(list, code)
    for _, value in ipairs(list) do
        if value == code or (type(value) == "table" and value.code == code) then return true end
    end
    return false
end

local WORDS = { pages = { [15] = "Rejestr miasta Hillsbrad." }, titles = { [1] = "Rejestr" } }

---------------------------------------------------------------- the registry
local env, Spoken = Boot({ Pack() })
local polish = Spoken:Language("plPL")
Expect("a text pack declares its language", polish ~= nil and polish.texts[1], FOLDER)
Expect("...named as its .toc names it", polish and polish.native, "Polski")
Expect("...but is no voice pack: no voice to choose", Has(Spoken:InstalledLanguages(), "plPL"), false)
Expect("...nor a folder of one", polish and #polish.folders, 0)
Expect("the Text Language row offers it", Has(env.Texts:Choices(), "plPL"), true)
Expect("...after Auto and the built-in languages", env.Texts:Choices()[1], "auto")
Expect("on Auto the Text Language is the client's", select(1, Spoken:TextLanguage()), "enUS")
Expect("...not chosen", select(2, Spoken:TextLanguage()), false)
Expect("on Auto the pack is not loaded", loads, 0)
Expect("...and words for another language are not kept", Spoken:RegisterText("plPL", "readables", WORDS), false)
Expect("...nor read", Spoken:TextIn("plPL", "readables", "pages", 15), nil)

env, Spoken = Boot({ Pack({ ["X-Spoken-TextFormat"] = "2" }) })
Expect("a format this Spoken cannot read is no text pack", Spoken:Language("plPL") == nil
    or #Spoken:Language("plPL").texts == 0, true)

---------------------------------------------------------------- chosen
env, Spoken = Boot({ Pack(nil, function() _G.Spoken:RegisterText("plPL", "readables", WORDS) end) }, "plPL")
Expect("chosen, the pack is loaded with Spoken", loads, 1)
Expect("...the language is the chosen one", table.concat({ tostring(select(1, Spoken:TextLanguage())),
    tostring(select(2, Spoken:TextLanguage())) }, " "), "plPL true")
Expect("...its words are read by section, kind and key", Spoken:TextIn("plPL", "readables", "pages", 15),
    "Rejestr miasta Hillsbrad.")
Expect("...and a title", Spoken:TextIn("plPL", "readables", "titles", 1), "Rejestr")
Expect("a key no pack has reads nil", Spoken:TextIn("plPL", "readables", "pages", 99), nil)

Spoken:RegisterText("plPL", "readables", { pages = { [16] = { "Druga strona.", src = "a1b2c3" } } })
Expect("a second registration adds to the first", Spoken:TextIn("plPL", "readables", "pages", 15),
    "Rejestr miasta Hillsbrad.")
Expect("...and a leaf may carry the hash of its English", Spoken:TextIn("plPL", "readables", "pages", 16), "Druga strona.")
Spoken:RegisterText("plPL", "bosses", { stories = { [36] = { ["edwin vancleef"] = "Przewodził Bractwu." } } })
Spoken:RegisterText("plPL", "bosses", { stories = { [36] = { ["rhahk'zor"] = "Ogr." } } })
Expect("nested tables merge, key by key", tostring(Spoken:TextIn("plPL", "bosses", "stories", 36, "edwin vancleef"))
    .. " " .. tostring(Spoken:TextIn("plPL", "bosses", "stories", 36, "rhahk'zor")), "Przewodził Bractwu. Ogr.")
Spoken:RegisterText("plPL", "bosses", { storeis = { [1] = { a = "x" } } })
Expect("a kind no module reads is refused", Spoken:TextIn("plPL", "bosses", "storeis", 1, "a"), nil)
Expect("English is Spoken's own, and no pack of it is taken", (function()
    env.Texts.loaded, env.Texts.chosen = "enUS", true
    local kept = Spoken:RegisterText("enUS", "readables", WORDS)
    env.Texts.loaded, env.Texts.chosen = "plPL", true
    return kept
end)(), false)
Expect("a section no module reads is refused", Spoken:RegisterText("plPL", "mail", { pages = {} }), false)
Expect("an empty string is no words", (function()
    Spoken:RegisterText("plPL", "readables", { pages = { [17] = "" } })
    return Spoken:TextIn("plPL", "readables", "pages", 17)
end)(), nil)

---------------------------------------------------------------- the setting
env, Spoken = Boot({ Pack() })
Expect("Auto stores nothing", env.Addon.db.profile.Language.Text, nil)
Expect("a choice is stored", Spoken:SetTextLanguage("plPL") and env.Addon.db.profile.Language.Text, "plPL")
Expect("...and read as chosen", Spoken:TextLanguageChoice(), "plPL")
Expect("...but this session reads what it loaded", select(1, Spoken:TextLanguage()), "enUS")
Expect("what is no language code is refused", Spoken:SetTextLanguage("polish"), false)
Spoken:SetTextLanguage(nil)
Expect("back to Auto", Spoken:TextLanguageChoice(), nil)

env, Spoken = Boot({}, "plPL")
Expect("a chosen language whose pack has gone stays on the row", Has(env.Texts:Choices(), "plPL"), true)
env, Spoken = Boot({ Pack() })
env.Options.LanguageDraws = function() return false end
Expect("a language the client's fonts cannot draw is not offered", Has(env.Texts:Choices(), "plPL"), false)

_G.GameFontHighlight = realHighlight
stub.ResetAddOns()
if Failures() > 0 then print(Failures() .. " failure(s)"); os.exit(1) end
print("\nAll text pack tests passed")
