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
---@field QuestFileLookupByNPCID? table<string, table<number, string>> Maps a quest line's filename and its giver's Creature ID to the line in that giver's own voice, where it differs
---@field QuestFileLookupByObjectID? table<string, table<number, string>> Maps a quest line's filename and its giver's GameObject ID to the line in that giver's own voice, where it differs

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
    -- player picks their side plus the shared quests, or takes the complete pack. Only shown
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
            Title = "Spoken Quests Audio: Alliance",
            ContentVersion = "2.2.0",
            RelevantAboveVersion = 0,
            URL = "https://www.curseforge.com/wow/addons/spoken-quests-audio-alliance",
        },
        {
            AddonName = "SpokenQuestsAudioHorde",
            Title = "Spoken Quests Audio: Horde",
            ContentVersion = "2.2.0",
            RelevantAboveVersion = 0,
            URL = "https://www.curseforge.com/wow/addons/spoken-quests-audio-horde",
        },
        {
            AddonName = "SpokenQuestsAudioShared",
            Title = "Spoken Quests Audio: Shared Quests",
            ContentVersion = "2.2.0",
            RelevantAboveVersion = 0,
            URL = "https://www.curseforge.com/wow/addons/spoken-quests-audio-shared",
        },
        {
            AddonName = "SpokenQuestsAudioGossip",
            Title = "Spoken Quests Audio: Gossip",
            ContentVersion = "2.2.0",
            RelevantAboveVersion = 0,
            URL = "https://www.curseforge.com/wow/addons/spoken-quests-audio-gossip",
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
    local title = module and module.Title or ""
    title = string.gsub(title, "Spoken Quests Audio: ", "")
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
    -- Lua 5.0 safe, as this file loads on 1.12: no `#`, no string methods, gfind there.
    local gmatch = string.gmatch or string.gfind
    local function parts(version)
        if type(version) ~= "string" or not string.find(version, "^%d+[%d.]*$") then return nil end
        local out = {}
        for n in gmatch(version, "%d+") do table.insert(out, tonumber(n)) end
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
-- Otherwise pre-classic-rerelease clients will refuse to load addons with version < 20000.
-- Here we temporarily enable "Load out of date AddOns" to load the module, and restore the user's setting afterwards.
-- These cvars can be nil, so have to store the fact of them being changed in a separate variable.
local prev_checkAddonVersion, changed_checkAddonVersion
local prev_lastAddonVersion, changed_lastAddonVersion -- Added in 5.x
local function EnableOutOfDate(addon)
    if not changed_checkAddonVersion then
        prev_checkAddonVersion = GetCVar("checkAddonVersion")
        SetCVar("checkAddonVersion", 0)
        changed_checkAddonVersion = true
    end
    if not changed_lastAddonVersion and Version:IsRetailOrAboveLegacyVersion(50000) then
        prev_lastAddonVersion = GetCVar("lastAddonVersion")
        SetCVar("lastAddonVersion", Version.Interface)
        changed_lastAddonVersion = true
    end
end
local function RestoreOutOfDate(addon)
    if changed_checkAddonVersion then
        SetCVar("checkAddonVersion", prev_checkAddonVersion)
        changed_checkAddonVersion = nil
    end
    if changed_lastAddonVersion and Version:IsRetailOrAboveLegacyVersion(50000) then
        SetCVar("lastAddonVersion", prev_lastAddonVersion)
        changed_lastAddonVersion = nil
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

    EnableOutOfDate(module.AddonName)
    local callSucceeded, loaded, reason = pcall(LoadAddOn, module.AddonName)
    RestoreOutOfDate(module.AddonName)

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
    EnableOutOfDate(module.AddonName)
    local name, title, notes, loadable, reason = GetAddOnInfo(module.AddonName)
    RestoreOutOfDate(module.AddonName)
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

--- Whether any pack holds gossip for this speaker, whatever the text. Asked the moment a
--- gossip dialog opens, before its text can be trusted, to decide whether to silence the
--- NPC's greeting for a line that is coming.
---@param soundData { unitGUID: string?, name: string?, unitIsObjectOrItem: boolean? }
---@return boolean
function DataModules:HasGossipFor(soundData)
    local table, npc = GossipLookupKey(soundData)
    if not table or npc == nil then
        return false
    end
    if GossipText and GossipText[table] and GossipText[table][npc] then
        return true
    end
    for _, module in self:GetModules() do
        local data = TextLookup(module, table)
        if data and data[npc] then
            return true
        end
    end
    return false
end

---@param soundData SoundData
---@return string|nil hash
function DataModules:GetNPCGossipTextHash(soundData)
    local table, npc = GossipLookupKey(soundData)
    if not table then
        return
    end
    local text = soundData.text

    local text_entries = {}

    -- A gossip table maps the NPC's text *as a client shows it* to the line's hash, so the
    -- tables that can match exactly are the ones written in the client's own locale --
    -- which is not the language the player chose to hear: an English client playing a
    -- Portuguese pack still shows English text. The hash is the line's, not the recording's,
    -- so whichever table found it, PrepareSound looks for the clip in the voice language.
    --
    -- Only when no pack in the client's locale knows this NPC are the rest searched. That is
    -- what every non-English client has always done with English packs, and it mostly works:
    -- most NPCs have a single line, and the fuzzy match lands on it whatever it is shown in.
    --
    -- GossipText (Gossip/<locale>.lua, built only on a client in that locale) is this addon's
    -- own copy of every line's text in the client's locale, so it is asked before any pack's.
    local client = Language:GetClientLanguage()
    local function collect(inClientLocale)
        local own = inClientLocale and GossipText and GossipText[table]
        if own and own[npc] then
            for text, hash in pairs(own[npc]) do
                text_entries[text] = hash
            end
        end
        for _, module in self:GetModules() do
            local data, locale = TextLookup(module, table)
            if data and (locale == client) == inClientLocale then
                local npc_gossip_table = data[npc]
                if npc_gossip_table then
                    for text, hash in pairs(npc_gossip_table) do
                        text_entries[text] = text_entries[text] or
                            hash -- Respect module priority, don't overwrite the entry if there is already one
                    end
                end
            end
        end
    end
    collect(true)
    if next(text_entries) == nil then
        collect(false)
    end

    local best_result = FuzzySearchBestKeys(text, text_entries)
    return best_result and best_result.value
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

---@type table<SoundEvent, fun(soundData: SoundData): string|nil>
local getFileNameForEvent =
{
    [Enums.SoundEvent.QuestAccept]   = function(soundData) return format("%d-%s", soundData.questID, "accept") end,
    [Enums.SoundEvent.QuestProgress] = function(soundData) return format("%d-%s", soundData.questID, "progress") end,
    [Enums.SoundEvent.QuestComplete] = function(soundData) return format("%d-%s", soundData.questID, "complete") end,
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
        return false, "no file name for it (no quest ID, or a greeting no pack's text matches)"
    end

    -- A quest given by NPCs of different voices is a file per voice: this giver's own first,
    -- then the line's, in each language before the next, so a voice no pack in the player's
    -- language has yet plays the line in that language rather than the voice in another.
    local own = self:GetQuestFileForGiver(soundData)
    local line = soundData.fileName
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
