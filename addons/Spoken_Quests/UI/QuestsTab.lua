-- The quests in Azeroth's Compendium, Spoken's window: every quest
-- this character's race and class may take. A quest is found once this character has started it:
-- completed, or in its quest log, which is marked in progress on its row and its page. Until then
-- it is greyed and does not open, unless Unlock Unstarted Quests is on.
--
-- The list is the Compendium's banners and lines. Banners are for continents and types:
-- one for each continent, Other Lands for the zones on no continent, Battlegrounds, then the
-- sections Classes, Professions, Holidays and Events and Other. Everything else is a line of the
-- list with what it holds under it: a place, a class, profession, holiday or other kind of quest
-- and Place Unknown in a section's banner, a zone's Dungeons and Raids where it has several (a line for each dungeon under it; a zone with
-- one has that dungeon's line), and a chain, the quests that follow one another (`prev` in the
-- data), with the same name in every zone it crosses. The rest are the leaves, a row each.
-- Every line and banner counts its quests completed out of all and those in progress; Voiced Only
-- leaves the quests no voice pack has out of the counts as it does out of the list.
--
-- The page shows what is chosen. A quest's is its title, where it is and its words, its offer and
-- its hand-in each under the face and name of who says it, with Play where a voice pack has it,
-- or L.QUEST_NOT_FOUND where it does not open. Its hand-in waits until
-- it is completed, unless Unlock Unstarted Quests is on. A banner's or line's is its name,
-- what holds it and its count on one line, and an empty page with its mark, the quests being on the left to
-- choose. A place is "In" its holder; a section, a class, profession or event and Place Unknown
-- are no place and are named as they are. The sections have nothing above them: their line is the
-- count.
--
-- A search lists what matches under what holds it. Where it matches the name of a banner, a line
-- or a chain, everything inside that one is listed.
--
-- On a client in another language, the words and title each quest's window showed are kept for
-- the whole account and shown over the English.
--
-- Not under setfenv(1, VoiceOver): the frames are built here, and the client's mixins are looked
-- up in the calling function's environment.

local _, ns = ...
local VO = VoiceOver

local QuestsTab = {}
VO.QuestsTab = QuestsTab

local L = VO.L
local C
local VERSION = _G.SpokenEnv and _G.SpokenEnv.Version
-- The shared Compendium data contains Forever's added quests, whose IDs start above the vanilla
-- quest range. The other clients have no quest data for those, even when Forever files one under
-- one of their zones.
local QUEST_LIMIT = 10000

local list, page
local selection          -- { quest = id } | { mapID = id } | { sort = id } | { group = "elsewhere" }
                         -- | { chain = key, ids = { id... }, first = id, where = key } | nil
local landed             -- the selection made for the player, where they stood; any other they chose
local openZones = {}     -- [mapID] = true: a zone's or city's line, opened
local continentOpen = { [1414] = true, [1415] = true }
local groupOpen = {}
local sectionOpen = {}

-- The quests filed under no zone, apart from Azeroth's: by what their QuestSort is. Any other sort
-- goes under Other, with the quests that have no place at all.
local SECTIONS = {
    { key = "classes", label = "QUESTS_SECTION_CLASSES",
        sorts = { [61] = true, [81] = true, [82] = true, [141] = true, [161] = true, [162] = true, [261] = true,
            [262] = true, [263] = true } },
    -- Camping (666) with them: nearly all its quests are Camping 101 for one profession or another.
    { key = "professions", label = "QUESTS_SECTION_PROFESSIONS",
        sorts = { [24] = true, [101] = true, [121] = true, [181] = true, [182] = true, [201] = true, [264] = true,
            [304] = true, [324] = true, [666] = true } },
    { key = "events", label = "QUESTS_SECTION_EVENTS",
        sorts = { [22] = true, [284] = true, [364] = true, [365] = true, [366] = true, [368] = true, [369] = true,
            winterveil = true, hallowsend = true, loveisintheair = true, harvestfestival = true } },
    { key = "other", label = "QUESTS_SECTION_OTHER" },
}

-- The tab's own names: for the groups the client has no QuestSort for (a word in the data), and
-- for three whose client name says too little. Special (284) holds Children's Week alone,
-- Reputation (367) the Commendation Signets' hand-ins, and Invasion (368) is the Scourge's, as the
-- German and Chinese clients name it.
local GROUP_NAMES = {
    [284] = "QUESTS_GROUP_CHILDRENS_WEEK", [367] = "QUESTS_GROUP_COMMENDATIONS", [368] = "QUESTS_GROUP_SCOURGE_INVASION",
    winterveil = "QUESTS_GROUP_WINTER_VEIL", hallowsend = "QUESTS_GROUP_HALLOWS_END",
    loveisintheair = "QUESTS_GROUP_LOVE_IS_IN_THE_AIR", harvestfestival = "QUESTS_GROUP_HARVEST_FESTIVAL",
    argentdawn = "QUESTS_GROUP_ARGENT_DAWN", library = "QUESTS_GROUP_LIBRARY",
}

local function SectionOf(sort)
    for _, section in ipairs(SECTIONS) do
        if section.sorts and section.sorts[sort] then return section.key end
    end
    return "other"
end
local filter = ""

-- What a quest's page shows and plays: the offer and the hand-in. The progress, said while the
-- quest is under way, is left out.
local MOMENTS = { "accept", "complete" }
local HEADINGS = { accept = "QUEST_PART_ACCEPT", complete = "QUEST_PART_COMPLETE" }

--------------------------------------------------------------------------------
-- What there is
--------------------------------------------------------------------------------

local function Quests()
    local data = _G.SpokenQuestsCompendium
    return data and data.quests or {}
end

local function English(id)
    return _G.SpokenQuestsText and SpokenQuestsText[id] or {}
end

local function Locale()
    return GetLocale and GetLocale() or "enUS"
end

local function Localized(id)
    local localized = _G.SpokenQuestsLocalizedText
    localized = localized and localized[Locale()]
    return localized and localized[id] or nil
end

local function Global()
    local db = VO.Addon.db and VO.Addon.db.global
    if not db then return {} end
    db.Compendium = db.Compendium or {}
    return db.Compendium
end

local function Unlocked()
    return Global().UnlockUnfound == true
end

local function OnlyFound()
    return Global().FoundOnly ~= false
end

-- Voiced Only, after Started Only in the filter menu: the quests no installed voice pack has a part
-- of are left out, and with them any line or banner left with nothing.
local function OnlyVoiced()
    return Global().VoicedOnly == true
end

-- Whether a voice pack has a part of a quest, as its page's Play finds one.
local AnyVoiced

-- The words and titles kept in this client's language, by quest: { title, accept = { text, sex } ... }.
-- None on an English client: the English shipped is what it would keep.
local function Kept()
    if Locale() == "enUS" then return nil end
    local db = VO.Addon.db and VO.Addon.db.global
    if not db then return nil end
    db.CompendiumText = db.CompendiumText or {}
    db.CompendiumText[Locale()] = db.CompendiumText[Locale()] or {}
    return db.CompendiumText[Locale()]
end

-- The client's title once it has one, else the English; asked for once where it is not loaded,
-- and the list drawn again when it arrives (QUEST_DATA_LOAD_RESULT).
local titles, asked = {}, {}
local function Title(id, ask)
    local localized = Localized(id)
    local quest = Quests()[id]
    -- QUEST_DETAIL can cache the English title before the Compendium is opened. Do not let
    -- that transient cache hide a shipped title for a client whose quest window is English.
    if titles[id] and not (localized and quest and titles[id] == quest[1]) then return titles[id] end
    local kept = Kept()
    local title = kept and kept[id] and kept[id].title
    if title and quest and title == quest[1] then title = nil end
    title = title or localized and localized.title
    if not title and Locale() ~= "enUS" and C_QuestLog and C_QuestLog.GetTitleForQuestID then
        title = C_QuestLog.GetTitleForQuestID(id)
        if (type(title) ~= "string" or title == "") and ask and not asked[id] and C_QuestLog.RequestLoadQuestByID then
            asked[id] = true
            C_QuestLog.RequestLoadQuestByID(id)
        end
    end
    if type(title) == "string" and title ~= "" then
        titles[id] = title
        return title
    end
    return quest and quest[1] or tostring(id)
end

local function SortName(sort)
    if GROUP_NAMES[sort] then return L[GROUP_NAMES[sort]] end
    local data = _G.SpokenQuestsCompendium
    local names = data and data.sorts and data.sorts[sort]
    if not names then return tostring(sort) end
    return names[Locale()] or names[1]
end

-- AllowableRaces and AllowableClasses are bit masks, bit (id - 1), save the races in `bits`:
-- Skyborne's (race ids 95 and 96) are PlayableRaceBit 32 and 33. Tested with arithmetic, since
-- bit.band is 32-bit.
local RACE_BITS = { [95] = 32, [96] = 33 }
local function Has(mask, id, bits)
    if not id or id < 1 then return true end
    return math.floor(mask / 2 ^ (bits and bits[id] or id - 1)) % 2 == 1
end

local function Allowed(quest)
    if quest.races then
        local _, _, race = UnitRace("player")
        if not Has(quest.races, race, RACE_BITS) then return false end
    end
    if quest.classes then
        local _, _, class = UnitClass("player")
        if not Has(quest.classes, class) then return false end
    end
    return true
