setfenv(1, SpokenEnv)

-- The languages Spoken knows, and which of them an installed voice pack brings. A pack declares
-- its language in its .toc, so a language needs no change to Spoken: its pack is installed and it
-- is there. The built-in ones are the languages a game client runs in, plus the names the lists
-- show for them, which the packs of those languages need not repeat.
Languages = {}

--- The built-in languages, in the order the lists show them. Each is written as a literal of the
--- form `{ code = "xxXX"`, which pipelines/places/tools/validate.mjs reads to keep its own list in
--- step. `sample` is characters only that Chinese has, which a font must draw beside the name: a
--- Korean font with Hanja draws "繁體中文" and still lacks most of Traditional Chinese.
Languages.BUILTIN = {
    { code = "enUS", name = "English", native = "English", script = "latin" },
    { code = "deDE", name = "German", native = "Deutsch", script = "latin" },
    { code = "esES", name = "Spanish (Spain)", native = "Español (España)", script = "latin" },
    { code = "esMX", name = "Spanish (Latin America)", native = "Español (América Latina)", script = "latin" },
    { code = "frFR", name = "French", native = "Français", script = "latin" },
    { code = "ptBR", name = "Portuguese (Brazil)", native = "Português", script = "latin" },
    { code = "ruRU", name = "Russian", native = "Русский", script = "cyrillic" },
    { code = "koKR", name = "Korean", native = "한국어", script = "korean" },
    { code = "zhCN", name = "Chinese (Simplified)", native = "简体中文", script = "simplifiedchinese", sample = "们这简国" },
    { code = "zhTW", name = "Chinese (Traditional)", native = "繁體中文", script = "traditionalchinese", sample = "嗎妳麼為" },
}

-- Names for languages that shipped packs existed for before packs named their own language, so that
-- an Italian or Polish pack without the name keys is not listed by its code. These are not built
-- in: nothing lists one until a pack declares it, it is no client's language, and a pack's own
-- names win. Kept apart from BUILTIN, whose literals pipelines/places/tools/validate.mjs reads.
local COURTESY = {
    itIT = { name = "Italian", native = "Italiano" },
    plPL = { name = "Polish", native = "Polski" },
    viVN = { name = "Vietnamese", native = "Tiếng Việt" },
    heIL = { name = "Hebrew", native = "עברית" },
}

-- Each pack names its language under its own section's key. Quests and Readables share the shape
-- of the others; the Quests pack that declares none is English (see Scan).
local LANGUAGE_KEYS = {
    "X-SpokenQuests-Language",
    "X-SpokenPlaces-Language",
    "X-SpokenZones-Language",
    "X-SpokenBosses-Language",
    "X-SpokenReadables-Language",
}
-- A text pack: the words of a language with no voice (Texts.lua). Not a language key above, as
-- those make a voice pack.
-- The packs of words with no voice: a text pack (Texts.lua) and an interface pack (Interface.lua),
-- each with the format it is written in, and the list of an entry's folders it goes in. A format
-- this Spoken cannot read is no pack of it: its tables would be misread.
local WORD_PACKS = {
    { key = "X-Spoken-Text", format = "X-Spoken-TextFormat", list = "texts" },
    { key = "X-Spoken-Interface", format = "X-Spoken-InterfaceFormat", list = "interfaces" },
}
local WORD_FORMAT = "1"
local PLACES_KEYS = { ["X-SpokenPlaces-Language"] = true, ["X-SpokenZones-Language"] = true }
local QUESTS_KEYS = { "X-SpokenQuests-DataModule-Version", "X-VoiceOver-DataModule-Version" }

-- Built from BUILTIN and what the packs declare; nil until first asked for, so that every pack is
-- in the AddOns list by then.
-- `voiceOf` maps a voice pack's folder to the voice it is in each language it declares.
local byCode, scanned, voiceOf

local function Reset()
    byCode, scanned, voiceOf = {}, false, {}
    for _, builtin in ipairs(Languages.BUILTIN) do
        byCode[builtin.code] = {
            code = builtin.code, name = builtin.name, native = builtin.native, script = builtin.script,
            sample = builtin.sample, client = true, builtin = true, lore = false, folders = {}, texts = {}, interfaces = {},
            voices = {},
        }
    end
end
Reset()

--- Whether a value is shaped like a language code: two lower case letters, two upper case ones.
function Languages:IsCode(value)
    return type(value) == "string" and value:find("^%l%l%u%u$") ~= nil
end

--- Whether a value is shaped like a team's slug, as the site makes them (^[a-z][a-z0-9-]{1,40}$).
local function IsTeam(value)
    return type(value) == "string" and #value >= 2 and #value <= 41 and value:find("^[a-z][a-z0-9%-]+$") ~= nil
end

--- A voice's language and its team: "deDE_stimmen" is "deDE", "stimmen"; "deDE" is "deDE", nil.
function Languages:SplitVoice(code)
    if type(code) ~= "string" then return nil, nil end
    local lang, team = code:match("^(%l%l%u%u)_(.+)$")
    if lang and IsTeam(team) then return lang, team end
    if self:IsCode(code) then return code, nil end
    return nil, nil
