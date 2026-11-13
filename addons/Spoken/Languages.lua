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
    nlNL = { name = "Dutch", native = "Nederlands" },
}

-- Languages Spoken's interface is translated into that no game client runs in, so the client's
-- locale can never choose them: the player does, under Interface Language. Each has a
-- Locale/<code>.lua in every module, loaded after the client's own so its strings win. Latin
-- script only, so that every client's font draws them.
Languages.INTERFACE = {
    { code = "nlNL", name = "Dutch", native = "Nederlands" },
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
local PLACES_KEYS = { ["X-SpokenPlaces-Language"] = true, ["X-SpokenZones-Language"] = true }
local QUESTS_KEYS = { "X-SpokenQuests-DataModule-Version", "X-VoiceOver-DataModule-Version" }

-- Built from BUILTIN and what the packs declare; nil until first asked for, so that every pack is
-- in the AddOns list by then.
local byCode, scanned

local function Reset()
    byCode, scanned = {}, false
    for _, builtin in ipairs(Languages.BUILTIN) do
        byCode[builtin.code] = {
            code = builtin.code, name = builtin.name, native = builtin.native, script = builtin.script,
            sample = builtin.sample, client = true, builtin = true, lore = false, folders = {},
        }
    end
end
Reset()

--- Whether a value is shaped like a language code: two lower case letters, two upper case ones.
function Languages:IsCode(value)
    return type(value) == "string" and value:find("^%l%l%u%u$") ~= nil
end

--- Whether the player switched the addon off in the AddOns list for this character.
local function SwitchedOff(i, getInfo)
    local _, _, _, loadable, reason = getInfo(i)
    return not loadable and reason == "DISABLED"
end

--- A pack declares its language. `meta` is what its .toc says of it: `name`, `native`, `font` (a
--- full path) and `lore`. The built-in entry's names stand and, for any other, the first pack to
--- declare one is kept, so two packs of one language never fight over what it is called. A courtesy
--- name (see COURTESY) is read only where no pack gave one.
--- A code that is not shaped like one is English: a mistyped key must not mint a language.
function Languages:Declare(code, folder, meta)
    if not self:IsCode(code) then return end
    -- A game client in British English runs the English pack.
    if code == "enGB" then code = "enUS" end
    local entry = byCode[code]
    if not entry then
        entry = setmetatable({ code = code, client = false, builtin = false, lore = false, folders = {} },
            { __index = COURTESY[code] })
        byCode[code] = entry
    end
    for _, known in ipairs(entry.folders) do
        if known == folder then return end
    end
    table.insert(entry.folders, folder)
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
        if isPack and not SwitchedOff(i, getInfo) then
            local folder = getInfo(i)
            local font = Value(getMeta, i, "X-Spoken-LanguageFont")
            local meta = {
                name = Value(getMeta, i, "X-Spoken-LanguageName"),
                native = Value(getMeta, i, "X-Spoken-LanguageNative"),
                font = font and ("Interface\\AddOns\\" .. folder .. "\\" .. font:gsub("/", "\\")),
            }
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
