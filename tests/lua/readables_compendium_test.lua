-- The readables in Azeroth's Compendium: every book, letter, note and plaque, in a card for the
-- zone it is in under its continent's banner and a line for what it is, or by what it is
-- alone, found or not; a readable's page with
-- where it comes from; the search, Found Only and Unlock Unfound Readables; and the tabs once the
-- places are there too. Against the shipped data (Data/Books.lua, Data/Places.lua). Run with
-- `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local Expect, Failures = H.Expecter(print)
local READABLES = here .. "/../../addons/Spoken_Readables/"
local SPOKEN = here .. "/../../addons/Spoken/"

stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()

-- The maps the client names, and where each is.
local MAPS = { [947] = { "Azeroth" }, [1414] = { "Kalimdor", 947 }, [1415] = { "Eastern Kingdoms", 947 },
    [1429] = { "Elwynn Forest", 1415 }, [1453] = { "Stormwind City", 1415 }, [1436] = { "Westfall", 1415 },
    [1455] = { "Ironforge", 1415 }, [1426] = { "Dun Morogh", 1415 },
    -- Alterac Valley under Azeroth, as one client hangs it; Warsong Gulch in Ashenvale; an isle on
    -- no continent.
    [1459] = { "Alterac Valley", 947 }, [1440] = { "Ashenvale", 1414 }, [1460] = { "Warsong Gulch", 1440 },
    [9001] = { "Zephras Isle", 947 },
    -- A hill on Kalimdor with nothing to read, and a map on no continent with nothing either.
    [9002] = { "Bare Hills", 1414 }, [9003] = { "Empty Sea", 947 },
    -- Two zones on Kalimdor with dungeons: Cragmoor two, Fenwatch one.
    [9004] = { "Cragmoor", 1414 }, [9005] = { "Fenwatch", 1414 } }
_G.C_Map.GetMapInfo = function(id)
    local map = MAPS[id]
    return { mapType = 3, name = map and map[1] or ("Map " .. id), parentMapID = map and map[2] or nil }
end
_G.C_Texture = { GetAtlasInfo = stub.ListAtlas }
_G.GetLocale = function() return "enUS" end
_G.UISpecialFrames = _G.UISpecialFrames or {}
-- The game's portrait frame, its title kept to be read back, and each frame's template.
local createFrame = _G.CreateFrame
_G.CreateFrame = function(kind, name, parent, template)
    local frame = createFrame(kind, name, parent, template)
    if template == "PortraitFrameTemplate" then
        function frame:SetTitle(text) self.title = text end
        function frame:SetPortraitToAsset(path) self.portrait = path end
    end
    frame.template = template
    return frame
end

-- The spellbook's colour, which the places' page writes in too, as the game has it before Spoken loads.
_G.SPELLBOOK_FONT_COLOR = { GetRGB = function() return 0.2, 0.09, 0 end }
local env = stub.LoadSpoken(SPOKEN)
env.Addon:Enable()
_G.SpokenReadablesSettings, _G.SpokenReadablesCharacter = nil, nil
local B = {}
for _, file in ipairs({ "Locale/enUS", "Checksum", "Core", "Language", "Reader", "Audio", "Playlist",
    "UI/Readables", "Events", "Commands" }) do
    assert(loadfile(READABLES .. file .. ".lua"))("Spoken_Readables", B)
end
B:InitDB()
Expect("Found Only is on in a fresh profile", SpokenReadablesSettings.compendiumFoundOnly, true)
Expect("Unlock Unfound Readables is off in a fresh profile", SpokenReadablesSettings.unlockUnfound, false)
SpokenReadablesSettings.compendiumFoundOnly = false
B:InitDB()
Expect("...and an explicit off stays off", SpokenReadablesSettings.compendiumFoundOnly, false)
SpokenReadablesSettings.foundOnlyDefaultOn = nil
B:InitDB()
Expect("an off stored before it was on by default is turned on once", SpokenReadablesSettings.compendiumFoundOnly, true)
SpokenReadablesSettings.compendiumFoundOnly = false
-- The tests below are about the unfiltered list, so Found Only stays off.
B:SetupSource()
dofile(READABLES .. "Data/Books.lua")
dofile(READABLES .. "Data/Places.lua")
local L = B.L
-- One readable whose event the data does not name, as an older export left every one.
SpokenReadablesPlaces.books[2878].event = true

-- A note on the isle, and one in Warsong Gulch: the shipped data has neither.
local ISLE_NOTE, GULCH_NOTE = 990001, 990002
for id, place in pairs({ [ISLE_NOTE] = { "Isle Tide Tables", 9001 }, [GULCH_NOTE] = { "Gulch Orders", 1460 } }) do
    SpokenReadablesData.pages[id] = { book = id, number = 1, text = "Words of " .. place[1] .. "." }
    SpokenReadablesData.books[id] = { title = place[1], pages = { id } }
    SpokenReadablesPlaces.books[id] = { kind = "world", type = "note", zones = { place[2] } }
end
-- A note of no known origin: the shipped data places every readable.
local STRAY_NOTE = 990007
SpokenReadablesData.pages[STRAY_NOTE] = { book = STRAY_NOTE, number = 1, text = "Words of a stray note." }
SpokenReadablesData.books[STRAY_NOTE] = { title = "Stray Note", pages = { STRAY_NOTE } }
SpokenReadablesPlaces.books[STRAY_NOTE] = { kind = "carried", type = "note" }
-- Cragmoor's two dungeons and Fenwatch's one, a readable inside each, a plaque outside in Cragmoor,
-- and an epitaph had inside Fenwatch's dungeon and outside in Cragmoor.
SpokenDungeons.dungeons[9101] = { zone = 9004, "Hollow Vault", deDE = "Hohles Gewölbe" }
SpokenDungeons.dungeons[9102] = { zone = 9004, "Ember Halls" }
SpokenDungeons.dungeons[9103] = { zone = 9005, "Sunken Crypt" }
local LEDGER, RUNE, SIGNPOST, EPITAPH = 990003, 990004, 990005, 990006
for id, place in pairs({
    [LEDGER] = { "Vault Ledger", "note", { 9004 }, { 9101 } },
    [RUNE] = { "Ember Rune", "tablet", { 9004 }, { 9102 } },
    [SIGNPOST] = { "Cragmoor Signpost", "plaque", { 9004 } },
    [EPITAPH] = { "Crypt Epitaph", "grave", { 9004, 9005 }, { 9103 } },
}) do
    SpokenReadablesData.pages[id] = { book = id, number = 1, text = "Words of " .. place[1] .. "." }
    SpokenReadablesData.books[id] = { title = place[1], pages = { id } }
    SpokenReadablesPlaces.books[id] = { kind = "world", type = place[2], zones = place[3], dungeons = place[4] }
end

-- Kurdran Wildhammer and Alleria Windrunner stand in Stormwind; A Dusty Unsent Letter is carried
-- from Westfall; An Exotic Cookbook is had across Azeroth.
local KURDRAN, ALLERIA, LETTER, COOKBOOK = 287, 288, 16, 410
SpokenReadablesCharacter.found[KURDRAN] = true

B:SetupReadables()
stub.SetZone({ map = 1436 })
B:ShowReadables()
local window = _G.SpokenCompendium.window
local panel = B.readables
Expect("the readables are a tab of Azeroth's Compendium", window.title, SpokenEnv.L.OPT_COMPENDIUM_TITLE)
Expect("...with no tabs while they are its only one", _G.SpokenCompendiumWindowTab1:IsShown(), false)

local rows
local function Collect(frame)
    for _, child in ipairs(frame.children or {}) do
        if child.row then table.insert(rows, child) end
        Collect(child)
    end
end
-- By each item's own name: a banner draws its name in capitals.
local function Shown()
    rows = {}
    Collect(panel)
    local labels = {}
    for _, row in ipairs(rows) do if row.shown ~= false and row.row then table.insert(labels, row.row.label) end end
    return table.concat(labels, "|")
end
local function RowFor(label)
    Shown()
    for _, row in ipairs(rows) do if row.shown ~= false and row.row and row.row.label == label then return row end end
end
local function Click(label)
    local row = RowFor(label)
    assert(row, "no row " .. label)
    row.scripts.OnClick(row)
end
local function Has(list, label)
    return ("|" .. list .. "|"):find("|" .. label .. "|", 1, true) ~= nil
end

-- Opened with nothing chosen, or still on where it landed, the tab lands on where the player stands.
local function Reopen(map)
    window:Hide()
    stub.SetZone({ map = map })
    B:ShowReadables()
end
Expect("opened, the tab lands on the player's zone", panel.page.title.text, "Westfall")
Expect("...its page has the zone's round portrait left of the title, with the zone badge",
    panel.page.headFace ~= nil and panel.page.headFace.speaker.bullet == "zone" and panel.page.shift > 0, true)
Expect("...its line open on the kinds of writing in it, each closed", RowFor("Westfall").row.open
    and Has(Shown(), L.TYPE_LETTER) and not Has(Shown(), "A Dusty Unsent Letter"), true)
Reopen(1453)
Expect("...reopened elsewhere, on the zone the player stands in now", panel.page.title.text, "Stormwind City")
Expect("...a city's card opened inside its zone's", RowFor("Elwynn Forest").row.open and RowFor("Stormwind City").row.open
    and Has(Shown(), L.TYPE_PLAQUE), true)
Expect("...the zone landed on before still open beside it", RowFor("Westfall").row.open, true)
Reopen(9002)
Expect("...where their zone has nothing to read, their continent's banner", panel.page.title.text, "Kalimdor")
Expect("...its page in Azeroth, with what is found of it", panel.page.sub.text.text:match("^In Azeroth · %d+ of %d+ found$") ~= nil, true)
Reopen(9003)
Expect("...on no continent, the first continent's", panel.page.title.text, "Eastern Kingdoms")
_G.GetInstanceInfo = function() return "Hollow Vault", "party", 1, "Normal", 5, 0, false, 9101 end
Reopen(9004)
Expect("...inside a dungeon, on its card, opened inside its zone's and its Dungeons and Raids line",
    panel.page.title.text .. "|" .. tostring(RowFor("Cragmoor").row.open and RowFor(L.GROUP_DUNGEONS).row.open
    and RowFor("Hollow Vault").row.open), "Hollow Vault|true")
_G.GetInstanceInfo = function() return "Ember Halls", "party", 1, "Normal", 5, 0, false, 9999 end
Reopen(9004)
Expect("...inside one with nothing to read, on the zone", panel.page.title.text, "Cragmoor")
_G.GetInstanceInfo = nil
Reopen(9003)
-- Landing far down the list, from the window closed and never laid out: the client's scroll frame
-- takes an offset only within the range it last measured, and has no height until the window is
-- laid out, a frame after it is shown.
do
    local scroll
    for _, child in ipairs(panel.inset.children or {}) do
        if child.frameType == "ScrollFrame" then scroll = child end
    end
    local measured, setScroll = 0, scroll.SetVerticalScroll
    window:Hide()
    scroll.height, scroll.verticalScroll = 0, 0
    function scroll:UpdateScrollChildRect() measured = math.max(0, self.scrollChild.height - self.height) end
    function scroll:SetVerticalScroll(v) setScroll(self, math.min(v, measured)) end
    stub.SetZone({ map = 9002 })
    B:ShowReadables()
    scroll.height = 200
    stub.Advance(0.1)
    local row = RowFor("Kalimdor")
    local top, offset = -row.anchor.y, scroll:GetVerticalScroll()
    Expect("...landing on a banner far down the list, a frame later it is in view",
        offset > 0 and top >= offset and top + row.height <= offset + scroll.height, true)
    scroll.SetVerticalScroll, scroll.UpdateScrollChildRect, scroll.height = setScroll, nil, 120
    Reopen(9003)
end
-- The tab never lands on what the list does not show.
do
    local function FirstKindIn(mapID)
        for _, type in ipairs(B.TYPES) do
            for _, place in pairs(SpokenReadablesPlaces.books) do
                if place.type == type and not place.event and not place.wide then
                    for _, zone in ipairs(place.zones or {}) do
                        if zone == mapID then return L[B.TYPE_NAMES[type].all] end
                    end
                end
            end
        end
    end
    SpokenReadablesSettings.compendiumByZone = false
    Reopen(1436)
    Expect("By Type, the tab lands on the first kind holding a readable of the player's zone",
        panel.page.title.text, FirstKindIn(1436))
    Expect("...its banner in the list", RowFor(panel.page.title.text) ~= nil
        and RowFor(panel.page.title.text).row.kind, "type")
    Expect("...its page with the book badge by the title", panel.page.headFace.speaker.bullet == "book" and panel.page.shift > 0, true)
    Reopen(9003)
    Expect("...where their zone holds none, on the first kind", panel.page.title.text, L.TYPE_BOOK)
    SpokenReadablesSettings.compendiumByZone = nil
    SpokenReadablesSettings.compendiumFoundOnly = true
    Reopen(1426)
    Expect("Found Only, where the player's zone holds nothing found, the tab lands on their continent's banner",
        panel.page.title.text .. " " .. tostring(RowFor("Dun Morogh") == nil), "Eastern Kingdoms true")
    SpokenReadablesSettings.compendiumFoundOnly = false
    Reopen(9003)
end
-- Left open by the landing inside Hollow Vault: closed, so the list starts folded.
Click("Hollow Vault")
Click(L.GROUP_DUNGEONS)
Click("Cragmoor")
Click("Westfall")
Reopen(1453)
Expect("...and what the player chose, kept on reopening", panel.page.title.text, "Westfall")
-- Each card stays as it was left: the click above closed Westfall's, and the landing on Stormwind
-- City opened it and Elwynn Forest's. Closed here, so the list starts folded.
Click("Stormwind City")
Click("Elwynn Forest")

local list = Shown()
Expect("the list is laid out as the places': a banner for each continent, no Azeroth above them",
    RowFor("Eastern Kingdoms") ~= nil and RowFor("Eastern Kingdoms").row.style == "banner" and not Has(list, "Azeroth"), true)
Expect("...its name as it is", RowFor("Eastern Kingdoms").label.text, "Eastern Kingdoms")
Expect("...a line under it for each zone, with no picture or bar", Has(list, "Elwynn Forest") and Has(list, "Westfall")
    and RowFor("Elwynn Forest").row.style == "group" and RowFor("Elwynn Forest").row.nest, 0)
Expect("...a city inside the zone around it, not beside it", Has(list, "Stormwind City"), false)
Expect("...the readables after the continents, a banner each: those found across Azeroth and those of no known origin",
    RowFor(L.GROUP_WIDE).row.style == "banner" and RowFor(L.GROUP_UNKNOWN).row.style, "banner")
Expect("...each zone's card counting what is found out of all, its city's included",
    RowFor("Elwynn Forest").count.text:match("^1/%d+ · %d+%%$") ~= nil, true)
Expect("...and the seasonal events' readables, in a group of their own before them",
    Has(list, L.GROUP_EVENTS) and list:find(L.GROUP_EVENTS, 1, true) < list:find(L.GROUP_WIDE, 1, true), true)
Click(L.GROUP_EVENTS)
Expect("...its page what is found of it alone, being no place", panel.page.sub.text.text:match("^%d+ of %d+ found$") ~= nil, true)
local function At(list, label) return ("|" .. list .. "|"):find("|" .. label .. "|", 1, true) end
-- A click on each kind's card in a group's banner, which opens it.
local function KindRow(group, label)
    Shown()
    for _, row in ipairs(rows) do
        if row.shown ~= false and row.row and row.row.kind == "kind" and row.row.group == group
            and (not label or row.row.label == label) then return row end
    end
end
local function OpenKinds(group)
    Shown()
    local kinds = {}
    for _, row in ipairs(rows) do
        if row.shown ~= false and row.row and row.row.kind == "kind" and row.row.group == group then table.insert(kinds, row.row.label) end
    end
    for _, label in ipairs(kinds) do
        local row = KindRow(group, label)
        row.scripts.OnClick(row)
    end
end
list = Shown()
Expect("...a line for each event, in the year's order, before the kinds of writing of one with no event named",
    At(list, L.EVENT_FISHING_EXTRAVAGANZA) < At(list, L.EVENT_HARVEST_FESTIVAL)
    and At(list, L.EVENT_HARVEST_FESTIVAL) < At(list, L.EVENT_WINTER_VEIL)
    and At(list, L.EVENT_WINTER_VEIL) < At(list, KindRow("events").row.label), true)
Expect("...each a line, closed", RowFor(L.EVENT_WINTER_VEIL).row.style .. "|" .. tostring(RowFor(L.EVENT_WINTER_VEIL).row.open),
    "group|false")
Click(L.EVENT_WINTER_VEIL)
Expect("...opening on its writings, the Winter Veil feast it once listed in the cities among them",
    Has(Shown(), "The Feast of Winter Veil") and Has(Shown(), "Metzen's Letters and Notes"), true)
Expect("...its page named for the event, in Holidays and Events, with its count", panel.page.title.text .. "|"
    .. panel.page.sub.text.text, L.EVENT_WINTER_VEIL .. "|" .. L.GROUP_EVENTS .. " · 0 of 2 found")
SpokenReadablesSettings.unlockUnfound = true
B:RefreshReadables()
Click("The Feast of Winter Veil")
SpokenReadablesSettings.unlockUnfound = false
Click(L.EVENT_WINTER_VEIL)
OpenKinds("events")
Expect("...one whose event the data does not name under its kind of writing, as before",
    Has(Shown(), "A Bloodstained Envelope"), true)
OpenKinds("events")
Click(L.GROUP_EVENTS)

-- The zones on no continent, then the battlegrounds wherever the client hangs them, each under a
-- banner of their own after the continents.
list = Shown()
Expect("Other Lands then Battlegrounds, each a banner, after the continents and before the groups",
    RowFor(L.GROUP_LANDS).row.style == "banner" and RowFor(L.GROUP_BATTLEGROUNDS).row.style == "banner"
    and At(list, "Kalimdor") < At(list, L.GROUP_LANDS) and At(list, L.GROUP_LANDS) < At(list, L.GROUP_BATTLEGROUNDS)
    and At(list, L.GROUP_BATTLEGROUNDS) < At(list, L.GROUP_EVENTS), true)
Expect("...closed at first", Has(list, "Zephras Isle") or Has(list, "Alterac Valley"), false)
Expect("...a battleground hung under a continent not listed under it", Has(list, "Warsong Gulch"), false)
Click(L.GROUP_LANDS)
Expect("Other Lands opens on a line for each zone on no continent", RowFor("Zephras Isle") ~= nil
    and RowFor("Zephras Isle").row.style == "group" and RowFor("Zephras Isle").row.nest, 0)
Expect("...its page its name, in Azeroth as a continent is, what is found of it, and no words",
    panel.page.title.text .. "|" .. panel.page.sub.text.text .. "|" .. panel.page.body.text.text,
    L.GROUP_LANDS .. "|" .. L.READABLES_IN_FMT:format("Azeroth") .. " · " .. L.FOUND_FMT:format(0, 1) .. "|")
Expect("...and the mark where the words would be", panel.page.mark:IsShown(), true)
Click(L.GROUP_LANDS)
Expect("...and closes again", Has(Shown(), "Zephras Isle"), false)
Click(L.GROUP_BATTLEGROUNDS)
Expect("Battlegrounds opens on Alterac Valley under Azeroth and Warsong Gulch under Ashenvale",
    Has(Shown(), "Alterac Valley") and Has(Shown(), "Warsong Gulch"), true)
Expect("...its page its name", panel.page.title.text, L.GROUP_BATTLEGROUNDS)
Click("Alterac Valley")
Click(L.TYPE_GRAVE)
Expect("...Alterac Valley's gravestone listed in it", Has(Shown(), "Rock of Durotan"), true)
Click(L.TYPE_GRAVE)
Click("Alterac Valley")
do
    local getMapInfo = _G.C_Map.GetMapInfo
    _G.C_Map.GetMapInfo = function(id) if id ~= 1460 then return getMapInfo(id) end end
    B:RefreshReadables()
    Expect("...not a battleground the client has never heard of", Has(Shown(), "Alterac Valley")
        and not Has(Shown(), "1460") and not Has(Shown(), "Warsong Gulch"), true)
    _G.C_Map.GetMapInfo = getMapInfo
    B:RefreshReadables()
end
Click(L.GROUP_BATTLEGROUNDS)

-- A readable in a city and in the zone around it (a book shelved in Ironforge and Dun Morogh) is
-- listed once, in the city: the zone's card counts the rows under it, its dungeon's (Gnomeregan's)
-- included.
do
    Click("Dun Morogh")
    Click("Ironforge")
    local function Closed()
        Shown()
        for _, row in ipairs(rows) do
            if row.shown ~= false and row.row and (row.row.kind == "group" or row.row.kind == "dungeon") and (row.row.mapID == 1426
                or row.row.mapID == 1455) and not row.row.open then return row end
        end
    end
    for _ = 1, 40 do
        local row = Closed()
        if not row then break end
        row.scripts.OnClick(row)
    end
    local leaves, inside, twice = 0, false, 0
    for _, row in ipairs(rows) do
        if row.shown ~= false and row.row then
            if row.row.label == "Dun Morogh" then inside = true
            elseif inside and row.row.nest == 0 then inside = false end
            if inside and row.row.leaf then leaves = leaves + 1 end
            if row.row.book == 1976 then twice = twice + 1 end
        end
    end
    Expect("a readable in a city and in the zone around it is listed once, in the city", twice, 1)
    Expect("...so the zone's card counts the rows under it", leaves, RowFor("Dun Morogh").row.total)
    Click("Ironforge")
    Click("Dun Morogh")
end

-- What is had inside a dungeon or a raid is under its card, in the zone of its entrance, as the
-- Quests tab files the dungeon's quests: a zone with one dungeon has its card, a zone with several
-- a Dungeons and Raids line holding a card for each.
do
    -- The row labelled `label` whose item passes `test`.
    local function RowWhere(label, test)
        Shown()
        for _, row in ipairs(rows) do
            if row.shown ~= false and row.row and row.row.label == label and test(row.row) then return row end
        end
    end
    local function KindIn(label, mapID, dungeon)
        return RowWhere(label, function(item) return item.kind == "group" and item.mapID == mapID and item.dungeon == dungeon end)
    end
    local function Press(row)
        assert(row, "no such row")
        row.scripts.OnClick(row)
    end
    Click("Cragmoor")
    list = Shown()
    Expect("a zone with several dungeons: a Dungeons and Raids line after the city, before its kinds of writing",
        RowFor(L.GROUP_DUNGEONS) ~= nil and RowFor(L.GROUP_DUNGEONS).row.style == "group"
        and RowFor(L.GROUP_DUNGEONS).row.nest == 1 and At(list, L.GROUP_DUNGEONS) < At(list, L.TYPE_PLAQUE), true)
    Expect("...closed at first, without a picture", RowFor(L.GROUP_DUNGEONS).row.open == false
        and not Has(list, "Hollow Vault") and not (RowFor(L.GROUP_DUNGEONS).icon and RowFor(L.GROUP_DUNGEONS).icon:IsShown()), true)
    Expect("...what is had inside them gone from the zone's own kinds", KindIn(L.TYPE_NOTE, 9004) == nil
        and KindIn(L.TYPE_TABLET, 9004) == nil and KindIn(L.TYPE_PLAQUE, 9004) ~= nil, true)
    Expect("...the zone's card counting them still", RowFor("Cragmoor").row.total, 4)
    Click(L.GROUP_DUNGEONS)
    list = Shown()
    Expect("...opened, a line for each dungeon by name", At(list, "Ember Halls") ~= nil
        and At(list, "Ember Halls") < At(list, "Hollow Vault") and RowFor("Hollow Vault").row.style == "group"
        and RowFor("Hollow Vault").row.nest, 2)
    Expect("...the line's page its name in the zone, with what is found of it", panel.page.title.text .. "|"
        .. panel.page.sub.text.text, L.GROUP_DUNGEONS .. "|" .. L.READABLES_IN_FMT:format("Cragmoor") .. " · "
        .. L.FOUND_FMT:format(0, 2))
    Click("Hollow Vault")
    Expect("a dungeon's card opens on its kinds of writing, closed", KindIn(L.TYPE_NOTE, 9004, 9101) ~= nil
        and KindIn(L.TYPE_NOTE, 9004, 9101).row.nest == 3 and not Has(Shown(), "Vault Ledger"), true)
    Expect("...its page in the zone of its entrance", panel.page.title.text .. "|" .. panel.page.sub.text.text,
        "Hollow Vault|" .. L.READABLES_IN_FMT:format("Cragmoor") .. " · " .. L.FOUND_FMT:format(0, 1))
    Expect("...chosen, its card alone marked", RowFor("Hollow Vault").selected == true
        and RowFor("Cragmoor").selected == false and RowFor(L.GROUP_DUNGEONS).selected == false, true)
    Press(KindIn(L.TYPE_NOTE, 9004, 9101))
    Expect("...a kind opening on its writings", Has(Shown(), "Vault Ledger") and RowFor("Vault Ledger").row.nest, 4)
    Expect("...its page in the dungeon", panel.page.sub.text.text, L.READABLES_IN_FMT:format("Hollow Vault") .. " · "
        .. L.FOUND_FMT:format(0, 1))
    Press(KindIn(L.TYPE_NOTE, 9004, 9101))
    Expect("...and closing again", Has(Shown(), "Vault Ledger"), false)
    Click("Hollow Vault")
    Expect("...the card closing on a click", Has(Shown(), "Hollow Vault") and KindIn(L.TYPE_NOTE, 9004, 9101) == nil, true)

    Click("Fenwatch")
    Expect("a zone with one dungeon has the dungeon's own line, no Dungeons and Raids line", RowFor("Sunken Crypt") ~= nil
        and RowFor("Sunken Crypt").row.style == "group" and RowFor("Sunken Crypt").row.nest == 1
        and RowWhere(L.GROUP_DUNGEONS, function(item) return item.mapID == 9005 end) == nil, true)
    Click("Sunken Crypt")
    Press(KindIn(L.TYPE_GRAVE, 9005, 9103))
    Press(KindIn(L.TYPE_GRAVE, 9004))
    local twice = 0
    for _, row in ipairs(rows) do
        if row.shown ~= false and row.row and row.row.book == EPITAPH then twice = twice + 1 end
    end
    Expect("a readable had in a dungeon and outside it in another zone is listed in each", twice, 2)
    Press(KindIn(L.TYPE_GRAVE, 9004))
    Press(KindIn(L.TYPE_GRAVE, 9005, 9103))
    Click("Sunken Crypt")
    Click("Fenwatch")

    -- The search: a dungeon named lists all it holds; a title inside one is found under its card.
    local box
    for _, child in ipairs(panel.children or {}) do if child.template == "SearchBoxTemplate" then box = child end end
    local function Find(text)
        box:SetText(text)
        box.hooks.OnTextChanged[1](box)
        return Shown()
    end
    list = Find("hollow vault")
    Expect("a search naming a dungeon lists all it holds, under its zone and its line",
        Has(list, "Cragmoor") and Has(list, L.GROUP_DUNGEONS) and Has(list, "Vault Ledger") and not Has(list, "Ember Rune")
        and RowFor("Hollow Vault").row.open, true)
    list = Find("ember rune")
    Expect("...a title inside one found under its card", At(list, "Cragmoor") < At(list, "Ember Halls")
        and At(list, "Ember Halls") < At(list, "Ember Rune") and not Has(list, "Hollow Vault"), true)
    Click("Ember Halls")
    Expect("...the card the search opened closing on a click", Has(Shown(), "Ember Halls")
        and not Has(Shown(), "Ember Rune"), true)
    list = Find("blackrock depths")
    Expect("...the shipped nameplates under Blackrock Depths", Has(list, "Blackrock Depths")
        and Has(list, "Dark Keeper Nameplate (1)"), true)
    Find("")

    -- Found Only and Voiced Only leave out a dungeon with nothing found or voiced, as a zone.
    SpokenReadablesCharacter.found[LEDGER] = true
    SpokenReadablesSettings.compendiumFoundOnly = true
    B:RefreshReadables()
    list = Shown()
    Expect("Found Only keeps a dungeon with something found and leaves out one with nothing",
        Has(list, "Hollow Vault") and not Has(list, "Ember Halls"), true)
    SpokenReadablesSettings.compendiumFoundOnly = false
    local hasAudio = B.HasAudio
    B.HasAudio = function(_, p) return p == RUNE end
    SpokenReadablesSettings.compendiumVoicedOnly = true
    B:RefreshReadables()
    list = Shown()
    Expect("...Voiced Only one with nothing voiced", Has(list, "Ember Halls") and not Has(list, "Hollow Vault"), true)
    SpokenReadablesSettings.compendiumVoicedOnly = false
    B.HasAudio = hasAudio
    SpokenReadablesCharacter.found[LEDGER] = nil
    Click(L.GROUP_DUNGEONS)
    Click("Cragmoor")
    B:RefreshReadables()
    Expect("a zone's page has the seal and no picture", panel.page.mark:IsShown()
        and not panel.page.body.picture:IsShown(), true)
    list = Shown()
end

Click("Westfall")
Click("Elwynn Forest")
Expect("a click on a second zone's card opens it beside the first, both open",
    RowFor("Westfall").row.open and RowFor("Elwynn Forest").row.open and Has(Shown(), L.TYPE_LETTER)
    and Has(Shown(), "Stormwind City"), true)
Click("Westfall")
Expect("...and a click on one closes it alone", tostring(RowFor("Westfall").row.open) .. "|"
    .. tostring(RowFor("Elwynn Forest").row.open), "false|true")
Click("Stormwind City")
list = Shown()
Expect("a city's page in the zone around it, with what is found of it",
    panel.page.sub.text.text:find(L.READABLES_IN_FMT:format("Elwynn Forest") .. " · 1 of ", 1, true), 1)
Expect("the city opens inside its zone, its readables by what they are", Has(list, L.TYPE_PLAQUE), true)
Expect("...the city a card inside its zone's card", RowFor("Stormwind City").row.nest, 1)
Expect("...each kind a line of the list inside the city's card, not a card", RowFor(L.TYPE_PLAQUE).row.nest == 2
    and RowFor(L.TYPE_PLAQUE).row.style, "group")
Expect("...with its plus or minus and no picture", RowFor(L.TYPE_PLAQUE).toggle:IsShown()
    and not (RowFor(L.TYPE_PLAQUE).icon and RowFor(L.TYPE_PLAQUE).icon:IsShown()), true)
Expect("...closed, as Quests' chains start", RowFor(L.TYPE_PLAQUE).row.open or Has(list, "Kurdran Wildhammer"), false)
Click(L.TYPE_PLAQUE)
Expect("...its page in the place that holds it", panel.page.sub.text.text:find(L.READABLES_IN_FMT:format("Stormwind City") .. " · ", 1, true), 1)
Expect("...opened by a click on its writings", RowFor(L.TYPE_PLAQUE).row.open and Has(Shown(), "Kurdran Wildhammer"), true)
Expect("...its writings rows inside that", RowFor("Kurdran Wildhammer").row.leaf and RowFor("Kurdran Wildhammer").row.nest, 3)
Expect("...a line down each open card's contents beside them, a step in from the banner",
    RowFor("Kurdran Wildhammer").rails[3] ~= nil
    and RowFor("Kurdran Wildhammer").rails[3]:IsShown() and RowFor("Kurdran Wildhammer").rails[3].anchor.x, 64.4)
Expect("...a readable not found greyed, with the padlock", RowFor("Ranger Captain Alleria Windrunner").row.locked, true)
Expect("...one found open to read", RowFor("Kurdran Wildhammer").row.locked, false)
do
    local row = RowFor("Kurdran Wildhammer")
    Expect("...its name clear of the tick at the row's end", row.label.anchor.point == "RIGHT" and row.label.anchor.x, -28)
    GameTooltip.text, GameTooltip.owner = nil, nil
    row.scripts.OnEnter(row)
    row.scripts.OnLeave(row)
    Expect("...a name shown whole has no tooltip", GameTooltip.text, nil)
    row.label.IsTruncated = function() return true end
    row.scripts.OnEnter(row)
    Expect("...a name cut short shows whole in a tooltip under the pointer", GameTooltip.owner == row
        and GameTooltip:IsShown() and GameTooltip.text, "Kurdran Wildhammer")
    row.scripts.OnLeave(row)
    Expect("...gone when the pointer leaves", GameTooltip:IsShown(), false)
    row.label.IsTruncated = nil
end

Click("Kurdran Wildhammer")
local page = panel.page
Expect("a readable's page: its title", page.title.text, "Kurdran Wildhammer")
Expect("...in the spellbook's ink, as the places' page is", page.body.ink and page.body.ink[1], 0.2)
Expect("...where it is", page.sub.text.text, L.READABLES_IN_FMT:format("Stormwind City"))
Expect("...on one line", page.sub.text.wordWrap, false)
Expect("...no line before its words saying it is in the world", (page.body.text.text or ""):find("In the World", 1, true), nil)
Expect("...and its words", page.body.text.text ~= nil and #page.body.text.text > 40, true)
-- A page that names its reader shows this character's name, class and gender word, as in the game.
do
    local kurdranPage = SpokenReadablesData.books[KURDRAN].pages[1]
    local words = SpokenReadablesData.pages[kurdranPage].text
    SpokenReadablesData.pages[kurdranPage].text = "Greetings, $gbrother:sister;. You, $N the $c, are ready."
    stub.world.playerName, stub.world.playerClass, stub.world.unitSex = "Torno", "Warrior", 3
    B:ShowReadables(KURDRAN)
    Expect("...a page's tokens filled in for this character", page.body.text.text,
        "Greetings, sister. You, Torno the Warrior, are ready.")
    SpokenReadablesData.pages[kurdranPage].text = words
    stub.world.playerName, stub.world.playerClass, stub.world.unitSex = nil, nil, 2
    B:ShowReadables(KURDRAN)
end
-- On a client in another language, a page is in that language where Spoken has its words: a pack in
-- the client's language, or the page as the client showed it.
do
    local first = SpokenReadablesData.books[KURDRAN].pages[1]
    local packs, locale, kept, titles = _G.SpokenReadablesAudioPacks, _G.GetLocale, B.pageText, B.bookTitle
    _G.GetLocale = function() return "esES" end
    _G.SpokenReadablesAudioPacks = { SpokenReadablesAudio_esES = { version = 1, language = "esES",
        pages = { [first] = { file = tostring(first), len = 2, text = "Palabras de Kurdran." } },
        index = { ["Saludo de Kurdran"] = { [1] = { x = first } } } } }
    B:ShowReadables(KURDRAN)
    Expect("...on a Spanish client, a page a Spanish pack has words for is in Spanish",
        page.body.text.text:sub(1, 20), "Palabras de Kurdran.")
    Expect("...under the title the pack's index gives it", page.title.text, "Saludo de Kurdran")
    _G.SpokenReadablesAudioPacks = {}
    B:RememberPageText(first, "esES", "Palabras vistas.", "Kurdran visto")
    B:ShowReadables(KURDRAN)
    Expect("...and a page the client showed is in the words it showed", page.body.text.text:sub(1, 16),
        "Palabras vistas.")
    Expect("...under the title it showed", page.title.text, "Kurdran visto")
    _G.SpokenReadablesAudioPacks, _G.GetLocale, B.pageText, B.bookTitle = packs, locale, kept, titles
    B:ShowReadables(KURDRAN)
end
-- Opened on a writing from elsewhere (Open in Azeroth's Compendium): chosen, with what holds it
-- opened, though the zone and its kind were closed.
Click("Stormwind City")
B:ShowReadables(KURDRAN)
Expect("opened on a writing, it is chosen, its row shown with what holds it opened",
    page.title.text .. "|" .. tostring(RowFor("Kurdran Wildhammer") and RowFor("Kurdran Wildhammer").selected), "Kurdran Wildhammer|true")
Expect("the Compendium shows a found writing's page, not one not found",
    tostring(B:CompendiumHas(KURDRAN)) .. "|" .. tostring(B:CompendiumHas(ALLERIA)), "true|false")
SpokenReadablesSettings.unlockUnfound = true
Expect("...or any with Unlock Unfound Readables on", B:CompendiumHas(ALLERIA), true)
SpokenReadablesSettings.unlockUnfound = false
-- The line under the title is plain words, as on Quests and Places.
Expect("a page's line under its title is not a link", page.sub.onClick, nil)
Click("Kurdran Wildhammer")
Click("Ranger Captain Alleria Windrunner")
Expect("a readable not found does not open", page.title.text, "Kurdran Wildhammer")

SpokenReadablesSettings.unlockUnfound = true
B:RefreshReadables()
Expect("Unlock Unfound Readables opens it", RowFor("Ranger Captain Alleria Windrunner").row.locked, false)
-- Opening one is not finding it: the counts stay what the character has found.
local before = RowFor("Stormwind City").count.text
Click("Ranger Captain Alleria Windrunner")
Expect("...and choosing it leaves the counts as they were", RowFor("Stormwind City").count.text, before)
SpokenReadablesSettings.unlockUnfound = false

SpokenReadablesCharacter.found[LETTER] = true
-- Stormwind City and Elwynn Forest closed, so the first Letters listed are Westfall's.
Click("Stormwind City")
Click("Elwynn Forest")
Click("Westfall")
Click(L.TYPE_LETTER)
Click("A Dusty Unsent Letter")
Expect("opened on a readable carried from a zone", page.title.text, "A Dusty Unsent Letter")
Expect("...in the zone it is had in", page.sub.text.text, L.READABLES_IN_FMT:format("Westfall"))
Expect("...its words alone, with nothing on how it is had", #page.body.text.text > 40, true)

-- The search: every match, with what holds it, opened.
local box
for _, child in ipairs(panel.children or {}) do if child.template == "SearchBoxTemplate" then box = child end end
box:SetText("cookbook")
box.hooks.OnTextChanged[1](box)
list = Shown()
Expect("a search shows what matches, under what holds it", Has(list, L.GROUP_WIDE) and Has(list, "An Exotic Cookbook")
    and not Has(list, "Kurdran Wildhammer"), true)
local function Search(text)
    box:SetText(text)
    box.hooks.OnTextChanged[1](box)
    return Shown()
end
-- A search naming what holds readables lists all it holds, the titles matching or not.
list = Search("alterac")
Expect("a search naming a zone lists all it holds, its card open", Has(list, "Rock of Durotan")
    and RowFor("Alterac Valley").row.open, true)
list = Search(L.TYPE_GRAVE:lower())
Expect("...naming a kind, every one of that kind", Has(list, "Rock of Durotan") and not Has(list, "Kurdran Wildhammer"), true)
list = Search(L.GROUP_LANDS:lower())
Expect("...naming Other Lands, its zones' cards, closed", Has(list, "Zephras Isle") and not Has(list, "Isle Tide Tables"), true)
Click("Zephras Isle")
Expect("...a zone among them opening on a click, as unsearched: on its kinds' cards, closed",
    Has(Shown(), L.TYPE_NOTE) and not Has(Shown(), "Isle Tide Tables"), true)
Click(L.TYPE_NOTE)
Expect("...each opening on a click", Has(Shown(), "Isle Tide Tables"), true)
Click(L.TYPE_NOTE)
Click("Zephras Isle")
list = Search(L.GROUP_WIDE:lower())
Expect("...naming a group, its kinds' cards, closed as a banner's cards are", Has(list, L.TYPE_BOOK)
    and not Has(list, "An Exotic Cookbook"), true)
Expect("...a title in a group still found inside its kind, opened", Has(Search("exotic cookbook"), "An Exotic Cookbook"), true)
Click(L.TYPE_BOOK)
Expect("...a click on the kind the search opened closes it", Has(Shown(), L.TYPE_BOOK)
    and not Has(Shown(), "An Exotic Cookbook"), true)
Click(L.TYPE_BOOK)
Expect("...and another opens it again", Has(Shown(), "An Exotic Cookbook"), true)
list = Search("alterac")
Click("Alterac Valley")
Expect("...a zone the search opened closing on a click", Has(Shown(), "Alterac Valley")
    and not Has(Shown(), "Rock of Durotan"), true)
Expect("...and a new search opening all it finds again", Has(Search("alterac v"), "Rock of Durotan"), true)
list = Search("eastern kingdoms")
Expect("...naming a continent, its zones' cards, closed", Has(list, "Westfall") and not Has(list, "Kurdran Wildhammer")
    and not Has(list, "Rock of Durotan"), true)
Click("Westfall")
Expect("...a card in it chosen, its page shows", page.title.text, "Westfall")
Click("Westfall")
list = Search("dark keeper nameplate")
Expect("readables sharing a title are numbered in id order, so no two rows read the same",
    Has(list, "Dark Keeper Nameplate (1)") and Has(list, "Dark Keeper Nameplate (6)")
    and not Has(list, "Dark Keeper Nameplate") and RowFor("Dark Keeper Nameplate (2)").row.book, 1432)
SpokenReadablesSettings.unlockUnfound = true
B:RefreshReadables()
Click("Dark Keeper Nameplate (2)")
Expect("...and so is its page's title", page.title.text, "Dark Keeper Nameplate (2)")
Search("civil war in the plaguelands")
Click("Civil War in the Plaguelands")
Expect("a readable in many zones: the line under its title names the first two and counts the rest",
    page.sub.text.text, L.READABLES_IN_FMT:format("Map 1420, Map 1423") .. L.READABLES_MORE_FMT:format(5))
SpokenReadablesSettings.unlockUnfound = false
Search("")

-- Found Only: the readables not found, and what holds none found, left out.
SpokenReadablesSettings.compendiumFoundOnly = true
B:RefreshReadables()
list = Shown()
Expect("Found Only leaves out what is not found", Has(list, "Ranger Captain Alleria Windrunner") or Has(list, L.GROUP_UNKNOWN), false)
Expect("...Other Lands' and Battlegrounds' banners too, holding nothing found",
    Has(list, L.GROUP_LANDS) or Has(list, L.GROUP_BATTLEGROUNDS), false)
Expect("...and keeps what is", Has(list, "Westfall") and Has(list, "Elwynn Forest"), true)
SpokenReadablesSettings.compendiumFoundOnly = false

-- Opening one in the world finds it, and the tab open meanwhile says so at once.
Click("Elwynn Forest")
Click("Stormwind City")
local function Counted(text) return tonumber(text:match("^(%d+)/")) end
local cardBefore, pageBefore = Counted(RowFor("Stormwind City").count.text), panel.page.sub.text.text
B:MarkBookFound(ALLERIA)
Expect("a readable found while the tab is open opens at once", RowFor("Ranger Captain Alleria Windrunner").row.locked, false)
Expect("...ticked", RowFor("Ranger Captain Alleria Windrunner").row.done, true)
Expect("...counted on its zone's card", Counted(RowFor("Stormwind City").count.text), cardBefore + 1)
Expect("...and on the page", panel.page.sub.text.text ~= pageBefore and panel.page.sub.text.text:find(tostring(cardBefore + 1), 1, true) ~= nil, true)

-- The type it is listed under closes and opens again, as the zone does.
local typeRow
do
    Shown()
    for _, row in ipairs(rows) do
        if row.shown ~= false and row.row and row.row.kind == "group" and row.row.mapID then typeRow = row.label.text end
        if row.row and row.label.text == "Ranger Captain Alleria Windrunner" then break end
    end
end
Expect("a zone's readables are under a card for their kind, open", typeRow ~= nil and RowFor(typeRow).row.open, true)
Click(typeRow)
Expect("...a click closes the type", Has(Shown(), "Ranger Captain Alleria Windrunner") or RowFor(typeRow).row.open, false)
Click(typeRow)
Expect("...and another opens it again", Has(Shown(), "Ranger Captain Alleria Windrunner") and RowFor(typeRow).row.open, true)

-- The filter menu beside the search box, as the spellbook's: Found Only, then By Zone or By Type
-- under a divider. By Type is the types alone.
local function Menu()
    local entries = {}
    for _, info in ipairs(stub.OpenDropdown(panel.filterMenu)) do
        table.insert(entries, info.isSeparator and "--" or info.text)
    end
    return table.concat(entries, "|"), stub.OpenDropdown(panel.filterMenu)
end
Expect("the filter menu holds Found Only and Voiced Only, then By Zone and By Type", (Menu()),
    L.READABLES_FOUND_ONLY .. "|" .. L.READABLES_VOICED_ONLY .. "|--|" .. L.READABLES_BY_ZONE .. "|" .. L.READABLES_BY_TYPE)
local _, choices = Menu()
Expect("...By Zone the one chosen", choices[4].checked and not choices[5].checked, true)

-- Voiced Only: what no installed voice pack reads is left out, with what holds nothing else.
local hasAudio = B.HasAudio
local alleriaPage = B:Data().books[ALLERIA].pages[1]
B.HasAudio = function(_, page) return page == alleriaPage end
Click("Kurdran Wildhammer")
Expect("a readable's page has a round portrait left of the title, with the book badge",
    panel.page.headFace.speaker.bullet == "book" and panel.page.shift > 0, true)
choices[2].func()
list = Shown()
local chosen
for _, row in ipairs(rows) do if row.shown ~= false and row.row and row.selected then chosen = row.row.label end end
Expect("Voiced Only leaving out the writing chosen chooses the nearest row above it still listed",
    chosen ~= nil and chosen ~= "Kurdran Wildhammer" and chosen == panel.page.title.text, true)
Expect("Voiced Only leaves out what has no recording", Has(list, "Kurdran Wildhammer") or Has(list, "Westfall"), false)
Expect("...and keeps what has one, with the zone that holds it", Has(list, "Ranger Captain Alleria Windrunner")
    and Has(list, "Elwynn Forest"), true)
Expect("...counting only what it lists", RowFor("Elwynn Forest").count.text, "1/1")
Expect("...and is remembered", SpokenReadablesSettings.compendiumVoicedOnly, true)
_, choices = Menu()
choices[2].func()
Expect("...off, everything again", Has(Shown(), "Westfall"), true)

-- Report on a readable's page, in the heading's corner with Play beside it, as the places' page.
page:Show({ title = "Ranger Captain Alleria Windrunner", target = ALLERIA })
Expect("a voiced readable's page has Report", page.report ~= nil and page.report:IsShown(), true)
Expect("...in the corner, Play to its left", select(2, page.play:GetPoint(1)) == page.report, true)
-- 36 is the text's right inset on the page: the view's right edge, where the scroll bar stands.
Expect("...the corner at the scroll bar's right edge",
    page.report.anchor.point .. " " .. page.report.anchor.x, "TOPRIGHT " .. -36)
-- A page with no Report (a tab that has none to give) still places Play in the corner: the buttons
-- are lined up without a hole where Report would be.
do
    local report = page.report
    page.report = nil
    page.play.anchor = nil
    page:Show({ title = "Ranger Captain Alleria Windrunner", target = ALLERIA })
    Expect("a page with no Report puts Play in the heading's corner", page.play.anchor ~= nil and page.play.anchor.point, "TOPRIGHT")
    page.report = report
    page:Show({ title = "Ranger Captain Alleria Windrunner", target = ALLERIA })
end
do
    local unsnapped
    local unsnap = SpokenTextView.Unsnap
    SpokenTextView.Unsnap = function(texture) unsnapped = unsnapped or texture end
    local fresh = _G.SpokenCompendium.NewPage(CreateFrame("Frame"), B)
    SpokenTextView.Unsnap = unsnap
    Expect("a page's parchment drawn off the pixel grid, as the fade cut from it is", unsnapped ~= nil and unsnapped == fresh.bg, true)

    -- The shared frame that looks at the models is made when the first one is shown, and is told a frame has
    -- passed through its OnUpdate.
    local watcher
    do
        local made, create = {}, _G.CreateFrame
        _G.CreateFrame = function(...)
            local f = create(...)
            made[#made + 1] = f
            return f
        end
        fresh:Show({ title = "Edwin VanCleef", model = { displayID = 2029 }, text = "A boss's story." })
        _G.CreateFrame = create
        for _, f in ipairs(made) do
            if f.scripts.OnUpdate then watcher = f end
        end
    end
    local function Tick(elapsed) watcher.scripts.OnUpdate(watcher, elapsed or 0.2) end
    Expect("a page can show a 3D model above its words",
        fresh.body.model:IsShown() and fresh.body.model.frameType == "ModelScene", true)
    Expect("...in a scene that leaves the mouse wheel to the page", fresh.body.model.mouseEnabled, false)
    Expect("...at the compact model size, a quarter wider than tall", fresh.body.model.width .. "x" .. fresh.body.model.height, "275x220")
    Expect("...with the same top spacing as a zone image", fresh.body.model.anchor.y, -8)
    local actor = fresh.body.modelActor
    Expect("...drawn by one actor from the model display ID", actor and actor.displayID .. "|" .. #fresh.body.model.actors .. "|"
        .. tostring(actor:IsShown()), "2029|1|true")
    Expect("...its feet at the scene's origin, its front to the camera, not centred on its middle",
        table.concat(actor.position, ",") .. "|" .. actor.yaw .. "|" .. table.concat({ tostring(actor.useCenter[1]),
        tostring(actor.useCenter[2]), tostring(actor.useCenter[3]) }, ","), "0,0,0|0|false,false,false")
    fresh:Show({ title = "Edwin VanCleef", model = { displayID = 2030 }, text = "A boss's story." })
    Expect("...the same actor drawing the next boss", #fresh.body.model.actors .. "|" .. actor.displayID, "1|2030")
    fresh:Show({ title = "Edwin VanCleef", model = { displayID = 2029, scale = 1.5 }, text = "A boss's story." })
    Expect("...at the scale the model asks for", actor.scale, 1.5)
    fresh:Show({ title = "Edwin VanCleef", model = { creatureID = 196 }, text = "A boss's story." })
    Expect("a model with no display ID is no model: a scene draws a display and nothing else",
        tostring(fresh.body.modelDisplayID) .. "|" .. tostring(fresh.body.model:IsShown()) .. "|" .. tostring(actor.displayID), "nil|false|nil")
    fresh:Show({ title = "Edwin VanCleef", model = { displayID = 2029 }, text = "A boss's story." })

    -- A boss gets a light of its own, so it does not come up almost black.
    local light = fresh.body.model.light
    Expect("...lit by a directional light of its own", light.visible == true and light.type == 0
        and light.direction[1] < 0 and light.diffuse[1] == 0.66 and light.ambient[1] == 0.8, true)
    -- Alone, so no model is ranked beside it.
    fresh.body:SetModel(nil)
    local refusing = _G.SpokenCompendium.NewPage(CreateFrame("Frame"), B)
    refusing.body.model.SetLightVisible = function() error("no light on this client") end
    local said, speak = nil, _G.print
    _G.print = function(...) said = (said or "") .. table.concat({ ... }, " ") end
    refusing:Show({ title = "Edwin VanCleef", model = { displayID = 2029 }, text = "A boss's story." })
    _G.print = speak
    Expect("...a client that refuses the light still shows the model, and says so once",
        tostring(refusing.body.model:IsShown()) .. "|" .. tostring(refusing.body.modelActor and refusing.body.modelActor.displayID)
        .. "|" .. tostring(said and said:find("no light on this client", 1, true) ~= nil), "true|2029|true")
    refusing.body:SetModel(nil)
    fresh:Show({ title = "Edwin VanCleef", model = { displayID = 2029 }, text = "A boss's story." })
    Expect("...the whole body, standing", actor.animation, 0)
    actor.animation = "still playing"
    fresh:Show({ title = "Edwin VanCleef", model = { displayID = 2029 }, text = "A boss's story." })
    Expect("...left playing when the page is shown again", actor.animation, "still playing")
    actor.animation = 0
    -- On a page narrower than 275 the whole frame shrinks, keeping the shape bosses are framed for.
    local body = fresh.body
    local wide = body.frame:GetWidth()
    body.frame:SetWidth(200 + body:BarRoom())
    fresh:Show({ title = "Edwin VanCleef", model = { displayID = 2029 }, text = "A boss's story." })
    Expect("...on a narrower page the frame shrinks whole, still a quarter wider than tall",
        body.model.width .. "x" .. body.model.height, "200x160")
    body.frame:SetWidth(wide)

    -- The brown backing and the frayed edge are drawn together, where the page has a picture to cut the edge from.
    local function Drawn() return tostring(body.modelShade:IsShown()) .. " " .. tostring(body.modelEdge:IsShown()) end
    fresh:Show({ title = "Edwin VanCleef", model = { displayID = 2029 }, text = "A boss's story." })
    body:SetFadeSource(fresh.bg, [[Interface\AddOns\Spoken\Textures\Test]], { 0, 1, 0, 1 })
    Expect("a model on a page with a picture has its edge and the backing", Drawn(), "true true")
    body:SetFadeShown(false)
    Expect("...both off while the page's fade layers are held off", Drawn(), "false false")
    body:SetFadeShown(true)
    Expect("...and back when they are let on", Drawn(), "true true")
    body:SetFadeColors({ 1, 1, 1 }, { 1, 1, 1 })
    Expect("...neither on a page with only colours, such as EllesmereUI's look", Drawn(), "false false")
    body:SetFadeSource(fresh.bg, [[Interface\AddOns\Spoken\Textures\Test]], { 0, 1, 0, 1 })

    -- The edge is cut again for a new scroll position, not for the same one, nor out of sight.
    body.frame:SetHeight(300)
    body.child:SetHeight(5000)
    local cuts = 0
    local setCoord = body.modelEdge.SetTexCoord
    body.modelEdge.SetTexCoord = function(...) cuts = cuts + 1; return setCoord(...) end
    body.frame.scripts.OnVerticalScroll(body.frame)
    Expect("...not cut again for the scroll position it was cut at", cuts, 0)
    body.frame:SetVerticalScroll(30)
    body.frame.scripts.OnVerticalScroll(body.frame)
    body.frame.scripts.OnVerticalScroll(body.frame)
    Expect("...cut once for a new position", cuts, 1)
    body.frame:SetVerticalScroll(1000)
    body.frame.scripts.OnVerticalScroll(body.frame)
    Expect("...and not while the model is scrolled out of sight", cuts, 1)
    body.frame:SetVerticalScroll(0)

    -- A page made with noFace has the round portrait only for an entry that asks for it, and a one-line
    -- heading lets the name take two lines beside it.
    local small = _G.SpokenCompendium.NewPage(CreateFrame("Frame"), B, nil, nil, { noFace = true, oneLine = true })
    small:Show({ title = "Warlord Kalithresh", text = "A boss's story." })
    Expect("a page made with noFace makes no portrait for an entry without one", small.headFace == nil and small.shift, 0)
    Expect("...its one-line heading cut short, not wrapped", small.title.wordWrap, false)
    small:Show({ title = "Warlord Kalithresh", text = "A boss's story.", face = true })
    Expect("...makes it for an entry that asks", small.headFace ~= nil and small.face == small.headFace and small.shift > 0, true)
    Expect("...and the name may then wrap", small.title.wordWrap, true)
    small:Show({ title = "Hollow Vault", text = "Place lore." })
    Expect("...hidden again for an entry without", small.face == nil and small.headFace:IsShown() == false and small.shift == 0, true)
    Expect("...the heading on one line again", small.title.wordWrap, false)

    local made, said = 0, nil
    local create, speak = Spoken.CreateSpeakerFace, _G.print
    Spoken.CreateSpeakerFace = function() made = made + 1; error("no face") end
    _G.print = function(...) said = (said or "") .. table.concat({ ... }, " ") end
    local failing = _G.SpokenCompendium.NewPage(CreateFrame("Frame"), B, nil, nil, { noFace = true })
    failing:Show({ title = "A", text = "B", face = true })
    failing:Show({ title = "A", text = "B", face = true })
    Spoken.CreateSpeakerFace, _G.print = create, speak
    Expect("a portrait that fails to build is said once in chat and not tried again",
        made .. "|" .. tostring(failing.headFace) .. "|" .. tostring(said and said:find("no face", 1, true) ~= nil), "1|false|true")

    -- A boss is framed once its model has loaded, from the box its actor reports, and drawn through that
    -- camera moved by what was changed by hand for its place. The scene's units are the model's own, and
    -- the frame is 1.25 times as wide as tall, filled to 85 percent: the numbers are written out here so a
    -- change to them in TextView shows up.
    local scene = fresh.body.model
    local FIT, ASPECT, FOV = 0.85, 1.25, 27.78
    local function Span(fov) return 2 * math.tan(math.rad(fov) / 2) end
    -- How far the camera stands from the middle of a box `h` high and `w` wide, for the figure to fill FIT of
    -- the frame's height or of its width, whichever needs more.
    local function Reach(h, w, fov) return math.max(h / (FIT * Span(fov)), w / (FIT * ASPECT * Span(fov))) end
    local function Round(v) return math.floor(v * 10000 + 0.5) / 10000 + 0 end
    local BOX = { -0.5, -0.5, 0, 0.5, 0.5, 2 }
    -- The camera's distance from the target, for BOX: the figure's reach plus half its depth.
    local BASE = Reach(2, 1, FOV) + 0.5
    local function Look(dist)
        local c = scene.camera
        if not c.position then return nil end
        local p = c.position
        local cp = math.cos(c.pitch)
        local f = { cp * math.cos(c.yaw), cp * math.sin(c.yaw), math.sin(c.pitch) }
        return { p = p, t = { p[1] + f[1] * dist, p[2] + f[2] * dist, p[3] + f[3] * dist } }
    end
    local function Clear() scene.camera.position = nil end
    -- A boss shown anew: the page's model is cleared first, as it is when another boss was shown before it.
    local function Boss(id)
        fresh.body:SetModel(nil)
        fresh:Show({ title = "Edwin VanCleef", model = { displayID = id or 2029 }, text = "A boss's story." })
        Tick(0.02)
    end
    local function Near(a, b) return math.abs(a - b) < 1e-6 end
    local function At(point, x, y, z) return Near(point[1], x) and Near(point[2], y) and Near(point[3], z) end
    local function Position() return scene.camera.position and table.concat({ Round(scene.camera.position[1]),
        Round(scene.camera.position[2]), Round(scene.camera.position[3]) }, ",") end

    -- While the model loads there is nothing to frame: the scene is invisible, so the boss does not show in the
    -- wrong place first, and the shared frame looks at it every frame.
    stub.actorLoaded = false
    Clear()
    fresh:Show({ title = "Edwin VanCleef", model = { displayID = 2029 }, text = "A boss's story." })
    Expect("a boss whose model has not loaded is invisible and has no camera",
        tostring(scene:GetAlpha()) .. "|" .. tostring(scene.camera.position) .. "|" .. tostring(fresh.body.modelCamera), "0|nil|nil")
    Expect("...and the shared frame looks at it every frame", watcher:IsShown(), true)
    Tick(1)
    Tick(1.9)
    Expect("...still waiting 2.9 seconds on", tostring(scene:GetAlpha()) .. "|" .. tostring(scene.camera.position), "0|nil")
    stub.actorLoaded = true
    stub.actorBox = nil
    Tick(0.016)
    Expect("...a model that has loaded but has no box is waited for as well",
        tostring(scene:GetAlpha()) .. "|" .. tostring(scene.camera.position), "0|nil")
    stub.actorBox = BOX
    Tick(0.016)
    Expect("...framed on the frame after its box is known: drawn, through a camera",
        tostring(scene:GetAlpha()) .. "|" .. tostring(scene.camera.position ~= nil) .. "|" .. tostring(fresh.body.modelCamera ~= nil), "1|true|true")
    Expect("...and the shared frame rests with nothing left to look at", watcher:IsShown(), false)

    -- The frame: the camera on the +x side, where a model at yaw 0 has its front, looking back at the middle of the box.
    local seen = Look(BASE)
    Expect("a boss is looked at from the +x side, stood back from its box's middle by its reach and half its depth",
        At(seen.p, BASE, 0, 1), true)
    Expect("...a figure 2 high filling 85 percent of the frame's height from 4.757 away", Round(BASE - 0.5), 4.7575)
    Expect("...at the middle of its box", At(seen.t, 0, 0, 1), true)
    Expect("...turned to face it: yaw is the way the view points along the ground (pi, towards -x), pitch its slope, roll none",
        Near(scene.camera.yaw, math.pi) and Near(scene.camera.pitch, 0) and scene.camera.roll == 0, true)
    Expect("...with the lens its data was made for", Near(scene.camera.fov, math.rad(27.78)), true)
    Expect("...and far enough out for any boss", scene.camera.far, 500)
    Expect("...a row of the old per-boss camera data is ignored", (function()
        _G.SpokenBossCameras = { [2029] = { 50, 50, 50, 0, 0, 0 } }
        Boss()
        _G.SpokenBossCameras = nil
        return Position()
    end)(), Round(BASE) .. ",0,1")

    -- A wide box is held further back, until its width fills the frame; a box off the origin is looked at in the middle.
    stub.actorBox = { -1, -5, 0, 1, 5, 2 }
    Boss()
    seen = Look(Reach(2, 10, FOV) + 1)
    Expect("a figure wider than the frame is tall stands further back for its width, past half its depth",
        At(seen.p, Reach(2, 10, FOV) + 1, 0, 1) and Reach(2, 10, FOV) > Reach(2, 1, FOV) * 3, true)
    stub.actorBox = { 0, -1, 0.5, 2, 3, 3.5 }
    Boss()
    seen = Look(Reach(3, 4, FOV) + 1)
    Expect("a box off the origin is framed round its own middle", At(seen.p, 1 + Reach(3, 4, FOV) + 1, 1, 2) and At(seen.t, 1, 1, 2), true)
    Expect("...the width deciding for it, as the frame is wider than tall but this box is wider still",
        Reach(3, 4, FOV) > 3 / (FIT * Span(FOV)), true)
    stub.actorBox = BOX
    _G.SpokenBossCameraView = { fov = 90, sequence = 0 }
    Boss()
    Expect("a wider lens stands the camera nearer, a figure 2 high from 1.176 away",
        Near(scene.camera.position[1], Reach(2, 1, 90) + 0.5) and Round(Reach(2, 1, 90)) == 1.1765
        and Near(scene.camera.fov, math.pi / 2), true)
    _G.SpokenBossCameraView = { fov = "wide" }
    Boss()
    Expect("...the default lens where the data holds none that is a number", At(scene.camera.position, BASE, 0, 1)
        and Near(scene.camera.fov, math.rad(27.78)), true)
    _G.SpokenBossCameraView = nil

    -- A box with no height or width is no box, as a model's first answer may be: it is waited for, and framed as
    -- the plain one only when the wait runs out.
    stub.actorBox = { 0, 0, 0, 1, 1, 0 }
    Clear()
    Boss()
    Expect("a box with no height is waited for", tostring(scene.camera.position) .. "|" .. scene:GetAlpha(), "nil|0")
    stub.actorBox = { 0, 0, 0, 1, 0, 1 }
    Tick()
    Expect("...a box with no width as well", tostring(scene.camera.position), "nil")
    stub.actorBox = { 0, 0 / 0, 0, 1, 1, 1 }
    Tick()
    Expect("...a box with a number that is not one as well", tostring(scene.camera.position), "nil")
    Tick(3)
    Expect("...and then framed as the plain box", At(scene.camera.position, BASE, 0, 1), true)
    stub.actorBox = { 0, 0, 0, 0, 0, 0 }
    Clear()
    Boss()
    stub.actorBox = BOX
    Tick()
    Expect("...a box that fills in a frame later is framed from it", At(scene.camera.position, BASE, 0, 1), true)

    -- A model that has not loaded in 3 seconds is framed as the plain box, a person-sized figure, and shown.
    stub.actorBox = { -5, -5, 0, 5, 5, 20 }
    stub.actorLoaded = false
    Clear()
    Boss()
    Tick(2.8)
    Expect("a model still loading after 2.8 seconds is not framed", tostring(scene.camera.position) .. "|" .. scene:GetAlpha(), "nil|0")
    Tick(0.3)
    Expect("...but is after 3: the plain box (not the big one it would report), and shown",
        tostring(At(scene.camera.position, BASE, 0, 1)) .. "|" .. scene:GetAlpha(), "true|1")
    Expect("...the shared frame resting again", watcher:IsShown(), false)
    stub.actorLoaded = true
    Tick(0.2)
    Expect("...and not framed a second time when the model loads late", At(scene.camera.position, BASE, 0, 1), true)
    stub.actorBox = BOX

    -- The wait counts only while the page is shown: a hidden page's model may load once it is shown.
    stub.actorLoaded = false
    Clear()
    fresh.body.frame:Hide()
    Boss()
    Tick(5)
    Expect("a model on a hidden page is not framed as the plain box however long the page stays hidden",
        tostring(scene.camera.position) .. "|" .. scene:GetAlpha(), "nil|0")
    Expect("...and does not keep the shared frame looking while it is hidden", watcher:IsShown(), false)
    fresh.body.frame:Show()
    Tick(2.8)
    Expect("...its 3 seconds count from when the page is shown", tostring(scene.camera.position), "nil")
    Tick(0.3)
    Expect("...and then it is framed as the plain box", At(scene.camera.position, BASE, 0, 1), true)
    stub.actorLoaded = true

    -- A page with no model drops the camera and shows the scene again, and nothing is framed for it later.
    stub.actorLoaded = false
    Boss()
    fresh.body:SetModel(nil)
    Clear()
    stub.actorLoaded = true
    Tick(5)
    Expect("a page with no model drops the camera and nothing waits to frame it",
        tostring(fresh.body.modelCamera) .. "|" .. tostring(scene.camera.position) .. "|" .. scene:GetAlpha(), "nil|nil|1")
    fresh.body:ApplyModelCamera()
    Expect("...so nothing is applied to the cleared model", Position(), nil)
    Expect("...the shared frame resting", watcher:IsShown(), false)
    Boss(2029)
    Expect("...and a later boss is framed afresh", Position(), Round(BASE) .. ",0,1")
    local before = fresh.body.modelCamera
    stub.actorLoaded = false
    fresh:Show({ title = "Edwin VanCleef", model = { displayID = 2030 }, text = "A boss's story." })
    Expect("...a boss changed for another drops the framing of the one before while the new one loads",
        before ~= nil and fresh.body.modelCamera == nil, true)
    stub.actorLoaded = true
    Boss(2029)

    -- Nudges act on the framed camera: a change made by hand for a place is moved from the camera above.
    _G.SpokenBossCameraNudges = { compendium = { [2029] = { 0, 0, 2, 0 } } }
    Boss()
    Expect("a boss is twice as large when its Compendium page was zoomed to 2, from half the distance",
        At(scene.camera.position, BASE / 2, 0, 1), true)
    _G.SpokenBossCameraNudges = { story = { [2029] = { 0, 0, 2, 0 } } }
    Boss()
    Expect("...a change made for the map's story page leaves the Compendium's as it was", At(scene.camera.position, BASE, 0, 1), true)
    fresh.body.cameraPlace = "story"
    _G.SpokenBossCameraNudges = { compendium = { [2029] = { 0, 0, 2, 0 } } }
    Boss()
    Expect("...the map's story page, with no change of its own, is moved as the Compendium's page is",
        At(scene.camera.position, BASE / 2, 0, 1), true)
    _G.SpokenBossCameraNudges = { compendium = { [2029] = { 0, 0, 2, 0 } }, story = { [2029] = { 0, 0, 1, 0 } } }
    Boss()
    Expect("...and by its own once it has one", At(scene.camera.position, BASE, 0, 1), true)
    fresh.body.cameraPlace = nil

    -- The nudge's directions, for a camera on the x axis looking back at the middle of the box: a positive `right`
    -- moves what the camera looks at towards -y (the boss towards the right of the frame), `up` towards -z, and a
    -- positive turn swings the camera round towards -y.
    local move = BASE * Span(FOV)
    _G.SpokenBossCameraNudges = { compendium = { [2029] = { 0.5, 0, 1, 0 } } }
    Boss()
    seen = Look(BASE)
    Expect("a positive right moves the target towards -y by that many frame heights",
        Near(seen.t[2], -0.5 * move) and Near(seen.t[1], 0) and Near(seen.t[3], 1), true)
    Expect("...and the camera with it", Near(seen.p[2], -0.5 * move) and Near(seen.p[1], BASE), true)
    _G.SpokenBossCameraNudges = { compendium = { [2029] = { 0, 0.25, 1, 0 } } }
    Boss()
    seen = Look(BASE)
    Expect("a positive up lowers the target, the boss rises in the frame", Near(seen.t[3], 1 - 0.25 * move) and Near(seen.t[2], 0), true)
    _G.SpokenBossCameraNudges = { compendium = { [2029] = { 0, 0, 1, math.pi / 2 } } }
    Boss()
    seen = Look(BASE)
    Expect("a positive turn swings the camera round the boss towards -y, keeping its distance",
        At(seen.p, 0, -BASE, 1) and Near(seen.t[1], 0), true)
    _G.SpokenBossCameraView = { fov = 90, sequence = 0 }
    _G.SpokenBossCameraNudges = { compendium = { [2029] = { 0.5, 0, 1, 0 } } }
    Boss()
    seen = Look(Reach(2, 1, 90) + 0.5)
    Expect("the field of view is the one the camera data was made for, for a nudge as for the framing",
        Near(seen.t[2], -0.5 * (Reach(2, 1, 90) + 0.5) * Span(90)) and Near(scene.camera.fov, math.pi / 2), true)
    _G.SpokenBossCameraView = { fov = "wide" }
    Boss()
    seen = Look(BASE)
    Expect("...and the default where the data holds none that is a number", Near(seen.t[2], -0.5 * move) and Near(scene.camera.fov, math.rad(27.78)), true)
    _G.SpokenBossCameraView = nil

    -- A row that is not four finite numbers, or whose zoom is not above 0, is no nudge: the boss is still drawn.
    local bad = { { 0.1 }, {}, { 0, 0, 0, 0 }, { 0, 0, -1, 0 }, { 0, 0, 1 / 0, 0 }, { 0, 0, 0 / 0, 0 }, { 0, 0, "2", 0 },
        { 0, 0, 1 }, "row" }
    local drawn = 0
    for _, row in ipairs(bad) do
        _G.SpokenBossCameraNudges = { compendium = { [2029] = row } }
        Clear()
        Boss()
        if Position() == Round(BASE) .. ",0,1" then drawn = drawn + 1 end
    end
    Expect("a camera row of the wrong shape leaves the camera as framed, whatever it is", drawn, #bad)

    -- Bosses on one model file share a nudge: its group is the key in SpokenBossCameraGroups.
    _G.SpokenBossCameraGroups = { [2030] = 2029 }
    _G.SpokenBossCameraNudges = { compendium = { [2029] = { 0, 0, 2, 0 } } }
    Boss(2030)
    Expect("a boss on another display of the same model file takes the file's nudge", At(scene.camera.position, BASE / 2, 0, 1), true)
    Expect("...whose group the view says", fresh.body:CameraGroup(), 2029)
    _G.SpokenBossCameraGroups = nil
    Boss(2030)
    Expect("...and none where no group names it", At(scene.camera.position, BASE, 0, 1), true)

    -- A developer module's edits win over the shipped nudge; players have none.
    local edits
    SpokenTextView.cameraEdits = function(place, group) return edits and edits[place] and edits[place][group] end
    _G.SpokenBossCameraNudges = { compendium = { [2029] = { 0, 0, 2, 0 } } }
    edits = { compendium = { [2029] = { 0, 0, 1, 0 } } }
    Boss()
    Expect("an edit of no change wins over a shipped nudge", At(scene.camera.position, BASE, 0, 1), true)
    edits = { compendium = { [2029] = { 0.1 } } }
    Boss()
    Expect("...a bad edit does not, the shipped nudge stands", At(scene.camera.position, BASE / 2, 0, 1), true)
    SpokenTextView.cameraEdits = function() error("editor broke") end
    Boss()
    Expect("...an editor that fails does not break the page", At(scene.camera.position, BASE / 2, 0, 1), true)
    SpokenTextView.cameraEdits = nil

    -- Nothing waits for the scene's own load event: the actor is asked.
    _G.SpokenBossCameraNudges = nil
    Boss()
    Expect("a boss's camera is set from its actor's box, with no handler on the scene waiting for the model to load",
        Position() .. "|" .. tostring(scene.scripts.OnModelLoaded), Round(BASE) .. ",0,1|nil")

    -- The pose every boss stands in: SpokenBossCameraView's, unless the model asks for one.
    _G.SpokenBossCameraView = { fov = 27.78, sequence = 5 }
    Boss()
    Expect("a boss stands in the pose its data names", actor.animation, 5)
    fresh:Show({ title = "Edwin VanCleef", model = { displayID = 2029, sequence = 2 }, text = "A boss's story." })
    Expect("...unless the model names another", actor.animation, 2)
    _G.SpokenBossCameraView = nil
    Boss()
    Expect("...and a data file with no view in it means the idle pose", actor.animation, 0)
    local animate = actor.SetAnimation
    actor.SetAnimation = function() error("no such animation") end
    Boss()
    actor.SetAnimation = animate
    Expect("...a client that refuses the pose still shows the boss", actor:IsShown() and actor.displayID, 2029)

    -- The code keeps nothing of the old cameras.
    local source = io.open(SPOKEN .. "UI/TextView.lua", "rb"):read("*a")
    Expect("the view reads no per-boss camera rows and has no scale from the old camera units",
        tostring(source:find("SpokenBossCameras", 1, true) ~= nil) .. "|" .. tostring(source:find("SCENE_SCALE", 1, true) ~= nil)
        .. "|" .. tostring(source:find("PLAIN_CAMERA", 1, true) ~= nil), "false|false|false")

    -- A camera call that raises is said once in chat, not swallowed.
    local said
    local speak = _G.print
    _G.print = function(...) said = (said or "") .. table.concat({ ... }, " ") .. "\n" end
    local setPosition = scene.SetCameraPosition
    scene.SetCameraPosition = function() error("no camera here") end
    Boss()
    Boss()
    _G.print = speak
    scene.SetCameraPosition = setPosition
    local _, times = (said or ""):gsub("no camera here", "")
    Expect("a camera call that fails is said once in chat", times, 1)
    _G.SpokenBossCameraNudges = nil
    fresh:Show({ title = "A place", text = "Place lore." })
    Expect("a page without a model hides the old one", fresh.body.model:IsShown(), false)

    -- Two models in different windows share one depth buffer and cut into each other, whichever window is on
    -- top. Each model takes a rank from its window's stacking (strata, then frame level, then who asked first)
    -- and its scene a near clip plane of that rank: the lowest a tiny share of the camera's distance to the
    -- model's nearest face, then 0.3, 0.5 and 0.7 of it, so the one above wins the depth test and is never clipped.
    do
        local create = _G.CreateFrame
        -- The camera stands BASE from the middle of the box. A near clip is a share of that less the half
        -- diagonal of the box's footprint, which is as near as the figure comes in any turn.
        local REACH = math.sqrt(0.5)
        local D = BASE - REACH
        local function Boss(level, displayID, strata)
            local window = create("Frame")
            window.GetFrameStrata = function() return window.strata end
            window.GetFrameLevel = function() return window.level end
            window.level, window.strata = level, strata or "HIGH"
            local view = SpokenTextView.Create(window, B)
            view.window = window
            view:SetModel({ displayID = displayID })
            view:SetText("A boss's story.")
            Tick()
            return view
        end
        local function Share(view)
            return Round(view.model.camera.near / D * 100) / 100
        end
        local function Shares(...)
            local out = {}
            for _, view in ipairs({ ... }) do out[#out + 1] = Share(view) end
            return table.concat(out, " ")
        end
        local back = Boss(1, 2029)
        Expect("a lone model has the lowest rank: a near clip of a hundredth of its camera's distance to the figure", Shares(back), "0.01")
        Expect("...its far clip well past the boss", back.model.camera.far, 500)
        local front = Boss(2, 2030)

        Expect("two models: the window on top has the larger near clip, the one under it the tiny one",
            Shares(back, front), "0.01 0.3")
        Expect("...a shared frame looking again as windows are raised", watcher ~= nil and watcher:IsShown(), true)
        Expect("...both models shown, whatever the windows cover: none is hidden or faded",
            tostring(back.model:IsShown()) .. " " .. tostring(front.model:IsShown()) .. "|" .. back.model:GetAlpha()
            .. " " .. front.model:GetAlpha(), "true true|1 1")
        back.window.level = 3
        Tick()
        Expect("raising the other window swaps the near clips", Shares(back, front), "0.3 0.01")
        local calls = back.model.camera.nearCalls + front.model.camera.nearCalls
        Tick()
        Expect("...a window left where it is leaves the near clips alone", back.model.camera.nearCalls
            + front.model.camera.nearCalls, calls)
        back.window.level = 2
        Tick(0.05)
        Expect("...looked at no more often than every tenth of a second", Shares(back, front), "0.3 0.01")
        Tick(0.05)
        Expect("...on equal levels the model that asked first is the lower", Shares(back, front), "0.01 0.3")
        back.window.strata, front.window.strata = "DIALOG", "HIGH"
        Tick()
        Expect("a window in a higher strata is on top, whatever its level", Shares(back, front), "0.3 0.01")
        back.window.strata = "HIGH"
        Tick()

        local third = Boss(3, 2030)
        local fourth = Boss(4, 2029)
        Expect("three overlapping windows: tiny, 0.3 and 0.5 from the bottom up", Shares(back, front, third), "0.01 0.3 0.5")
        Expect("...a fourth is 0.7, each rank 0.2 above the one under it", Shares(back, front, third, fourth), "0.01 0.3 0.5 0.7")
        third.window.level = 0
        Tick()
        Expect("raising the lowest of them re-ranks the four", Shares(back, front, third, fourth), "0.3 0.5 0.01 0.7")
        Expect("...the near clip always short of the figure's nearest face, so the boss is never clipped",
            back.model.camera.near < BASE - 0.5 and front.model.camera.near < BASE - 0.5
            and fourth.model.camera.near < BASE - 0.5, true)
        local fifth = Boss(5, 2030)
        Expect("...a fifth window takes the last share with the fourth", Shares(fifth, fourth), "0.7 0.7")
        fifth:SetModel(nil)
        fourth:SetModel(nil)
        third:SetModel(nil)
        Tick()
        Expect("two models left are ranked again from the bottom", Shares(back, front), "0.01 0.3")

        front.frame:Hide()
        Tick()
        Expect("a page that is hidden no longer ranks above the other", Shares(back), "0.01")
        front.frame:Show()
        Tick()
        Expect("...and ranks again when it is shown", Shares(back, front), "0.01 0.3")
        _G.SpokenBossCameraNudges = { compendium = { [2029] = { 0, 0, 2, 0 } } }
        back:SetModel({ displayID = 2029 })
        back:SetText("A boss's story.")
        Tick()
        Expect("a model set again takes its near clip from its new camera's distance, at the rank its window has now",
            Round(back.model.camera.near / (BASE / 2 - REACH) * 100) / 100, 0.3)
        _G.SpokenBossCameraNudges = nil
        back:SetModel({ displayID = 2029 })
        back:SetText("A boss's story.")
        Tick()
        Expect("...a model asked for again is above the one before it", Shares(back, front), "0.3 0.01")
        front:SetModel(nil)
        Tick()
        Expect("a model that is cleared lets the other back to the lowest rank", Shares(back), "0.01")
        Expect("...with no more than one model wanted the shared frame is let rest", watcher:IsShown(), false)
        local other = Boss(3, 2030)
        Expect("two shown models keep the shared frame looking", watcher:IsShown(), true)
        back.frame:Hide()
        other.frame:Hide()
        Tick()
        Expect("...and two models whose pages are hidden let it rest, however many were asked for", watcher:IsShown(), false)
        back.frame:Show()
        other.frame:Show()
        Tick()
        Expect("...and it looks again once they are shown", watcher:IsShown(), true)
        other:SetModel(nil)
        Tick()

        -- A boss shown again is the one already drawn: it is not loaded and framed over again, which would
        -- blink it out and back. One asked for in another size or pose is another model.
        local actor = back.modelActor
        local sets = actor.modelSets
        back:SetModel({ displayID = 2029 })
        Tick()
        Expect("a boss shown again is not loaded again, and stays drawn", actor.modelSets .. "|" .. back.model:GetAlpha(),
            sets .. "|1")
        back:SetModel({ displayID = 2029, scale = 2 })
        Expect("...but one asked for at another scale is", actor.modelSets, sets + 1)
        Tick()
        back:SetModel({ displayID = 2029, scale = 2, sequence = 3 })
        Expect("...or in another pose", actor.modelSets, sets + 2)
        back:SetModel(nil)
        back:SetModel({ displayID = 2029, scale = 2, sequence = 3 })
        Expect("...and one cleared in between is loaded afresh", actor.modelSets, sets + 3)
        Tick()
        Expect("nothing is left of hiding or fading a covered model",
            tostring(back.SnapModel) .. tostring(back.StepModelFade) .. tostring(back.modelCovered)
            .. tostring(back.modelHidden) .. tostring(back.modelAlpha), "nilnilnilnilnil")
        back:SetModel(nil)
    end

    -- A client with no ModelScene draws no boss: the page has no room, backing or frame for one.
    do
        local create = _G.CreateFrame
        _G.CreateFrame = function(kind, ...)
            if kind == "ModelScene" then error("no such frame type") end
            return create(kind, ...)
        end
        local bare = SpokenTextView.Create(create("Frame"), B)
        _G.CreateFrame = create
        bare:SetModel({ displayID = 2029 })
        bare:SetText("A boss's story.")
        Tick()
        Expect("a client with no ModelScene shows no model, backing or edge for a boss",
            tostring(bare.modelDisplayID) .. "|" .. tostring(bare.model:IsShown()) .. "|"
            .. tostring(bare.modelShade:IsShown()) .. "|" .. tostring(bare.modelEdgeFrame:IsShown()), "nil|false|false|false")
        Expect("...and the shared frame has nothing to look at", watcher:IsShown(), false)
    end

    -- The line under the title: plain words, or where the tab gives one, a way up a level.
    local sub, clicked, red = fresh.sub, 0, nil
    sub.text.SetTextColor = function(_, r) red = r end
    fresh:Show({ title = "Stormwind City", subtitle = "In Elwynn Forest" })
    red = nil
    sub.scripts.OnEnter(sub)
    Expect("the line under a page's title, with no way up, stays in ink under the pointer",
        sub:IsEnabled() == false and sub.text.text == "In Elwynn Forest" and red, nil)
    sub:Click()
    fresh:Show({ title = "Stormwind City", subtitle = "In Elwynn Forest", onSubtitle = function() clicked = clicked + 1 end })
    sub.scripts.OnEnter(sub)
    Expect("...given one, in the link's colour under the pointer", sub:IsEnabled() and red, 0.5)
    sub:Click()
    Expect("...a click going there", clicked, 1)
    sub.scripts.OnLeave(sub)
    Expect("...in ink again when the pointer leaves", red ~= 0.5, true)
    Expect("...on one line, cut short", sub.text.wordWrap, false)
end
local copied
-- ShowReport's copy box and context are Contribute.lua's, tested there: here, only which page.
local showReport = B.ShowReport
B.ShowReport = function(_, pageId, language) copied = B:ReportURL(pageId, language) end
page.report.scripts.OnClick(page.report)
Expect("...a click giving the address to report its first voiced page", copied ~= nil
    and copied:find("/readables/r/" .. alleriaPage, 1, true) ~= nil, true)
-- A letter of two pages whose first has no recording: Play and Report are there for the second,
-- and Play starts it there.
do
    local first, second = unpack(B:Data().books[LETTER].pages)
    local voiced = { [second] = true }
    B.HasAudio = function(_, p) return voiced[p] == true end
    page:Show({ title = "A Dusty Unsent Letter", target = LETTER })
    Expect("a readable whose first page has no recording and a later one has: Play and Report on its page",
        page.play:IsShown() and page.report:IsShown(), true)
    local syncTo, synced = B.SyncTo, nil
    B.SyncTo = function(_, p) synced = p end
    page.play.scripts.OnClick(page.play)
    B.SyncTo = syncTo
    Expect("...Play starting at its first voiced page", synced, second)
    page.report.scripts.OnClick(page.report)
    Expect("...Report filing that page", copied:find("/readables/r/" .. second, 1, true) ~= nil, true)
    voiced[first] = true
    B.following[LETTER] = { clip = { pageId = second }, pages = {} }
    page.report.scripts.OnClick(page.report)
    Expect("...and while it is read, the page being read", copied:find("/readables/r/" .. second, 1, true) ~= nil, true)
    B.following[LETTER] = nil
    page.report.scripts.OnClick(page.report)
    Expect("...else its first voiced page", copied:find("/readables/r/" .. first, 1, true) ~= nil, true)
    -- Nothing recorded: Play greyed, and Report all the same, filing its first page.
    voiced[first], voiced[second] = nil, nil
    page:Show({ title = "A Dusty Unsent Letter", target = LETTER })
    Expect("a readable with no recording has Report and a greyed Play",
        page.report:IsShown() and page.play:IsShown() and not page.play:IsEnabled(), true)
    copied = nil
    page.report.scripts.OnClick(page.report)
    Expect("...Report filing its first page", copied ~= nil and copied:find("/readables/r/" .. first, 1, true) ~= nil, true)
end
B.HasAudio = function(_, p) return p == alleriaPage end
B.ShowReport = showReport
local spoken, hidden = _G.Spoken, true
_G.Spoken = setmetatable({ AreReportButtonsHidden = function() return hidden end }, { __index = spoken })
page:RefreshPlay()
Expect("...none with Hide Report Buttons on", page.report:IsShown(), false)
_G.Spoken = spoken
B.HasAudio = hasAudio

-- Play on a readable's page as the quest log's Play: Stop while it is read, Replay once stopped,
-- and Play otherwise; behind another line, left waiting while that speaks, played once it is stopped.
do
    local kurdranPage = B:Data().books[KURDRAN].pages[1]
    local clipFor, voiced = B.ClipFor, { [alleriaPage] = true, [kurdranPage] = true }
    B.HasAudio = function(_, p) return voiced[p] == true end
    B.ClipFor = function(_, p)
        if not voiced[p] then return nil end
        return { key = "b:" .. p, path = "page" .. p .. ".mp3", length = 5, pageId = p, present = { header = "" } }
    end
    -- Play and Report tooltips: titles only.
    local function Tip(asIs, button)
        button = button or page.play
        if not asIs then
            GameTooltip.lines = nil
            for _, hook in ipairs(button.hooks.OnEnter) do hook(button) end
        end
        return table.concat(GameTooltip.lines or {}, "|")
    end
    local S = SpokenEnv.L
    local function Head() return Spoken:GetCurrent() and Spoken:GetCurrent().pageId end
    page:Show({ title = "Ranger Captain Alleria Windrunner", target = ALLERIA })
    Expect("a readable not being read: Play's tooltip keeps its title", page.play.pageState .. " " .. Tip(),
        "play " .. S.PLAY)
    page.play.scripts.OnClick(page.play)
    Expect("...a click reads it", Spoken:GetNowPlaying() and Spoken:GetNowPlaying().pageId, alleriaPage)
    Expect("...its Play showing Stop without a description", page.play.pageState .. " " .. Tip(), "stop " .. S.STOP)
    page.play.scripts.OnClick(page.play)
    Expect("...Stop stops it and keeps it at the head", tostring(Spoken:IsPaused()) .. " " .. tostring(Head()),
        "true " .. alleriaPage)
    Expect("...showing Replay without a description", page.play.pageState .. " " .. Tip(), "replay " .. S.REPLAY)
    Spoken:RegisterDeveloper({ MenuHint = function() return "Right-click: the debug log" end })
    Expect("its Report's tooltip keeps its title", Tip(false, page.report), L.REPORT_PROBLEM)
    Spoken:RegisterDeveloper(nil)
    page.play.scripts.OnClick(page.play)
    Expect("...Replay reads it again from the start", not Spoken:IsPaused() and Spoken:GetNowPlaying()
        and Spoken:GetNowPlaying().pageId, alleriaPage)
    Expect("...showing Stop again", page.play.pageState, "stop")
    Spoken:StopAll()
    B.following = {}
    B.source:Enqueue(B:ClipFor(kurdranPage))
    page.play.scripts.OnClick(page.play)
    Expect("behind another line speaking, Play queues it behind that", Spoken:GetQueueSize() .. " " .. tostring(Head()),
        "2 " .. kurdranPage)
    Expect("...still Play", page.play.pageState, "play")
    page.play.scripts.OnClick(page.play)
    Expect("...a second click leaving it where it is", Spoken:GetQueueSize() .. " " .. tostring(Head()), "2 " .. kurdranPage)
    Spoken:Pause()
    Expect("...still Play once that line is stopped", page.play.pageState, "play")
    page.play.scripts.OnClick(page.play)
    Expect("...and a click then reads it at once", tostring(Spoken:IsPaused()) .. " "
        .. tostring(Spoken:GetNowPlaying() and Spoken:GetNowPlaying().pageId), "false " .. alleriaPage)
    Expect("...still followed as the book being read", B.following[ALLERIA] ~= nil
        and B.following[ALLERIA].clip == Spoken:GetCurrent(), true)
    Spoken:StopAll()
    B.following = {}

    -- Shift-click on a writing's row queues it behind what is playing, as on Quests, choosing nothing.
    SpokenReadablesSettings.unlockUnfound = true
    B:RefreshReadables()
    local chosenTitle = panel.page.title.text
    local shift = _G.IsShiftKeyDown
    _G.IsShiftKeyDown = function() return true end
    B.source:Enqueue(B:ClipFor(kurdranPage))
    Click("Ranger Captain Alleria Windrunner")
    Expect("a shift-click on a voiced writing queues it behind what is playing", Spoken:GetQueueSize() .. " "
        .. tostring(Head()) .. " " .. tostring(Spoken:GetQueue()[2] and Spoken:GetQueue()[2].pageId), "2 " .. kurdranPage .. " " .. alleriaPage)
    Expect("...choosing nothing", panel.page.title.text, chosenTitle)
    Click("Ranger Captain Alleria Windrunner")
    Expect("...and a second does not queue it twice", Spoken:GetQueueSize(), 2)
    _G.IsShiftKeyDown = shift
    SpokenReadablesSettings.unlockUnfound = false
    Spoken:StopAll()
    B.following = {}
    B.ClipFor, B.HasAudio = clipFor, hasAudio
end

-- The readables places.mjs leaves out (the Deprecated and TEST items, whose page is "Missing
-- Text") are neither listed nor counted, so every count can reach all.
local placed = 0
for _ in pairs(SpokenReadablesPlaces.books) do placed = placed + 1 end

_, choices = Menu()
choices[5].func()
list = Shown()
local counted = 0
for _, row in ipairs(rows) do if row.shown ~= false and row.row and row.row.kind == "type" then counted = counted + row.row.total end end
Expect("the kinds count only the readables the places know", counted, placed)
Click(L.TYPE_OTHER)
Expect("By Type does not list one the places leave out", RowFor("Test Language Item"), nil)
Click(L.TYPE_OTHER)
Expect("By Type: the list is a card for each kind alone", Has(list, L.TYPE_PLAQUE) and Has(list, L.TYPE_LETTER) and not Has(list, "Elwynn Forest"), true)
_, choices = Menu()
Expect("...and the menu says so", choices[5].checked and not choices[4].checked, true)
Expect("...a search naming a kind lists every one of it", Has(Search(L.TYPE_PLAQUE:lower()), "Kurdran Wildhammer"), true)
Search("")
Click(L.TYPE_PLAQUE)
Expect("...a type opens on its readables", Has(Shown(), "Kurdran Wildhammer"), true)
Expect("...each a banner, being a type, counted found out of all", RowFor(L.TYPE_PLAQUE).row.style == "banner"
    and RowFor(L.TYPE_PLAQUE).count.text:match("^2/%d+$") ~= nil, true)
Expect("...its readables rows under it, a step in", RowFor("Kurdran Wildhammer").row.leaf
    and RowFor("Kurdran Wildhammer").row.nest, 0)
list = Shown()
Expect("...journals and diaries a type of their own, after books, and pictures and maps one too",
    Has(list, L.TYPE_JOURNAL) and Has(list, L.TYPE_PICTURE)
    and list:find(L.TYPE_BOOK, 1, true) < list:find(L.TYPE_JOURNAL, 1, true), true)
Click(L.TYPE_JOURNAL)
Expect("...Stalvan's diary among the journals", Has(Shown(), "Book from Sven's Farm"), true)
Click(L.TYPE_JOURNAL)
Click(L.TYPE_PICTURE)
Expect("...the Snapshot of Gammerita among the pictures", Has(Shown(), "Snapshot of Gammerita"), true)
Click(L.TYPE_PICTURE)
_, choices = Menu()
choices[4].func()
Expect("...and By Zone again, the zones", Has(Shown(), "Elwynn Forest"), true)

-- The groups after the continents: a card for each kind inside, the writings under it.
Click(L.GROUP_WIDE)
list = Shown()
local kindRow
for _, row in ipairs(rows) do
    if row.shown ~= false and row.row and row.row.kind == "kind" and row.row.group == "wide" then kindRow = kindRow or row end
end
Expect("a group's banner opens on a line of the list for each kind of writing in it", kindRow ~= nil and kindRow.row.style == "group"
    and kindRow.row.nest, 0)
Expect("...each closed", kindRow.row.open or Has(list, "An Exotic Cookbook"), false)
OpenKinds("wide")
Expect("...a click opening it on the writings under it", Has(Shown(), "An Exotic Cookbook") and RowFor("An Exotic Cookbook").row.nest, 1)
local kindLabel = kindRow.row.label
kindRow = KindRow("wide", kindLabel)
Expect("...a kind chosen, its page names it and its group", page.title.text == kindLabel
    and page.sub.text.text:find(L.GROUP_WIDE .. " · ", 1, true) == 1, true)
Expect("...the group named as it is, not as a place a readable is in", page.sub.text.text:find(
    L.READABLES_IN_FMT:format(L.GROUP_WIDE), 1, true), nil)
kindRow.scripts.OnClick(kindRow)
Expect("...and another click closes it", KindRow("wide", kindLabel).row.open, false)
OpenKinds("wide")
OpenKinds("wide")
Click(L.GROUP_WIDE)

-- The places' tab joins: the tabs show, and each shows its own panel.
_G.SpokenCompendium:Register("places", { label = "Places", order = 1,
    build = function(p) p.places = true end })
_G.SpokenCompendium:Select("places")
Expect("with two tabs, the tabs show", _G.SpokenCompendiumWindowTab1:IsShown() and _G.SpokenCompendiumWindowTab2:IsShown(), true)
Expect("...each its own panel", _G.SpokenCompendium:Tab("places").panel:IsShown() and not panel:IsShown(), true)
_G.SpokenCompendiumWindowTab2.scripts.OnClick(_G.SpokenCompendiumWindowTab2)
Expect("...and a click on the other goes back to the readables", panel:IsShown(), true)

-- A tab whose part is off is not shown, and does not open.
local on = { spare = false, readables = true }
_G.SpokenCompendium:Register("spare", { label = "Spare", order = 3, build = function() end,
    enabled = function() return on.spare end })
_G.SpokenCompendium:Tab("readables").enabled = function() return on.readables end
Expect("a tab whose part is off has no tab", _G.SpokenCompendiumWindowTab3 == nil or not _G.SpokenCompendiumWindowTab3:IsShown(), true)
Expect("...and is not opened", _G.SpokenCompendium:Select("spare") == nil and _G.SpokenCompendium:Active(), "readables")
Expect("...the window open on the readables", window:IsShown(), true)
on.readables = false
_G.SpokenCompendium:Relayout()
Expect("the part of the tab shown switched off, the window closes", window:IsShown(), false)
on.readables = true

-- Played from the Compendium is browsing: it does not count for Read Only Once, so the book still
-- reads itself the first time it is opened in the world.
do
    local source, clipFor, isQueued = B.source, B.ClipFor, B.IsQueued
    B.source = { Enqueue = function() return true end, PlayNow = function() return true end, StopAll = function() end }
    B.ClipFor = function() return {} end
    B.IsQueued = function() return false end
    SpokenReadablesCharacter.read[KURDRAN] = nil
    B:SyncTo(SpokenReadablesData.books[KURDRAN].pages[1], true)
    Expect("Play in the Compendium does not count for Read Only Once", B:HasReadBook(KURDRAN), false)
    B:SyncTo(SpokenReadablesData.books[KURDRAN].pages[1])
    Expect("...a book read in the world does", B:HasReadBook(KURDRAN), true)
    B.source, B.ClipFor, B.IsQueued = source, clipFor, isQueued
end

-- Listening is not finding: a book heard (Read Only Once's record) stays unfound until it is
-- opened in the world. One heard before Found was kept still is.
SpokenReadablesCharacter.found[ALLERIA] = nil
B:MarkBookRead(ALLERIA)
Expect("a book heard is not found by it", B:IsBookFound(ALLERIA), false)
_G.SpokenReadablesCharacter = { read = { [LETTER] = true } }
B:InitDB()
Expect("...one heard before Found was kept is found", B:IsBookFound(LETTER), true)

-- Played from here, with no page open in the world, a readable is drawn on what its kind is
-- written on: the book window draws stone and bronze in stone, the rest on paper.
local function FirstPage(id) return B:Data().books[id].pages[1] end
B.lastPage = nil
Expect("a gravestone played with nothing open is on stone", B:PageMaterial(FirstPage(2731)), "Stone")
Expect("...a plaque on bronze", B:PageMaterial(FirstPage(KURDRAN)), "Bronze")
Expect("...a letter on paper", B:PageMaterial(FirstPage(LETTER)), nil)
Expect("...its picture the stone's", B:PagePicture(FirstPage(2731)).texture, B.MATERIALS.Stone)
B.lastPage = FirstPage(LETTER)
Expect("...and another page open in the world lends it nothing", B:PageMaterial(FirstPage(2731)), "Stone")
B.lastPage = nil

-- Text Size, on Spoken's page: the words read at it, and drawn again when it changes.
do
    local text, questFont = panel.page.body.text, _G.QuestFont
    _G.QuestFont = { GetFont = function() return "Fonts/FRIZQT__.TTF", 12 end }
    local setFont, drawnAt = text.SetFont, nil
    text.SetFont = function(self, face, size, ...) drawnAt = size; if setFont then return setFont(self, face, size, ...) end end
    _G.Spoken:SetCompendiumFontSize(16)
    -- The parchment's ink is drawn a point larger than the Text Size.
    Expect("the page's words at the Compendium's Text Size, drawn again when it changes",
        _G.Spoken:CompendiumFontSize() .. "|" .. tostring(drawnAt), "16|" .. (16 + 1))
    text.SetFont, _G.QuestFont = setFont, questFont
    _G.Spoken:SetCompendiumFontSize(12)
end

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll readables tests passed")