end

local function OnThisClient(id)
    return not VERSION or VERSION.Variant == "forever" or id < QUEST_LIMIT
end

-- What the game says this character has completed, read again on each refresh: the whole list
-- where the client gives one, else asked quest by quest.
local completed
local function ReadCompleted()
    completed = nil
    local ids = C_QuestLog and C_QuestLog.GetAllCompletedQuestIDs and C_QuestLog.GetAllCompletedQuestIDs()
    if type(ids) == "table" then
        completed = {}
        for _, id in ipairs(ids) do completed[id] = true end
        return
    end
    local done = GetQuestsCompleted and GetQuestsCompleted()
    if type(done) == "table" then
        completed = {}
        for id, yes in pairs(done) do
            if yes then completed[id] = true end
        end
    end
end

local function Completed(id)
    if completed then return completed[id] == true end
    local ask = (C_QuestLog and C_QuestLog.IsQuestFlaggedCompleted) or IsQuestFlaggedCompleted
    return ask ~= nil and ask(id) and true or false
end

-- The quests in this character's quest log, read again on each refresh.
local inLog = {}
local Index
local function ReadLog()
    local log, listed = {}, 0
    local modern = C_QuestLog and C_QuestLog.GetNumQuestLogEntries and C_QuestLog.GetInfo
    local entries, quests
    if modern then
        entries, quests = C_QuestLog.GetNumQuestLogEntries()
    elseif GetNumQuestLogEntries and GetQuestLogTitle then
        entries, quests = GetNumQuestLogEntries()
    end
    for i = 1, entries or 0 do
        local id, header
        if modern then
            local info = C_QuestLog.GetInfo(i)
            id, header = info and info.questID, info and info.isHeader
        else
            local _, _, _, isHeader, _, _, _, questID = GetQuestLogTitle(i)
            id, header = questID, isHeader
        end
        if not header and type(id) == "number" and id > 0 then
            log[id] = true
            listed = listed + 1
        end
    end
    -- Classic's log does not list the quests under a header the player has collapsed.
    if type(quests) == "number" and listed < quests and C_QuestLog and C_QuestLog.IsOnQuest then
        for id in pairs(Index().all) do
            if C_QuestLog.IsOnQuest(id) then log[id] = true end
        end
    end
    local changed = false
    for id in pairs(log) do if not inLog[id] then changed = true end end
    for id in pairs(inLog) do if not log[id] then changed = true end end
    inLog = log
    return changed
end

local function InProgress(id)
    return inLog[id] == true and not Completed(id)
end

local function Found(id)
    return Completed(id) or inLog[id] == true
end

local function Matches(text)
    return filter == "" or (text and string.find(string.lower(text), filter, 1, true) ~= nil)
end

-- Set while the rows inside a container whose name the search matches are built: all it holds is
-- listed, not only what matches.
local whole = false

-- Whether the search leaves out what does not match it, where the rows are being built.
local function Filtering()
    return filter ~= "" and not whole
end

