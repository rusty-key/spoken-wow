setfenv(1, SpokenEnv)

-- Text packs: the words of quests, gossip, readables, bosses and places in a language, with no
-- voice. A language no game client runs in (Polish) is read nowhere else, and its text is kept by
-- its own translators, outside Spoken, so it comes as an addon of its own beside Spoken's:
--
--   ## X-Spoken-Text: plPL
--   ## X-Spoken-TextFormat: 1
--   ## LoadOnDemand: 1
--   ## Dependencies: Spoken
--
-- and calls Spoken:RegisterText(code, section, data) as it loads. Spoken loads it only where the
-- player's Text Language is its language, so a corpus nobody reads costs no memory. The sections,
-- their tables and their keys are in docs/contributors/TEXT-PACKS.md; the keys are the frozen ids
-- every pack uses, so the format holds as long as they do.
Texts = {}

-- What each section's table holds, by kind. A kind nobody reads is refused at registration, so a
-- misspelt one is said in the debug log instead of reading as a translation that never shows.
local KINDS = {
    quests = { lines = true, titles = true },
    readables = { pages = true, titles = true },
    bosses = { stories = true, names = true },
    places = { zones = true, subzones = true },
}

-- [code][section][kind] = the tables registered, merged.
local registered = {}

--- The Text Language the player chose: a code, or nil for Auto.
function Texts:Choice()
    local language = Addon.db and Addon.db.profile.Language
    local text = language and language.Text
    if Languages:IsCode(text) then return text end
    return nil
end

--- Store the player's Text Language: a code, or nil for Auto. Takes effect on the next load.
function Texts:SetChoice(code)
    local language = Addon.db and Addon.db.profile.Language
    if not language then return false end
    if code ~= nil and not Languages:IsCode(code) then return false end
    language.Text = code
    return true
end

--- The language the stored setting reads: the chosen one, or the client's (Options:ClientLanguage)
--- on Auto. The second value says whether it was chosen.
function Texts:Language()
    local chosen = self:Choice()
    if chosen then return chosen, true end
    return Languages:Client(), false
end

--- The language this session reads, as Texts:Language answered at load: its packs are the ones
--- loaded, and a choice made since waits for the reload. The second value says whether it was
--- chosen, which is where a module puts it before its own order: on Auto every module keeps the
--- order it always had.
function Texts:Reading()
    if self.loaded == nil then return self:Language() end
    return self.loaded, self.chosen
end

--- `into` with `from` laid over it, table by table, so two packs (or two files of one) can each
--- bring part of a section, as Places' subzones are split by zone. Only for the second: the first
--- pack's table is taken as it is, as copying a corpus of quest lines key by key at load is the
--- loading screen's time.
local function Merge(into, from)
    for key, value in pairs(from) do
        if type(value) == "table" and type(into[key]) == "table" then
            Merge(into[key], value)
        else
            into[key] = value
        end
    end
end

--- Take a text pack's words. Kept only for the language the player reads: a pack loaded by the
--- client before Spoken could ask (one without LoadOnDemand) costs nothing more than its parsing.
--- Returns whether they were kept.
function Texts:Register(code, section, data)
    if not (Languages:IsCode(code) and KINDS[section] and type(data) == "table") then
        Developer:Log("texts", "refused text for %s/%s: not a language and a section", tostring(code), tostring(section))
        return false
    end
    -- English is Spoken's own corpus, which a module reads as its base and the site edits: a pack
    -- of it would be a second English the modules do not ask for.
    if code == "enUS" then
        Developer:Log("texts", "refused text for enUS/%s: English is Spoken's own", section)
        return false
    end
    if code ~= self:Reading() then return false end
    for kind, value in pairs(data) do
        if not KINDS[section][kind] or type(value) ~= "table" then
            Developer:Log("texts", "refused %s %s.%s: no such kind", code, section, tostring(kind))
        else
            registered[code] = registered[code] or {}
            local tables = registered[code]
            tables[section] = tables[section] or {}
            if tables[section][kind] then Merge(tables[section][kind], value) else tables[section][kind] = value end
        end
    end
    return true
end

--- A leaf's words: a string, or a table whose [1] is (`{ "…", src = "…" }`, the hash of the English
--- it was translated from, which the pack's own checks read). Nil for anything else and for "".
local function Words(value)
    if type(value) == "table" then value = value[1] end
    if type(value) == "string" and value ~= "" then return value end
    return nil
end

--- The words a text pack gives, under `section`, `kind` and then each key in turn:
--- Texts:Get("plPL", "bosses", "stories", 33, "archmage arugal"). Nil where none does.
function Texts:Get(code, section, kind, ...)
    local node = registered[code] and registered[code][section] and registered[code][section][kind]
    for i = 1, select("#", ...) do
        if type(node) ~= "table" then return nil end
        node = node[(select(i, ...))]
    end
    return Words(node)
end

