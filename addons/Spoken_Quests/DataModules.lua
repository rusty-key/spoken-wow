setfenv(1, VoiceOver)

local CURRENT_MODULE_VERSION = 1

-- A pack declares itself with a TOC key rather than a name, which is why a pack published
-- years ago is still found today and why the packs kept their folder names through the
-- rename. The key itself is being renamed, so both generations are read, newest first.
-- X-VoiceOver-DataModule-* is what every shipped pack carries, and what a pack built for
-- upstream AI_VoiceOver carries; those keep working indefinitely. A pack built during the
-- transition carries both, so that it also loads under the addon's previous release.
local MODULE_KEY_PREFIXES = { "X-SpokenQuests-DataModule-", "X-VoiceOver-DataModule-" }

-- The language a pack was recorded in, read off the pack's own TOC. Deliberately not a
-- DataModule- key: it describes the recording rather than the data format, and a pack
-- built for upstream AI_VoiceOver never carries it. Absent is English -- see Language.lua.
local LANGUAGE_KEY = "X-SpokenQuests-Language"

--- One of a pack's module keys, whichever generation it declares.
---@param addon string|number Addon folder name, or its index in the addon list
---@param suffix string "Version" | "Priority" | "Maps"
local function ModuleMeta(addon, suffix)
    for _, prefix in ipairs(MODULE_KEY_PREFIXES) do
        -- Absent reads as nil on a client and as "" in the test harness.
        local value = GetAddOnMetadata(addon, prefix .. suffix)
        if value and value ~= "" then
            return value
        end
    end
end

--- The numeric form. Absent stays absent: the client tolerates tonumber(nil), LuaJIT does not.
local function ModuleNumber(addon, suffix)
    return tonumber(ModuleMeta(addon, suffix) or "")
end
--- Whether the player switched the addon off in the AddOns list for this character. Not
--- GetAddOnEnableState: given a name rather than a GUID, C_AddOns answers for all characters.
local function SwitchedOff(addon)
    local _, _, _, loadable, reason = GetAddOnInfo(addon)
    return not loadable and reason == "DISABLED"
end
local LOAD_ALL_MODULES = true