-- The rows `build` returns, everything it holds listed where `named` (the search matches the
-- container's name).
local function Whole(named, build)
    local before = whole
    whole = before or named
    local rows = build()
    whole = before
    return rows
end

-- Set while the lines under a banner whose name the search matches are built: each is listed,
-- closed or open as the player left it, and opens and closes on a click as it does unsearched. A
-- continent's every quest at once would be too long a list to read.
local asLeft = false

-- Whether a search opens the lines being built.
local function Searched()
    return filter ~= "" and not asLeft
end

-- What a search opened and the player closed again with a click, by row; a new search opens all.
local searchClosed = {}

-- A line's rows: the line, and what it holds unless the player closed it during this search.
local function Rows(head, inside, key)
    head.closeKey = key
    if Searched() and searchClosed[key] then
        head.open = false
        return { head }
    end
    local rows = { head }
    for _, row in ipairs(inside) do table.insert(rows, row) end
    return rows
end

-- While a search opens everything it finds, a click on an open line closes it, and opens it again.
local function SearchFold(row)
    if filter == "" or row.asLeft or not row.closeKey then return false end
    searchClosed[row.closeKey] = not searchClosed[row.closeKey] or nil
    return true
end

-- As Whole, for a banner: its lines listed, each as the player left it.
local function AsLeft(named, build)
    local before = asLeft
    asLeft = before or named
    local rows = Whole(named, build)
    asLeft = before
    return rows
end

-- Whether this client has heard of a map: Era's has not of Forever's Zephras Isle and Darkspear
-- Islands, whose lines would lead nowhere.
local function Known(mapID)
    return not (C_Map and C_Map.GetMapInfo and C_Map.GetMapInfo(mapID) == nil)
end

-- A quest's zones this client knows.
local function KnownZones(quest)
    local out = {}
    for _, mapID in ipairs(quest.zones or {}) do
        if Known(mapID) then table.insert(out, mapID) end
    end
    return out
end

-- Whether the data or the tab has a name for a sort: one with none has no line of its own to go
-- under, and its quests are Place Unknown's.
local function Named(sort)
    local names = _G.SpokenQuestsCompendium and SpokenQuestsCompendium.sorts or {}
    return sort ~= nil and (names[sort] ~= nil or GROUP_NAMES[sort] ~= nil)
end

-- Every quest this character may take, by where it is: index.zones[mapID], index.sorts[sort],
-- index.elsewhere, and `all`. A quest only in zones this client does not know is in none of them:
-- the list could never show it, so it counts nowhere. Built once: neither the data, the client's
-- maps nor the character's race and class change in a session.
local index
function Index()
    if index then return index end
    index = { zones = {}, sorts = {}, elsewhere = {}, all = {} }
    for id, quest in pairs(Quests()) do
        if OnThisClient(id) and Allowed(quest) then
            local zones = KnownZones(quest)
            if quest.zones and #quest.zones > 0 then
                if #zones > 0 then index.all[id] = true end
                for _, mapID in ipairs(zones) do
                    index.zones[mapID] = index.zones[mapID] or {}
                    table.insert(index.zones[mapID], id)
                end
            elseif Named(quest.sort) then
                index.all[id] = true
                index.sorts[quest.sort] = index.sorts[quest.sort] or {}
                table.insert(index.sorts[quest.sort], id)
            else
                index.all[id] = true
                table.insert(index.elsewhere, id)
            end
        end
    end
    return index
end

local function ByName(a, b)
    local na, nb = C.MapName(a), C.MapName(b)
    if na == nb then return a < b end
    return na < nb
end

-- The zones on `continent` with quests, cities left to the zone around them and battlegrounds to
-- their banner.
local function ZonesOn(continent)
    local out, listed = {}, {}
    for mapID in pairs(Index().zones) do
        local zone = C.CITY_IN[mapID] or mapID
        if not listed[zone] and not C.IS_BATTLEGROUND[zone] and C.ContinentOf(zone) == continent then
            listed[zone] = true
            table.insert(out, zone)
        end
    end
    table.sort(out, ByName)
    return out
end

-- The zones with quests on no continent (Forever's Zephras Isle, whose map hangs under Azeroth),
-- under a banner of their own after the continents, as the Zones tab lists them.
local function LooseZones()
    local out = {}
    for mapID in pairs(Index().zones) do
        if not C.CITY_IN[mapID] and not C.IS_BATTLEGROUND[mapID] and not C.ContinentOf(mapID) then
            table.insert(out, mapID)
        end
    end
    table.sort(out, ByName)
    return out
end

-- The battlegrounds with quests, by name: the index holds only maps this client knows, so not
-- Forever's Darkspear Islands on Era.
local function Battlegrounds()
    local out = {}
    for _, mapID in ipairs(C.BATTLEGROUNDS) do
        if Index().zones[mapID] then table.insert(out, mapID) end
    end
    table.sort(out, ByName)
    return out
end

-- Every quest under `mapID`, its city's included, each once.
local function QuestsIn(mapID, into)
    into = into or {}
    for _, id in ipairs(Index().zones[mapID] or {}) do into[id] = true end
    for city, around in pairs(C.CITY_IN) do
        if around == mapID then QuestsIn(city, into) end
    end
    return into
end

local function SetOf(ids)
    local set = {}
    for _, id in ipairs(ids or {}) do set[id] = true end
    return set
end

-- Found out of all, and how many of the found are in progress. Of what is listed: under Voiced
-- Only, the quests no pack has are left out of the count as they are of the rows.
local function Tally(set)
    local found, total, going = 0, 0, 0
    local voicedOnly = OnlyVoiced()
    for id in pairs(set) do
        if not voicedOnly or AnyVoiced(id) then
            total = total + 1
            if Found(id) then found = found + 1 end
            if InProgress(id) then going = going + 1 end
        end
    end
    return found, total, going
end

-- Whether a line or banner counting `found` of `total` is left out: Started Only with none
-- started, or Voiced Only with none voiced.
local function Unlisted(found, total)
    return (OnlyFound() and found == 0) or (OnlyVoiced() and total == 0)
end

-- The gossip window's mark for a quest under way, before the title of one in progress.
local IN_PROGRESS_MARK = "|TInterface\\GossipFrame\\ActiveQuestIcon:0|t "

--------------------------------------------------------------------------------
-- The chains
--------------------------------------------------------------------------------

-- A chain is the quests linked by `prev` in the data (the quest before each in its storyline),
-- known by its first quest. The client has no chain of its own to ask.
local function Prev(id)
    local quest = Quests()[id]
    local prev = quest and quest.prev
    return prev and OnThisClient(prev) and Quests()[prev] and prev or nil
end

-- The quests that follow each, by id, by the quest before them.
local following
local function Following(id)
    if not following then
        following = {}
        for after, quest in pairs(Quests()) do
            if OnThisClient(after) and quest.prev and OnThisClient(quest.prev) then
                following[quest.prev] = following[quest.prev] or {}
                table.insert(following[quest.prev], after)
            end
        end
        for _, ids in pairs(following) do table.sort(ids) end
    end
    return following[id]
end

local function InChain(id)
    return Prev(id) ~= nil or Following(id) ~= nil
end

-- The first quest of `id`'s chain, and how many come before `id` in it. The data has no loops, but
-- a hand-edited file could: the walk stops where it has been.
local firstOf, stepsOf = {}, {}
local function First(id)
    if firstOf[id] then return firstOf[id], stepsOf[id] end
    local at, steps, seen = id, 0, { [id] = true }
    while Prev(at) and not seen[Prev(at)] do
        at = Prev(at)
        seen[at] = true
        steps = steps + 1
    end
    firstOf[id], stepsOf[id] = at, steps
    return at, steps
end

-- The first quest of the chain starting at `first` that this character may take, walking it in
-- the order its quests are taken: a chain's first quest can be another race's (Rude Awakening, the
-- Undead's, starts a chain Orcs, Tauren and Trolls join later).
local takenFirst = {}
local function FirstTaken(first)
    if takenFirst[first] then return takenFirst[first] end
    local queue, seen, at, found = { first }, { [first] = true }, 1, nil
    while queue[at] and not found do
        local id = queue[at]
        at = at + 1
        if Allowed(Quests()[id]) then
            found = id
        else
            for _, after in ipairs(Following(id) or {}) do
                if not seen[after] then
                    seen[after] = true
                    table.insert(queue, after)
                end
            end
        end
    end
    takenFirst[first] = found or first
    return takenFirst[first]
end

-- A chain's name: the one the data gives its first quest (`name`: a quest's id, whose title the
-- client gives in its own language, or words by language), else the title of the first quest this
-- character may take. The same in every zone the chain crosses, where each zone's line holds only
-- its quests there.
local function ChainName(first, ask)
    local quest = Quests()[first]
    local name = quest and quest.name
    if type(name) == "number" and Quests()[name] then return Title(name, ask) end
    if type(name) == "table" then return name[Locale()] or name[1] end
    return Title(FirstTaken(first), ask)
end

-- A chain's name on its line and its page: numbered (`nth`) where its place has others of that name.
local function ChainLabel(first, nth, ask)
    local name = ChainName(first, ask)
    return nth and L.QUESTS_TITLE_NTH_FMT:format(name, nth) or name
end

-- In the order they are taken: by how far down the chain, then by id.
local function InOrder(ids)
    table.sort(ids, function(a, b)
        local _, sa = First(a)
        local _, sb = First(b)
        if sa ~= sb then return sa < sb end
        return a < b
    end)
    return ids
end

local chainOpen = {}

--------------------------------------------------------------------------------
-- The rows
--------------------------------------------------------------------------------

local function QuestRow(id, nest)
    return { kind = "quest", leaf = true, quest = id, label = Title(id, filter == ""),
        nest = nest, locked = not Found(id) and not Unlocked(), going = InProgress(id), done = Completed(id),
        missing = not QuestsTab:HasWords(id) or not AnyVoiced(id) }
end

local function Shows(id)
    local english = Quests()[id] and Quests()[id][1]
    return not (OnlyFound() and not Found(id)) and not (OnlyVoiced() and not AnyVoiced(id))
        and (not Filtering() or Matches(Title(id)) or Matches(english))
end

-- A line counts its completed quests; those under way are counted apart.
local function Counted(item, found, total, going)
    local done = found - going
    item.style = "group"
    -- `found`, completed or under way, is what opens: a chain with one quest started has that to show.
    item.count, item.total, item.goingCount, item.found = done, total, going, found
    item.asLeft = asLeft
    item.tick = total > 0 and done == total
    item.none = found == 0
    return item
end

-- A chain's quests in one place, under a line with the chain's name.
local function ChainRows(where, first, ids, nest, nth)
    InOrder(ids)
    local key = where .. ":" .. first
    local label = ChainLabel(first, nth, filter == "")
    local found, total, going = Tally(SetOf(ids))
    if Unlisted(found, total) then return {} end
    local inside = Whole(filter ~= "" and Matches(label), function()
        local out = {}
        if chainOpen[key] or Searched() then
            for _, id in ipairs(ids) do
                if Shows(id) then table.insert(out, QuestRow(id, nest + 1)) end
            end
        end
        return out
    end)
    if Filtering() and #inside == 0 then return {} end
    return Rows(Counted({ kind = "chain", key = key, ids = ids, first = first, nth = nth, label = label, nest = nest,
        where = where, open = #inside > 0 }, found, total, going), inside, "c" .. key)
end

-- The quests in one place (`where`): each chain of two or more of them first, by name, then the
-- rest, by title. Sorted as they are drawn: a title the client has only just given may move.
local function Leaves(ids, nest, into, where)
    local chains, single = {}, {}
    for _, id in ipairs(ids or {}) do
        if InChain(id) then
            local first = First(id)
            chains[first] = chains[first] or {}
            table.insert(chains[first], id)
        else
            table.insert(single, id)
        end
    end
    local groups = {}
    for first, members in pairs(chains) do
        if #members > 1 then
            table.insert(groups, { first = first, ids = members, name = ChainName(first) })
        else
            table.insert(single, members[1])
        end
    end
    table.sort(groups, function(a, b)
        if a.name == b.name then return a.first < b.first end
        return a.name < b.name
    end)
    -- Chains here of one name (Warsong Gulch's six Fight for Warsong Gulch) are told apart by a
    -- number, in the order of their first quests' ids.
    local named, nth = {}, {}
    for _, group in ipairs(groups) do named[group.name] = (named[group.name] or 0) + 1 end
    for _, group in ipairs(groups) do
        if named[group.name] > 1 then
            nth[group.name] = (nth[group.name] or 0) + 1
            group.nth = nth[group.name]
        end
    end
    for _, group in ipairs(groups) do
        for _, row in ipairs(ChainRows(where, group.first, group.ids, nest, group.nth)) do table.insert(into, row) end
    end
    table.sort(single, function(a, b)
        local ta, tb = Title(a), Title(b)
        if ta == tb then return a < b end
        return ta < tb
    end)
    for _, id in ipairs(single) do
        if Shows(id) then table.insert(into, QuestRow(id, nest)) end
    end
end

-- The chain `id` is listed in, where it is listed: the key of its line, or nil where it is listed
-- on its own.
local function ChainKey(id, where, ids)
    if not InChain(id) then return nil end
    local first, count = First(id), 0
    for _, other in ipairs(ids or {}) do
        if InChain(other) and First(other) == first then count = count + 1 end
    end
    return count > 1 and (where .. ":" .. first) or nil
end

-- A dungeon's or a raid's name, as the client's Map table has it in this client's language.
local function DungeonName(id)
    return C.DungeonName(id)
end

-- A zone's own quests, and its dungeons' and raids' by dungeon (`dungeon` in the data: the quest
-- log files them under the dungeon, and the data under the zone of its entrance).
local function ZoneParts(mapID)
    local own, byDungeon = {}, {}
    for _, id in ipairs(Index().zones[mapID] or {}) do
        local dungeon = Quests()[id].dungeon
        if dungeon then
            byDungeon[dungeon] = byDungeon[dungeon] or {}
            table.insert(byDungeon[dungeon], id)
        else
            table.insert(own, id)
        end
    end
    return own, byDungeon
end

-- Where a dungeon's quests are listed, for their chains' keys.
local function DungeonKey(mapID, dungeon)
    return "d" .. mapID .. (dungeon and (":" .. dungeon) or "")
end

local dungeonOpen = {}

-- A zone's dungeons' and raids' quests: the dungeon's line where the zone has one, else a line,
-- Dungeons and Raids, with a line for each dungeon under it (Blackrock Mountain's four, in Searing
-- Gorge).
local function DungeonRows(mapID, byDungeon, nest)
    local all, dungeons = {}, {}
    for dungeon, ids in pairs(byDungeon) do
        table.insert(dungeons, dungeon)
        for _, id in ipairs(ids) do table.insert(all, id) end
    end
    if #all == 0 then return {} end
    table.sort(dungeons, function(a, b)
        local na, nb = DungeonName(a), DungeonName(b)
        if na == nb then return a < b end
        return na < nb
    end)
    local found, total, going = Tally(SetOf(all))
    if Unlisted(found, total) then return {} end
    local key, searching = DungeonKey(mapID), filter ~= ""
    local label = #dungeons == 1 and DungeonName(dungeons[1]) or L.QUESTS_DUNGEONS
    local inside = Whole(searching and Matches(label), function()
        local out = {}
        if not (dungeonOpen[key] or Searched()) then return out end
        if #dungeons == 1 then
            Leaves(all, nest + 1, out, DungeonKey(mapID, dungeons[1]))
            return out
        end
        for _, dungeon in ipairs(dungeons) do
            local ids, dkey, name = byDungeon[dungeon], DungeonKey(mapID, dungeon), DungeonName(dungeon)
            local f, t, g = Tally(SetOf(ids))
            local leaves = Whole(searching and Matches(name), function()
                local rows = {}
                if dungeonOpen[dkey] or Searched() then Leaves(ids, nest + 2, rows, dkey) end
                return rows
            end)
            if not Unlisted(f, t) and not (Filtering() and #leaves == 0) then
                for _, row in ipairs(Rows(Counted({ kind = "dungeon", key = dkey, dungeon = dungeon, ids = ids, label = name,
                    nest = nest + 1, open = #leaves > 0 }, f, t, g), leaves, "d" .. dkey)) do
                    table.insert(out, row)
                end
            end
        end
        return out
    end)
    if Filtering() and #inside == 0 then return {} end
    return Rows(Counted({ kind = "dungeons", key = key, ids = all, label = label, nest = nest,
        dungeon = #dungeons == 1 and dungeons[1] or nil,
        open = #inside > 0 }, found, total, going), inside, "d" .. key)
end

-- A zone's line, and under it when it is open its city's line, its dungeons' and raids' line or
-- line, its chains' lines and its quests. A city's line opens on its own, and shows only while its
-- zone is open.
local function ZoneRows(mapID, nest)
    local found, total, going = Tally(QuestsIn(mapID))
    if Unlisted(found, total) then return {} end
    local open = openZones[mapID] == true
    local inside = Whole(filter ~= "" and Matches(C.MapName(mapID)), function()
        local out = {}
        if not (open or Searched()) then return out end
        for city, around in pairs(C.CITY_IN) do
            if around == mapID and Index().zones[city] then
                for _, row in ipairs(ZoneRows(city, nest + 1)) do table.insert(out, row) end
            end
        end
        local own, byDungeon = ZoneParts(mapID)
        for _, row in ipairs(DungeonRows(mapID, byDungeon, nest + 1)) do table.insert(out, row) end
        Leaves(own, nest + 1, out, "z" .. mapID)
        return out
    end)
    if Filtering() and #inside == 0 then return {} end
    return Rows(Counted({ kind = "zone", mapID = mapID, label = C.MapName(mapID), nest = nest,
        open = (open or Searched()) and #inside > 0 }, found, total, going), inside, "z" .. mapID)
end

-- A sort's line in its section's banner (Mage, Cooking, Lunar Festival), or Place Unknown's.
local function GroupRows(kind, key, label, ids)
    if not ids or #ids == 0 then return {} end
    local found, total, going = Tally(SetOf(ids))
    if Unlisted(found, total) then return {} end
    local leaves = Whole(filter ~= "" and Matches(label), function()
        local out = {}
        if groupOpen[key] or Searched() then Leaves(ids, 1, out, "s" .. key) end
        return out
    end)
    if Filtering() and #leaves == 0 then return {} end
    return Rows(Counted({ kind = kind, key = key, label = label, nest = 0, open = #leaves > 0 },
        found, total, going), leaves, "g" .. key)
end

-- A section's quests, and the sorts it holds.
local function SectionSet(key)
    local set, sorts = {}, {}
    for sort, ids in pairs(Index().sorts) do
        if SectionOf(sort) == key then
            table.insert(sorts, sort)
            for _, id in ipairs(ids) do set[id] = true end
        end
    end
    if key == "other" then
        for _, id in ipairs(Index().elsewhere) do set[id] = true end
    end
    table.sort(sorts, function(a, b) return SortName(a) < SortName(b) end)
    return set, sorts
end

local function SectionRows(section)
    local set, sorts = SectionSet(section.key)
    local found, total, going = Tally(set)
    if total == 0 or Unlisted(found, total) then return {} end
    local searching = filter ~= ""
    local inside = AsLeft(searching and Matches(L[section.label]), function()
        local out = {}
        local function Add(rows) for _, row in ipairs(rows) do table.insert(out, row) end end
        if searching or sectionOpen[section.key] then
            for _, sort in ipairs(sorts) do Add(GroupRows("sort", sort, SortName(sort), Index().sorts[sort])) end
            if section.key == "other" then Add(GroupRows("elsewhere", "elsewhere", L.QUESTS_ELSEWHERE, Index().elsewhere)) end
        end
        return out
    end)
    if searching and #inside == 0 then return {} end
    local rows = { { style = "banner", kind = "section", key = section.key, label = L[section.label],
        count = found - going, found = found, total = total, open = #inside > 0 } }
    for _, row in ipairs(inside) do table.insert(rows, row) end
    return rows
end

-- The continents with quests, by name.
local function Continents()
    local out = {}
    for _, continent in ipairs(C.CONTINENTS) do
        if #ZonesOn(continent) > 0 then table.insert(out, continent) end
    end
    table.sort(out, ByName)
    return out
end

-- A banner holding a line for each of `zones`, opened and chosen as the sections' are.
local function ZoneBanner(key, label, zones)
    local set = {}
    for _, mapID in ipairs(zones) do QuestsIn(mapID, set) end
    local found, total, going = Tally(set)
    if total == 0 or Unlisted(found, total) then return {} end
    local searching = filter ~= ""
    local inside = AsLeft(searching and Matches(label), function()
        local out = {}
        if searching or sectionOpen[key] then
            for _, mapID in ipairs(zones) do
                for _, row in ipairs(ZoneRows(mapID, 0)) do table.insert(out, row) end
            end
        end
        return out
    end)
    if searching and #inside == 0 then return {} end
    local rows = { { style = "banner", kind = "section", key = key, label = label,
        count = found - going, found = found, total = total, open = #inside > 0 } }
    for _, row in ipairs(inside) do table.insert(rows, row) end
    return rows
end

-- The zones' banners apart from the continents': what each holds and its name.
local ZONE_BANNERS = {
    lands = { label = "QUESTS_SECTION_LANDS", zones = function() return LooseZones() end },
    battlegrounds = { label = "QUESTS_SECTION_BATTLEGROUNDS", zones = function() return Battlegrounds() end },
}

-- A banner for each continent, its zones' lines inside; the zones on none under a banner of their
-- own; the battlegrounds' banner; then a banner for each section.
local function BuildRows()
    local out = {}
    local function Add(rows) for _, row in ipairs(rows) do table.insert(out, row) end end
    local searching = filter ~= ""
    whole, asLeft = false, false
    for _, continent in ipairs(Continents()) do
        local zones = ZonesOn(continent)
        local set = {}
        for _, mapID in ipairs(zones) do QuestsIn(mapID, set) end
        local found, total, going = Tally(set)
        local rows = AsLeft(searching and Matches(C.MapName(continent)), function()
            local out = {}
            if searching or continentOpen[continent] then
                for _, mapID in ipairs(zones) do
                    for _, row in ipairs(ZoneRows(mapID, 0)) do table.insert(out, row) end
                end
            end
            return out
        end)
        if not Unlisted(found, total) and (not searching or #rows > 0) then
            table.insert(out, { style = "banner", kind = "continent", mapID = continent, label = C.MapName(continent),
                count = found - going, found = found, total = total, open = #rows > 0 })
            Add(rows)
        end
    end
    for _, key in ipairs({ "lands", "battlegrounds" }) do
        local banner = ZONE_BANNERS[key]
        Add(ZoneBanner(key, L[banner.label], banner.zones()))
    end
    for _, section in ipairs(SECTIONS) do Add(SectionRows(section)) end
    return out
end

local function IsSelected(row)
    if not selection then return false end
    if row.kind == "quest" then return selection.quest == row.quest end
    if row.kind == "sort" then return selection.sort == row.key end
    if row.kind == "section" then return selection.section == row.key end
    if row.kind == "elsewhere" then return selection.group == "elsewhere" end
    if row.kind == "chain" then return selection.chain == row.key end
    if row.kind == "dungeons" or row.kind == "dungeon" then return selection.dungeon == row.key end
    return selection.mapID ~= nil and selection.mapID == row.mapID
end

--------------------------------------------------------------------------------
-- The words
--------------------------------------------------------------------------------

local function Sex()
    return UnitSex and UnitSex("player") or 2
end

local function Plain(text)
    return (text:gsub("[%^%$%(%)%%%.%[%]%*%+%-%?]", "%%%0"))
end

--- A quest's words for this character, as the client fills them: the name, class and race,
--- the word for its sex out of "$G male:female;", and $B a line break.
function QuestsTab:Fill(text)
    return VO.Utils:FillPlayerTokens(text)
end

-- Words the client showed, made fit for another character: where the English names the player,
-- their class or race, so does what is kept.
local function Generalise(text, english)
    english = english or ""
    local words = {
        { "N", UnitName and UnitName("player") },
        { "C", UnitClass and UnitClass("player") },
        { "R", UnitRace and UnitRace("player") },
    }
    for _, each in ipairs(words) do
        local letter, word = each[1], each[2]
        if type(word) == "string" and word ~= "" and english:find("%$[" .. letter .. letter:lower() .. "]") then
            text = text:gsub(Plain(word), "$" .. letter)
        end
    end
    return text
end

-- Each moment's words as stored: those kept in this client's language, else the English, or nil.
-- Kept words filled for the other sex are not used where the English has a word for each.
local function Stored(id, moment)
    local english = English(id)
    local localized = Localized(id)
    local kept = Kept()
    kept = kept and kept[id]
    local own = kept and kept[moment]
    local text = localized and localized[moment] or english[moment]
    local hasLocalizedFallback = localized and localized[moment]
    local isEnglishCopy = hasLocalizedFallback and own and own.text == english[moment]
    if type(own) == "table" and own.text and not isEnglishCopy
        and not (own.sex ~= Sex() and (text or ""):find("%$[Gg]")) then
        text = own.text
    end
    if text and text ~= "" then return text end
end

-- One part's words, in the client's language where its window was seen, or nil.
local function PartText(id, moment)
    local text = Stored(id, moment)
    return text and QuestsTab:Fill(text)
end

--- Keep what the open quest window shows, in this client's language.
function QuestsTab:Keep(moment, text, title)
    local id = GetQuestID and VO.NotSecret(GetQuestID())
    local kept = Kept()
    if not kept or not id or id == 0 or not Quests()[id] then return end
    kept[id] = kept[id] or {}
    if type(title) == "string" and title ~= "" then
        kept[id].title = title
        titles[id] = title
    end
    if type(text) == "string" and text ~= "" then
        kept[id][moment] = { text = Generalise(text, English(id)[moment]), sex = Sex() }
    end
end

--------------------------------------------------------------------------------
-- The page
--------------------------------------------------------------------------------

local EVENTS = { accept = VO.Enums.SoundEvent.QuestAccept, progress = VO.Enums.SoundEvent.QuestProgress,
    complete = VO.Enums.SoundEvent.QuestComplete }

-- The quest's clips queued, of one moment where `moment` is given.
local function Clips(id, moment)
    local out = {}
    for _, clip in ipairs(VO.Player:Queued()) do
        if clip.questID == id and (moment and clip.event == EVENTS[moment] or not moment and (clip.event == EVENTS.accept
            or clip.event == EVENTS.progress or clip.event == EVENTS.complete)) then
            table.insert(out, clip)
        end
    end
    return out
end

local function Voiced(id, moment)
    return VO.DataModules:PrepareSound({ event = EVENTS[moment], questID = id }) and true or false
end

-- The hand-in tells how a quest ends: it shows once the quest is completed, or with Unlock
-- Unstarted Quests on, where the player chose to see everything.
local function Shows(id, moment)
    return moment ~= "complete" or Completed(id) or Unlocked()
end

-- Whether the page has words to show: the offer's, or the hand-in's where it shows. Looks at the
-- stored text only, so a row can ask it on every render.
function QuestsTab:HasWords(id)
    return Stored(id, "accept") ~= nil or (Shows(id, "complete") and Stored(id, "complete") ~= nil)
end

-- Who says one moment of a quest: the hand-in is said by the one it is handed
-- in to (`ender`, `enderObject` in the data, absent where that is the giver), the offer by its
-- giver, as the quest log's Play names it.
local function Speaker(id, moment)
    local DataModules, Enums = VO.DataModules, VO.Enums
    local quest = moment ~= "accept" and Quests()[id]
    if quest and quest.ender then return Enums.GUID.Creature, quest.ender end
    if quest and quest.enderObject then return Enums.GUID.GameObject, quest.enderObject end
    return DataModules:GetQuestLogQuestGiverTypeAndID(id)
end

-- The name of who says one moment, as the packs name them, or nil where none is known.
local function SpeakerName(kind, speaker)
    return speaker and VO.DataModules:GetObjectName(kind, speaker) or nil
end

-- What the player is given to play one moment of a quest, named and pictured for who says it.
local function SoundData(id, moment, origin)
    local Enums = VO.Enums
    local kind, speaker = Speaker(id, moment)
    local name = SpeakerName(kind, speaker) or Title(id)
    local guid = speaker and Enums.GUID:CanHaveID(kind) and VO.Utils:MakeGUID(kind, speaker) or nil
    return { event = EVENTS[moment], questID = id, title = Title(id), name = name, unitGUID = guid,
        unitIsObjectOrItem = speaker ~= nil and not Enums.GUID:IsCreature(kind), text = PartText(id, moment),
        origin = origin }
end

-- Whether a voice pack has any of a quest (Voiced Only), and a quest played from its row
-- (shift-click): what is said when it is offered and handed in, as far as the voice packs have
-- it, named for who says it. A quest voiced only in its progress counts as unvoiced. The quest's
-- page plays each part from its own Play.
local PLAY = {
    has = function(id)
        for _, moment in ipairs(MOMENTS) do
            if Voiced(id, moment) then return true end
        end
        return false
    end,
    -- One part, the first a pack voices: the offer and the hand-in are said at
    -- different times, not as one speech. Its words go with it, for the window to show. Nothing
    -- where a part of the quest is queued already: one part of a quest at a time.
    -- `queued`: behind what the queue already holds, not played at once.
    start = function(id, queued)
        if #Clips(id) > 0 then return end
        for _, moment in ipairs(MOMENTS) do
            if Shows(id, moment) and Voiced(id, moment) then
                local soundData = SoundData(id, moment, "Azeroth's Compendium")
                if queued then VO.Player:Enqueue(soundData, true) else VO.Player:PlayNow(soundData) end
                return
            end
        end
    end,
}

-- Each part's Play and Report, on its heading's line on the page: made once, pointed at the
-- quest shown.
local partButtons = {}

-- The part's line in the queue, nearest the head, or nil.
local function PartPlaying(id, moment) return Clips(id, moment)[1] end

local function PaintPartPlay(button)
    button.pageState = C.PlayState(button.questID and PartPlaying(button.questID, button.moment))
    if button.SetState then button:SetState(button.pageState) end
end

local function PartButtons(moment)
    if partButtons[moment] then return partButtons[moment] end
    if not (page and Spoken and Spoken.CreateRoundButton) then return nil end
    local child = page.body.child
    local play = Spoken:CreateRoundButton(child, "play")
    play.moment = moment
    -- Stop and Replay while this part is the head, as the quest log's Play (C.PlayClick).
    play:SetScript("OnClick", function(self)
        local id = self.questID
        if not id then return end
        C.PlayClick(PartPlaying(id, moment), function()
            -- One part of a quest at a time: another part queued gives way.
            for _, clip in ipairs(Clips(id)) do VO.Player:Remove(clip) end
            VO.Player:PlayNow(SoundData(id, moment, "Azeroth's Compendium"))
        end)
        PaintPartPlay(self)
        if GameTooltip and GameTooltip:GetOwner() == self then C.PlayTooltip(self, self.pageState) end
    end)
    play:HookScript("OnEnter", function(self) C.PlayTooltip(self, self.pageState) end)
    play:HookScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
    local report = Spoken:CreateRoundButton(child, "report")
    report:SetScript("OnClick", function(self)
        local id = self.questID
        local target = id and VO.ReportButton and VO.ReportButton:TargetForQuest(id, EVENTS[moment])
        if target then VO.ReportButton:ShowLink(target) end
    end)
    report:HookScript("OnEnter", function(self) C.ReportTooltip(self, L.OPT_REPORT_PROBLEM) end)
    report:HookScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
    play:Hide()
    report:Hide()
    partButtons[moment] = { play = play, report = report }
    return partButtons[moment]
end

-- Each part's face, at the left of its heading's line, as the Small Window shows who speaks: made
-- once, given the speaker of the quest shown. false where Spoken could not make one.
local partFaces = {}
local FACE_SIZE = 44
local BULLETS = { accept = "quest-accept", complete = "quest-complete" }

local function PartFace(moment)
    if partFaces[moment] ~= nil then return partFaces[moment] or nil end
    if not (page and Spoken and Spoken.CreateSpeakerFace) then return nil end
    local ok, face = pcall(Spoken.CreateSpeakerFace, Spoken, page.body.child, FACE_SIZE)
    if not ok then
        print("|cffff5555Spoken Quests|r: " .. tostring(face))
        partFaces[moment] = false
        return nil
    end
    face:Hide()
    partFaces[moment] = face
    return face
end

-- A part's name: the offer is the quest's description, by the word the client's quest window
-- heads it with where the client has one; the hand-in its completion.
local function PartName(moment)
    local description = moment == "accept" and _G.QUEST_DESCRIPTION
    if type(description) == "string" and description ~= "" then return description end
    return L[HEADINGS[moment]]
end

-- Who says one moment, for its face: the creature SoundData names, else the object or item with
-- the quest's item where an item offers it, else no one (the book).
local function FaceSpeaker(id, moment)
    local Enums = VO.Enums
    local kind, speaker = Speaker(id, moment)
    local bullet = BULLETS[moment]
    if not speaker then return { bullet = bullet } end
    if Enums.GUID:IsCreature(kind) then
        return { creatureID = speaker, displayID = VO.Player:QuestFace(speaker), bullet = bullet }
    end
    local icon = kind == Enums.GUID.Item and Spoken.QuestItemIcon and Spoken:QuestItemIcon(id) or nil
    return { objectOrItem = true, icon = icon, bullet = bullet }
end

-- A quest's words in parts, the offer and the hand-in, each headed by the face of who says it
-- beside their name over the part's name, with Report for every part and Play where a pack voices
-- it; the hand-in only where it Shows. A part a pack voices whose words are not known says so,
-- and is there to be played and reported. nil with no words and nothing voiced.
local function Parts(id)
    local parts = {}
    local reportsHidden = Spoken and Spoken.AreReportButtonsHidden and Spoken:AreReportButtonsHidden()
    for _, moment in ipairs(MOMENTS) do
        local shows = Shows(id, moment)
        local voiced = shows and Voiced(id, moment)
        local text = shows and PartText(id, moment) or voiced and L.QUEST_PART_NO_TEXT
        if text then
            local buttons = PartButtons(moment)
            local list = {}
            if buttons then
                buttons.play.questID, buttons.report.questID = id, id
                buttons.report:SetShown(not reportsHidden)
                buttons.play:Show()
                if voiced then buttons.play:Enable() else buttons.play:Disable() end
                PaintPartPlay(buttons.play)
                list = { buttons.report, buttons.play }
            end
            local name, speaker = PartName(moment), SpeakerName(Speaker(id, moment))
            local face = PartFace(moment)
            if face then face:SetSpeaker(FaceSpeaker(id, moment)) end
            -- Who speaks is the heading, over which part it is: Description or Completion.
            local who = face and speaker and speaker ~= "" and speaker or nil
            table.insert(parts, { heading = who or name, text = text, buttons = list, face = face,
                caption = who and name or nil })
        end
    end
    return #parts > 0 and parts or nil
end

-- Asked once while the packs and the voice languages stay as they are: Voiced Only asks it of every
-- quest under every banner, on every keystroke of a search. A pack loading, or a language chosen on
-- Spoken's page, voices other quests and asks again (Voicing).
local voicedSeen, voicedFor = {}, nil

-- What decides which quests a pack voices: the packs loaded and the languages a line is looked up in.
local function Voicing()
    local packs = 0
    for _ in VO.DataModules:GetModules() do packs = packs + 1 end
    local order = VO.Language and VO.Language.ResolutionOrder and VO.Language:ResolutionOrder() or {}
    return packs .. ":" .. table.concat(order, ",")
end

AnyVoiced = function(id)
    if voicedSeen[id] == nil then voicedSeen[id] = PLAY.has(id) end
    return voicedSeen[id]
end

local function SectionName(key)
    for _, section in ipairs(SECTIONS) do
        if section.key == key then return L[section.label] end
    end
end

-- Where a quest is, on its page's line: in its zones (the first two, and how many more), else
-- its section and its sort ("Classes · Warrior"), else Other and Place Unknown.
local function Where(id)
    local quest = Quests()[id] or {}
    local zones = KnownZones(quest)
    if #zones > 0 then
        local names = {}
        for i = 1, math.min(2, #zones) do table.insert(names, C.MapName(zones[i])) end
        local line = L.QUESTS_IN_FMT:format(table.concat(names, ", "))
        if #zones > 2 then line = line .. L.QUESTS_MORE_FMT:format(#zones - 2) end
        return line
    end
    if Named(quest.sort) then return SectionName(SectionOf(quest.sort)) .. " · " .. SortName(quest.sort) end
    return SectionName("other") .. " · " .. L.QUESTS_ELSEWHERE
end

local function Count(set)
    local found, total, going = Tally(set)
    if going > 0 then return L.QUESTS_FOUND_GOING_FMT:format(found - going, total, going) end
    return L.QUESTS_FOUND_FMT:format(found, total)
end

-- What holds a selection, one level up the list, or nil for a banner: a quest's zone or sort, a
-- chain's zone, dungeon or sort, a dungeon's zone, a city's zone, a zone's continent, Other Lands
-- or Battlegrounds, and a sort's or Place Unknown's section.
local function Holder(chosen)
    if chosen.quest then
        local quest = Quests()[chosen.quest] or {}
        local zone = KnownZones(quest)[1]
        if zone then return { mapID = zone } end
        if Named(quest.sort) then return { sort = quest.sort } end
        return { group = "elsewhere" }
    end
    if chosen.chain then
        local where = chosen.where or ""
        local zone = where:match("^z(%d+)$")
        if zone then return { mapID = tonumber(zone) } end
        local mapID, dungeon = where:match("^d(%d+):(%d+)$")
        if mapID then
            mapID, dungeon = tonumber(mapID), tonumber(dungeon)
            -- A zone with one dungeon has that dungeon's line under the zone's own key (DungeonRows).
            local _, byDungeon = ZoneParts(mapID)
            local several = next(byDungeon, next(byDungeon)) ~= nil
            local key = several and DungeonKey(mapID, dungeon) or DungeonKey(mapID)
            return { dungeon = key, ids = byDungeon[dungeon] or {}, label = DungeonName(dungeon), map = dungeon }
        end
        local sort = where:match("^s(.+)$")
        if sort == "elsewhere" then return { group = "elsewhere" } end
        if sort then return { sort = tonumber(sort) or sort } end
        return nil
    end
    if chosen.dungeon then return { mapID = tonumber(chosen.dungeon:match("^d(%d+)")) } end
    if chosen.sort then return { section = SectionOf(chosen.sort) } end
    if chosen.group == "elsewhere" then return { section = "other" } end
    local mapID = chosen.mapID
    if not mapID or C.IsContinent(mapID) then return nil end
    if C.CITY_IN[mapID] then return { mapID = C.CITY_IN[mapID] } end
    if C.IS_BATTLEGROUND[mapID] then return { section = "battlegrounds" } end
    local continent = C.ContinentOf(mapID)
    if continent then return { mapID = continent } end
    return { section = "lands" }
end

-- The name of what holds a zone's line: its continent, the zone around a city, Other Lands or
-- Battlegrounds; the world for a continent.
local function ZoneHolderName(up)
    if not up then return C.MapName(C.WORLD) end
    if up.mapID then return C.MapName(up.mapID) end
    return L[ZONE_BANNERS[up.section].label]
end

-- What lists a chain, from where its line is (Leaves' `where`), and whether it is a place: a zone
-- or a dungeon is, a class, profession or event, or Place Unknown, is not.
local function HolderName(where)
    local zone = where:match("^z(%d+)$")
    if zone then return C.MapName(tonumber(zone)), true end
    local dungeon = where:match("^d%d+:(%d+)$")
    if dungeon then return DungeonName(tonumber(dungeon)), true end
    local sort = where:match("^s(.+)$")
    if sort == "elsewhere" then return L.QUESTS_ELSEWHERE, false end
    if sort then return SortName(tonumber(sort) or sort), false end
end

-- A page's line, one line: the count after what holds it, "In" a place ("In Elwynn Forest · …")
-- and the name alone for what is no place ("Classes · …"); the count alone with nothing to name.
local function Line(set, holder, place)
    if not holder then return Count(set) end
    return (place and L.QUESTS_IN_FMT:format(holder) or holder) .. " · " .. Count(set)
end

-- Where a quest is, and after it the quest mark and In progress while it is.
local function Subtitle(id)
    if InProgress(id) then return Where(id) .. " · " .. IN_PROGRESS_MARK .. L.QUEST_IN_PROGRESS end
    return Where(id)
end

-- The quest's scroll, with the question mark badge where `done`, else the exclamation mark.
local function ScrollIcon(done)
    return { objectOrItem = true, icon = [[Interface\Icons\INV_Scroll_03]], bullet = done and BULLETS.complete or BULLETS.accept }
end

local QUESTS_ICON = ScrollIcon(false)

local function QuestIcon(id)
    return ScrollIcon(Completed(id))
end

-- A chain is quests, so it has the quest's scroll: the question mark badge once every quest in it is done.
local function ChainIcon(ids)
    local done = #ids > 0
    for _, id in ipairs(ids) do
        if not Completed(id) then
            done = false
            break
        end
    end
    return ScrollIcon(done)
end

-- The pages that are no place and no quest have an icon that fits: a class's own, a profession's, a
-- holiday's. Each is checked against the client's files, since a texture it lacks draws solid green;
-- one it lacks falls back to the section's icon, then to the question mark.
local ICON_DIR = [[Interface\Icons\]]
local SECTION_ICONS = {
    classes = "INV_Misc_Book_09", professions = "Trade_Engineering", events = "INV_Misc_Gift_01",
    other = "INV_Misc_Bag_08", lands = "INV_Misc_Map_01", battlegrounds = "INV_BannerPVP_02",
}
local SORT_ICONS = {
    -- Classes (QuestSort).
    [61] = "ClassIcon_Warlock", [81] = "ClassIcon_Warrior", [82] = "ClassIcon_Shaman", [141] = "ClassIcon_Paladin",
    [161] = "ClassIcon_Mage", [162] = "ClassIcon_Rogue", [261] = "ClassIcon_Hunter", [262] = "ClassIcon_Priest",
    [263] = "ClassIcon_Druid",
    -- Professions.
    [24] = "Trade_Herbalism", [101] = "Trade_Fishing", [121] = "Trade_BlackSmithing", [181] = "Trade_Alchemy",
    [182] = "Trade_LeatherWorking", [201] = "Trade_Engineering", [264] = "Trade_Tailoring", [304] = "INV_Misc_Food_15",
    [324] = "INV_Misc_Bandage_15", [666] = "Spell_Fire_Fire",
    -- Holidays and events.
    winterveil = "INV_Holiday_Christmas_Present_01", hallowsend = "INV_Misc_Bag_28_Halloween",
    loveisintheair = "INV_Misc_Gift_02", harvestfestival = "INV_Misc_Food_15",
}

local function Present(name)
    if not name then return nil end
    local path = ICON_DIR .. name
    -- A client without the lookup is trusted.
    if _G.GetFileIDFromPath and GetFileIDFromPath(path) == nil then return nil end
    return path
end

local function GroupIcon(sort, section)
    local path = Present(sort and SORT_ICONS[sort]) or Present(section and SECTION_ICONS[section])
    if not path then return C.UnknownIcon(nil) end
    return { objectOrItem = true, icon = path }
end

local function ShowEntry()
    if not page then return end
    if not selection then
        page:Show({ title = L.COMPENDIUM_QUESTS, subtitle = Count(Index().all), icon = QUESTS_ICON })
        return
    end
    local up = Holder(selection)
    if selection.chain then
        local ids = selection.ids
        -- As a zone's page: its name, what holds it and its count, and the quests on the left to choose.
        local holder, place
        if selection.where then holder, place = HolderName(selection.where) end
        page:Show({ title = ChainLabel(selection.first or First(ids[1]), selection.nth),
            subtitle = Line(SetOf(ids), holder, place), icon = ChainIcon(ids) })
        return
    end
    if selection.quest then
        local id = selection.quest
        if not Found(id) and not Unlocked() then
            page:Show({ title = Title(id), subtitle = Subtitle(id), text = L.QUEST_NOT_FOUND, icon = QuestIcon(id) })
            return
        end
        -- Play and Report on each part's heading, not the page's: each part is said at its own time.
        local parts = Parts(id)
        page:Show({ title = Title(id), subtitle = Subtitle(id), parts = parts, icon = QuestIcon(id),
            unwritten = not QuestsTab:HasWords(id) })
        return
    end
    if selection.dungeon then
        -- In the zone of its entrance, whose line holds it.
        local zone = tonumber(selection.dungeon:match("^d(%d+)"))
        page:Show({ title = selection.label, subtitle = Line(SetOf(selection.ids), zone and C.MapName(zone), true), icon = C.PlaceIcon(zone, selection.map) })
        return
    end
    local banner = selection.section and ZONE_BANNERS[selection.section]
    if banner then
        local set = {}
        for _, mapID in ipairs(banner.zones()) do QuestsIn(mapID, set) end
        page:Show({ title = L[banner.label], subtitle = Line(set, C.MapName(C.WORLD), true),
            icon = GroupIcon(nil, selection.section) })
        return
    end
    -- Classes, Professions, Holidays and Events and Other are no place: their count alone.
    if selection.section then
        for _, section in ipairs(SECTIONS) do
            if section.key == selection.section then
                page:Show({ title = L[section.label], subtitle = Count((SectionSet(section.key))),
                    icon = GroupIcon(nil, section.key) })
            end
        end
        return
    end
    -- A sort's line, and Place Unknown's, names the section that holds it, which is no place.
    if selection.sort then
        page:Show({ title = SortName(selection.sort),
            subtitle = Line(SetOf(Index().sorts[selection.sort]), SectionName(SectionOf(selection.sort))),
            icon = GroupIcon(selection.sort, SectionOf(selection.sort)) })
        return
    end
    if selection.group == "elsewhere" then
        page:Show({ title = L.QUESTS_ELSEWHERE, subtitle = Line(SetOf(Index().elsewhere), SectionName("other")),
            icon = C.UnknownIcon(nil) })
        return
    end
    local set = {}
    if C.IsContinent(selection.mapID) then
        for _, mapID in ipairs(ZonesOn(selection.mapID)) do QuestsIn(mapID, set) end
    else
        QuestsIn(selection.mapID, set)
    end
    page:Show({ title = C.MapName(selection.mapID), subtitle = Line(set, ZoneHolderName(up), true), icon = C.PlaceIcon(selection.mapID) })
end

--------------------------------------------------------------------------------
-- The tab
--------------------------------------------------------------------------------

local function OnClick(row)
    if row.kind == "quest" and IsShiftKeyDown and IsShiftKeyDown() then
        PLAY.start(row.quest, true)
        return
    end
    if row.kind == "quest" then
        selection = { quest = row.quest }
    elseif row.kind == "chain" then
        if not SearchFold(row) and (filter == "" or row.asLeft) then chainOpen[row.key] = not chainOpen[row.key] end
        selection = { chain = row.key, ids = row.ids, first = row.first, nth = row.nth, where = row.where }
    elseif row.kind == "dungeons" or row.kind == "dungeon" then
        if not SearchFold(row) and (filter == "" or row.asLeft) then dungeonOpen[row.key] = not dungeonOpen[row.key] end
        selection = { dungeon = row.key, ids = row.ids, label = row.label, map = row.dungeon }
    elseif row.kind == "section" then
        if filter == "" then sectionOpen[row.key] = not sectionOpen[row.key] end
        selection = { section = row.key }
    elseif row.kind == "sort" or row.kind == "elsewhere" then
        if not SearchFold(row) and (filter == "" or row.asLeft) then groupOpen[row.key] = not groupOpen[row.key] end
        selection = row.kind == "sort" and { sort = row.key } or { group = "elsewhere" }
    elseif filter ~= "" and not row.asLeft then
        SearchFold(row)
        selection = { mapID = row.mapID }
    elseif row.kind == "continent" then
        continentOpen[row.mapID] = not continentOpen[row.mapID]
        selection = { mapID = row.mapID }
    else
        -- A zone's or city's line opens and closes alone.
        openZones[row.mapID] = not openZones[row.mapID] or nil
        selection = { mapID = row.mapID }
    end
    QuestsTab:Refresh()
end

-- The zone the player stands in that has quests listed, or nil.
local function PlayerZone()
    return C.PlayerZone(function(map) return Index().zones[map] ~= nil end)
end

-- Open what holds a zone's line, and the line.
local function OpenAround(zone) C.OpenAround(zone, continentOpen, sectionOpen) end
local function OpenZone(zone) C.OpenZone(zone, openZones) end

-- Whether the list shows what holds `set` ({ [id] = true }): Started Only leaves out one with
-- nothing started, Voiced Only one with nothing voiced.
local function SetListed(set)
    local found, total = Tally(set)
    return total > 0 and not Unlisted(found, total)
end

-- The quests a continent's banner holds.
local function ContinentSet(continent)
    local set = {}
    for _, mapID in ipairs(ZonesOn(continent)) do QuestsIn(mapID, set) end
    return set
end

-- The continent the player is on where the list shows it, else the first it shows.
local function PlayerContinent()
    local listed = {}
    for _, continent in ipairs(Continents()) do
        if SetListed(ContinentSet(continent)) then table.insert(listed, continent) end
    end
    return C.PlayerContinent(listed)
end

-- Choose where the player stands: their zone, opened, else their continent, as Zones and Books
-- land. Never a zone the list does not show (Started Only, Voiced Only): the page would be for no
-- row. With nothing listed at all, nothing is chosen and the page counts the quests.
local function LandOnPlayer()
    local zone = PlayerZone()
    if zone and SetListed(QuestsIn(zone)) then
        selection = { mapID = zone }
        OpenZone(zone)
        OpenAround(zone)
    else
        local continent = PlayerContinent()
        selection = continent and { mapID = continent } or nil
    end
    landed = selection
end

-- Whether the list shows a selection's row, as far as the filters go.
local function SelectionListed(chosen)
    if chosen.quest then return SetListed({ [chosen.quest] = true }) end
    if chosen.chain or chosen.dungeon then return SetListed(SetOf(chosen.ids)) end
    if chosen.sort then return SetListed(SetOf(Index().sorts[chosen.sort])) end
    if chosen.group == "elsewhere" then return SetListed(SetOf(Index().elsewhere)) end
    if chosen.section then
        local banner = ZONE_BANNERS[chosen.section]
        if not banner then return SetListed((SectionSet(chosen.section))) end
        local set = {}
        for _, mapID in ipairs(banner.zones()) do QuestsIn(mapID, set) end
        return SetListed(set)
    end
    if C.IsContinent(chosen.mapID) then return SetListed(ContinentSet(chosen.mapID)) end
    return SetListed(QuestsIn(chosen.mapID))
end

-- A filter in the menu left the chosen row out of the list. Where the tab chose it for the player,
-- it lands again; where the player chose it, the nearest row above it the list still shows is
-- chosen, else it lands.
local function OnHidden()
    if selection ~= landed then
        local up = selection and Holder(selection)
        while up and not SelectionListed(up) do up = Holder(up) end
        selection = up
    else
        selection = nil
    end
    QuestsTab:Refresh(true)
end

--- Forget what Index() and Following() worked out, for a test that changes the client under them.
function QuestsTab:Reindex()
    index, following = nil, nil
end

function QuestsTab:Refresh(scrollToSelection)
    if not list then return end
    ReadCompleted()
    ReadLog()
    local voicing = Voicing()
    if voicing ~= voicedFor then voicedSeen, voicedFor = {}, voicing end
    if not selection then
        LandOnPlayer()
        scrollToSelection = true
    end
    local items = list:Render()
    if scrollToSelection and selection then list:ScrollToChosen(items) end
    ShowEntry()
end

local function Build(panel)
    list = C.NewList(panel, {
        search = L.QUESTS_SEARCH,
        none = L.QUESTS_NONE,
        only = L.QUESTS_FOUND_ONLY,
        onlyGet = OnlyFound,
        onlySet = function(on) Global().FoundOnly = on end,
        checks = { { label = L.QUESTS_VOICED_ONLY, get = OnlyVoiced, set = function(on) Global().VoicedOnly = on end } },
        build = BuildRows,
        isSelected = IsSelected,
        onClick = OnClick,
        locked = function() return C.LockedReason("OPT_UNLOCK_QUESTS") end,
        hint = function(item) return item.kind == "quest" and L.QUESTS_SHIFT_QUEUE or nil end,
        onHidden = OnHidden,
        onSearch = function(text)
            filter = text
            searchClosed = {}
            QuestsTab:Refresh()
        end,
        addScrollBar = function(scroll, child, inset) return SpokenTextView.AddScrollBar(scroll, child, inset) end,
    })
    panel.Refresh = function() QuestsTab:Refresh() end
    panel.inset, panel.filterButton, panel.filterMenu, panel.noMatch = list.inset, list.filterButton, list.filterMenu, list.noMatch

    local holder = C.PageHolder(panel, list)
    -- No Play in the page's corner: each part is said at its own time, and has its own.
    page = C.NewPage(holder, ns)
    -- The parts' Play show Stop while their part plays, and their Report follows Hide Report Buttons.
    if Spoken and Spoken.RegisterCallback then
        Spoken:RegisterCallback("AUDIO_CHANGED", function()
            for _, buttons in pairs(partButtons) do PaintPartPlay(buttons.play) end
        end)
        Spoken:RegisterCallback("REPORT_SETTINGS_CHANGED", function()
            if selection and selection.quest then ShowEntry() end
        end)
    end
    -- Text Size, on Spoken's page, fires no game event: the page is drawn again at the new size.
    if Spoken and Spoken.RegisterCallback then
        Spoken:RegisterCallback("COMPENDIUM_FONT_CHANGED", function() ShowEntry() end)
    end
    panel.page = page
    QuestsTab.panel = panel
end

-- Whether this character has started `id`, asked now: what the tab last read may be from before
-- the quest was handed in.
local function StartedNow(id)
    local ask = (C_QuestLog and C_QuestLog.IsQuestFlaggedCompleted) or IsQuestFlaggedCompleted
    if ask then
        if ask(id) then return true end
    else
        local done = GetQuestsCompleted and GetQuestsCompleted()
        if type(done) == "table" and done[id] then return true end
    end
    if C_QuestLog and C_QuestLog.IsOnQuest then return C_QuestLog.IsOnQuest(id) and true or false end
    return GetQuestLogIndexByID ~= nil and (GetQuestLogIndexByID(id) or 0) > 0
end

--- Whether the tab is there, its part is on, and it lists `questID` for this character's race and
--- class.
function QuestsTab:Lists(questID)
    return C ~= nil and C:Tab("quests") ~= nil and VO.Addon:IsPartOn() and questID ~= nil and Index().all[questID] == true
end

--- Whether opening the tab on `questID` shows its words: this character may take it, and it is
--- started or Unlock Unstarted Quests is on. Started Only and Voiced Only do not count: Open shows
--- the page though they leave its row out of the list.
function QuestsTab:Has(questID)
    if not self:Lists(questID) then return false end
    return StartedNow(questID) or Unlocked()
end

--- A quest's title in the client's language once it is known, else the English.
function QuestsTab:Title(questID)
    return Title(questID)
end

--- Open the quests, on `questID` when one is given: chosen, with what holds it opened. Its page
--- shows though Started Only or Voiced Only leaves its row out; the list keeps its filters.
function QuestsTab:Open(questID)
    if not C then return end
    local quest = questID and Index().all[questID] and Quests()[questID]
    if quest then
        selection = { quest = questID }
        local zone = KnownZones(quest)[1]
        local chain
        if zone then
            OpenZone(zone)
            OpenAround(zone)
            local own, byDungeon = ZoneParts(zone)
            if quest.dungeon and byDungeon[quest.dungeon] then
                dungeonOpen[DungeonKey(zone)] = true
                dungeonOpen[DungeonKey(zone, quest.dungeon)] = true
                chain = ChainKey(questID, DungeonKey(zone, quest.dungeon), byDungeon[quest.dungeon])
            else
                chain = ChainKey(questID, "z" .. zone, own)
            end
        else
            local named = Named(quest.sort)
            local key = named and quest.sort or "elsewhere"
            groupOpen[key] = true
            sectionOpen[named and SectionOf(quest.sort) or "other"] = true
            chain = ChainKey(questID, "s" .. key, named and Index().sorts[quest.sort] or Index().elsewhere)
        end
        if chain then chainOpen[chain] = true end
    elseif selection == landed then
        -- Opened from the minimap, on where the player stands now.
        selection = nil
    end
    self:Reveal()
end

--- Show the window on the Quests tab with nothing searched, on what is chosen.
function QuestsTab:Reveal()
    if list then
        list:ClearSearch()
        filter = ""
    end
    C:Open("quests")
    C:Expand()
    self:Refresh(true)
end

local function Visible()
    return QuestsTab.panel ~= nil and QuestsTab.panel:IsVisible()
end

local function OnEvent(_, event, a)
    a = VO.NotSecret(a)
    if event == "QUEST_DETAIL" then
        QuestsTab:Keep("accept", GetQuestText and VO.NotSecret(GetQuestText()), GetTitleText and VO.NotSecret(GetTitleText()))
    elseif event == "QUEST_PROGRESS" then
        -- Its title alone: the page has no progress part to show its words.
        QuestsTab:Keep("progress", nil, GetTitleText and VO.NotSecret(GetTitleText()))
    elseif event == "QUEST_COMPLETE" then
        QuestsTab:Keep("complete", GetRewardText and VO.NotSecret(GetRewardText()), GetTitleText and VO.NotSecret(GetTitleText()))
    elseif event == "QUEST_TURNED_IN" then
        if Visible() then QuestsTab:Refresh() end
    elseif event == "QUEST_LOG_UPDATE" or event == "QUEST_ACCEPTED" or event == "QUEST_REMOVED" then
        -- QUEST_LOG_UPDATE comes with every objective done, and in bursts: the list is drawn again
        -- once, a moment after the last, and only when the quests in the log have changed.
        if not QuestsTab.logPending and Visible() and C_Timer and C_Timer.After then
            QuestsTab.logPending = true
            C_Timer.After(0.3, function()
                QuestsTab.logPending = false
                if Visible() and ReadLog() then QuestsTab:Refresh() end
            end)
        end
    elseif event == "QUEST_DATA_LOAD_RESULT" then
        -- Titles arrive one by one: the list is drawn again once, a moment after the last.
        if asked[a] and not QuestsTab.pending and Visible() and C_Timer and C_Timer.After then
            QuestsTab.pending = true
            C_Timer.After(0.3, function()
                QuestsTab.pending = false
                QuestsTab:Refresh()
            end)
        end
    end
end

--- Add the tab to Azeroth's Compendium.
function QuestsTab:Setup()
    C = _G.SpokenCompendium
    if not C or C:Tab("quests") or not _G.SpokenQuestsCompendium then return end
    C:Register("quests", {
        label = L.COMPENDIUM_QUESTS,
        -- The first tab, before Zones (1) and Books (2).
        order = 0,
        build = Build,
        open = function() QuestsTab:Open() end,
        -- Come back to from another tab: where the player stands now, unless they chose here.
        onShow = function() if selection == landed then selection = nil end end,
        enabled = function() return VO.Addon:IsPartOn() end,
        -- Unlock Unstarted Quests, on Spoken's page.
        unlock = {
            get = function() return Unlocked() end,
            set = function(value)
                Global().UnlockUnfound = value and true or false
                QuestsTab:Refresh()
                -- Open in Azeroth's Compendium shows on an unstarted quest by it, on any window open.
                for _, refresh in ipairs({ "RefreshGiverButton", "RefreshLogButton", "RefreshMapButton" }) do
                    if QuestsTab[refresh] then QuestsTab[refresh](QuestsTab) end
                end
            end,
        },
    })
    local frame = CreateFrame("Frame")
    for _, event in ipairs({ "QUEST_DETAIL", "QUEST_PROGRESS", "QUEST_COMPLETE", "QUEST_TURNED_IN",
        "QUEST_DATA_LOAD_RESULT", "QUEST_LOG_UPDATE", "QUEST_ACCEPTED", "QUEST_REMOVED" }) do
        pcall(frame.RegisterEvent, frame, event)
    end
    frame:SetScript("OnEvent", OnEvent)
    if self.SetupOpenButtons then self:SetupOpenButtons() end
end

-- Once the world is up, as the other tabs are added.
local loader = CreateFrame("Frame")
loader:RegisterEvent("PLAYER_ENTERING_WORLD")
loader:SetScript("OnEvent", function(self)
    self:UnregisterEvent("PLAYER_ENTERING_WORLD")
    local ok, err = pcall(QuestsTab.Setup, QuestsTab)
    if not ok and VO.Debug then VO.Debug:Record("compendium-error", tostring(err)) end
end)
