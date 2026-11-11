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

-- Spoken's menus list what is installed, named as this client can draw it.
local function HebrewInstalled(meta)
    local m = { ["X-SpokenQuests-Language"] = "heIL" }
    for k, v in pairs(meta or {}) do m[k] = v end
    return Install({ Pack("SpokenCommunity_ivrit", m), Pack("SpokenCommunity_deutsch", { ["X-SpokenQuests-Language"] = "deDE" }) })
end
local function List(list) return table.concat(list, ",") end
env = HebrewInstalled(HEBREW)
Expect("voice choices", List(env.Options:VoiceChoices()), "auto,deDE,heIL")
Expect("fallback choices", List(env.Options:FallbackChoices()), "none,deDE,heIL")
env = Install({})
Expect("no packs: only auto", List(env.Options:VoiceChoices()), "auto")
env = HebrewInstalled()
Expect("a pack without names shows its code", env.Options:LanguageName("heIL"), "heIL")
Expect("an unknown language shows its code", env.Options:LanguageName("itIT"), "itIT")
Expect("a built-in Latin language shows its native name", env.Options:LanguageName("deDE"), "Deutsch")
Expect("a language the registry lacks draws nothing", env.Options:LanguageDraws("itIT"), false)

-- Every glyph but ASCII is a box here, so only a pack's own font can draw Hebrew.
stub.TextWidth = function(fs)
    local width = 0
    for ch in tostring(fs.text or ""):gmatch("[%z\1-\127\194-\244][\128-\191]*") do
        width = width + ((fs.fontFile == "Interface\\AddOns\\SpokenCommunity_ivrit\\Fonts\\Hebrew.ttf"
            and #ch > 1 and ch ~= "\205\184") and 7 or (#ch > 1 and 10 or 7))
    end
    return width
end
env = HebrewInstalled(HEBREW)
local drawn = env.Options:LanguageName("heIL")
Expect("the pack's font draws the native name", drawn, "עברית")
Expect("...and is offered for the menu", env.Options:LanguageFace("heIL"),
    "Interface\\AddOns\\SpokenCommunity_ivrit\\Fonts\\Hebrew.ttf")
Expect("a Latin language needs no face", env.Options:LanguageFace("deDE"), nil)

stub.refusedFonts = { ["Interface\\AddOns\\SpokenCommunity_ivrit\\Fonts\\Hebrew.ttf"] = true }
env = HebrewInstalled(HEBREW)
Expect("a font the client cannot load falls back to the English name", env.Options:LanguageName("heIL"), "Hebrew")
Expect("...and offers no face", env.Options:LanguageFace("heIL"), nil)
stub.refusedFonts, stub.TextWidth = nil, nil

-- Layout:Dropdown draws an entry in its own font where `fontOf` gives one, and puts the font back
-- where it does not: the game's menu buttons are pooled, so a face must not outlive its entry.
local FACE, OWN = "Interface\\AddOns\\SpokenCommunity_ivrit\\Fonts\\Hebrew.ttf", "Fonts\\FRIZQT__.TTF"
local function FaceOf(value) return value == "heIL" and FACE or nil end
local function Layout() return env.SpokenLayout or _G.SpokenLayout end
env = Install({})
-- The classic menu.
local closedText = stub.Widget("FontString", "SpokenLayoutDropdown1Text")
closedText:SetFont(OWN, 12, "")
_G.SpokenLayoutDropdown1Text = closedText
local chosen = "heIL"
local classic = Layout().New(stub.Widget("Frame"), 25, -16)
local control = classic:Dropdown("Language", nil, { "deDE", "heIL" }, function() return chosen end,
    function(v) chosen = v end, nil, tostring, FaceOf)
-- The stub's widgets do not name themselves, as the game's do.
function control:GetName() return "SpokenLayoutDropdown1" end
control.layoutSync()
local entries = stub.OpenDropdown(control)
Expect("classic: an entry with a face gets a font object", entries[2].fontObject ~= nil, true)
Expect("classic: an entry without one gets none", entries[1].fontObject, nil)
Expect("classic: the closed text wears the chosen entry's face", closedText.fontFile, FACE)
chosen = "deDE"
control.layoutSync()
Expect("classic: ...and gets its own font back", closedText.fontFile, OWN)
_G.SpokenLayoutDropdown1Text = nil

-- The modern menu: a radio's initializer is added for every entry, and refonts its pooled button.
local realCreate, realMenu = _G.CreateFrame, _G.MenuUtil
_G.MenuUtil = {}
local initializers = {}
local dropdown = stub.Widget("Frame")
dropdown.Text = stub.Widget("FontString")
dropdown.Text:SetFont(OWN, 12, "")
function dropdown:SetupMenu(generator) self.generator = generator end
function dropdown:GenerateMenu()
    initializers = {}
    self.generator(self, { CreateRadio = function(_, text)
        local element = { text = text }
        function element:AddInitializer(fn) initializers[text] = fn end
        return element
    end })
end
_G.CreateFrame = function(kind, name, parent, template)
    if template == "SettingsDropdownWithButtonsTemplate" then
        local frame = stub.Widget("Frame")
        frame.Dropdown = dropdown
        return frame
    end
    return realCreate(kind, name, parent, template)
end
chosen = "heIL"
local modern = Layout().New(stub.Widget("Frame"), 25, -16)
local modernControl = modern:Dropdown("Language", nil, { "deDE", "heIL" }, function() return chosen end,
    function(v) chosen = v end, nil, tostring, FaceOf)
local button = { fontString = stub.Widget("FontString") }
button.fontString:SetFont(OWN, 12, "")
initializers.heIL(button)
Expect("modern: an entry with a face draws in it", button.fontString.fontFile, FACE)
initializers.deDE(button)
Expect("modern: a pooled button reused for an entry without one gets its font back", button.fontString.fontFile, OWN)
Expect("modern: the closed text wears the chosen entry's face", dropdown.Text.fontFile, FACE)
chosen = "deDE"
modernControl.layoutSync()
Expect("modern: ...and gets its own font back", dropdown.Text.fontFile, OWN)
_G.CreateFrame, _G.MenuUtil = realCreate, realMenu

-- A clip's text is drawn in its language's pack font, unless the clip names a font itself.
env = HebrewInstalled(HEBREW)
local function ClipText()
    local text = stub.Widget("FontString")
    -- The stub's own GetFont always answers the same face; the client reports what was set.
    function text:GetFont() return self.fontFile, self.fontSize, self.fontFlags end
    text:SetFont(OWN, 12, "OUTLINE")
    return text
end
local text = ClipText()
env.Addon:ClipFont(text, { present = { lang = "heIL" } })
Expect("clip: the pack's font draws its language", text.fontFile, FACE)
Expect("clip: ...at the player's size", text.fontSize, 12)
Expect("clip: ...and flags", text.fontFlags, "OUTLINE")
env.Addon:ClipFont(text, { present = { lang = "deDE" } })
Expect("clip: a language with no pack font goes back to the player's own", text.fontFile, OWN)
text = ClipText()
env.Addon:ClipFont(text, { present = { lang = "heIL", font = "Fonts\\ARIALN.TTF" } })
Expect("clip: present.font beats the pack's", text.fontFile, "Fonts\\ARIALN.TTF")
text = ClipText()
env.Addon:ClipFont(text, { present = { lang = "xxXX" } })
Expect("clip: a language nobody declared keeps the player's face", text.fontFile, OWN)
text = ClipText()
stub.refusedFonts = { [FACE] = true }
env.Addon:ClipFont(text, { present = { lang = "heIL" } })
Expect("clip: a pack font the client refuses leaves the player's face", text.fontFile, OWN)
stub.refusedFonts = nil

stub.ResetAddOns()
if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll language registry tests passed")