end

--- Whether a value is a voice: a language's code, or a language's and a team's ("deDE_stimmen").
function Languages:IsVoice(code)
    return (self:SplitVoice(code)) ~= nil
end

--- The installed voice `code`, as Voices lists it, or nil where no pack is in it.
function Languages:Voice(code)
    local lang = self:SplitVoice(code)
    local entry = lang and self:Get(lang)
    return entry and entry.voices[code]
end

--- The voice of the language `lang` that a pack of `team` (nil for none) is in.
local function VoiceCode(lang, team)
    return team and (lang .. "_" .. team) or lang
end

--- Whether the player switched the addon off in the AddOns list for this character.
local function SwitchedOff(i, getInfo)
    local _, _, _, loadable, reason = getInfo(i)
    return not loadable and reason == "DISABLED"
end

--- A pack declares its language. `meta` is what its .toc says of it: `name`, `native`, `font` (a
--- full path), `lore`, and for a team's pack `team` (its slug) and `teamName`, which make its voice. The built-in entry's names stand and, for any other, the first pack to
--- declare one is kept, so two packs of one language never fight over what it is called. A courtesy
--- name (see COURTESY) is read only where no pack gave one.
--- A code that is not shaped like one is English: a mistyped key must not mint a language.
--- `list` is "texts" or "interfaces" for a text or interface pack: no voice pack, it is kept apart,
--- so it lists no voice to choose.
function Languages:Declare(code, folder, meta, list)
    if not self:IsCode(code) then return end
    -- A game client in British English runs the English pack.
    if code == "enGB" then code = "enUS" end
    local entry = byCode[code]
    if not entry then
        entry = setmetatable({ code = code, client = false, builtin = false, lore = false, folders = {}, texts = {}, interfaces = {},
            voices = {} }, { __index = COURTESY[code] })
        byCode[code] = entry
    end
    local folders = entry[list or "folders"]
    for _, known in ipairs(folders) do
        if known == folder then return end
    end
    table.insert(folders, folder)
    if not list then
        local team = meta and IsTeam(meta.team) and meta.team or nil
        local voice = VoiceCode(code, team)
        local known = entry.voices[voice]
        if not known then
            known = { code = voice, lang = code, team = team, folders = {} }
            entry.voices[voice] = known
        end
        -- The first pack to name its team names it, as for a language.
        known.teamName = known.teamName or (team and meta.teamName) or nil
        table.insert(known.folders, folder)
        voiceOf[folder] = voiceOf[folder] or { first = voice }
        voiceOf[folder][code] = voice
    end
    if meta then
        entry.name = rawget(entry, "name") or meta.name
        entry.native = rawget(entry, "native") or meta.native
        -- A built-in language is drawn in the player's font, so a pack's font is not taken for it;
        -- a pack that needs its own face for a clip names it in the clip.
        if not entry.builtin then entry.font = entry.font or meta.font end
        entry.lore = entry.lore or meta.lore == true
    end
end

local function Value(getMeta, i, key)
    local value = getMeta(i, key)
    if value and value ~= "" then return value end
end

--- Read every installed addon's .toc, once, for the language it declares.
function Languages:Scan()
    scanned = true
    local api = C_AddOns
    local getNum = api and api.GetNumAddOns or GetNumAddOns
    local getInfo = api and api.GetAddOnInfo or GetAddOnInfo
    local getMeta = api and api.GetAddOnMetadata or GetAddOnMetadata
    for i = 1, getNum() do
        local declared, isPack, lore = {}, false, nil
        for _, key in ipairs(LANGUAGE_KEYS) do
            local value = Value(getMeta, i, key)
            isPack = isPack or value ~= nil
            if self:IsCode(value) then table.insert(declared, value) end
            -- Lore is Places', so it is the language under Places' key that carries it.
            if PLACES_KEYS[key] then lore = lore or value end
        end
        for _, key in ipairs(QUESTS_KEYS) do
            if isPack then break end
            isPack = Value(getMeta, i, key) ~= nil
        end
        local words = {}
        for _, kind in ipairs(WORD_PACKS) do
            local code = Value(getMeta, i, kind.key)
            if self:IsCode(code) and Value(getMeta, i, kind.format) == WORD_FORMAT then
                words[kind.list] = code
            end
        end
        if (isPack or next(words)) and not SwitchedOff(i, getInfo) then
            local folder = getInfo(i)
            local font = Value(getMeta, i, "X-Spoken-LanguageFont")
            local meta = {
                name = Value(getMeta, i, "X-Spoken-LanguageName"),
                native = Value(getMeta, i, "X-Spoken-LanguageNative"),
                font = font and ("Interface\\AddOns\\" .. folder .. "\\" .. font:gsub("/", "\\")),
                -- A team's pack beside the language's plain one: a voice of its own. A malformed
                -- slug is no team, and its pack is the plain voice's.
                team = Value(getMeta, i, "X-Spoken-Team"),
                teamName = Value(getMeta, i, "X-Spoken-TeamName"),
            }
            for list, code in pairs(words) do self:Declare(code, folder, meta, list) end
            if isPack then
                local carriesLore = Value(getMeta, i, "X-SpokenPlaces-Lore") == "1"
                -- A pack with no language, or only one that is no code, speaks English.
                if #declared == 0 then declared[1] = "enUS" end
                for _, value in ipairs(declared) do
                    meta.lore = carriesLore and value == lore
                    self:Declare(value, folder, meta)
                end
            end
        end
    end
