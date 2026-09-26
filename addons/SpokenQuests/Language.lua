setfenv(1, VoiceOver)

-- SpokenQuests -- the language axis of the sound packs.
--
-- A pack declares the language it was recorded in; the player says which language it
-- wants to hear and which to fall back on. Nothing else in this addon knows about
-- languages: DataModules asks this file which packs may answer a line, and in what order.
--
-- Three identifiers, deliberately distinct:
--
--   client locale     GetLocale(). What the client itself is running in, and the only
--                     thing a fresh install can guess a preference from.
--
--   pack language     X-SpokenQuests-Language on the pack's TOC. What was recorded.
--                     Absent means English: every pack published before this key
--                     existed is an English pack, and there is no other reading of
--                     silence that keeps those packs working.
--
--   voice language    What the player chose to hear. "auto" means follow the client.
--
-- The resolution order for one line is: the selected language, then the fallback
-- language, then silence. Not "any pack that has the line" -- a player who asked for
-- Portuguese and hears an English clip because that is what happened to be installed
-- has been given a bug, not a feature, and the fallback setting is where that choice
-- is made explicitly.
--
-- Gossip needs both identifiers. Which line the NPC is saying is found from its text as
-- the *client* shows it, so the lookup prefers tables in the client locale; the clip is
-- then played in the voice language like any other line. See
-- DataModules:GetNPCGossipTextHash.

Language = {}

-- Every locale a supported client can run in, and therefore every language a pack may
-- declare. A code absent here is not a language: a pack declaring one is treated as
-- undeclared (English), because the alternative is a pack that silently answers nothing.
--
-- Kept deliberately in step with SpokenZones.LOCALES in addons/SpokenZones/Language.lua:
-- the two addons are installed side by side and a player who sets Portuguese in one and
-- finds no such option in the other has found a bug.
Language.LOCALES = {
    { code = "enUS", name = "English", native = "English" },
    { code = "deDE", name = "German", native = "Deutsch" },
    { code = "esES", name = "Spanish (EU)", native = "Español (España)" },
    { code = "esMX", name = "Spanish (AL)", native = "Español (América Latina)" },
    { code = "frFR", name = "French", native = "Français" },
    { code = "ptBR", name = "Portuguese", native = "Português" },
    { code = "ruRU", name = "Russian", native = "Русский" },
    { code = "koKR", name = "Korean", native = "한국어" },
    { code = "zhCN", name = "Chinese (S)", native = "简体中文" },
    { code = "zhTW", name = "Chinese (T)", native = "繁體中文" },
}

-- What an undeclared pack is, what a client in an unknown locale gets, and what the
-- fallback defaults to. Every pack that exists today is this.
Language.BASE = "enUS"

-- "Follow the client": the stored value, not a language code. Stored rather than
-- resolved-and-stored so that a player who never chose starts hearing Portuguese the
-- day a Portuguese pack is installed, while one who explicitly picked English keeps
-- English when a Portuguese pack appears beside it.
Language.AUTO = "auto"

local byCode = {}
for _, locale in ipairs(Language.LOCALES) do
    byCode[locale.code] = locale
end

---@param code string|nil
---@return string name The English name of the language, or the code itself if unknown
function Language:GetName(code)
    local locale = code and byCode[code]
    return locale and locale.name or tostring(code)
end

--- The language's name for itself, as the language pickers list it -- the same names
--- SpokenBooks and SpokenZones show, so the three panels read alike.
---@param code string|nil
---@return string name
function Language:GetNativeName(code)
    local locale = code and byCode[code]
    return locale and (locale.native or locale.name) or tostring(code)
end

--------------------------------------------------------------------------------
-- What a pack declares
--------------------------------------------------------------------------------

--- The language a pack was recorded in.
---
--- Absent, empty, or a code this addon does not know all read as English: every pack
--- published before this key existed carries no language at all, and those packs must
--- keep answering lines exactly as they did.
---@param declared string|nil The raw TOC value
---@return string code
function Language:Normalize(declared)
    if declared and byCode[declared] then
        return declared
    end
    return self.BASE
end

--------------------------------------------------------------------------------
-- What the player chose
--------------------------------------------------------------------------------

--- The client's own locale as a language code, or English if the client runs in a
--- locale no pack could ever declare.
---@return string code
function Language:GetClientLanguage()
    local locale = GetLocale and GetLocale()
    return self:Normalize(locale)
end

--- The language the player wants to hear, resolved. `auto` becomes the client's locale.
---@return string code
function Language:GetVoiceLanguage()
    local stored = Addon and Addon.db and Addon.db.profile.Audio.VoiceLanguage
    if stored == nil or stored == self.AUTO or not byCode[stored] then
        return self:GetClientLanguage()
    end
    return stored
end

--- The language to try when the selected one has no clip for a line. `nil` means
--- "no fallback": the line is silent rather than spoken in a language nobody asked for.
---@return string|nil code
function Language:GetFallbackLanguage()
    local stored = Addon and Addon.db and Addon.db.profile.Audio.FallbackLanguage
    if stored == nil then
        return self.BASE
    end
    if stored == "none" or not byCode[stored] then
        return nil
    end
    return stored
end

--- The languages a line may be answered in, most wanted first. One entry when the
--- fallback is off or is the selected language itself; never more than two.
---@return string[] codes
function Language:ResolutionOrder()
    local selected = self:GetVoiceLanguage()
    local order = { selected }
    local fallback = self:GetFallbackLanguage()
    if fallback and fallback ~= selected then
        table.insert(order, fallback)
    end
    return order
end
