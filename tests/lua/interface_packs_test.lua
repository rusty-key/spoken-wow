-- Interface Language (Spoken's Interface.lua): the built-in locale files load by the language the
-- player chose, and an interface pack's strings lie over them, in Spoken and in each module. Also
-- that Spoken's files read no string as they load but the key bindings' names, which are named
-- again when a pack's strings arrive. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/Spoken/"
local READABLES = here .. "/../../addons/Spoken_Readables/"
local PLACES = here .. "/../../addons/Spoken_Places/"
local Expect, Failures = H.Expecter(print)

local FOLDER = "WoWPoPolsku_Interface"
local loads = 0
local function Pack(onLoad)
    return { folder = FOLDER, loadOnDemand = true, onLoad = function()
            loads = loads + 1
            if onLoad then onLoad() end
            return true
        end,
        meta = H.InterfacePackMeta("plPL") }
end
local POLISH = function()
    _G.Spoken:RegisterInterfaceStrings("plPL", "Spoken", { PLAY = "Odtwórz", BIND_STOP_REPLAY = "Zatrzymaj lub powtórz" })
    _G.Spoken:RegisterInterfaceStrings("plPL", "Readables", { OPT_AUTOPLAY = "Czytaj automatycznie" })
    _G.Spoken:RegisterInterfaceStrings("plPL", "Places", { OPT_SECTION_MAP = "Mapa" })
    _G.Spoken:RegisterInterfaceStrings("deDE", "Spoken", { PLAY = "Nicht diese" })
end

--- Spoken loaded on a client in `locale` with these addons installed, the Interface Language
--- `chosen` saved (nil for Auto), as a reload finds it.
local function Boot(addons, locale, chosen)
    _G.Spoken, _G.SpokenEnv = nil, nil
    _G.SpokenSettings = chosen and { global = { InterfaceLanguage = chosen } } or nil
    stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers(); stub.SetLocale(locale or "enUS")
    stub.SetAddOns(addons)
    local env = stub.LoadSpoken(SPOKEN)
    env.Options.LanguageDraws = function(_, code) return code == "plPL" end
    return env, _G.Spoken
end

local function Readables()
    local B = {}
    for _, file in ipairs({ "Locale/enUS", "Locale/deDE", "Locale/esES", "Locale/frFR", "Locale/ptBR",
        "Locale/ruRU", "Locale/koKR", "Locale/zhCN", "Locale/zhTW", "Locale/Interface" }) do
        assert(loadfile(READABLES .. file .. ".lua"))("Spoken_Readables", B)
    end
    return B
end

local Has = H.Has

---------------------------------------------------------------- Auto
loads = 0
local env, Spoken = Boot({ Pack(POLISH) })
Expect("on Auto the interface is the client's", Spoken:InterfaceLanguage(), "enUS")
Expect("...its words English", env.L.PLAY, "Play")
Expect("...and the pack is not loaded", loads, 0)
Expect("an interface pack is no voice pack", #Spoken:Language("plPL").folders, 0)
Expect("the Interface Language row offers it", Has(env.Interface:Choices(), "plPL"), true)
Expect("...and the built-in languages", Has(env.Interface:Choices(), "deDE"), true)

---------------------------------------------------------------- a built-in language chosen
env, Spoken = Boot({}, "enUS", "deDE")
Expect("German chosen on an English client, Spoken's locale file is German's", env.L.PLAY, "Abspielen")
Expect("...and so is a module's", Readables().L.OPT_AUTOPLAY ~= "Read Automatically", true)
env, Spoken = Boot({}, "deDE", nil)
Expect("on Auto a German client is German", env.L.PLAY, "Abspielen")
env, Spoken = Boot({}, "deDE", "enUS")
Expect("...and English chosen there is English", env.L.PLAY, "Play")

---------------------------------------------------------------- a pack's language chosen
env, Spoken = Boot({ Pack(POLISH) }, "enUS", "plPL")
Expect("Polish chosen, the session is Polish", Spoken:InterfaceLanguage(), "plPL")
Expect("...on English's locale files", Spoken:InterfaceBase(), "enUS")
Expect("...the pack's strings lie over Spoken's", env.L.PLAY, "Odtwórz")
Expect("...a key the pack lacks reads English", env.L.TRANSCRIPT, "Words")
Expect("...a pack's strings for another language are not taken", env.L.PLAY ~= "Nicht diese", true)
Expect("...and the key bindings are named again in Polish", _G.BINDING_NAME_SPOKEN_PLAYPAUSE, "Zatrzymaj lub powtórz")
local B = Readables()
Expect("a module's locale files end with the pack's strings over them", B.L.OPT_AUTOPLAY, "Czytaj automatycznie")
Expect("...the rest English", B.L.OPT_WHOLE_BOOK, "Read Whole Book")
local Z = H.LoadPlaces(PLACES, {})
for _, file in ipairs({ "Locale/enUS", "Locale/deDE", "Locale/Interface" }) do
    assert(loadfile(PLACES .. file .. ".lua"))("Spoken_Places", Z)
end
Expect("Places reads the pack's first", Z.L.OPT_SECTION_MAP, "Mapa")
Expect("...and English where the pack has none", Z.L.OPT_PICTURES ~= nil and Z.L.OPT_PICTURES:find("^%[%[") == nil, true)

env, Spoken = Boot({ Pack(POLISH) }, "deDE", "plPL")
Expect("Polish chosen on a German client: the pack's strings", env.L.PLAY, "Odtwórz")
Expect("...and German where the pack has none", env.L.TRANSCRIPT, "Text")
Expect("...in a module too", Readables().L.OPT_WHOLE_BOOK ~= "Read Whole Book", true)

-- A pack for a language a client runs in lies over that language's own strings.
local GERMAN = { folder = "BetterGerman", loadOnDemand = true, meta = H.InterfacePackMeta("deDE"), onLoad = function()
    _G.Spoken:RegisterInterfaceStrings("deDE", "Places", { OPT_SECTION_MAP = "Karte (besser)" })
    return true
end }
env, Spoken = Boot({ GERMAN }, "deDE", "deDE")
Z = H.LoadPlaces(PLACES, {})
for _, file in ipairs({ "Locale/enUS", "Locale/deDE", "Locale/Interface" }) do
    assert(loadfile(PLACES .. file .. ".lua"))("Spoken_Places", Z)
end
local german = {}
assert(loadfile(PLACES .. "Locale/deDE.lua"))("Spoken_Places", { RegisterStrings = function(_, _, strings) german = strings end })
Expect("a German pack's strings lie over Places' German", Z.L.OPT_SECTION_MAP, "Karte (besser)")
Expect("...and the keys it lacks keep the German, not English", Z.L.OPT_PICTURES, german.OPT_PICTURES)

env, Spoken = Boot({}, "enUS", "plPL")
Expect("a chosen language whose pack has gone reads the client's", Spoken:InterfaceLanguage(), "enUS")
Expect("...and stays on the row", Has(env.Interface:Choices(), "plPL"), true)
Expect("...and asks for no reload, which would change nothing", env.Interface:Pending(), false)

---------------------------------------------------------------- the setting
env, Spoken = Boot({ Pack() })
Expect("Auto stores nothing", env.Addon.db.global.InterfaceLanguage, nil)
Expect("a choice is stored account-wide", env.Interface:SetChoice("plPL") and env.Addon.db.global.InterfaceLanguage, "plPL")
Expect("...and waits for the reload", Spoken:InterfaceLanguage(), "enUS")
Expect("...which the row says", env.Interface:Pending(), true)
env.Interface:SetChoice("enUS")
Expect("English chosen on an English client reads as Auto did: no reload", env.Interface:Pending(), false)
Expect("what is no language code is refused", env.Interface:SetChoice("polish"), false)
env.Interface:SetChoice(nil)
env.Options.LanguageDraws = function() return false end
Expect("a language the game's font cannot draw is not offered", Has(env.Interface:Choices(), "plPL"), false)

---------------------------------------------------------------- strings read as Spoken's files load
-- Each file runs with L wrapped so a read is recorded until the last one has loaded. A string read
-- then would stay in the language before a pack's arrive; only the key bindings may, as
-- Options:NameBindings names them again.
do
    _G.Spoken, _G.SpokenEnv, _G.SpokenSettings = nil, nil, nil
    stub.SetAddOns({})
    local reads, loading = {}, true
    local realDofile = dofile
    _G.dofile = function(path)
        local results = { realDofile(path) }
        if path:match("Strings%.lua$") then
            local real = _G.SpokenEnv.L
            _G.SpokenEnv.L = setmetatable({}, {
                __index = function(_, key) if loading then reads[key] = true end return real[key] end,
                __newindex = real })
        end
        return unpack(results)
    end
    local loaded = stub.LoadSpoken(SPOKEN)
    loading = false
    _G.dofile = realDofile
    local read = {}
    for key in pairs(reads) do
        if not key:match("^BIND_") then table.insert(read, key) end
    end
    table.sort(read)
    Expect("Spoken's files read no string as they load but the key bindings'", table.concat(read, " "), "")
    loaded.L = getmetatable(loaded.L).__newindex
end

stub.ResetAddOns()
_G.SpokenSettings = nil
if Failures() > 0 then print(Failures() .. " failure(s)"); os.exit(1) end
print("\nAll interface pack tests passed")