---@class DataModuleMetadata
---@field AddonName string Addon name
---@field LoadOnDemand boolean Whether the module can be dynamically loaded (TOC ##LoadOnDemand)
---@field ModuleVersion number Module's data format version (TOC ##X-SpokenQuests-DataModule-Version or ##X-VoiceOver-DataModule-Version, must be CURRENT_MODULE_VERSION to be loaded)
---@field ModulePriority number Module's priority (TOC ##X-SpokenQuests-DataModule-Priority or ##X-VoiceOver-DataModule-Priority, larger number = higher priority)
---@field ContentVersion? string Module's content version (TOC ##Version)
---@field Title string Module's title (TOC ##Title or addon name if missing)
---@field Maps number[] Map IDs in which the module should load (TOC ##X-SpokenQuests-DataModule-Maps or ##X-VoiceOver-DataModule-Maps)
---@field Language string The language the pack was recorded in (TOC ##X-SpokenQuests-Language; absent means enUS)

---@class DataModule
---@field METADATA DataModuleMetadata
---@field LookupLocale? string The client locale the module's text-keyed tables are written in (absent means the pack's own language)
---@field ClientLocaleLookups? table Text-keyed tables in this client's locale, loaded only on a client in it
---@field GetSoundPath fun(self: DataModule, fileName: string, event: SoundEvent): string Function implemented in the module that returns the sound path for the desired voiceover
---@field GossipLookupByNPCID table<number, table<string, string>> Maps Creature ID and fuzzy-searchable gossip text to gossip text hash
---@field GossipLookupByNPCName table<string, table<string, string>> Maps Creature name and fuzzy-searchable gossip text to gossip text hash
---@field GossipLookupByObjectID table<number, table<string, string>> Maps GameObject ID and fuzzy-searchable gossip text to gossip text hash
---@field GossipLookupByObjectName table<string, table<string, string>> Maps GameObject name and fuzzy-searchable gossip text to gossip text hash
---@field QuestIDLookup table<QuestIDLookupSource, table<string, number|table<string, number|table<string, number>>>> Maps quest title to quest ID or (if there is ambiguity) maps quest title and quest giver name to quest ID or (if there is ambiguity) maps quest title and quest giver name and fuzzy-searchable quest text to quest ID
---@field NPCIDLookupByQuestID table<number, number> Maps Quest ID to quest giver Creature ID
---@field ObjectIDLookupByQuestID table<number, number> Maps Quest ID to quest giver GameObject ID
---@field ItemIDLookupByQuestID table<number, number> Maps Quest ID to quest giver Item ID
---@field NPCNameLookupByNPCID table<number, string> Maps Creature ID to Creature name
---@field ObjectNameLookupByObjectID table<number, string> Maps GameObject ID to GameObject name
---@field ItemNameLookupByItemID table<number, string> Maps Item ID to Item name
---@field SoundLengthLookupByFileName table<string, number> Maps sound filenames to their duration in seconds
---@field WordTimesByFileName? table<string, string> Maps sound filenames to when each word of their line starts, packed as clip.present.timings takes them
---@field QuestFileLookupByNPCID? table<string, table<number, string>> Maps a quest line's filename and its giver's Creature ID to the line in that giver's own voice, where it differs
---@field QuestFileLookupByObjectID? table<string, table<number, string>> Maps a quest line's filename and its giver's GameObject ID to the line in that giver's own voice, where it differs
---@field GossipFileLookupByNPCSex? table<number, table<number, table<string, string>>> Maps a split Creature ID, the sex it is drawn as (UnitSex) and a gossip line's hash to the file that sex hears
---@field QuestFileLookupByNPCSex? table<string, table<number, table<number, string>>> Maps a quest line's filename, its split giver's Creature ID and the sex it is drawn as to the file that sex hears
---@field NPCSexByNPCID? table<number, number> Maps every other speaking Creature ID to the sex (UnitSex) it is voiced as
---@field GossipFileLookupByNPCBody? table<number, table<string, table<string, string>>> Maps a split Creature ID, the body it is drawn as ("gnome-female") and a gossip line's hash to the file that body hears
---@field QuestFileLookupByNPCBody? table<string, table<number, table<string, string>>> Maps a quest line's filename, its split giver's Creature ID and the body it is drawn as to the file that body hears
---@field FollowupLookupByNPCBody? table<number, table<number, table<string, string>>> Maps a split speaker's Creature ID, a follow-up's BroadcastText ID and the body it is drawn as to the file that body hears
---@field NPCBodiesByNPCID? table<number, table<string, boolean>> Maps every Creature ID that greets to the bodies it is voiced as
---@field BodyByModelFileID? table<number, string> Maps a character model's file id to the body it draws

---@class AvailableDataModule
---@field AddonName string Addon name
---@field Title string Module's title (TOC ##Title)
---@field ContentVersion string Module's content version (TOC ##Version)
---@field RelevantAboveVersion? number Interface number above which (inclusive) it makes sense to show this module as available to download or update
---@field RelevantBelowVersion? number Interface number below which (exclusive) it makes sense to show this module as available to download or update
---@field URL string URL where the module can be downloaded

DataModules =
{
    --- Store the modules present in Interface\AddOns folder, whether they're loaded or not
    ---@type table<string, DataModuleMetadata>
    presentModules = {},

    --- Stores present modules with a consistent ordering (which key-value hashmaps don't provide) to avoid bugs that can only be reproduced randomly
    ---@type DataModuleMetadata[]
    presentModulesOrdered = {},

    --- Stores the modules that were already loaded and registered
    ---@type table<string, DataModule>
    registeredModules = {},

    --- Stores registered modules with a consistent ordering (which key-value hashmaps don't provide) to avoid bugs that can only be reproduced randomly
    ---@type DataModule[]
    registeredModulesOrdered = {}, -- To have a consistent ordering of modules (which key-value hashmaps don't provide) to avoid bugs that can only be reproduced randomly

    --- Stores the most recent load failure for each detected module.
    ---@type table<string, string>
    loadErrors = {},

    --- Stores modules known to exist to present the player with information on how to download or update them
    ---@type AvailableDataModule[]
    -- AddonName is the folder on disk, which is what EnumerateAddons keys presentModules by, so
    -- these have to be the folder names the packs ship under and not their titles. They were
    -- VoiceOverReduxHQAudio* until the rename, and moved with it: a pack's folder can be renamed
    -- because nothing resolves a path from a baked-in name - DataModules composes it from
    -- METADATA.AddonName at play time - and every pack is re-downloaded on the next release
    -- anyway, which is the only cost a rename has.
    --
    -- The sound pack ships in five pieces, so this is a menu rather than a single answer: a
    -- player picks their side plus the shared quests, or takes them all. Only shown
    -- to somebody who has no pack at all - see EnumerateAddons, where having one silences the
    -- other four, since suggesting the Horde pack to an Alliance player who already installed
    -- theirs is noise.
    availableModules = {
        {
            AddonName = "SpokenQuestsAudioAll",
            Title = "Spoken Quests Audio: All",
            ContentVersion = "2.2.0",
            RelevantAboveVersion = 0,
            URL = "https://www.curseforge.com/wow/addons/spoken-quests-audio-all",
        },
        {
            AddonName = "SpokenQuestsAudioAlliance",
            Title = "Spoken Audio: Quests - Alliance",
            ContentVersion = "2.2.0",
            RelevantAboveVersion = 0,
            URL = "https://www.curseforge.com/wow/addons/spoken-audio-quests-alliance",
        },
        {
            AddonName = "SpokenQuestsAudioHorde",
            Title = "Spoken Audio: Quests - Horde",
            ContentVersion = "2.2.0",
            RelevantAboveVersion = 0,
            URL = "https://www.curseforge.com/wow/addons/spoken-audio-quests-horde",
        },
        {
            AddonName = "SpokenQuestsAudioShared",
            Title = "Spoken Audio: Quests - Shared",
            ContentVersion = "2.2.0",
            RelevantAboveVersion = 0,
            URL = "https://www.curseforge.com/wow/addons/spoken-audio-quests-shared",
        },
        {
            AddonName = "SpokenQuestsAudioGossip",
            Title = "Spoken Audio: Gossip",
            ContentVersion = "2.2.0",
            RelevantAboveVersion = 0,
            URL = "https://www.curseforge.com/wow/addons/spoken-audio-gossip",
        },
    },
}

---@param a DataModule|DataModuleMetadata
---@param b DataModule|DataModuleMetadata
local function SortModules(a, b)
    a = a.METADATA or a
    b = b.METADATA or b
    if a.ModulePriority ~= b.ModulePriority then
        return a.ModulePriority > b.ModulePriority
    end
    return a.AddonName < b.AddonName
end

---@param name string Addon name
---@param module DataModule Module data table
function DataModules:Register(name, module)
    assert(not self.registeredModules[name], format([[Module "%s" already registered]], name))

    local metadata = assert(self.presentModules[name],
        format([[Module "%s" attempted to register but wasn't detected during addon enumeration]], name))
    local moduleVersion = assert(ModuleNumber(name, "Version"),
        format([[Module "%s" is missing data format version]], name))

    -- Ideally if module format would ever change - there should be fallbacks in place to handle outdated formats
    assert(moduleVersion == CURRENT_MODULE_VERSION,
        format([[Module "%s" contains outdated data format (version %d, expected %d)]], name, moduleVersion,
            CURRENT_MODULE_VERSION))

    module.METADATA = metadata

    self.registeredModules[name] = module
    table.insert(self.registeredModulesOrdered, module)

    -- Order the modules by priority (higher first) then by name (case-sensitive alphabetical)
    -- Modules with higher priority will be iterated through first, so one can create a module with "overrides" for data in other modules by simply giving it a higher priority
    table.sort(self.registeredModulesOrdered, SortModules)
end

function DataModules:HasRegisteredModules()
    return next(self.registeredModules) ~= nil
end

function DataModules:GetModule(name)
    return self.registeredModules[name]
end

function DataModules:GetModules()
    return ipairs(self.registeredModulesOrdered)
end

function DataModules:GetPresentModule(name)
    return self.presentModules[name]
end

function DataModules:GetPresentModules()
    return ipairs(self.presentModulesOrdered)
end

function DataModules:GetAvailableModules()
    return ipairs(self.availableModules)
end

-- Short display names for the known sound packs, shown on the download buttons.
-- Keyed by folder name, which is the stable identifier; the titles themselves come
-- from the packs and cannot be translated. Anything unknown falls back to the
-- title with the shared prefix stripped, exactly what the buttons showed before.
local PACK_LABELS = {
    SpokenQuestsAudioAll = "OPT_PACK_ALL",
    SpokenQuestsAudioAlliance = "OPT_PACK_ALLIANCE",
    SpokenQuestsAudioHorde = "OPT_PACK_HORDE",
    SpokenQuestsAudioShared = "OPT_PACK_SHARED",
    SpokenQuestsAudioGossip = "OPT_PACK_GOSSIP",
}

---@param module DataModuleMetadata
function DataModules:GetPackLabel(module)
    local key = module and PACK_LABELS[module.AddonName]
    local label = key and L[key]
    if label then
        return label
    end
    -- Without the colour Spoken's name is drawn in.
    local title = string.gsub(module and module.Title or "", "|c%x%x%x%x%x%x%x%x(.-)|r", "%1")
    -- "Spoken German Audio: Quests - Horde", or a pack built before that, "Spoken Quests Audio: Horde".
    title = string.gsub(title, "^Spoken [^:]*Audio: ", "")
    return (string.gsub(title, "VoiceOver Data %- ", ""))
end

--- The language the player's packs speak to them: the first language in the resolution
--- order that an installed pack is recorded in. With none installed, the chosen language.
---
--- What a report is filed under when there is no clip to ask, and what a contribution says
--- the player was listening to.
---@return string code
function DataModules:GetPackLanguage()
    local order = Language:ResolutionOrder()
    for _, language in ipairs(order) do
        for _, module in self:GetPresentModules() do
            if module.Language == language then
                return language
            end
        end
    end
    return order[1]
end

--- The newest .toc Version among the installed packs recorded in `language`, or "none" when
--- no pack speaks it. What a contribution says the player was hearing with, so the site can
--- tell a line nobody has voiced from one only this player's pack is behind on.
---@param language string
---@return string version
function DataModules:GetPackVersion(language)
    local newest
    for _, module in self:GetPresentModules() do
        local version = module.ContentVersion
        if module.Language == language and version
            and (not newest or self:IsOlderContent(newest, version)) then
            newest = version
        end
    end
    return newest or "none"
end

---@param loadModules? boolean Whether LoadOnDemand data modules should be loaded during enumeration
function DataModules:EnumerateAddons(loadModules)
    assert(GetNumAddOns and GetAddOnMetadata and GetAddOnInfo,
        "No compatible AddOn-management API was found (expected C_AddOns on current clients)")

    for i = 1, GetNumAddOns() do
        local moduleVersion = ModuleNumber(i, "Version")
        if moduleVersion and not SwitchedOff(i) then
            local name = GetAddOnInfo(i)
            local mapsString = ModuleMeta(i, "Maps")
            local maps = {}
            if mapsString then
                for _, mapString in ipairs({ strsplit(",", mapsString) }) do
                    local map = tonumber(mapString)
                    if map then
                        maps[map] = true
                    end
                end
            end
            ---@type DataModuleMetadata
            local module =
            {
                AddonName = name,
                LoadOnDemand = IsAddOnLoadOnDemand(name),
                ModuleVersion = moduleVersion,
                ModulePriority = ModuleNumber(name, "Priority") or 0,
                ContentVersion = GetAddOnMetadata(name, "Version"),
                Title = GetAddOnMetadata(name, "Title") or name,
                Maps = maps,
                Language = Language:Normalize(GetAddOnMetadata(i, LANGUAGE_KEY)),
            }
            self.presentModules[name] = module
            table.insert(self.presentModulesOrdered, module)

            -- Maybe in the future we can load modules based on the map the player is in (select(8, GetInstanceInfo())), but for now - just load everything
            if loadModules ~= false and LOAD_ALL_MODULES and IsAddOnLoadOnDemand(name) then
                DataModules:LoadModule(module)
            end
        end
    end

    table.sort(self.presentModulesOrdered, SortModules)
    for order, module in self:GetPresentModules() do
        Options:AddDataModule(module, order)
    end

    -- A player with no pack at all is offered every one of them and picks; a player who has
    -- one is offered only updates to what they installed. Before the pack was split there was
    -- a single entry and "you do not have it" was the whole question, but now four of the five
    -- are absent from any sensible install, and advertising those is nagging.
    local hasAnyPack = next(self.presentModules) ~= nil

    for order, module in self:GetAvailableModules() do
        local min = module.RelevantAboveVersion
        local max = module.RelevantBelowVersion
        if (not min or Version.Interface >= min) and (not max or Version.Interface < max) then
            local present = self.presentModules[module.AddonName]
            local update = present and DataModules:IsOlderContent(present.ContentVersion, module.ContentVersion)
            if (not present and not hasAnyPack) or update then
                Options:AddAvailableDataModule(module, order, update)
            end
        end
    end
end

--- Whether an installed pack's version is older than the one this addon knows of. Older, not
--- different: the versions above are written into the addon, so a pack released after it --
--- 2.1.0 packs under an addon that still says 2.0.0 -- would otherwise be told to "update" back
--- to the version it replaced. A version that is not dotted numbers is never called out of date.
---@param installed string?
---@param known string?
---@return boolean
function DataModules:IsOlderContent(installed, known)
    local function parts(version)
        if type(version) ~= "string" or not string.find(version, "^%d+[%d.]*$") then return nil end
        local out = {}
        for n in string.gmatch(version, "%d+") do table.insert(out, tonumber(n)) end
        return out
    end
    local a, b = parts(installed), parts(known)
    if not a or not b then return false end
    for i = 1, math.max(table.getn(a), table.getn(b)) do
        local x, y = a[i] or 0, b[i] or 0
        if x ~= y then return x < y end
    end
    return false
end

function DataModules:LoadPresentModules()
    for _, module in self:GetPresentModules() do
        if LOAD_ALL_MODULES and module.LoadOnDemand and not self:GetModule(module.AddonName) then
            self:LoadModule(module)
        end
    end
    return self:HasRegisteredModules()
end

-- We deliberately use a high ##Interface version in TOC to ensure that all clients will load it.
-- Here we temporarily enable "Load out of date AddOns" to load the module, and restore the user's setting afterwards.
-- These cvars can be nil, so have to store the fact of them being changed in a separate variable.
local prev_checkAddonVersion, prev_lastAddonVersion, changed
local function EnableOutOfDate()
    if not changed then
        prev_checkAddonVersion = GetCVar("checkAddonVersion")
        prev_lastAddonVersion = GetCVar("lastAddonVersion")
        SetCVar("checkAddonVersion", 0)
        SetCVar("lastAddonVersion", Version.Interface)
        changed = true
    end
end
local function RestoreOutOfDate()
    if changed then
        SetCVar("checkAddonVersion", prev_checkAddonVersion)
        SetCVar("lastAddonVersion", prev_lastAddonVersion)
        changed = nil
    end
end

---@param module DataModuleMetadata
function DataModules:LoadModule(module)
    if not module.LoadOnDemand then
        self.loadErrors[module.AddonName] = "NOT_LOAD_ON_DEMAND"
        return false, self.loadErrors[module.AddonName]
    end
    if self:GetModule(module.AddonName) then
        self.loadErrors[module.AddonName] = nil
        return true
    end
    if IsAddOnLoaded(module.AddonName) then
        self.loadErrors[module.AddonName] = "LOADED_BUT_NOT_REGISTERED"
        return false, self.loadErrors[module.AddonName]
    end

    EnableOutOfDate()
    local callSucceeded, loaded, reason = pcall(LoadAddOn, module.AddonName)
    RestoreOutOfDate()

    if not callSucceeded then
        reason = tostring(loaded)
        loaded = false
    elseif loaded and not self:GetModule(module.AddonName) then
        loaded = false
        reason = "DID_NOT_REGISTER"
    end

    if loaded then
        self.loadErrors[module.AddonName] = nil
    else
        self.loadErrors[module.AddonName] = reason or "UNKNOWN"
    end
    return loaded, reason
end

function DataModules:GetModuleLoadError(name)
    return self.loadErrors[name]
end

function DataModules:GetModuleAddOnInfo(module)
    EnableOutOfDate()
    local name, title, notes, loadable, reason = GetAddOnInfo(module.AddonName)
    RestoreOutOfDate()
    return name, title, notes, loadable, reason
end

local function replaceDoubleQuotes(text)
    return string.gsub(text, '"', "'")
end

--- One of a module's text-keyed tables, and the client locale its keys are written in.
---
--- A pack can carry a copy for the client's own locale (ClientLocaleLookups, which the pack
--- loads only on a client in that locale), and that copy is preferred. Otherwise the plain
--- table is in LookupLocale, which a pack sets when its tables are not in its own language --
--- this project builds them from the English corpus whatever the audio is -- or else in the
--- pack's own language: a pack somebody built from their own client holds the text that
--- client showed.
---@param module DataModule
---@param name string
---@return table|nil data
---@return string locale
local function TextLookup(module, name)
    local localized = module.ClientLocaleLookups and module.ClientLocaleLookups[name]
    if localized then
        return localized, Language:GetClientLanguage()
    end
    return module[name], module.LookupLocale or module.METADATA.Language
end

--- A table of `prefix`ByNPCID or `prefix`ByObjectID for the giver a GUID names, and its id.
---@param prefix string
---@param unitGUID string
---@return string|nil table
---@return number|nil id
local function GiverLookupKey(prefix, unitGUID)
    local type = Utils:GetGUIDType(unitGUID)
    if Enums.GUID:IsCreature(type) then
        return prefix .. "ByNPCID", Utils:GetIDFromGUID(unitGUID)
    elseif type == Enums.GUID.GameObject then
        return prefix .. "ByObjectID", Utils:GetIDFromGUID(unitGUID)
    end
end

--- The gossip table a speaker is filed under, and its key there.
---@param soundData { unitGUID: string?, name: string?, unitIsObjectOrItem: boolean? }
---@return string|nil table
---@return any npc
local function GossipLookupKey(soundData)
    if soundData.unitGUID then
        return GiverLookupKey("GossipLookup", soundData.unitGUID)
    end
    return soundData.unitIsObjectOrItem and "GossipLookupByObjectName" or "GossipLookupByNPCName",
        soundData.name and (replaceDoubleQuotes(soundData.name))
end

--- Whether a pack holds the audio of any of this speaker's gossip lines, whatever the text on
--- screen. Asked the moment a gossip dialog opens, before its text can be trusted, to decide
--- whether to silence the NPC's greeting for a line that is coming. The addon's own text names
--- every NPC's lines, so it counts only where a pack has the file.
---@param soundData { unitGUID: string?, name: string?, unitIsObjectOrItem: boolean? }
---@return boolean
function DataModules:HasGossipFor(soundData)
    local table, npc = GossipLookupKey(soundData)
    if not table or npc == nil then
        return false
    end
    local probe = { event = Enums.SoundEvent.Gossip, unitGUID = soundData.unitGUID, name = soundData.name,
        unitIsObjectOrItem = soundData.unitIsObjectOrItem }
    local function Voiced(lines)
        for text in pairs(lines or {}) do
            probe.text = text
            if self:PrepareSound(probe) then
                return true
            end
        end
        return false
    end
    if Voiced(GossipText and GossipText[table] and GossipText[table][npc]) then
        return true
    end
    for _, module in self:GetModules() do
        local data = TextLookup(module, table)
        if Voiced(data and data[npc]) then
            return true
        end
    end
    return false
end

-- Measured on the corpus: a rewording of the same line scores 0.8 or more, while an NPC's
-- other variants (another profession's or faction's) mostly score under 0.6.
local GOSSIP_MATCH_FLOOR = 0.7

-- Lua 5.0 safe from here to Words, as this file loads on 1.12: no `#`, no hex numbers,
-- string.byte one byte at a time, gfind there.

--- The code point of a three-byte UTF-8 character, else nil.
local function CodePoint3(char)
    local a = string.byte(char, 1)
    if string.len(char) == 3 and a >= 224 and a <= 239 then
        return (a - 224) * 4096 + (string.byte(char, 2) - 128) * 64 + (string.byte(char, 3) - 128)
    end
end

--- Chinese writes no spaces, so a sentence would be one word that only an exact key equals.
--- Each pair of neighbouring characters is compared as a word instead. Korean words carry their
--- particles, and pairs of syllables match a reworded line more often than whole words do.
--- Kana U+3040-30FF, Han U+3400-4DBF, U+4E00-9FFF and U+F900-FAFF, Hangul U+AC00-D7A3.
local function IsPaired(cp)
    return cp and ((cp >= 12352 and cp <= 12543) or (cp >= 13312 and cp <= 19903)
        or (cp >= 19968 and cp <= 40959) or (cp >= 63744 and cp <= 64255)
        or (cp >= 44032 and cp <= 55203))
end

--- Punctuation that separates words in that text: general U+2000-206F, CJK U+3000-303F, and
--- the full-width forms that are not letters or digits.
local function IsWidePunctuation(cp)
    return cp and ((cp >= 8192 and cp <= 8303) or (cp >= 12288 and cp <= 12351)
        or (cp >= 65281 and cp <= 65295) or (cp >= 65306 and cp <= 65312)
        or (cp >= 65339 and cp <= 65344) or (cp >= 65371 and cp <= 65381))
end

local function CharacterPairs(text)
    local words, word, run = {}, "", {}
    local function EndWord()
        if word ~= "" then
            table.insert(words, word)
            word = ""
        end
    end
    local function EndRun()
        local n = table.getn(run)
        if n == 1 then
            table.insert(words, run[1])
        end
        for i = 2, n do
            table.insert(words, run[i - 1] .. run[i])
        end
        run = {}
    end
    local gmatch = string.gmatch or string.gfind
    for char in gmatch(text, "[%z\1-\127\194-\244][\128-\191]*") do
        local cp = CodePoint3(char)
        if IsPaired(cp) then
            EndWord()
            table.insert(run, char)
        else
            EndRun()
            if char == " " or char == "\t" or char == "\n" or char == "\r" or IsWidePunctuation(cp) then
                EndWord()
            else
                word = word .. char
            end
        end
    end
    EndWord()
    EndRun()
    return table.concat(words, " ")
end

--- A line's words as they are compared: lower case, ASCII punctuation as spaces. French text
--- shows a typographic apostrophe and no-break spaces where the keys may have the plain ones.
--- Other bytes past ASCII are kept, so another alphabet's words compare whole. ASCII text comes
--- out as it always has.
local function Words(text)
    text = string.lower(text)
    text = string.gsub(text, "\226\128\153", "'")
    text = string.gsub(text, "\194\160", " ")
    text = string.gsub(text, "\226\128\175", " ")
    text = string.gsub(text, "%p", " ")
    if string.find(text, "[\227-\239]") then
        return CharacterPairs(text)
    end
    return text
end

--- The keys still hold the server's tokens ($N, $g...), so each is filled in for this player
--- before it is compared.
local function ClosestGossipLine(shown, lines)
    local best = FuzzySearchBestKeys(Words(shown), lines, function(text)
        return Words(Utils:FillPlayerTokens(text))
    end)
    return best and best.similarity >= GOSSIP_MATCH_FLOOR and best or nil
end

--- Every text a table of text as a client shows it holds under `key`, mapped to its file, into
--- `into`: the tables written in the client's own locale when `inClientLocale`, the rest
--- otherwise. That locale is not the language the player chose to hear: an English client
--- playing a Portuguese pack still shows English text. The file is the line's, not the
--- recording's, so whichever table found it, PrepareSound looks for the clip in the voice
--- language.
---
--- GossipText (Gossip/<locale>.lua, built only on a client in that locale) is this addon's own
--- copy of every line's text in the client's locale, so it is asked before any pack's.
local function CollectTexts(table, key, inClientLocale, into)
    local client = Language:GetClientLanguage()
    local own = inClientLocale and GossipText and GossipText[table]
    if own and own[key] then
        for text, file in pairs(own[key]) do
            into[text] = file
        end
    end
    for _, module in DataModules:GetModules() do
        local data, locale = TextLookup(module, table)
        if data and (locale == client) == inClientLocale and data[key] then
            for text, file in pairs(data[key]) do
                into[text] = into[text] or file -- module priority: the first pack's entry stands
            end
        end
    end
    return into
end

--- The file of the text on screen among `entries`: its exact key, else the closest above the floor.
local function MatchShown(text, entries)
    if entries[text] then
        return entries[text]
    end
    local best = ClosestGossipLine(text, entries)
    return best and best.value or nil
end

---@param soundData SoundData
---@return string|nil hash
function DataModules:GetNPCGossipTextHash(soundData)
    local table, npc = GossipLookupKey(soundData)
    if not table then
        return
    end
    local text = soundData.text
    -- An NPC whose text varies by who asks may lack the variant on screen. Playing nothing then
    -- lets the window offer Contribute. HasGossipFor asks with each key itself, so an exact key
    -- skips scoring every line again.
    local text_entries = CollectTexts(table, npc, true, {})
    if next(text_entries) ~= nil then
        return MatchShown(text, text_entries)
    end
    -- Only when no pack in the client's locale knows this NPC are the rest searched. Their words
    -- cannot match the screen's, so an NPC with a single line (its aliases count as that line)
    -- plays it whatever it is shown in. Among several, the best score is noise and would pick
    -- any of them: one must clear the floor, which another language's words do not, and the
    -- window offers Contribute instead.
    CollectTexts(table, npc, false, text_entries)
    local file, same
    for _, each in pairs(text_entries) do
        if not file then
            file, same = each, { [each] = true }
            for _, alias in ipairs(GossipAliases and GossipAliases[each] or {}) do
                same[alias] = true
            end
        elseif not same[each] then
            return MatchShown(text, text_entries)
        end
    end
    return file
end

--- A line's words with the spacing gone, so two texts that sound the same compare equal.
local function Said(text)
    return (string.gsub(string.gsub(Words(text), "%s+", " "), "^ ?(.-) ?$", "%1"))
end

local QUEST_MOMENTS = {
    [Enums.SoundEvent.QuestAccept] = "accept",
    [Enums.SoundEvent.QuestProgress] = "progress",
    [Enums.SoundEvent.QuestComplete] = "complete",
}

--- Whether the text on screen is word for word one this speaker's lines are made from, with its
--- tokens filled in for this player. False where the speaker has lines in the client's language
--- and none says this: Blizzard changed the words, or the corpus line was taken from a client
--- that wrote a player's name into it. Nil where there is nothing in the client's language to
--- compare with. A quest moment of one wording is compared with the Compendium's text
--- (SpokenQuestsText), which is English and holds accept and complete only.
---@param soundData SoundData its event, text and speaker, with questID for a quest line
---@return boolean|nil
function DataModules:IsTextKnown(soundData)
    local shown = soundData.text
    if type(shown) ~= "string" or shown == "" then
        return nil
    end
    local texts = {}
    if Enums.SoundEvent:IsQuestEvent(soundData.event) then
        local moment = QUEST_MOMENTS[soundData.event]
        CollectTexts("QuestWordingLookup", format("%d-%s", soundData.questID or 0, moment), true, texts)
        if next(texts) == nil and Language:GetClientLanguage() == "enUS" then
            local quest = SpokenQuestsText and SpokenQuestsText[soundData.questID]
            if quest and type(quest[moment]) == "string" then
                texts[quest[moment]] = true
            end
        end
    else
        local lookup, npc = GossipLookupKey(soundData)
        if not lookup or npc == nil then
            return nil
        end
        CollectTexts(lookup, npc, true, texts)
    end
    if next(texts) == nil then
        return nil
    elseif texts[shown] then
        return true
    end
    shown = Said(shown)
    for text in pairs(texts) do
        if Said(Utils:FillPlayerTokens(text)) == shown then
            return true
        end
    end
    return false
end

local function getFirstNWords(text, n)
    local firstNWords = {}
    local count = 0

    for word in string.gmatch(text, "%S+") do
        count = count + 1
        table.insert(firstNWords, word)
        if count >= n then
            break
        end
    end

    return table.concat(firstNWords, " ")
end

local function getLastNWords(text, n)
    local lastNWords = {}
    local count = 0

    for word in string.gmatch(text, "%S+") do
        table.insert(lastNWords, word)
        count = count + 1
    end

    local startIndex = math.max(1, count - n + 1)
    local endIndex = count

    return table.concat(lastNWords, " ", startIndex, endIndex)
end

---@alias QuestIDLookupSource "accept"|"progress"|"complete"

---@param source QuestIDLookupSource
---@param title string
---@param npcName string
---@param text string
---@return number questID
function DataModules:GetQuestID(source, title, npcName, text)
    local cleanedTitle = replaceDoubleQuotes(title)
    local cleanedNPCName = replaceDoubleQuotes(npcName)
    local cleanedText = replaceDoubleQuotes(getFirstNWords(text, 15)) ..
        " " .. replaceDoubleQuotes(getLastNWords(text, 15))
    local text_entries = {}

    for _, module in self:GetModules() do
        local data = module.QuestIDLookup
        if data then
            local titleLookup = data[source][cleanedTitle]
            if titleLookup then
                if type(titleLookup) == "number" then
                    return titleLookup
                else
                    -- else titleLookup is a table and we need to search it further
                    local npcLookup = titleLookup[cleanedNPCName]
                    if npcLookup then
                        if type(npcLookup) == "number" then
                            return npcLookup
                        else
                            for text, ID in pairs(npcLookup) do
                                text_entries[text] = text_entries[text] or
                                    ID -- Respect module priority, don't overwrite the entry if there is already one
                            end
                        end
                    end
                end
            end
        end
    end

    local best_result = FuzzySearchBestKeys(cleanedText, text_entries)
    return best_result and best_result.value
end

---@param questID number
---@return GUID|nil type `Enums.GUID` type of the quest giver
---@return number|nil id ID of the quest giver
function DataModules:GetQuestLogQuestGiverTypeAndID(questID)
    for _, module in self:GetModules() do
        local data = module.NPCIDLookupByQuestID
        if data then
            local npcID = data[questID]
            if npcID then
                return Enums.GUID.Creature, npcID
            end
        end

        data = module.ObjectIDLookupByQuestID
        if data then
            local objectID = data[questID]
            if objectID then
                return Enums.GUID.GameObject, objectID
            end
        end

        data = module.ItemIDLookupByQuestID
        if data then
            local itemID = data[questID]
            if itemID then
                return Enums.GUID.Item, itemID
            end
        end
    end
end

---@param type GUID `Enums.GUID` type of the desired object
---@param id number ID of the desired object
---@return string|nil name
function DataModules:GetObjectName(type, id)
    local table, kind
    if Enums.GUID:IsCreature(type) then
        table, kind = "NPCNameLookupByNPCID", "creature"
    elseif type == Enums.GUID.GameObject then
        table, kind = "ObjectNameLookupByObjectID", "gameobject"
    elseif type == Enums.GUID.Item then
        table, kind = "ItemNameLookupByItemID", "item"
    else
        return
    end

    -- The packs' names are the English corpus's. Locale/Names holds the client's own, so a
    -- quest-log line names its giver as the dialog did. It holds quest givers only - the ids
    -- the packs' questlog tables can return - and a giver missing there is one whose name the
    -- language does not translate.
    local localized = GiverNames and GiverNames[kind] and GiverNames[kind][id]
    if localized then
        return localized
    end

    for _, module in self:GetModules() do
        local data = module[table]
        if data then
            local npcName = data[id]
            if npcName then
                return npcName
            end
        end
    end
end

--- A quest moment's file: `{questID}-{event}`, or, where the moment has more than one wording
--- in the client's language, the wording the screen shows, matched as gossip is and none below
--- the floor. Text in another language cannot be compared to the screen, so a client with no
--- wordings in its own plays the moment's file, as it always has.
local function QuestFile(soundData, event)
    local stem = format("%d-%s", soundData.questID, event)
    -- An empty text is what a quest reader answers when it has none to give.
    local text = soundData.text ~= "" and soundData.text or nil
    local wordings = text and CollectTexts("QuestWordingLookup", stem, true, {})
    if not wordings or next(wordings) == nil then
        return stem
    end
    return MatchShown(text, wordings)
end

---@type table<SoundEvent, fun(soundData: SoundData): string|nil>
local getFileNameForEvent =
{
    [Enums.SoundEvent.QuestAccept]   = function(soundData) return QuestFile(soundData, "accept") end,
    [Enums.SoundEvent.QuestProgress] = function(soundData) return QuestFile(soundData, "progress") end,
    [Enums.SoundEvent.QuestComplete] = function(soundData) return QuestFile(soundData, "complete") end,
    [Enums.SoundEvent.QuestGreeting] = function(soundData) return DataModules:GetNPCGossipTextHash(soundData) end,
    [Enums.SoundEvent.Gossip]        = function(soundData) return DataModules:GetNPCGossipTextHash(soundData) end,
}
setmetatable(getFileNameForEvent,
    {
        __index = function(self, event)
            error(format([[Unhandled Spoken Quests sound event %d "%s"]], event,
                Enums.SoundEvent:GetName(event) or "???"))
        end
    })

--- The file a quest line is in, in the voice of the NPC or object giving it, where that is
--- not the line's own: one quest given by NPCs of different voices is a file per voice.
---@param soundData SoundData Its fileName the quest line's own, as getFileNameForEvent names it
---@return string|nil
function DataModules:GetQuestFileForGiver(soundData)
    if not Enums.SoundEvent:IsQuestEvent(soundData.event) or not soundData.unitGUID then
        return
    end
    local name, id = GiverLookupKey("QuestFileLookup", soundData.unitGUID)
    if not name then
        return
    end
    for _, module in self:GetModules() do
        local byGiver = module[name] and module[name][soundData.fileName]
        if byGiver and byGiver[id] then
            return byGiver[id]
        end
    end
end

--- The first installed pack's `tableName[key]`, or nil where none has it.
---@param tableName string
---@param key any
---@return any
local function FirstIn(tableName, key)
    for _, module in DataModules:GetModules() do
        local value = module[tableName] and module[tableName][key]
        if value then
            return value
        end
    end
end

--- The creature a GUID names, its id, the sex it is drawn as and its body where its model is in.
---@param soundData SoundData
---@return number|nil id
---@return number|nil sex
---@return string|nil body
local function CreatureBody(soundData)
    local id = Utils:GetCreatureIDFromGUID(soundData.unitGUID)
    if not id then
        return
    end
    soundData.npcSex = soundData.npcSex or Utils:GetSexForGUID(soundData.unitGUID)
    soundData.npcBody = soundData.npcBody or Utils:GetBodyForGUID(soundData.unitGUID)
    return id, soundData.npcSex, soundData.npcBody
end

--- A line's file in the `...ByNPCBody` or `...ByNPCSex` tables (`kind`), for creature `id` drawn
--- as `key`: quest tables are `[line][id][key]`, gossip tables `[id][key][line]`.
---@param kind "Body"|"Sex"
---@param id number
---@param key string|number
---@param line string
---@param quest boolean
---@return string|nil
local function FileFor(kind, id, key, line, quest)
    for _, module in DataModules:GetModules() do
        local file
        if quest then
            local byGiver = module["QuestFileLookupByNPC" .. kind]
            byGiver = byGiver and byGiver[line]
            file = byGiver and byGiver[id] and byGiver[id][key]
        else
            local byKey = module["GossipFileLookupByNPC" .. kind]
            byKey = byKey and byKey[id]
            file = byKey and byKey[key] and byKey[key][line]
        end
        if file then
            return file
        end
    end
end

--- The file a line is in for the body its NPC is drawn as, for an NPC split by body: the body's
--- where its model is in, else its sex's, which each pack names for addons that cannot see a body.
---@param soundData SoundData
---@param line string The line's own file
---@return string|nil
function DataModules:GetFileForBody(soundData, line)
    local id, sex, body = CreatureBody(soundData)
    if not id then
        return
    end
    local quest = Enums.SoundEvent:IsQuestEvent(soundData.event)
    return body and FileFor("Body", id, body, line, quest)
        or sex and FileFor("Sex", id, sex, line, quest)
        or nil
end

--- Whether a creature is drawn as a body its voice is not. Its line still plays, and the site has
--- to hear about it to give that body a voice. Where the model is not in, or no pack lists the
--- creature's bodies (a pack built before them), only the sex is compared.
---@param soundData SoundData
---@return boolean
function DataModules:IsOtherBody(soundData)
    local id, sex, body = CreatureBody(soundData)
    if not id or (sex ~= 2 and sex ~= 3) then
        return false
    end
    local bodies = body and FirstIn("NPCBodiesByNPCID", id)
    if bodies then
        return not bodies[body]
    end
    if FirstIn("GossipFileLookupByNPCSex", id) then
        return false
    end
    local voiced = FirstIn("NPCSexByNPCID", id)
    return voiced ~= nil and voiced ~= sex
end

--- Whether a creature is split by body in any installed pack: the ones worth loading a model for
--- before their dialog opens.
---@param id number
---@return boolean
function DataModules:IsSplit(id)
    return (FirstIn("GossipFileLookupByNPCBody", id) or FirstIn("GossipFileLookupByNPCSex", id)) ~= nil
end

--- Whether any installed pack lists a creature's bodies, so that its model is worth reading.
---@param id number
---@return boolean
function DataModules:HasBodies(id)
    return FirstIn("NPCBodiesByNPCID", id) ~= nil
end

--- A greeting's table names its speaker's own voice's file, `{hash}-{voice}`: the line's own
--- file is the hash, tried in each language before the next.
---@param fileName string
---@return string|nil
local function GreetingOfVoice(fileName)
    local _, _, hash = string.find(fileName, "^(" .. string.rep("%x", 32) .. ")%-")
    return hash
end

---@param soundData SoundData
---@return boolean found Whether the sound is found and can be played
--- Whether a pack has the line, filling in its file, length and pack if so. When not, the second
--- value says why, for the debug log.
function DataModules:PrepareSound(soundData)
    -- Spoken > Developer: a quest line answered as one no pack has, before any pack is asked,
    -- so everything that asks here -- autoplay, the Play buttons, the Contribute button --
    -- sees the voice-over missing, as it would be.
    if Debug.IsMockingMissingVoice and Debug:IsMockingMissingVoice()
        and Enums.SoundEvent:IsQuestEvent(soundData.event) then
        return false, "Mock Missing Voice Over is on (Spoken > Developer)"
    end

    soundData.fileName = getFileNameForEvent[soundData.event](soundData)

    if soundData.fileName == nil then
        return false, "no file name for it (no quest ID, or a text no pack's wording or greeting matches)"
    end

    -- A quest given by NPCs of different voices is a file per voice: this giver's own first,
    -- then the line's, in each language before the next, so a voice no pack in the player's
    -- language has yet plays the line in that language rather than the voice in another.
    local line = soundData.fileName
    local own = self:GetFileForBody(soundData, line) or self:GetQuestFileForGiver(soundData)
    soundData.fileName = own or line
    if self:ResolveSoundFile(soundData, own and line or GreetingOfVoice(line)) then
        return true
    end
    soundData.fileName = line

    -- No pack holds the line - but an easter egg for it ships with the player itself.
    if EasterEggs:Apply(soundData) then
        return true
    end
    return false, format("no pack loaded has %s", tostring(soundData.fileName))
end

--- Find the pack holding `soundData.fileName` and fill in the path, length and language.
--- Split from PrepareSound for a caller that already knows the file it wants rather than
--- the line - Followup.lua, whose packs name a follow-up line's file in FollowupLookup.
--- `instead`, where given, is the file to try in each language when that one is missing there.
---@param soundData SoundData
---@param instead string|nil
---@return boolean found
function DataModules:ResolveSoundFile(soundData, instead)
    -- Language before priority. A pack that holds the line in the language the player
    -- asked for answers it even if a higher-priority pack holds the same line in another
    -- language; only when no pack in the selected language has it does the fallback
    -- language get a turn, and the packs within each language keep their own priority
    -- order. With only English packs installed -- every install that exists today -- the
    -- English pass is the only one that finds anything, so the result is what it always was.
    --
    -- Gossip falls back like any other line. Its file is named for a hash of the English
    -- text in every language a pack is built in, so the fallback pack holds the same name.
    --
    -- A gossip line may be one moment with lines recorded under other names (GossipAliases:
    -- the same BroadcastText id and voice, minted before anything tied them). Those are asked
    -- after the line's own name, within each language, so a take in the chosen language under
    -- a sibling's name beats the fallback language under the line's own.
    local languages = Language:ResolutionOrder()

    local candidates = {}
    for _, name in ipairs({ soundData.fileName, instead }) do
        table.insert(candidates, name)
        local aliases = GossipAliases and GossipAliases[name]
        if aliases then
            for _, alias in ipairs(aliases) do
                table.insert(candidates, alias)
            end
        end
    end
    for _, language in ipairs(languages) do
        for _, wantedFileName in ipairs(candidates) do
            local playerGenderedFileName = DataModules:AddPlayerGenderToFilename(wantedFileName)
            for _, module in self:GetModules() do
                local data = module.SoundLengthLookupByFileName
                if data and module.METADATA.Language == language then
                    local fileName = wantedFileName
                    local length = data[playerGenderedFileName]
                    if length then
                        fileName = playerGenderedFileName
                    else
                        length = data[wantedFileName]
                    end
                    if length then
                        soundData.fileName = fileName
                        soundData.filePath = format([[Interface\AddOns\%s\%s]], module.METADATA.AddonName,
                            module.GetSoundPath and module:GetSoundPath(fileName, soundData.event) or
                            fileName)
                        soundData.length = length
                        -- Timed to the recording's words, which the window shows only in the
                        -- client's own language.
                        soundData.timings = language == Language:GetClientLanguage()
                            and module.WordTimesByFileName and module.WordTimesByFileName[fileName] or nil
                        soundData.module = module
                        soundData.language = language
                        EasterEggs:Apply(soundData)
                        return true
                    end
                end
            end
        end
    end
    return false
end

function DataModules:AddPlayerGenderToFilename(fileName)
    local playerGender = UnitSex("player")

    if playerGender == 2 then     -- male
        return "m-" .. fileName
    elseif playerGender == 3 then -- female
        return "f-" .. fileName
    else                          -- unknown or error
        return fileName
    end
end
