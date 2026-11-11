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
--                     silence that keeps those packs working. Any well-formed code is
--                     a language: Spoken's registry learns it from the pack's TOC.
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

-- The languages a game client runs in, which Spoken's registry keeps for every module. They
-- are the only ones this addon lists by itself: any other language is one an installed pack
-- declares, found by asking Spoken, and a pack for it needs no change here. Without Spoken (a
-- hand install) the list is just English.
Language.LOCALES = Spoken and Spoken.BuiltinLanguages and Spoken:BuiltinLanguages()
    or { { code = "enUS", name = "English", native = "English" } }

-- What an undeclared pack is, what a client in an unknown locale gets, and what the
-- fallback defaults to. Every pack that exists today is this.
Language.BASE = "enUS"

-- "Follow the client": the stored value, not a language code. Stored rather than
-- resolved-and-stored so that a player who never chose starts hearing Portuguese the
-- day a Portuguese pack is installed, while one who explicitly picked English keeps
-- English when a Portuguese pack appears beside it.
Language.AUTO = "auto"

--- The registry's entry for a language, or nil where it is neither built in nor declared by an
--- installed pack. Without Spoken nothing is known, and the entry is nil.
local function Entry(code)
    return code and Spoken and Spoken.Language and Spoken:Language(code) or nil
end

---@param code string|nil
---@return string name The English name of the language, or the code itself if unknown
function Language:GetName(code)
    local locale = Entry(code)
    return locale and locale.name or tostring(code)
end

--- The language's name for itself, as the language pickers list it -- the same names
--- Spoken Readables and Spoken Places show, so the three panels read alike.
---@param code string|nil
---@return string name
function Language:GetNativeName(code)
    local locale = Entry(code)
    return locale and (locale.native or locale.name) or tostring(code)
end

--- Whether a value is shaped like a language code, with or without Spoken's registry.
local function IsCode(value)
    if Spoken and Spoken.IsLanguageCode then return Spoken:IsLanguageCode(value) end
    return type(value) == "string" and string.find(value, "^%l%l%u%u$") ~= nil
end

--------------------------------------------------------------------------------
-- What a pack declares
--------------------------------------------------------------------------------

--- The language a pack was recorded in.
---
--- Absent, empty, or no code at all reads as English: every pack published before this key
--- existed carries no language at all, and those packs must keep answering lines exactly as
--- they did. A code is taken as it stands, since Spoken's scan of the same TOC has already
--- registered it.
---@param declared string|nil The raw TOC value
---@return string code
function Language:Normalize(declared)
    if IsCode(declared) then
        -- A game client in British English runs the English pack, as the registry reads it.
        return declared == "enGB" and self.BASE or declared
    end
    return self.BASE
end

--------------------------------------------------------------------------------
-- What the player chose
--------------------------------------------------------------------------------

--- The client's own locale as a language code, or English if the client runs in a
--- locale that is no built-in language.
---@return string code
function Language:GetClientLanguage()
    local locale = GetLocale and GetLocale()
    if self:IsClientLanguage(locale) then
        return locale
    end
    return self.BASE
end

--- Whether a game client runs in this language: a built-in one, which the registry marks `client`.
---@param code string|nil
---@return boolean
function Language:IsClientLanguage(code)
    local locale = Entry(code)
    return locale ~= nil and locale.client == true
end

--- The language the player wants to hear, resolved. `auto` becomes the client's locale.
---@return string code
function Language:GetVoiceLanguage()
    -- The one choice on Spoken's page for every module, once made; this addon's own until then.
    local shared = Spoken and Spoken.GetLanguageChoice and Spoken:GetLanguageChoice()
    local stored = shared or (Addon and Addon.db and Addon.db.profile.Audio.VoiceLanguage)
    -- A code is kept even where no pack of it is installed: the choice outlives the pack, and the
    -- fallback answers meanwhile.
    if stored == nil or stored == self.AUTO or not IsCode(stored) then
        return self:GetClientLanguage()
    end
    return stored
end

--- The language to try when the selected one has no clip for a line. `nil` means
--- "no fallback": the line is silent rather than spoken in a language nobody asked for.
---@return string|nil code
function Language:GetFallbackLanguage()
    -- Called on its own: an `and` chain would keep only the first of its two answers.
    local shared
    if Spoken and Spoken.GetLanguageChoice then
        local _
        _, shared = Spoken:GetLanguageChoice()
    end
    local stored = shared or (Addon and Addon.db and Addon.db.profile.Audio.FallbackLanguage)
    if stored == nil then
        return self.BASE
    end
    if stored == "none" or not IsCode(stored) then
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
