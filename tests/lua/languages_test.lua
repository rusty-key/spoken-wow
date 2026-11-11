-- The registry of languages: the built-in ones, and those an installed pack declares in its
-- .toc. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

local QUESTS_KEY = "X-SpokenQuests-DataModule-Version"

--- Install the given addons and load Spoken. Each is { folder, meta, loadable, reason }.
local function Install(addons)
    stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()
    stub.SetAddOns(addons)
    return stub.LoadSpoken(SPOKEN)
end

local function Pack(folder, meta, extra)
    local entry = { folder = folder, meta = meta }
    for k, v in pairs(extra or {}) do entry[k] = v end
    return entry
end

local function Codes(env)
    local codes = {}
    for _, entry in ipairs(env.Languages:Installed()) do codes[#codes + 1] = entry.code end
    return table.concat(codes, ",")
end

local env = Install({})
Expect("no packs: nothing installed", #env.Languages:Installed(), 0)
Expect("deDE is built in", env.Languages:Get("deDE").builtin, true)
Expect("deDE is a client language", env.Languages:Get("deDE").client, true)
Expect("deDE script", env.Languages:Get("deDE").script, "latin")
Expect("zhTW sample", env.Languages:Get("zhTW").sample, "嗎妳麼為")
Expect("heIL is unknown", env.Languages:Get("heIL"), nil)
Expect("IsCode accepts deDE", env.Languages:IsCode("deDE"), true)
Expect("IsCode rejects a word", env.Languages:IsCode("hebrew"), false)
Expect("IsCode rejects a number", env.Languages:IsCode(12), false)

env = Install({ Pack("SpokenQuestsAudio", { [QUESTS_KEY] = "1" }) })
Expect("a quests pack without a language is English", Codes(env), "enUS")

local HEBREW = {
    ["X-SpokenQuests-Language"] = "heIL",
    ["X-Spoken-LanguageName"] = "Hebrew",
    ["X-Spoken-LanguageNative"] = "עברית",
    ["X-Spoken-LanguageFont"] = "Fonts/Hebrew.ttf",
}
env = Install({ Pack("SpokenCommunity_ivrit", HEBREW) })
local he = env.Languages:Get("heIL")
Expect("heIL name", he.name, "Hebrew")
Expect("heIL native", he.native, "עברית")
Expect("heIL is no client language", he.client, false)
Expect("heIL is not built in", he.builtin, false)
Expect("heIL font is a full path", he.font, "Interface\\AddOns\\SpokenCommunity_ivrit\\Fonts\\Hebrew.ttf")
Expect("heIL folders", table.concat(he.folders, ","), "SpokenCommunity_ivrit")

env = Install({ Pack("SpokenCommunity_ivrit", { ["X-SpokenQuests-Language"] = "heIL" }) })
Expect("heIL without a name has none", env.Languages:Get("heIL").name, nil)
Expect("heIL without a name is still installed", Codes(env), "heIL")

env = Install({ Pack("SpokenCommunity_deutsch", {
    ["X-SpokenQuests-Language"] = "deDE", ["X-Spoken-LanguageName"] = "Deutschish" }) })
Expect("the built-in name wins", env.Languages:Get("deDE").name, "German")

env = Install({
    Pack("SpokenCommunity_a", { ["X-SpokenQuests-Language"] = "plPL", ["X-Spoken-LanguageName"] = "Polish" }),
    Pack("SpokenCommunity_b", { ["X-SpokenQuests-Language"] = "plPL", ["X-Spoken-LanguageName"] = "Polski2" }),
})
Expect("the first pack's name wins", env.Languages:Get("plPL").name, "Polish")
Expect("both packs are listed", #env.Languages:Get("plPL").folders, 2)

env = Install({ Pack("SpokenCommunity_ivrit", HEBREW, { loadable = false, reason = "DISABLED" }) })
Expect("a switched-off pack does not count", env.Languages:Get("heIL"), nil)
Expect("a switched-off pack lists nothing", #env.Languages:Installed(), 0)

env = Install({ Pack("SpokenCommunity_missing", HEBREW, { loadable = false, reason = "MISSING" }) })
Expect("a pack that cannot load for another reason still counts", env.Languages:Get("heIL") ~= nil, true)

for _, bad in ipairs({ "hebrew", "he", "HEil" }) do
    env = Install({ Pack("SpokenCommunity_bad", { [QUESTS_KEY] = "1", ["X-SpokenQuests-Language"] = bad }) })
    Expect("malformed " .. bad .. " reads as English", Codes(env), "enUS")
    Expect("malformed " .. bad .. " is no language", env.Languages:Get(bad), nil)
end

for _, key in ipairs({ "X-SpokenPlaces-Language", "X-SpokenZones-Language", "X-SpokenBosses-Language",
    "X-SpokenReadables-Language" }) do
    env = Install({ Pack("SpokenCommunity_x", { [key] = "heIL" }) })
    Expect(key .. " counts", Codes(env), "heIL")
end

env = Install({ Pack("SpokenPlacesAudio_ivrit", { ["X-SpokenPlaces-Language"] = "heIL", ["X-SpokenPlaces-Lore"] = "1" }) })
Expect("lore is carried", env.Languages:Get("heIL").lore, true)
env = Install({ Pack("SpokenPlacesAudio_ivrit", { ["X-SpokenPlaces-Language"] = "heIL" }) })
Expect("lore is off by default", env.Languages:Get("heIL").lore, false)

env = Install({ Pack("SpokenQuestsAudio", { [QUESTS_KEY] = "1" }) })
Expect("before the declaration", env.Languages:Get("itIT"), nil)
env.Languages:Declare("itIT", "SpokenReadablesAudio_itIT")
Expect("a declared language is installed", Codes(env), "enUS,itIT")
env.Languages:Declare("itIT", "SpokenReadablesAudio_itIT")
Expect("a folder declares once", #env.Languages:Get("itIT").folders, 1)
env.Languages:Declare("hebrew", "SpokenReadablesAudio_x")
Expect("a non-code is ignored", env.Languages:Get("hebrew"), nil)
env.Languages:Reset()
Expect("Reset forgets declarations", env.Languages:Get("itIT"), nil)

env = Install({
    Pack("SpokenCommunity_a", { ["X-SpokenQuests-Language"] = "heIL" }),
    Pack("SpokenCommunity_b", { ["X-SpokenQuests-Language"] = "deDE" }),
    Pack("SpokenCommunity_c", { [QUESTS_KEY] = "1" }),
    Pack("SpokenCommunity_d", { ["X-SpokenQuests-Language"] = "plPL" }),
})
Expect("built-in first, the rest by code", Codes(env), "enUS,deDE,heIL,plPL")

env = Install({ Pack("SpokenQuestsAudio", { [QUESTS_KEY] = "1", ["X-SpokenQuests-Language"] = "enGB" }) })
Expect("enGB is read as enUS", Codes(env), "enUS")

env = Install({ Pack("SpokenCommunity_a", { ["X-SpokenQuests-Language"] = "heIL" }) })
Expect("the API answers", Spoken:Language("heIL").code, "heIL")
Expect("the API lists", #Spoken:InstalledLanguages(), 1)
Spoken:DeclareLanguage("itIT", "SpokenReadablesAudio_itIT")
Expect("the API declares", #Spoken:InstalledLanguages(), 2)
Expect("the API tests a code", Spoken:IsLanguageCode("heIL"), true)

stub.ResetAddOns()
if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll language registry tests passed")