--- A section's tables in `code`, as registered and merged, or nil: for a module that takes them
--- whole (Places' zones and subzones).
function Texts:Section(code, section)
    return registered[code] and registered[code][section]
end

--- Load the text packs of the language the player reads. At Spoken's own load, after its
--- settings and before its modules, so a module finds the words there as its own files run.
--- The Text Language was the Places page's: a profile whose Places settings still hold a choice,
--- and whose Spoken ones have none, takes it before the session's language is fixed, so the first
--- login after the update reads it everywhere. Places drops its copy as it loads
--- (SpokenPlaces:MoveLanguageToSpoken), and moves one this cannot see, from before its settings
--- were kept in Spoken's profile.
function Texts:TakePlacesChoice()
    local db = Addon.db
    local language = db and db.profile.Language
    if not language or language.Text ~= nil then return end
    local places = type(db.profile.Modules) == "table" and db.profile.Modules.Places
    if type(places) ~= "table" then
        places = type(db.global.ModulesLegacy) == "table" and db.global.ModulesLegacy.Places
    end
    local pref = type(places) == "table" and places.language
    if Languages:IsCode(pref) then language.Text = pref end
end

function Texts:Load()
    self:TakePlacesChoice()
    local code, chosen = self:Language()
    self.loaded, self.chosen = code, chosen
    Languages:LoadPacks(code, "texts", "texts")
end

--- For tests: forget every pack's words.
function Texts:Reset()
    registered = {}
end

--------------------------------------------------------------------------------
-- Drawing a language
--------------------------------------------------------------------------------

-- The fonts clients ship for the other scripts, which the game's font objects fall back to and a
-- page that sets a file has to name itself, the first that draws the language taken.
local SCRIPT_FONTS = {
    cyrillic = { "Fonts\\FRIZQT___CYR.TTF" },
    korean = { "Fonts\\2002.TTF" },
    simplifiedchinese = { "Fonts\\ARKai_T.ttf" },
    -- An English Forever client has no blei00d.TTF, which its font objects still name.
    traditionalchinese = { "Fonts\\blei00d.TTF", "Fonts\\bKAI00M.TTF" },
    -- A pack's language, which has no script: the stock font most likely to draw accents a Latin
    -- font lacks, such as ệ and ữ. A script it cannot draw fails the test like any.
    [false] = { "Fonts\\ARIALN.TTF" },
}

--- The font file to write `code` in where a page uses `fontObject`: the object's own file where it
--- draws that language, else the font its pack names, else the client's font for its script. Nil
--- where none draws it. `cache` keeps the answers (`cache.fonts`), a module's own so a test can
--- clear it.
function Texts:FontFor(fontObject, code, cache)
    local path = fontObject and fontObject.GetFont and fontObject:GetFont()
    local locale = Languages:Get(code)
    -- A pack's language has no script to share with the client's, so it is always drawn to see.
    if not path or not locale or Languages:DrawnLikeClient(locale) then
        return path
    end
    cache = cache or self
    cache.fonts = cache.fonts or {}
    local key = path .. "|" .. locale.code
    if cache.fonts[key] == nil then
        cache.fonts[key] = false
        local candidates = { path }
        if locale.font then table.insert(candidates, locale.font) end
        for _, font in ipairs(SCRIPT_FONTS[locale.script or false] or {}) do table.insert(candidates, font) end
        for _, font in ipairs(candidates) do
            if Options:LanguageDraws(locale.code, font) then
                cache.fonts[key] = font
                break
            end
        end
    end
    return cache.fonts[key] or nil
end

--- The font a clip's words in `code` are drawn in (`present.font`): the file that draws them where
--- the narrator's own font cannot, else nil, and the player keeps its own. `cache` as for FontFor.
function Texts:ClipFont(code, cache)
    if not (GameFontNormal and GameFontNormal.GetFont) then return nil end
    local font = self:FontFor(GameFontNormal, code, cache)
    if font == GameFontNormal:GetFont() then return nil end
    return font
end

--- Whether this client's fonts can draw `code`: in the pages' own font files where they have its
--- script, else in its pack's font or the client's font for it (FontFor). English is always
--- allowed. Another script, and a pack's language, is tested once by drawing its own name.
--- `cache` keeps the answers (`cache.drawable`) as FontFor's.
function Texts:CanRender(code, cache)
    if code == "enUS" then
        return true
    end
    local locale = Languages:Get(code)
    if not locale then
        return false
    end
    if Languages:DrawnLikeClient(locale) then
        return true
    end
    cache = cache or self
    cache.drawable = cache.drawable or {}
    if cache.drawable[code] == nil then
        local tried, drawn = false, true
        for _, fontObject in ipairs({ _G.GameFontHighlight, _G.QuestFont }) do
            if fontObject and fontObject.GetFont and fontObject:GetFont() then
                tried = true
                drawn = drawn and self:FontFor(fontObject, code, cache) ~= nil
            end
        end
        cache.drawable[code] = tried and drawn
    end
    return cache.drawable[code]
end

--- The Text Language row's choices: "auto", then every language there are words in that this
--- client can draw: the built-in ones, then those a text pack or a voice pack brings. A voice pack
--- carries the words its voice says, so a language no client runs in is read through it.
function Texts:Choices()
    local rest = Languages:WithText()
    for _, entry in ipairs(Languages:Installed()) do table.insert(rest, entry) end
    return Languages:ChoiceList(function(code) return self:CanRender(code) end, rest, self:Choice())
end
