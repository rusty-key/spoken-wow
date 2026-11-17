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
-- The session's language and the built-in one under it, fixed at the first answer.
local language, base

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

--- The language this session's interface is in: the choice where a client runs in it or an
--- installed pack brings it, else the client's. Fixed at the first answer, as the strings loaded
--- then are the ones the session keeps.
function Interface:Language()
    if not language then language, base = self:Resolve(self:Choice()) end
    return language
end

--- What a load would read for the choice `chosen` (a code, or nil for Auto): the language, and the
--- built-in one under it. A choice no client runs in and no installed pack brings reads the client's.
function Interface:Resolve(chosen)
    local client = Languages:Client()
    local entry = chosen and Languages:Get(chosen)
    if entry and entry.builtin then return chosen, chosen end
    if entry and #entry.interfaces > 0 then return chosen, client end
    return client, client
end

--- Whether the stored choice would read another language at the next load than this session does:
--- not for one whose pack has gone, which reads the same.
function Interface:Pending()
    return (self:Resolve(self:Choice())) ~= self:Language()
end

--- The built-in language whose locale files load: the session's where a client runs in it, else
--- the client's, under a pack's strings.
function Interface:Base()
    self:Language()
    return base
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

--- Load the interface packs of the session's language. At Spoken's own load, before its modules,
--- so each finds its strings there as its locale files finish.
function Interface:Load()
    Languages:LoadPacks(self:Language(), "interfaces", "interface")
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
    return Languages:DrawnLikeClient(entry) or Options:LanguageDraws(code)
end

--- The Interface Language row's choices: "auto", the built-in languages, then those an installed
--- pack brings, each only where the game's font draws it.
function Interface:Choices()
    return Languages:ChoiceList(function(code) return self:Draws(code) end, Languages:WithInterface(), self:Choice())
end