end

--- The language `code`, or nil where it is neither built in nor declared by an installed pack.
function Languages:Get(code)
    if not scanned then self:Scan() end
    return byCode[code]
end

--- The languages at least one installed pack declares: the built-in ones in their order, then the
--- rest by code.
function Languages:Installed()
    if not scanned then self:Scan() end
    local list = {}
    for _, builtin in ipairs(Languages.BUILTIN) do
        local entry = byCode[builtin.code]
        if #entry.folders > 0 then table.insert(list, entry) end
    end
    local rest = {}
    for _, entry in pairs(byCode) do
        if not entry.builtin and #entry.folders > 0 then table.insert(rest, entry) end
    end
    table.sort(rest, function(a, b) return a.code < b.code end)
    for _, entry in ipairs(rest) do table.insert(list, entry) end
    return list
end

--- Every voice an installed pack is in, each `{ code, lang, team, teamName, folders }`: the
--- languages' plain voices in Installed order, each followed by its teams' by team name.
function Languages:Voices()
    local list = {}
    for _, entry in ipairs(self:Installed()) do
        local teams = {}
        for code, voice in pairs(entry.voices) do
            if code == entry.code then table.insert(list, voice) else table.insert(teams, voice) end
        end
        table.sort(teams, function(a, b)
            local na, nb = a.teamName or a.team, b.teamName or b.team
            if na ~= nb then return na < nb end
            return a.code < b.code
        end)
        for _, voice in ipairs(teams) do table.insert(list, voice) end
    end
    return list
end

--- The voice an installed pack `folder` is in: in `lang` where given, else in the first language it
--- declared. A folder no pack declared is `lang`'s plain voice.
function Languages:VoiceOf(folder, lang)
    if not scanned then self:Scan() end
    local voices = voiceOf[folder]
    if voices and lang then return voices[lang] or lang end
    return voices and voices.first or lang
end

--- The client's language as a built-in one: English where it is none (enGB). What Auto reads.
function Languages:Client()
    local locale = GetLocale and GetLocale()
    for _, builtin in ipairs(self.BUILTIN) do
        if builtin.code == locale then return locale end
    end
    return "enUS"
end

--- Whether the client's own fonts draw `entry`'s language as they are: a Latin language, or one in
--- the client's script.
function Languages:DrawnLikeClient(entry)
    if entry.script == "latin" then return true end
    local client = byCode[self:Client()]
    return entry.script ~= nil and client ~= nil and client.script == entry.script
end

--- Load the packs in `list` ("texts" or "interfaces") of the language `code`, each a LoadOnDemand
--- addon, saying in the developer's log under `tag` which did not load.
function Languages:LoadPacks(code, list, tag)
    local entry = self:Get(code)
    for _, folder in ipairs(entry and entry[list] or {}) do
        local ok, loaded, reason = pcall(LoadAddOn, folder)
        if not ok or not loaded then
            Developer:Log(tag, "%s pack %s did not load: %s", tag, folder, tostring(ok and reason or loaded))
        end
    end
end

--- A language row's choices: "auto", the built-in languages, then `extra` entries by code, each
--- where `draws(code)`; then `chosen` if it is none of them, so the row shows a choice whose pack
--- has since gone.
function Languages:ChoiceList(draws, extra, chosen)
    local list, seen = { "auto" }, {}
    local function Add(code)
        if not seen[code] and draws(code) then
            seen[code] = true
            table.insert(list, code)
        end
    end
    for _, builtin in ipairs(self.BUILTIN) do Add(builtin.code) end
    table.sort(extra, function(a, b) return a.code < b.code end)
    for _, entry in ipairs(extra) do Add(entry.code) end
    if chosen and not seen[chosen] then table.insert(list, chosen) end
    return list
end

--- The languages whose `list` ("texts" or "interfaces") has a folder, by code.
local function With(list)
    if not scanned then Languages:Scan() end
    local found = {}
    for _, entry in pairs(byCode) do
        if #entry[list] > 0 then table.insert(found, entry) end
    end
    table.sort(found, function(a, b) return a.code < b.code end)
    return found
end

--- The languages an installed text pack (Texts.lua) brings words in, by code.
function Languages:WithText() return With("texts") end

--- The languages an installed interface pack (Interface.lua) brings strings in, by code.
function Languages:WithInterface() return With("interfaces") end

--- Every language a list of packs names: the built-in ones in their order, whether installed or
--- not, then the installed rest by code.
function Languages:Known()
    local list = {}
    for _, builtin in ipairs(Languages.BUILTIN) do table.insert(list, byCode[builtin.code]) end
    for _, entry in ipairs(self:Installed()) do
        if not entry.builtin then table.insert(list, entry) end
    end
    return list
end

--- For tests: forget the scan and every declaration.
function Languages:Reset()
    Reset()
end
