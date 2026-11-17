setfenv(1, SpokenEnv)

-- The language of Spoken's own windows and settings: the client's on Auto, a language a game client
-- runs in that the player chose (a German interface on an English client), or one an interface pack
-- brings, a language no client runs in (Polish), kept by its own translators:
--
--   ## X-Spoken-Interface: plPL
--   ## X-Spoken-InterfaceFormat: 1
--   ## LoadOnDemand: 1
--   ## Dependencies: Spoken
--
-- and calls Spoken:RegisterInterfaceStrings(code, module, strings) as it loads. Its format is in
-- docs/contributors/INTERFACE-PACKS.md.
--
-- Two layers make what a module shows. The built-in one is the module's own Locale/<code>.lua, of
-- the chosen language where a client runs in it, else of the client's: each asks Interface:In as
-- it loads. A pack's strings lie over it, so a key the pack lacks reads the built-in one, then the
-- English. The choice is account-wide and read once, before AceDB, as Spoken's own locale files
-- load: Spoken.toc sets LoadSavedVariablesFirst for it. A client that ignored that line would
-- quietly keep its own language.
Interface = {}

-- [module] = the strings a pack in the session's language registered for it, merged.
local registered = {}
local language

--- The stored choice: a code, or nil for Auto. Read from the saved table before AceDB has one.
function Interface:Choice()
    local global = Addon.db and Addon.db.global
    if not global then
        local sv = rawget(_G, "SpokenSettings")
        global = type(sv) == "table" and sv.global
    end
    local chosen = type(global) == "table" and global.InterfaceLanguage
    if Languages:IsCode(chosen) then return chosen end
    return nil
end

--- Store the choice: a code, or nil for Auto. It takes effect on the next load.
function Interface:SetChoice(code)
    if code ~= nil and not Languages:IsCode(code) then return false end
    Addon.db.global.InterfaceLanguage = code
    return true
end

--- The client's language as a built-in one: English where it is none (enGB).
local function Client()
    local locale = GetLocale and GetLocale()
    for _, builtin in ipairs(Languages.BUILTIN) do
        if builtin.code == locale then return locale end
    end
    return "enUS"
end

--- The language this session's interface is in: the choice where a client runs in it or an
--- installed pack brings it, else the client's. Fixed at the first answer, as the strings loaded
--- then are the ones the session keeps.
function Interface:Language()
    if language then return language end
    language = Client()
    local chosen = self:Choice()
    local entry = chosen and Languages:Get(chosen)
    if entry and (entry.builtin or #entry.interfaces > 0) then language = chosen end
    return language
end

--- The built-in language whose locale files load: the session's where a client runs in it, else
--- the client's, under a pack's strings.
function Interface:Base()
    local current = self:Language()
    local entry = Languages:Get(current)
    if entry and entry.builtin then return current end
    return Client()
end

--- Whether the built-in language whose locale files load is one of these codes: a locale file's
--- guard, `if not Interface:In("esES", "esMX") then return end`.
function Interface:In(...)
    local base = self:Base()
    for i = 1, select("#", ...) do
        if base == select(i, ...) then return true end
    end
    return false
end

--- For tests: forget the session's language and every pack's strings, as a reload does.
function Interface:Reset()
    language, registered = nil, {}
end

--- Load the interface packs of the session's language. At Spoken's own load, before its modules,
--- so each finds its strings there as its locale files finish.
function Interface:Load()
    local entry = Languages:Get(self:Language())
    for _, folder in ipairs(entry and entry.interfaces or {}) do
        local ok, loaded, reason = pcall(LoadAddOn, folder)
        if not ok or not loaded then
            Developer:Log("interface", "interface pack %s did not load: %s", folder, tostring(ok and reason or loaded))
        end
    end
end

--- Take a pack's strings for `module` ("Spoken", "Quests", "Places", "Readables", "Bosses" or
--- "Developer"). Kept only for the session's language. Spoken's own are laid over its strings at
--- once; a module's wait for it to load (Interface:Apply). Returns whether they were kept.
function Interface:Register(code, module, strings)
    if not (Languages:IsCode(code) and type(module) == "string" and type(strings) == "table") then
        Developer:Log("interface", "refused strings for %s/%s", tostring(code), tostring(module))
        return false
    end
    if code ~= self:Language() then return false end
    registered[module] = registered[module] or {}
    for key, value in pairs(strings) do
        if type(value) == "string" and value ~= "" then registered[module][key] = value end
    end
    if module == "Spoken" then
        self:Apply("Spoken", L)
        Options:NameBindings()
    end
    return true
end

--- The strings packs registered for `module`, or nil.
function Interface:Strings(module)
    return registered[module]
end

--- Lay a pack's strings for `module` over `strings`, the module's own table, in place.
function Interface:Apply(module, strings)
    for key, value in pairs(registered[module] or {}) do strings[key] = value end
end

--- Whether the game's font draws `code` as the interface needs it: a Latin language, one in the
--- client's script, or one whose own name the settings' font draws. The interface has no font of
--- its own to fall back on, unlike a caption.
function Interface:Draws(code)
    local entry = Languages:Get(code)
    if not entry then return false end
    if entry.script == "latin" then return true end
    local client = Languages:Get(Client())
    if entry.script and client and client.script == entry.script then return true end
    return Options:LanguageDraws(code)
end

--- The Interface Language row's choices: "auto", the built-in languages, then those an installed
--- pack brings, each only where the game's font draws it. A chosen language whose pack has since
--- gone stays on the list, so the row shows it.
function Interface:Choices()
    local list, seen = { "auto" }, {}
    local function Add(code)
        if not seen[code] and self:Draws(code) then
            seen[code] = true
            table.insert(list, code)
        end
    end
    for _, builtin in ipairs(Languages.BUILTIN) do Add(builtin.code) end
    for _, entry in ipairs(Languages:WithInterface()) do Add(entry.code) end
    local chosen = self:Choice()
    if chosen and not seen[chosen] then table.insert(list, chosen) end
    return list
end
