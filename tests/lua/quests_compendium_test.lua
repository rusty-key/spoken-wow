-- The quests in Azeroth's Compendium: every quest this character's race and class may take, in a
-- card for the zone it is in under its continent's banner, or under its class, profession or
-- season; its chain a card inside, with the chain's page; a quest's page with its words, its
-- placeholders filled for the player; found once completed or in the quest log, marked in progress
-- then; Started Only, the search and Unlock Unstarted Quests; Play; and on a client in another
-- language, the words its windows showed.
-- Against the shipped data (Data/Compendium.lua, Data/QuestText.lua). Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local Expect, Failures = H.Expecter(print)
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local SPOKEN = here .. "/../../addons/Spoken/"

stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
stub.world.questID = 0; stub.ShowPanel(nil)

-- Alterac Valley as Forever's newer client hangs it, in Hillsbrad Foothills; the other
-- battlegrounds and Zephras Isle under Azeroth itself. Forever's Darkspear Islands is a map this
-- client (Era's) has never heard of.
local MAPS = { [947] = { "Azeroth" }, [1414] = { "Kalimdor", 947 }, [1415] = { "Eastern Kingdoms", 947 },
    [1429] = { "Elwynn Forest", 1415 }, [1453] = { "Stormwind City", 1415 }, [1436] = { "Westfall", 1415 },
    [1440] = { "Ashenvale", 1414 }, [1424] = { "Hillsbrad Foothills", 1415 }, [1459] = { "Alterac Valley", 1424 },
    [1460] = { "Warsong Gulch", 947 }, [1461] = { "Arathi Basin", 947 },
    [2521] = { "Zephras Isle", 947 }, [2548] = { "Riverglades", 1415 }, [1427] = { "Searing Gorge", 1415 } }
local UNKNOWN_MAP = 2524
_G.C_Map.GetMapInfo = function(id)
    if id == UNKNOWN_MAP then return nil end
    local map = MAPS[id]
    return { mapType = 3, name = map and map[1] or ("Map " .. id), parentMapID = map and map[2] or nil }
end
_G.C_Texture = { GetAtlasInfo = stub.ListAtlas }
local faction = "Alliance"
_G.UnitFactionGroup = function() return faction, faction end
_G.UISpecialFrames = _G.UISpecialFrames or {}
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

-- A human mage, Tester, who has completed Kobold Camp Cleanup.
local KOBOLDS, CANDLES, SHARPTALON, JENNEA = 7, 60, 2, 1860
stub.world.playerName = "Tester"
_G.UnitRace = function() return "Human", "Human", 1 end
_G.UnitClass = function() return "Mage", "MAGE", 8 end
local completed = { [KOBOLDS] = true }
_G.GetQuestsCompleted = function() return completed end

local VO = stub.LoadQuests(QUESTS, SPOKEN)
VO.Addon:OnInitialize()
local Spoken = _G.Spoken
-- The window is Spoken's: no other module is loaded.
-- Where a quest is read: Classic Era's quest log, a zone's header then its quests, with the
-- selected quest's details beside the list, and the map's quest log of Forever, with its details
-- view.
local questLog, logQuest = {}, nil
_G.QuestLogFrame = CreateFrame("Frame", "QuestLogFrame")
_G.QuestLogDetailScrollFrame = CreateFrame("ScrollFrame", "QuestLogDetailScrollFrame", QuestLogFrame)
function QuestLogDetailScrollFrame:IsVisible() return logQuest ~= nil end
_G.GetNumQuestLogEntries = function() return #questLog + 1, #questLog end
_G.GetQuestLogTitle = function(index)
    if index == 1 then return "Elwynn Forest", 0, nil, true, false end
    local id = questLog[index - 1]
    if id then return "A quest", 1, nil, false, false, false, 0, id end
end
_G.GetQuestLogIndexByID = function(id)
    for i, logged in ipairs(questLog) do if logged == id then return i + 1 end end
    return 0
end
_G.GetQuestLogSelection = function()
    for i, id in ipairs(questLog) do if id == logQuest then return i + 1 end end
    return 0
end
_G.QuestLog_UpdateQuestDetails = function() end
_G.QuestMapFrame = CreateFrame("Frame", "QuestMapFrame")
QuestMapFrame.DetailsFrame = CreateFrame("Frame", nil, QuestMapFrame)
QuestMapFrame.DetailsFrame.BackFrame = CreateFrame("Frame", nil, QuestMapFrame.DetailsFrame)
_G.QuestMapFrame_ShowQuestDetails = function(questID) QuestMapFrame.DetailsFrame.questID = questID end
local ns = {}
for _, file in ipairs({ "Data/Compendium", "Data/QuestText", "Data/QuestFaces", "UI/QuestsTab", "UI/OpenInCompendium" }) do
    assert(loadfile(QUESTS .. file .. ".lua"))("Spoken_Quests", ns)
end
-- The shipped data links each quest to the one before it in its chain: Lost Necklace, Pie for
-- Billy, Back to Billy, then Goldtooth. Only that chain is kept here, so the rest of the tree
-- reads as single quests; and one made up, crossing from Elwynn Forest into Westfall: The
-- Jasperlode Mine, then Westfall Stew and Goretusk Liver Pie.
local NECKLACE, PIE, BACK, GOLDTOOTH = 85, 86, 84, 87
local JASPERLODE, STEW, LIVER_PIE = 76, 36, 22
local shipped = SpokenQuestsCompendium.quests
local linked = shipped[PIE].prev == NECKLACE and shipped[BACK].prev == PIE and shipped[GOLDTOOTH].prev == BACK
-- Speak with Ruga, the breadcrumb Brutal Armor's chain starts with, names it after that quest.
local namedByHand = shipped[1823] and shipped[1823].name == 1838
-- Zephras Isle's story, which both sides take: every High Order Skyborne starts there.
local zephrasOpen = true
for _, id in ipairs({ 92517, 92528, 92529, 92550, 92640, 92642, 92643, 92644, 92645, 92880, 92881, 92947,
                      93036, 93065, 93320, 93926, 93927, 93948, 93958, 94568 }) do
    zephrasOpen = zephrasOpen and shipped[id] ~= nil and shipped[id].races == nil
end
for _, quest in pairs(shipped) do quest.prev, quest.name = nil, nil end
SpokenQuestsCompendium.quests[PIE].prev = NECKLACE
SpokenQuestsCompendium.quests[BACK].prev = PIE
SpokenQuestsCompendium.quests[GOLDTOOTH].prev = BACK
shipped[STEW].prev, shipped[LIVER_PIE].prev = JASPERLODE, STEW
-- A mage's chain, in the Mage group: Speak with Bink, then Mage-tastic Gizmonitor.
local BINK_CHAIN = "Speak with Bink"
shipped[1880].prev = 1879
-- Two chains of one name in Redridge Mountains: The Price of Shoes, then Return to Verner, named
-- after Messenger to Stormwind, as the chain of that quest and the next is.
local SHOES, VERNER, MESSENGER, MESSENGER_2, REDRIDGE = 118, 119, 120, 121, 1433
shipped[VERNER].prev, shipped[MESSENGER_2].prev, shipped[SHOES].name = SHOES, MESSENGER, MESSENGER
-- And a chain that starts with a quest this human cannot take, made an orc's here: Redridge
-- Goulash, then A Watchful Eye and Looking Further.
local GOULASH, WATCHFUL, FURTHER = 92, 94, 248
shipped[GOULASH].races, shipped[WATCHFUL].prev, shipped[FURTHER].prev = 2, GOULASH, WATCHFUL
local L, Tab = VO.L, VO.QuestsTab
Expect("the shipped data has the quests' chains, from the world DB", linked, true)
Expect("...and the names of chains given by hand, on their first quest", namedByHand, true)
Expect("...and Zephras Isle's shared quests open to both sides", zephrasOpen, true)
local C = _G.SpokenCompendium

Expect("no tab before the world is up", C:Tab("quests"), nil)
stub.FireEvent("PLAYER_ENTERING_WORLD")
Expect("the quests are a tab of Azeroth's Compendium once it is", C:Tab("quests") ~= nil and C:Tab("quests").label, L.COMPENDIUM_QUESTS)
-- A map with no quests and nothing above it.
stub.world.playerMapID = 9999
Tab:Open()
local panel = Tab.panel
local page = panel.page
-- A page's words as one string: a quest's parts each under its heading, as one block reads.
local function PageWords()
    local parts = page.body.lastParts
    if not parts then return page.body.text["text"] end
    local out = {}
    for _, part in ipairs(parts) do
        table.insert(out, part.heading)
        table.insert(out, part.text)
    end
    return table.concat(out, "\n\n")
end
-- A part's Play and Report on a quest's page, by its heading.
local function PartButton(heading, kind)
    for _, part in ipairs(page.body.lastParts or {}) do
        if part.caption == heading or (part.caption == nil and part.heading == heading) then
            for _, button in ipairs(part.buttons or {}) do
                if button.kind == kind or (kind == "play" and button.moment) or (kind == "report" and not button.moment) then
                    return button
                end
            end
        end
    end
end
Expect("...and open on it", C:IsOpen("quests"), true)
Expect("...where the player's continent is not known, on the first continent, as there is no Azeroth to land on",
    page.title.text, "Eastern Kingdoms")
MAPS[9998] = { "An inn in Kalimdor", 1414 }
stub.world.playerMapID = 9998
Tab:Open()
Expect("...where the player is on a continent and in no zone with quests, on that continent, as Places and Readables land",
    page.title.text, "Kalimdor")

-- The client's scroll frame: an offset only within the range it last measured, which it measures
-- when asked or a frame after it is laid out, and no height until the window is first laid out.
local listScroll
for _, child in ipairs(panel.inset.children or {}) do
    if child.frameType == "ScrollFrame" then listScroll = child end
end
local measured = 0
local setScroll = listScroll.SetVerticalScroll
-- From the window closed and never laid out: the list at its top, no range measured, no height.
local function Unmeasured()
    C:Hide()
    listScroll.height, measured, listScroll.verticalScroll = 0, 0, 0
    function listScroll:UpdateScrollChildRect() measured = math.max(0, self.scrollChild.height - self.height) end
    function listScroll:SetVerticalScroll(v) setScroll(self, math.min(v, measured)) end
end
-- Laid out a frame after it is shown.
local function LaidOut()
    listScroll.height = 200
    stub.Advance(0.1)
end
local function Measured()
    listScroll.SetVerticalScroll, listScroll.UpdateScrollChildRect = setScroll, nil
    listScroll.height = 120
end
-- Whether the row for `mapID`, or the quest `id`, is inside the list's view.
local function InView(mapID, id)
    local found
    local function Walk(frame)
        for _, child in ipairs(frame.children or {}) do
            local item = child.shown ~= false and child.row
            if item and (mapID and item.mapID == mapID and item.style == "group" or id and item.quest == id) then found = child end
            Walk(child)
        end
    end
    Walk(panel)
    if not found then return false end
    local top, offset = -found.anchor.y, listScroll:GetVerticalScroll()
    return offset > 0 and top >= offset and top + found.height <= offset + listScroll.height
end
local ASHENVALE = 1440
Unmeasured()
stub.world.playerMapID = ASHENVALE
Tab:Open()
LaidOut()
Expect("landing on a zone far down the list, a frame later its line is in view, the list scrolled to it",
    page.title.text == "Ashenvale" and InView(ASHENVALE), true)
Measured()
stub.world.playerMapID = 1429
Tab:Open()
Expect("...on the zone the player stands in, never an empty page", page.title.text, "Elwynn Forest")
-- In an instance the game hides the player's map (#422): it is no zone to look up, not an error.
stub.Secrets(1429)
Expect("a hidden map raises no error when the tab opens", pcall(Tab.Open, Tab), true)
Expect("...and is no zone the player stands in: the tab opens on the first continent", page.title.text,
    "Eastern Kingdoms")
stub.Secrets()
stub.world.playerMapID = nil

local rows
local function Collect(frame)
    for _, child in ipairs(frame.children or {}) do
        if child.row then table.insert(rows, child) end
        Collect(child)
    end
end
-- By each item's own name.
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
-- Parts drawn for a style the row is not in now: a row reused from a banner for a line or a
-- quest must not keep the banner's art or a rail.
local function Leftovers()
    Shown()
    local out, reused = {}, 0
    for _, row in ipairs(rows) do
        local item = row.shown ~= false and row.row
        if item then
            if row.bannerParts and item.style ~= "banner" then
                reused = reused + 1
                for i, part in ipairs(row.bannerParts) do
                    if part.shown ~= false then table.insert(out, item.label .. " banner part " .. i) end
                end
            end
            for i, rail in ipairs(row.rails or {}) do
                if rail.shown ~= false and i > (item.style ~= "banner" and item.nest or 0) then
                    table.insert(out, item.label .. " rail")
                end
            end
        end
    end
    return table.concat(out, ", "), reused
end
local function Click(label)
    local row = RowFor(label)
    assert(row, "no row " .. label)
    row.scripts.OnClick(row)
end
local function Has(list, label)
    return ("|" .. list .. "|"):find("|" .. label .. "|", 1, true) ~= nil
end

Expect("...the zone landed on before still open beside it", RowFor("Ashenvale").row.open
    and RowFor("Elwynn Forest").row.open, true)
-- Ashenvale closed again and Elwynn Forest chosen, open, for what follows.
Click("Ashenvale")
Click("Elwynn Forest")
Click("Elwynn Forest")

local list = Shown()
Expect("the list opens on the continents' banners, no Azeroth above them", list:find("^Eastern Kingdoms|") ~= nil
    and Has(list, "Kalimdor") and not Has(list, "Azeroth"), true)
Expect("...a banner across the list, its name as it is", RowFor("Eastern Kingdoms").row.style == "banner"
    and RowFor("Eastern Kingdoms").label.text, "Eastern Kingdoms")
Expect("...counting the quests completed out of all", RowFor("Eastern Kingdoms").count.text:match("^1/%d+$") ~= nil, true)
local banner = RowFor("Eastern Kingdoms")
Expect("...drawn as the objective tracker's campaign header, the Alliance's for an Alliance character",
    banner.headMiddle:IsShown() and banner.headMiddle.texture, "file:Objective-Header-CampaignAlliance")
Expect("...without the crest at its left end: its middle from past it", banner.headMiddle.texCoord[1], 64 / 274)
Expect("...its left end the right one turned round", banner.headLeft.texCoord[1] == banner.headRight.texCoord[2]
    and banner.headLeft.texCoord[2] == banner.headRight.texCoord[1] and banner.headLeft.texCoord[1] > banner.headLeft.texCoord[2]
    and banner.headLeft:IsShown() and banner.headRight:IsShown(), true)
Expect("...the quest log's collapse on it while open",
    SpokenEnv.Version.IsRetailVanilla and banner.toggle.texture or banner.toggle.atlas,
    SpokenEnv.Version.IsRetailVanilla and [[Interface\Buttons\UI-MinusButton-Up]] or "questlog-icon-shrink")
Expect("...its numbers ending in the column a zone line's do", banner.count.anchor.point .. " " .. banner.count.anchor.x .. "|"
    .. RowFor("Elwynn Forest").count.anchor.point .. " " .. RowFor("Elwynn Forest").count.anchor.x, "RIGHT -12|RIGHT -12")
faction = "Horde"
Tab:Refresh()
Expect("...the Horde's for a Horde character", RowFor("Eastern Kingdoms").headMiddle.texture, "file:Objective-Header-CampaignHorde")
faction = "Alliance"
Tab:Refresh()
Expect("...each zone a line inside it, with no picture or bar", RowFor("Elwynn Forest").row.style == "group" and RowFor("Elwynn Forest").row.nest, 0)
Expect("...then a banner each for the quests no zone holds: Classes, Professions, Holidays and Events, Other",
    list:find("|Classes|Professions|Holidays and Events|Other$") ~= nil and not Has(list, "Mage")
    and RowFor("Classes").row.style == "banner", true)
local elwynn = RowFor("Elwynn Forest")
Expect("a zone's line: its quests completed out of all and the share, on one line beside its name",
    elwynn.count.text:match("^1/%d+ • %d+%%$") ~= nil, true)
Expect("...with no picture or bar of its own: its picture is on its page",
    elwynn.icon == nil and elwynn.track == nil and elwynn.fill == nil and elwynn.face == nil, true)
Expect("...a plus or minus before its name", elwynn.toggle:IsShown(), true)
Expect("...a step in from the continent's banner", elwynn.indent, 20.4)
Expect("...chosen, the list's own light full with its gold edge", elwynn.selected and elwynn.wash:IsShown()
    and elwynn.wash.alpha == 1 and elwynn.edge:IsShown(), true)
local elwynnTotal = tonumber(elwynn.count.text:match("/(%d+)"))
Expect("...the share completed after them", elwynn.count.text, "1/" .. elwynnTotal .. " • " .. math.floor(100 / elwynnTotal) .. "%")
_G.BreakUpLargeNumbers = function(n) return "<" .. n .. ">" end
Tab:Refresh()
Expect("numbers written as the game writes them in the player's language, on banners and lines",
    RowFor("Eastern Kingdoms").count.text:match("^<1>/<%d+>$") ~= nil
    and RowFor("Elwynn Forest").count.text:match("^<1>/<%d+> • %d+%%$") ~= nil, true)
_G.BreakUpLargeNumbers = nil
Tab:Refresh()
elwynn = RowFor("Elwynn Forest")
Expect("...its page saying where it is and counting its quests, on one line",
    page.sub.text.text:match("^In Eastern Kingdoms · 1 of %d+ completed$") ~= nil, true)
local city = RowFor("Stormwind City")
Expect("a city is a line inside its zone's line", city ~= nil and city.row.style == "group" and city.row.nest, 1)
Expect("...indented under it, 16 further in", city.indent - elwynn.indent, 16)
Expect("...with the line down the open zone's contents beside it", city.rails[1]:IsShown() and city.rails[1].anchor.x, 32.4)
Expect("...not chosen or under the pointer, no light on it", city.wash:IsShown(), false)
city.scripts.OnEnter(city)
Expect("...under the pointer, the list's light over it", city.wash:IsShown(), true)
city.scripts.OnLeave(city)
Expect("...and gone again after", city.wash:IsShown(), false)
Expect("...a quest in the zone a row, as far in", RowFor("Kobold Camp Cleanup").row.leaf and RowFor("Kobold Camp Cleanup").row.nest, 1)
Click("Classes")
list = Shown()
Expect("...Classes opening on a class's quests under its name, this character's class only", Has(list, "Mage") and not Has(list, "Warlock"), true)
Expect("...a line of the list for it, a class being no place", RowFor("Mage").row.style, "group")
Expect("...Classes' page its count alone, being no place", page.title.text == "Classes"
    and page.sub.text.text:match("^%d+ of %d+ completed$") ~= nil, true)
Expect("...Classes' page has a portrait, as no page of the tab goes without one",
    page.face ~= nil and page.headFace.speaker.icon ~= nil, true)
Click("Mage")
Expect("...a class's page naming Classes, not \"In\" it, with its count",
    page.sub.text.text:match("^Classes · %d+ of %d+ completed$") ~= nil, true)
Expect("...a class's page has its class's icon", page.headFace.speaker.icon, [[Interface\Icons\ClassIcon_Mage]])
Click(BINK_CHAIN)
Expect("...a chain in a class naming the class, not \"In\" it", page.title.text .. "|" .. page.sub.text.text,
    BINK_CHAIN .. "|Mage · 0 of 2 completed")
Click("Mage")
Click("Holidays and Events")
Expect("...Events on the festivals and the Darkmoon Faire", Has(Shown(), "Lunar Festival") and Has(Shown(), "Darkmoon Faire"), true)
list = Shown()
Expect("...each holiday a group of its own, Children's Week among them, where the client has Seasonal and Special",
    Has(list, "Feast of Winter Veil") and Has(list, "Hallow's End") and Has(list, "Love is in the Air")
    and Has(list, "Harvest Festival") and Has(list, "Children's Week") and not Has(list, "Seasonal")
    and not Has(list, "Special"), true)
Expect("...the Scourge Invasion named so, not the client's bare Invasion", Has(list, "Scourge Invasion")
    and not Has(list, "Invasion"), true)
Click("Classes")
Click("Holidays and Events")
local leftovers, reused = Leftovers()
Expect("a row drawn as a banner and reused for a line or a quest keeps none of the banner's parts", leftovers, "")
Expect("...as rows were, once the list changed under them", reused > 0, true)
Click("Professions")
Expect("Professions holds Camping, whose quests are Camping 101 for one profession or another", Has(Shown(), "Camping"), true)
Click("Professions")
Click("Other")
list = Shown()
Expect("Other holds the Commendation Signets' hand-ins, the Argent Dawn's and the library books, under those names",
    Has(list, "Commendation Signets") and Has(list, "Argent Dawn") and Has(list, "Library Books")
    and not Has(list, "Reputation"), true)
Expect("...and no Place Unknown: CLUCK!, its last quest, is in Westfall and Tirisfal Glades, where its feed is sold",
    tostring(Has(list, L.QUESTS_ELSEWHERE)) .. "|" .. table.concat(SpokenQuestsCompendium.quests[3861].zones, ","), "false|1436,1420")
Click("Other")
Click("Kalimdor")
Expect("a continent's page is in Azeroth, with its count", page.title.text == "Kalimdor"
    and page.sub.text.text:match("^In Azeroth · %d+ of %d+ completed$") ~= nil, true)
Click("Kalimdor")

-- Zephras Isle is on no continent: under a banner of its own after them, closed with it. The
-- battlegrounds are under a banner of their own, Alterac Valley too, though the client hangs it in
-- Hillsbrad Foothills.
list = Shown()
Expect("the zones on no continent a banner after the continents, then the battlegrounds' banner",
    list:find("|" .. L.QUESTS_SECTION_LANDS .. "|Battlegrounds|Classes|", 1, true) ~= nil
    and RowFor(L.QUESTS_SECTION_LANDS).row.style, "banner")
Expect("...closed, Zephras Isle not shown", Has(list, "Zephras Isle"), false)
Click(L.QUESTS_SECTION_LANDS)
Expect("...opened, Zephras Isle a line inside it", RowFor("Zephras Isle") ~= nil and RowFor("Zephras Isle").row.style == "group"
    and RowFor("Zephras Isle").row.nest, 0)
Expect("...its page in Azeroth, as a continent's, counting their quests", page.title.text == L.QUESTS_SECTION_LANDS
    and page.sub.text.text:match("^In Azeroth · 0 of %d+ completed$") ~= nil, true)
Click(L.QUESTS_SECTION_LANDS)
Expect("...and closed again", Has(Shown(), "Zephras Isle"), false)
list = Shown()
Expect("...the battlegrounds a banner", RowFor("Battlegrounds").row.style, "banner")
Expect("...no battleground among its continent's zones", Has(list, "Alterac Valley"), false)
Click("Battlegrounds")
list = Shown()
Expect("...opening on a line for each battleground", Has(list, "Alterac Valley") and Has(list, "Warsong Gulch")
    and Has(list, "Arathi Basin") and RowFor("Alterac Valley").row.style, "group")
Expect("...but none for a map this client has never heard of", Has(list, "Darkspear Islands") or Has(list, tostring(UNKNOWN_MAP)), false)
local DARKSPEAR_QUEST = 98888 -- Conflict at Darkspear Islands
Expect("...nor a quest there counted or opened in the Compendium", SpokenQuestsCompendium.quests[DARKSPEAR_QUEST].zones[1]
    .. " " .. tostring(Tab:Lists(DARKSPEAR_QUEST)), UNKNOWN_MAP .. " false")
Expect("...its page in Azeroth, counting their quests", page.title.text == L.QUESTS_SECTION_BATTLEGROUNDS
    and page.sub.text.text:match("^In Azeroth · 0 of %d+ completed$") ~= nil, true)
Click("Battlegrounds")
list = Shown()
Expect("a zone opens on its quests", Has(list, "Kobold Camp Cleanup") and Has(list, "Kobold Candles"), true)
Expect("...a quest completed open to read", RowFor("Kobold Camp Cleanup").row.locked, false)
Expect("...one not completed greyed, with the padlock", RowFor("Kobold Candles").row.locked, true)
do
    local locked, open = RowFor("Kobold Candles"), RowFor("Kobold Camp Cleanup")
    GameTooltip.lines = nil
    locked.scripts.OnEnter(locked)
    Expect("...saying under the pointer why it does not open, and which switch opens it",
        table.concat(GameTooltip.lines or {}, "|"),
        "Kobold Candles|" .. string.format(SpokenEnv.L.LOCKED_ROW_FMT, SpokenEnv.L.OPT_UNLOCK_QUESTS))
    locked.scripts.OnLeave(locked)
    GameTooltip.lines = nil
    open.scripts.OnEnter(open)
    Expect("...and, on one that opens, how Shift-click queues it",
        table.concat(GameTooltip.lines or {}, "|"), "Kobold Camp Cleanup|" .. L.QUESTS_SHIFT_QUEUE)
    open.scripts.OnLeave(open)
end

Click("Kobold Camp Cleanup")
Expect("a quest's page: its title", page.title.text, "Kobold Camp Cleanup")
Expect("...with a round portrait left of it: the quest's scroll, the question mark badge as it is completed",
    page.headFace ~= nil and page.headFace.speaker.icon .. " " .. page.headFace.speaker.bullet,
    [[Interface\Icons\INV_Scroll_03]] .. " quest-complete")
Expect("...the title moved right of it", page.shift > 0, true)
Expect("...in its zone", page.sub.text.text, "In Elwynn Forest")
Expect("...on one line, cut short", page.sub.text.wordWrap, false)
do
    local zones = shipped[KOBOLDS].zones
    shipped[KOBOLDS].zones = { 1429, 1436, ASHENVALE }
    Tab:Refresh()
    Expect("...a quest in several zones naming the first two and how many more", page.sub.text.text,
        "In Elwynn Forest, Westfall and 1 more")
    shipped[KOBOLDS].zones = zones
    Tab:Refresh()
end
local words = PageWords() or ""
Expect("...its words in parts, offered then handed in, each under its heading",
    page.body.lastParts ~= nil and page.body.lastParts[1].heading == L.QUEST_PART_ACCEPT
    and page.body.lastParts[#page.body.lastParts].heading == L.QUEST_PART_COMPLETE, true)
Expect("...no Play or Report in the page's corner: each part has its own", tostring(page.play) .. " " .. tostring(page.report),
    "nil nil")
Expect("...no placeholder left in them", words:find("$", 1, true), nil)
Click("Kobold Candles")
Expect("a quest not completed does not open", page.title.text, "Kobold Camp Cleanup")

-- Unlock Unstarted Quests, the switch Spoken's page shows.
C:Tab("quests").unlock.set(true)
Expect("Unlock Unstarted Quests opens it", RowFor("Kobold Candles").row.locked, false)
Click("Kobold Candles")
Expect("...and its page, not completed, the exclamation mark badge", page.headFace.speaker.bullet, "quest-accept")
words = PageWords() or ""
Expect("...all its words, the hand-in too, though it is not completed",
    page.body.lastParts[#page.body.lastParts].heading, L.QUEST_PART_COMPLETE)
Expect("...its words filled for the player: the word for his sex", words:find("Hello, good sir!", 1, true) ~= nil, true)
Expect("...and his name", words:find("Thanks for the candles, Tester,", 1, true) ~= nil, true)
Expect("...and a line break for $B", words:find("moment?\n\nMy brother", 1, true) ~= nil, true)
Expect("...$c and $r his class and race in lower case, as the client writes them, $C and $R capitalised",
    Tab:Fill("Go, young $c. A $r like you; $C of the $R."), "Go, young mage. A human like you; Mage of the Human.")
stub.SetLocale("deDE")
Expect("...and in German capitalised either way, nouns keeping their capital",
    Tab:Fill("young $c, $r"), "young Mage, Human")
stub.SetLocale("enUS")
stub.world.unitSex = 3
Tab:Refresh()
Expect("...and for hers", (PageWords() or ""):find("Hello, my lady!", 1, true) ~= nil, true)
stub.world.unitSex = 2
Expect("...choosing it leaves the counts as they were", RowFor("Elwynn Forest").count.text:match("^1/") ~= nil, true)
C:Tab("quests").unlock.set(false)

-- A quest in the quest log is found too, marked in progress.
local function RowOf(id)
    Shown()
    for _, row in ipairs(rows) do if row.shown ~= false and row.row and row.row.quest == id then return row end end
end
questLog = { CANDLES }
Tab:Refresh()
Expect("a quest in the quest log opens", RowOf(CANDLES).row.locked, false)
Expect("...its row marked in progress, the quest mark before its name", RowOf(CANDLES).status:IsShown()
    and RowOf(CANDLES).status.texture .. " " .. RowOf(CANDLES).label.text, [[Interface\GossipFrame\ActiveQuestIcon]] .. " Kobold Candles")
Expect("...a completed one the quest log's gold tick", RowFor("Kobold Camp Cleanup").status:IsShown()
    and RowFor("Kobold Camp Cleanup").status.atlas .. " " .. RowFor("Kobold Camp Cleanup").label.text,
    "questlog-icon-checkmark-yellow Kobold Camp Cleanup")
Expect("...15 by 13, as every tick in the list is", RowFor("Kobold Camp Cleanup").status.width .. "x"
    .. RowFor("Kobold Camp Cleanup").status.height, "15x13")
Expect("...and its zone's line counts it in progress, apart from the completed",
    RowFor("Elwynn Forest").count.text:match("ActiveQuestIcon.-|t1 +1/%d+ • ") ~= nil, true)
RowOf(CANDLES).scripts.OnClick(RowOf(CANDLES))
Expect("its page: its title", page.title.text, "Kobold Candles")
Expect("...where it is, then the quest mark and In progress", page.sub.text.text,
    "In Elwynn Forest · |TInterface\\GossipFrame\\ActiveQuestIcon:0|t " .. L.QUEST_IN_PROGRESS)
Expect("...and its offer alone: no part for its progress", #page.body.lastParts .. " "
    .. page.body.lastParts[1].heading .. " "
    .. tostring((PageWords() or ""):find("Did you gather those candles yet?", 1, true)), "1 " .. L.QUEST_PART_ACCEPT .. " nil")
Expect("...not the hand-in before it is completed: it tells how the quest ends",
    (PageWords() or ""):find("Thanks for the candles", 1, true) == nil
    and page.body.lastParts[#page.body.lastParts].heading ~= L.QUEST_PART_COMPLETE, true)
Click("Elwynn Forest")
Expect("a zone's page counts it apart from the completed",
    page.sub.text.text:match("^In Eastern Kingdoms · 1 of %d+ completed, 1 in progress$") ~= nil, true)
Click("Elwynn Forest")
VO.Addon.db.global.Compendium.FoundOnly = true
Tab:Refresh()
Expect("Started Only keeps it", RowOf(CANDLES) ~= nil, true)
VO.Addon.db.global.Compendium.FoundOnly = false
-- The list follows the quest log while it is open, once a burst of events is over.
questLog = {}
stub.FireEvent("QUEST_REMOVED", CANDLES)
stub.FireEvent("QUEST_LOG_UPDATE")
Expect("a quest dropped from the log stays until the events settle", RowOf(CANDLES).row.locked, false)
stub.Advance(0.5)
Expect("...then is greyed again", RowOf(CANDLES).row.locked, true)
questLog = { CANDLES }
stub.FireEvent("QUEST_ACCEPTED", 1, CANDLES)
stub.Advance(0.5)
Expect("a quest accepted opens", RowOf(CANDLES).row.locked, false)
questLog = {}
Tab:Refresh()

-- Completing one in the world finds it.
completed[CANDLES] = true
Tab:Refresh()
Expect("a quest completed since opens", RowFor("Kobold Candles").row.locked, false)
Click("Kobold Candles")
Expect("...its page with the hand-in now", (PageWords() or ""):find("Thanks for the candles", 1, true) ~= nil, true)
Click("Kobold Candles")
Expect("...and is counted", RowFor("Elwynn Forest").count.text:match("^2/") ~= nil, true)

-- Started Only.
VO.Addon.db.global.Compendium.FoundOnly = true
Tab:Refresh()
list = Shown()
Expect("Started Only leaves out what is not started", Has(list, "Wolves Across the Border") or Has(list, "Mage"), false)
Expect("...and keeps what is", Has(list, "Kobold Candles"), true)
VO.Addon.db.global.Compendium.FoundOnly = false

-- The search: every match, with what holds it, opened.
local box
for _, child in ipairs(panel.children or {}) do if child.template == "SearchBoxTemplate" then box = child end end
box:SetText("speak with jennea")
box.hooks.OnTextChanged[1](box)
list = Shown()
Expect("a search shows what matches, under what holds it", Has(list, "Mage") and Has(list, "Speak with Jennea")
    and not Has(list, "Kobold Candles"), true)
box:SetText("sharptalon")
box.hooks.OnTextChanged[1](box)
Expect("...and never a quest of the other side", Has(Shown(), "Sharptalon's Claw"), false)
-- A search that matches what holds quests lists all it holds, as one that matches a chain's name.
local function Search(text)
    box:SetText(text)
    box.hooks.OnTextChanged[1](box)
    return Shown()
end
list = Search("westfall")
Expect("a search matching a zone's name lists all its quests, not only those whose titles match",
    Has(list, "Westfall") and Has(list, "The Killing Fields") and RowFor("Westfall").row.open, true)
Expect("...with what holds them inside it, a chain from another zone among them",
    Has(list, "The Jasperlode Mine") and Has(list, "Westfall Stew"), true)
Expect("...and no zone that does not match", Has(list, "Elwynn Forest"), false)
Click("Westfall")
Expect("...a click choosing the zone while searching, its page shown", page.title.text, "Westfall")
Expect("...and closing what the search opened, as a click does unsearched", Has(Shown(), "The Killing Fields"), false)
Click("Westfall")
list = Search("mage")
Expect("a search matching a class lists all that class's quests", Has(list, "Mage") and Has(list, "Speak with Jennea")
    and RowFor("Mage").row.open, true)
list = Search("classes")
Expect("a search matching a section's banner lists its cards, closed", Has(list, "Classes") and Has(list, "Mage")
    and not Has(list, "Speak with Jennea") and RowFor("Mage").row.open, false)
Click("Mage")
Expect("...a card among them opening on a click, as unsearched", Has(Shown(), "Speak with Jennea"), true)
Click("Mage")
Expect("...and closing on another", Has(Shown(), "Speak with Jennea"), false)
list = Search("battlegrounds")
Expect("...the battlegrounds' banner too", Has(list, "Alterac Valley") and not Has(list, "Irondeep Supplies"), true)
list = Search("kalimdor")
Expect("a search matching a continent lists its zones' cards, closed", Has(list, "Kalimdor") and Has(list, "Ashenvale")
    and not Has(list, "Elwynn Forest") and RowFor("Ashenvale").row.open, false)
Click("Ashenvale")
Expect("...a zone among them opening on a click, all its quests listed", RowFor("Ashenvale").row.open
    and #Shown() > #list, true)
Click("Ashenvale")
list = Search("blackrock depths")
Expect("a search matching a dungeon lists all its quests", Has(list, "Blackrock Depths")
    and Has(list, "A Taste of Flame") and not Has(list, "Blackrock Spire"), true)
list = Search("dungeons and raids")
Expect("...and one matching Dungeons and Raids all of a zone's dungeons", Has(list, "Blackrock Depths")
    and Has(list, "Blackrock Spire") and Has(list, "A Taste of Flame"), true)
list = Search("killing fields")
Expect("a title's match inside a zone that does not match still lists that quest alone",
    Has(list, "Westfall") and Has(list, "The Killing Fields") and not Has(list, "Goretusk Liver Pie"), true)
Click("Westfall")
Expect("...a click on the zone the search opened closes it, its quest hidden", Has(Shown(), "Westfall")
    and not Has(Shown(), "The Killing Fields") and RowFor("Westfall").row.open, false)
Click("Westfall")
Expect("...and another opens it again", Has(Shown(), "The Killing Fields"), true)
Click("Westfall")
list = Search("killing field")
Expect("...a new search opening all it finds again", Has(list, "The Killing Fields"), true)
box:SetText("")
box.hooks.OnTextChanged[1](box)

-- Chains: a zone's quests that follow one another under one card, named after the first.
Tab:Open(KOBOLDS)
local function ChainRow(label)
    Shown()
    for _, row in ipairs(rows) do
        if row.shown ~= false and row.row and row.row.kind == "chain" and row.label.text == label then return row end
    end
end
local function ClickChain(label)
    local row = ChainRow(label)
    assert(row, "no chain " .. label)
    row.scripts.OnClick(row)
end
local function RowOfQuest(id)
    Shown()
    for _, row in ipairs(rows) do if row.shown ~= false and row.row and row.row.quest == id then return row end end
end
list = Shown()
Expect("a chain is a line of the list in its zone's line, named after its first quest", ChainRow("Lost Necklace") ~= nil
    and ChainRow("Lost Necklace").row.style == "group" and ChainRow("Lost Necklace").row.nest, 1)
Expect("...its quests inside it, not beside it", RowOfQuest(NECKLACE) or Has(list, "Pie for Billy") or Has(list, "Goldtooth"), false)
Expect("...a quest in no chain still a row of its own", Has(list, "Kobold Camp Cleanup"), true)
Expect("...its plus or minus before its name, no picture", ChainRow("Lost Necklace").toggle:IsShown()
    and not (ChainRow("Lost Necklace").icon and ChainRow("Lost Necklace").icon:IsShown()), true)
Expect("...its quests completed out of all and the share, beside its name", ChainRow("Lost Necklace").count.text, "0/4 • 0%")
Expect("...none completed, none of the share", ChainRow("Lost Necklace").row.none
    and ChainRow("Lost Necklace").count.text:match("• (%d+)%%$"), "0")
local zoneRow = RowFor("Westfall")
Expect("a zone with none completed: its line greyed", zoneRow ~= nil and zoneRow.row.none, true)
completed[NECKLACE], completed[PIE] = true, true
questLog = { BACK }
Tab:Refresh()
Expect("...how many are in progress before them, by the quest mark", ChainRow("Lost Necklace").count.text,
    "|TInterface\\GossipFrame\\ActiveQuestIcon:12:12:0:0|t1   2/4 • 50%")
Expect("...its plus counting what is under way as well as completed, so it opens as Started Only lists it",
    ChainRow("Lost Necklace").row.found == 3 and not ChainRow("Lost Necklace").toggle.desaturated, true)
ClickChain("Lost Necklace")
list = Shown()
Expect("a chain opens on its quests, in the order they are taken",
    list:find("Lost Necklace|Lost Necklace|Pie for Billy|.*Back to Billy|Goldtooth") ~= nil, true)
Expect("...rows one step further in", RowOfQuest(PIE).row.nest, 2)
Expect("...chosen, its page has the chain's name", page.title.text, "Lost Necklace")
Expect("...the zone it is listed in and its count", page.sub.text.text, "In Elwynn Forest · 2 of 4 completed, 1 in progress")
Expect("...and, as a zone's page, no words", PageWords(), "")
Expect("...nothing to play on it", page.play, nil)
Expect("...a chain is quests: the quest's scroll with the exclamation mark badge while any is open",
    page.headFace ~= nil and page.headFace.speaker.icon .. " " .. page.headFace.speaker.bullet,
    [[Interface\Icons\INV_Scroll_03]] .. " quest-accept")
Expect("...the divider 10 under the line under the title, which the face reaches past by 2",
    select(5, page.divider:GetPoint()), -12)
do
    page:Show({ title = "No Line Under It" })
    Expect("a page with no line under its title: the divider clear of the face", select(5, page.divider:GetPoint()), -27)
    GameTooltip.lines = nil
    page.titleHit.scripts.OnEnter(page.titleHit)
    Expect("...a title shown whole, nothing under the pointer", GameTooltip.lines, nil)
    page.title.IsTruncated = function() return true end
    page.titleHit.scripts.OnEnter(page.titleHit)
    Expect("...one cut short, whole in the tooltip", table.concat(GameTooltip.lines or {}, "|"), "No Line Under It")
    page.titleHit.scripts.OnLeave(page.titleHit)
    page.title.IsTruncated = nil
    page:Show({ title = "Nothing Written", empty = true })
    Expect("an empty page shows its mark", page.mark:IsShown(), true)
    page:Show({ title = "Nothing Written", empty = true, picture = { file = "Interface\\Elwynn" } })
    Expect("...but not under a place's picture", page.mark:IsShown(), false)
    ClickChain("Lost Necklace")
    ClickChain("Lost Necklace")
end
completed[BACK], completed[GOLDTOOTH] = true, true
questLog = {}
Tab:Refresh()
Expect("a chain all completed gets the gold tick after its numbers, no share", ChainRow("Lost Necklace").status:IsShown()
    and ChainRow("Lost Necklace").count.text, "4/4")
Expect("...the quest log's gold tick, where a single quest's goes", ChainRow("Lost Necklace").row.tick
    and ChainRow("Lost Necklace").status.atlas, "questlog-icon-checkmark-yellow")
Expect("...at the same size", ChainRow("Lost Necklace").status.width .. "x" .. ChainRow("Lost Necklace").status.height, "15x13")
ClickChain("Lost Necklace")
Expect("...and closes again", Has(Shown(), "Pie for Billy"), false)
Tab:Open(PIE)
Expect("opened on a quest of a chain, the chain is opened to it", RowFor("Pie for Billy") ~= nil
    and RowFor("Pie for Billy").selected, true)
box:SetText("pie for")
box.hooks.OnTextChanged[1](box)
list = Shown()
Expect("a search finds a quest inside its chain", Has(list, "Pie for Billy") and ChainRow("Lost Necklace") ~= nil
    and RowOfQuest(NECKLACE), nil)
box:SetText("")
box.hooks.OnTextChanged[1](box)
for _, id in ipairs({ NECKLACE, PIE, BACK, GOLDTOOTH }) do completed[id] = nil end
VO.Addon.db.global.Compendium.FoundOnly = true
Tab:Refresh()
Expect("Started Only leaves out a chain with nothing started", ChainRow("Lost Necklace"), nil)
VO.Addon.db.global.Compendium.FoundOnly = false
Tab:Refresh()

-- A chain's name is the same in every zone it crosses: its first quest's, though that quest is in
-- another zone, or the name the data gives that quest.
Click("Westfall")
Expect("a click on a second zone's card opens it beside the open one, both open",
    RowFor("Westfall").row.open and RowFor("Elwynn Forest").row.open and Has(Shown(), "Kobold Camp Cleanup"), true)
Click("Elwynn Forest")
Expect("...and a click on one closes it alone", tostring(RowFor("Elwynn Forest").row.open) .. "|"
    .. tostring(RowFor("Westfall").row.open), "false|true")
Expect("a chain's card in a zone it crosses into has the chain's name: its first quest's, from another zone",
    ChainRow("The Jasperlode Mine") ~= nil and ChainRow("The Jasperlode Mine").row.nest == 1
    and ChainRow("Westfall Stew"), nil)
shipped[JASPERLODE].name = 64 -- The Forgotten Heirloom
Tab:Refresh()
Expect("...or the quest whose title the data names it after", ChainRow("The Forgotten Heirloom") ~= nil
    and ChainRow("The Jasperlode Mine"), nil)
shipped[JASPERLODE].name = { "Mine and Stew", deDE = "Mine und Eintopf" }
Tab:Refresh()
Expect("...or words of its own", ChainRow("Mine and Stew") ~= nil, true)
ClickChain("Mine and Stew")
Expect("...its page under that name", page.title.text, "Mine and Stew")
stub.SetLocale("deDE")
Tab:Refresh()
Expect("...in the client's language where the data has it", ChainRow("Mine und Eintopf") ~= nil, true)
stub.SetLocale("enUS")
shipped[JASPERLODE].name = nil
Tab:Refresh()
ClickChain("The Jasperlode Mine")
Click("Westfall")
Click("Elwynn Forest")

-- Chains of one name side by side in one place are told apart by a number.
Tab:Open(VERNER)
do
    local first, second = ChainRow("Messenger to Stormwind (1)"), ChainRow("Messenger to Stormwind (2)")
    Expect("chains of one name in one place are numbered, in the order of their first quests' ids",
        first and second and (first.row.first .. "|" .. second.row.first), SHOES .. "|" .. MESSENGER)
end
ClickChain("Messenger to Stormwind (2)")
Expect("...the number on the chain's page too", page.title.text, "Messenger to Stormwind (2)")
ClickChain("Messenger to Stormwind (2)")
Expect("a chain whose first quest this character may not take is named after the first it may",
    ChainRow("A Watchful Eye") ~= nil and ChainRow("Redridge Goulash"), nil)
shipped[GOULASH].name = { "Goulash and After" }
Tab:Refresh()
Expect("...unless the data gives the chain a name", ChainRow("Goulash and After") ~= nil and ChainRow("A Watchful Eye"), nil)
shipped[GOULASH].name = nil
Tab:Refresh()
Click(C.MapName(REDRIDGE))

-- Play: the first part the voice packs have of the quest, with its words. Kobold Camp Cleanup is
-- made here to be handed in to another than its giver: Marshal McBride offers it, Marshal Dughan
-- takes it in.
local MCBRIDE, DUGHAN = 197, 240
local testPack = {
    SoundLengthLookupByFileName = { ["7-accept"] = 2, ["7-complete"] = 2, ["85-accept"] = 2, ["85-complete"] = 2 },
    GetSoundPath = function(_, fileName) return fileName .. ".ogg" end,
    NPCIDLookupByQuestID = { [KOBOLDS] = MCBRIDE },
    NPCNameLookupByNPCID = { [MCBRIDE] = "Marshal McBride", [DUGHAN] = "Marshal Dughan" },
}
VO.DataModules:Register("TestPack", testPack)
SpokenQuestsCompendium.quests[KOBOLDS].ender = DUGHAN
local function Who()
    local clip = Spoken:GetQueue()[1]
    return clip and (tostring(clip.name) .. " " .. tostring(clip.unitGUID))
end
local function Npc(name, id) return name .. " " .. VO.Utils:MakeGUID(VO.Enums.GUID.Creature, id) end
-- The face is from the shipped data (Data/QuestFaces.lua), not what the client answers.
stub.world.creatureDisplays[MCBRIDE], stub.world.creatureDisplays[DUGHAN] = { 3258 }, { 1990 }
Click("Kobold Camp Cleanup")
-- Without DialogueUI, each part's header is the Small Window's: the face of who says it with the
-- part's badge, their name over the part's name.
local function PartOf(heading)
    -- The speaker's name is the heading and the part's name the line over it; with no speaker the part's name is the heading.
    for _, part in ipairs(page.body.lastParts or {}) do
        if part.caption == heading or (part.caption == nil and part.heading == heading) then return part end
    end
end
local BOOK = [[Interface\AddOns\Spoken\Textures\Book]]
local function Face(part)
    local face = part.face
    if not face then return "no face" end
    local drawn = face.still:IsShown() and "still " .. tostring(face.still.display)
        or face.viewport.texture and face.viewport.texture:IsShown() and face.viewport.texture:GetTexture() or "nothing"
    return drawn .. " " .. tostring(face.badge:GetTexture()) .. " " .. tostring(part.caption and part.heading or nil)
end
local BADGES = SpokenEnv.Face.BADGES
Expect("without DialogueUI, no DialogueUI header on either part",
    tostring(PartOf(L.QUEST_PART_ACCEPT).header) .. " " .. tostring(PartOf(L.QUEST_PART_COMPLETE).header), "nil nil")
Expect("the offer is named its description, the hand-in its completion",
    L.QUEST_PART_ACCEPT .. "|" .. L.QUEST_PART_COMPLETE, "Description|Completion")
Expect("the offer's header: its giver's face with the offer's badge, and its giver's name",
    Face(PartOf(L.QUEST_PART_ACCEPT)), "still 1859 " .. BADGES["quest-accept"] .. " Marshal McBride")
Expect("...the completion's: the face and name of the one it is handed in to, with the completion's badge",
    Face(PartOf(L.QUEST_PART_COMPLETE)), "still 1985 " .. BADGES["quest-complete"] .. " Marshal Dughan")
do
    local part = PartOf(L.QUEST_PART_ACCEPT)
    Expect("...the face 44 across, shown at the left of the heading's line", part.face:GetWidth() .. " "
        .. tostring(part.face:IsShown()) .. " " .. part.face.anchor.point .. " " .. part.face.anchor.x
        .. " " .. tostring(part.face.anchor.relativeTo == page.body.child), "44 true LEFT 0 true")
    Expect("...the speaker's name its heading, and the part's name shown over it", part.heading .. " "
        .. tostring(page.body.parts[1].caption:IsShown()) .. " " .. tostring(page.body.parts[1].caption.text),
        "Marshal McBride true " .. L.QUEST_PART_ACCEPT)
end
local play = PartButton(L.QUEST_PART_ACCEPT, "play")
Expect("a voiced part has Play on its heading's line", play ~= nil and play:IsShown(), true)
Expect("...and Report beside it", PartButton(L.QUEST_PART_ACCEPT, "report") ~= nil
    and PartButton(L.QUEST_PART_ACCEPT, "report"):IsShown(), true)
do
    -- The page's own buttons end over the words' right edge, 36 + the bar's room from the
    -- page's right: a part's rightmost ends there too.
    local body, report = page.body, PartButton(L.QUEST_PART_ACCEPT, "report")
    local width = body.frame.width
    body.frame.width = 400
    body:SetParts(body.lastParts)
    local fromPageRight = body.frame.anchor.x - (400 - report.anchor.x)
    Expect("...ending in the column the page's own Play and Report end in",
        report.anchor.relativeTo == body.child and fromPageRight, -(36 + body:BarRoom()))
    -- A page's words start 18 down (the top fade's room); the first heading's line, as tall as its
    -- speaker's face (44), starts there too, and its buttons are centred on the face.
    Expect("...the first heading's line, as tall as its face, starting where a page's words do", report.anchor.y,
        -(18 + 22))
    body.frame.width = width
    -- Headings grow with the words' size, up to 20.
    local heading, size = body.parts[1].heading, nil
    local titleFont = _G.QuestTitleFont
    _G.QuestTitleFont = { GetFont = function() return "Fonts/MORPHEUS.TTF", 18 end }
    heading.SetFont = function(_, _, s) size = s end
    Spoken:SetCompendiumFontSize(12)
    body:SetParts(body.lastParts)
    Expect("...a part's heading 7 larger than the words", size, 19)
    Spoken:SetCompendiumFontSize(18)
    body:SetParts(body.lastParts)
    Expect("...and no larger than 20, under the page's title", size, 20)
    Spoken:SetCompendiumFontSize(12)
    _G.QuestTitleFont, heading.SetFont = titleFont, nil
    body:SetParts(body.lastParts)
end
-- A part with a face: the face at the left of the heading's line, which is as tall as it, and the
-- caption over the heading right of it, the two centred on the line, as the buttons are.
do
    local body, report = page.body, PartButton(L.QUEST_PART_ACCEPT, "report")
    local parts = body.lastParts
    local face = CreateFrame("Frame", nil, body.child)
    face:SetSize(44, 44)
    local slot = body.parts[1]
    local points, restore = {}, {}
    local function Record(region, name)
        local set = region.SetPoint
        restore[region] = set
        region.SetPoint = function(self, point, rel, relPoint, x, y)
            points[name .. " " .. point] = (type(rel) == "number" and rel or x) .. "," .. (type(rel) == "number" and relPoint or y)
            return set(self, point, rel, relPoint, x, y)
        end
    end
    Record(face, "face"); Record(slot.caption, "caption"); Record(slot.heading, "heading")
    Record(slot.words, "words"); Record(report, "report")
    slot.heading.GetStringHeight = function() return 22 end
    slot.caption.GetStringHeight = function() return 14 end
    body:SetParts({ { heading = L.QUEST_PART_ACCEPT, caption = "Marshal McBride", text = "Words.", face = face,
        buttons = { report } } })
    -- The line 44 tall from the words' top (18), its middle 40 down; caption and heading 38 together,
    -- from 21 down.
    Expect("a part's face at the left of its heading's line, as tall as the face", face:IsShown() and points["face LEFT"], "0,-40")
    Expect("...its buttons centred on the face", points["report RIGHT"]:match(",(.*)$"), "-40")
    Expect("...the caption right of the face, above the heading", slot.caption:IsShown() and slot.caption.text .. " "
        .. points["caption LEFT"], "Marshal McBride 52,-28")
    Expect("...and the heading under it", slot.heading.text .. " " .. points["heading LEFT"], L.QUEST_PART_ACCEPT .. " 52,-48")
    Expect("...the words 10 under the line", points["words TOPLEFT"], "0,-72")
    body:SetParts({ { heading = L.QUEST_PART_ACCEPT, text = "Words.", buttons = { report } } })
    Expect("a part without a face lays out as before: no caption, the heading at the left, the face put away",
        tostring(slot.caption:IsShown()) .. " " .. points["heading LEFT"] .. " " .. tostring(face:IsShown()), "false 0,-27 false")
    for region, set in pairs(restore) do region.SetPoint = set end
    slot.heading.GetStringHeight, slot.caption.GetStringHeight = nil, nil
    body:SetParts(parts)
end
play.scripts.OnClick(play)
local queued = {}
for _, clip in ipairs(Spoken:GetQueue()) do table.insert(queued, clip.fileName) end
Expect("...which plays that part alone, not the hand-in after it", table.concat(queued, ","), "7-accept")
Expect("...named and pictured for its giver", Who(), Npc("Marshal McBride", MCBRIDE))
local playing = Spoken:GetQueue()[1]
Expect("...with the offer's words, for the window to show and highlight",
    playing and type(playing.text) == "string" and playing.text ~= "" and PageWords():find(playing.text, 1, true) ~= nil, true)
-- A button's tooltip, its lines as one, the pointer put on it; or as it stands, with `asIs`.
local function Tip(button, asIs)
    if not asIs then
        GameTooltip.lines = nil
        for _, hook in ipairs(button.hooks and button.hooks.OnEnter or {}) do hook(button) end
    end
    return table.concat(GameTooltip.lines or {}, "|")
end
local function PlayTip() return Tip(play) end
local S = SpokenEnv.L
Expect("...its tooltip naming Stop while it plays, and what Stop does", PlayTip(), S.STOP .. "|" .. S.STOP_READING_TIP)
local handIn = PartButton(L.QUEST_PART_COMPLETE, "play")
handIn.scripts.OnClick(handIn)
queued = {}
for _, clip in ipairs(Spoken:GetQueue()) do table.insert(queued, clip.fileName) end
Expect("...the hand-in's Play playing the hand-in in its place", queued[1], "7-complete")
Expect("...named and pictured for the one it is handed in to, not its giver", Who(), Npc("Marshal Dughan", DUGHAN))
local function Names()
    local names = {}
    for _, clip in ipairs(Spoken:GetQueue()) do table.insert(names, clip.fileName) end
    return table.concat(names, ",")
end
-- Stop and Replay, as the quest log's Play and the subtitle have them.
handIn.scripts.OnClick(handIn)
Expect("a part's Stop stops it and keeps it at the head", tostring(Spoken:IsPaused()) .. " " .. Names(), "true 7-complete")
Expect("...its Play showing Replay", handIn.pageState, "replay")
Expect("...named Replay in its tooltip, with what Replay does", Tip(handIn), S.REPLAY .. "|" .. S.REPLAY_READING_TIP)
handIn.scripts.OnClick(handIn)
Expect("...Replay plays it again from the start", not Spoken:IsPaused() and Spoken:GetNowPlaying()
    and Spoken:GetNowPlaying().fileName, "7-complete")
Expect("...and shows Stop again", handIn.pageState, "stop")
Expect("...its tooltip, the pointer still on it, redrawn for Stop at once", Tip(handIn, true), S.STOP .. "|" .. S.STOP_READING_TIP)
-- Another part, not queued: it starts and the part playing gives way, one part of a quest at a time.
play.scripts.OnClick(play)
Expect("Play on another part of the quest plays it in place of the part playing", Names(), "7-accept")
SpokenQuestsCompendium.quests[KOBOLDS].ender = nil
handIn.scripts.OnClick(handIn)
Expect("...and for its giver where the data names no one else", Who(), Npc("Marshal McBride", MCBRIDE))
Tab:Refresh()
Expect("...its header then the giver's face and name", Face(PartOf(L.QUEST_PART_COMPLETE)),
    "still 1859 " .. BADGES["quest-complete"] .. " Marshal McBride")
-- Waiting behind another quest's line: left where it is while that speaks, played at once once it is
-- stopped.
Spoken:StopAll()
VO.Player:PlayNow({ event = VO.Enums.SoundEvent.QuestAccept, questID = NECKLACE })
play.scripts.OnClick(play)
Expect("a part played while another quest's line speaks waits behind it", Names(), "85-accept,7-accept")
Expect("...its Play still Play", play.pageState, "play")
play.scripts.OnClick(play)
Expect("...a second click leaving it where it is", Names(), "85-accept,7-accept")
Spoken:Pause()
Expect("...still Play behind the line once that is stopped", play.pageState, "play")
play.scripts.OnClick(play)
Expect("...and then a click plays it at once, the stopped line kept behind it", tostring(Spoken:IsPaused()) .. " "
    .. Names() .. " " .. tostring(Spoken:GetNowPlaying() and Spoken:GetNowPlaying().fileName), "false 7-accept,85-accept 7-accept")
Expect("...showing Stop", play.pageState, "stop")
Spoken:StopAll()
Expect("...Play again once nothing is queued, its tooltip saying what the part's Play does", play.pageState .. " " .. PlayTip(),
    "play " .. S.PLAY .. "|" .. L.QUEST_PART_PLAY_TIP)
-- A part's Report ends its tooltip with the line about its right-click, where the debug log's menu is.
Spoken:RegisterDeveloper({ MenuHint = function() return "Right-click: the debug log" end })
Expect("a part's Report tooltip ends with the debug log's menu hint", Tip(PartButton(L.QUEST_PART_ACCEPT, "report")),
    L.OPT_REPORT_PROBLEM .. "|" .. L.OPT_REPORT_QUEST_TIP .. "|Right-click: the debug log")
Spoken:RegisterDeveloper(nil)
Click("Kobold Candles")
Expect("a quest no pack has has a greyed Play", PartButton(L.QUEST_PART_ACCEPT, "play") ~= nil
    and PartButton(L.QUEST_PART_ACCEPT, "play"):IsShown() and not PartButton(L.QUEST_PART_ACCEPT, "play"):IsEnabled(), true)
Expect("...but Report: a line no pack voices can be wrong too", PartButton(L.QUEST_PART_ACCEPT, "report") ~= nil
    and PartButton(L.QUEST_PART_ACCEPT, "report"):IsShown(), true)
Expect("...and, no one known to say it, the book in its face and no name over its heading",
    Face(PartOf(L.QUEST_PART_ACCEPT)), BOOK .. " " .. BADGES["quest-accept"] .. " nil")
-- A part a pack voices whose words are not known: there, saying so, with its Play and Report.
do
    local words = SpokenQuestsText[KOBOLDS].complete
    SpokenQuestsText[KOBOLDS].complete = nil
    Click("Kobold Camp Cleanup")
    local last = page.body.lastParts[#page.body.lastParts]
    Expect("a voiced part with no words known keeps its part, saying no words are known",
        (last.caption or last.heading) .. "|" .. last.text, L.QUEST_PART_COMPLETE .. "|" .. L.QUEST_PART_NO_TEXT)
    Expect("...with Play and Report", PartButton(L.QUEST_PART_COMPLETE, "play"):IsShown()
        and PartButton(L.QUEST_PART_COMPLETE, "report"):IsShown(), true)
    local handInPlay = PartButton(L.QUEST_PART_COMPLETE, "play")
    handInPlay.scripts.OnClick(handInPlay)
    Expect("...its Play playing it", Spoken:GetNowPlaying() and Spoken:GetNowPlaying().fileName, "7-complete")
    Spoken:StopAll()
    SpokenQuestsText[KOBOLDS].complete = words
    local handInWords = SpokenQuestsText[CANDLES].complete
    SpokenQuestsText[CANDLES].complete = nil
    Click("Kobold Candles")
    Expect("a part with no words known that no pack voices is left out", #page.body.lastParts .. " "
        .. page.body.lastParts[1].heading, "1 " .. L.QUEST_PART_ACCEPT)
    SpokenQuestsText[CANDLES].complete = handInWords
    -- A quest Forever has that the corpus has no lines for says nothing is written.
    local candles = SpokenQuestsText[CANDLES]
    SpokenQuestsText[CANDLES] = nil
    Click("Kobold Camp Cleanup")
    Click("Kobold Candles")
    Expect("a quest with no words in the corpus says nothing is written", PageWords(), SpokenCompendium.NotWritten())
    Expect("...with Contribute under it", page.contribute:IsShown(), true)
    SpokenQuestsText[CANDLES] = candles
    Click("Kobold Camp Cleanup")
    Click("Kobold Candles")
    Expect("...its words back once the corpus has them", PageWords() ~= SpokenCompendium.NotWritten(), true)
end
ClickChain("Lost Necklace")
completed[NECKLACE] = true
Tab:Refresh()
Expect("a chain's page has no Play, even with a voiced quest started: its quests are on the left", page.play, nil)
completed[NECKLACE] = nil
ClickChain("Lost Necklace")

-- Voiced Only, after Started Only in the filter menu: the quests no voice pack has are left out,
-- with any card or banner left with nothing, and out of the counts. The test pack has Kobold Camp
-- Cleanup and Lost Necklace.
local function Menu()
    local entries = {}
    for _, info in ipairs(stub.OpenDropdown(panel.filterMenu)) do table.insert(entries, info.text) end
    return table.concat(entries, "|"), stub.OpenDropdown(panel.filterMenu)
end
Expect("the filter menu holds Started Only, then Voiced Only", (Menu()), L.QUESTS_FOUND_ONLY .. "|" .. L.QUESTS_VOICED_ONLY)
local _, choices = Menu()
choices[2].func()
list = Shown()
Expect("Voiced Only leaves out the quests no pack has", Has(list, "Kobold Candles"), false)
Expect("...and keeps those it has, in what holds them", Has(list, "Kobold Camp Cleanup") and Has(list, "Elwynn Forest")
    and ChainRow("Lost Necklace") ~= nil, true)
Expect("...leaving out a zone, a continent and a section with none", Has(list, "Westfall") or Has(list, "Kalimdor")
    or Has(list, "Classes"), false)
Expect("...each card counting only the quests it lists", RowFor("Elwynn Forest").count.text:match("^1/2 ") ~= nil
    and ChainRow("Lost Necklace").count.text, "0/1 • 0%")
Expect("...and each banner", RowFor("Eastern Kingdoms").count.text, "1/2")
Expect("...and is remembered", VO.Addon.db.global.Compendium.VoicedOnly, true)
do
    -- Every quest under every banner is asked whether a pack voices it: once, not on each refresh or
    -- keystroke, until the packs or the voice languages change. The page's own parts are asked each time.
    local prepare, asked = VO.DataModules.PrepareSound, 0
    VO.DataModules.PrepareSound = function(...) asked = asked + 1; return prepare(...) end
    Tab:Refresh()
    Expect("...each quest's voice asked once, not again on a refresh", asked < 20, true)
    local order = VO.Language.ResolutionOrder
    VO.Language.ResolutionOrder = function() return { "deDE" } end
    asked = 0
    Tab:Refresh()
    Expect("...and again once the voice language changes", asked > 100, true)
    VO.Language.ResolutionOrder = order
    VO.DataModules.PrepareSound = prepare
    Tab:Refresh()
end
Expect("...a started quest it leaves out still opened in the Compendium", Tab:Has(CANDLES), true)
Tab:Open(CANDLES)
Expect("...on its page, the list keeping the filter and leaving its row out", page.title.text .. "|"
    .. tostring(VO.Addon.db.global.Compendium.VoicedOnly) .. "|" .. tostring(Has(Shown(), "Kobold Candles")),
    "Kobold Candles|true|false")
_, choices = Menu()
choices[2].func()
Expect("...off, everything again", Has(Shown(), "Kobold Candles") and Has(Shown(), "Westfall") and Tab:Has(CANDLES), true)
-- The page has no progress part, so a quest a pack voices only in its progress counts as unvoiced.
do
    testPack.SoundLengthLookupByFileName["60-progress"] = 2
    testPack.NPCIDLookupByQuestID[CANDLES] = MCBRIDE
    Expect("(a pack voicing Kobold Candles' progress)",
        VO.DataModules:PrepareSound({ event = VO.Enums.SoundEvent.QuestProgress, questID = CANDLES }) and true, true)
    _, choices = Menu()
    choices[2].func()
    Expect("a quest a pack voices only in its progress is left out by Voiced Only", Has(Shown(), "Kobold Candles"), false)
    _, choices = Menu()
    choices[2].func()
    local shift = _G.IsShiftKeyDown
    _G.IsShiftKeyDown = function() return true end
    Spoken:StopAll()
    Click("Kobold Candles")
    Expect("...and shift-click on its row plays nothing", Spoken:GetQueueSize(), 0)
    _G.IsShiftKeyDown = shift
    testPack.SoundLengthLookupByFileName["60-progress"] = nil
    testPack.NPCIDLookupByQuestID[CANDLES] = nil
end
-- A switch in the filter menu leaving out the chosen row tells the tab (onHidden), which says what
-- the page shows in its place.
do
    local listObject = RowFor("Eastern Kingdoms").list
    local hidden, onHidden = 0, listObject.opts.onHidden
    Expect("the tab answers the list's onHidden", type(onHidden), "function")
    listObject.opts.onHidden = function() hidden = hidden + 1 end
    local wasOpen = RowFor("Classes").row.open
    Click("Classes")
    local chosen = RowFor("Classes").selected
    _, choices = Menu()
    choices[2].func()
    Expect("a filter leaving out the chosen row tells the tab, once", chosen and hidden, 1)
    _, choices = Menu()
    choices[2].func()
    Expect("...and one that leaves it in does not", hidden, 1)
    listObject.opts.onHidden = onHidden
    if RowFor("Classes").row.open ~= wasOpen then Click("Classes") end
end
-- What the page shows then: the nearest row above the one chosen that the list still shows.
local WOLVES = 33 -- Wolves Across the Border, in Elwynn Forest, not started
Tab:Open(WOLVES)
_, choices = Menu()
choices[1].func()
Expect("Started Only leaving out the quest chosen, its zone is chosen, which the list still shows", page.title.text,
    "Elwynn Forest")
_, choices = Menu()
choices[1].func()
-- Where the tab chose for the player, it lands again. Classes chosen and left out, there is nothing
-- above it: the tab lands, the player in Westfall, where no pack has a quest.
stub.world.playerMapID = 1436
Click("Classes")
_, choices = Menu()
choices[2].func()
Expect("landing, never on a zone Voiced Only leaves out: on its continent", page.title.text, "Eastern Kingdoms")
_, choices = Menu()
choices[2].func()
Tab:Open()
Expect("...on the zone itself with the filter off", page.title.text, "Westfall")
_, choices = Menu()
choices[2].func()
Expect("...and a filter leaving out the zone landed on lands again, on its continent", page.title.text, "Eastern Kingdoms")
_, choices = Menu()
choices[2].func()
stub.world.playerMapID = nil
if RowFor("Classes").row.open then Click("Classes") end

-- Text Size, on Spoken's page: the words read at it, and drawn again when it changes.
do
    local text, questFont = page.body.text, _G.QuestFont
    _G.QuestFont = { GetFont = function() return "Fonts/FRIZQT__.TTF", 12 end }
    local setFont, drawnAt = text.SetFont, nil
    text.SetFont = function(self, face, size, ...) drawnAt = size; if setFont then return setFont(self, face, size, ...) end end
    Spoken:SetCompendiumFontSize(16)
    -- The parchment's ink is drawn a point larger than the Text Size.
    Expect("the page's words at the Compendium's Text Size, drawn again when it changes",
        Spoken:CompendiumFontSize() .. "|" .. tostring(drawnAt), "16|" .. (16 + 1))
    text.SetFont, _G.QuestFont = setFont, questFont
    Spoken:SetCompendiumFontSize(12)
end

-- The part switched off takes its tab away.
C:Open("quests")
Spoken:SetPartOn("quests", false)
Expect("Quests switched off while the window shows its tab, the window closes", C:IsOpen(), false)
Expect("with Quests off, the tab is not offered", C:Select("quests"), nil)
Spoken:SetPartOn("quests", true)

-- Quests is the first tab, before Places and Readables, and gives the window its title.
C:Register("places", { label = "Places", order = 1, build = function() end })
C:Register("readables", { label = "Readables", order = 2, build = function() end })
Expect("Quests is the first tab", _G.SpokenCompendiumWindowTab1:GetText(), L.COMPENDIUM_QUESTS)
Expect("...Places and Readables after it", _G.SpokenCompendiumWindowTab2:GetText() .. "|" .. _G.SpokenCompendiumWindowTab3:GetText(),
    "Places|Readables")
Expect("...and the window has its title", C.window.title, SpokenEnv.L.OPT_COMPENDIUM_TITLE)
-- Opened from the minimap menu, on the first tab until the player has chosen one with the tabs.
C:Select("readables")
C:Hide()
C:Toggle()
Expect("the window opened from the minimap opens on Quests, whichever tab a part showed last", C:IsOpen("quests"), true)
_G.SpokenCompendiumWindowTab2.scripts.OnClick(_G.SpokenCompendiumWindowTab2)
C:Hide()
C:Toggle()
Expect("...and once the player has chosen a tab, on that one", C:IsOpen("places"), true)
C:Hide()
C:Select("quests")

---------------------------------------------------------------- Open in Azeroth's Compendium
-- Opened on a quest: chosen, with its zone, continent or group opened, and its page shown.
local HEIRLOOM = 64
C:Hide()
Tab:Open(HEIRLOOM)
Expect("opened on a quest, the window shows the Quests tab", C:IsOpen("quests"), true)
Expect("...with the quest's zone opened to it", Has(Shown(), "The Forgotten Heirloom"), true)
Expect("...the quest chosen", RowFor("The Forgotten Heirloom").selected, true)
Expect("...and its page shown", page.title.text, "The Forgotten Heirloom")
Tab:Open(JENNEA)
Expect("a class's quest opens under its class", Has(Shown(), "Speak with Jennea") and page.title.text, "Speak with Jennea")
Expect("...its page naming its section and its class, neither a place", page.sub.text.text, "Classes · Mage")
local IRONDEEP = 5892
Tab:Open(IRONDEEP)
Expect("a battleground's quest opens under the battlegrounds' banner", Has(Shown(), "Irondeep Supplies")
    and RowFor("Battlegrounds").row.open and page.title.text, "Irondeep Supplies")
local ashenvaleQuest
for id, quest in pairs(SpokenQuestsCompendium.quests) do
    if not ashenvaleQuest and quest.zones and quest.zones[1] == ASHENVALE and Tab:Lists(id) and not quest.dungeon then
        ashenvaleQuest = id
    end
end
Unmeasured()
Tab:Open(ashenvaleQuest)
LaidOut()
Expect("opened on a quest far down the list, a frame later its row is in view", InView(nil, ashenvaleQuest), true)
Measured()

-- A zone's dungeons' and raids' quests: a line inside its line, named after the dungeon
-- where the zone has one; in a zone with several, Dungeons and Raids, a line for each
-- dungeon inside that.
local STOCKADE, DARK_IRON = 386, 3801
Tab:Open(STOCKADE)
list = Shown()
local dungeons = RowFor("Stormwind Stockade")
Expect("opened on a dungeon's quest, its zone's line of its dungeon is opened to it", dungeons ~= nil
    and dungeons.row.style == "group" and dungeons.row.open and Has(list, "What Comes Around...") and page.title.text,
    "What Comes Around...")
Expect("...named after the zone's one dungeon, not Dungeons and Raids", Has(list, "Dungeons and Raids"), false)
Expect("...a line inside the city's line, one level above its quests", dungeons.row.nest, 2)
Expect("...its quests straight inside", RowFor("What Comes Around...").row.nest, 3)
stub.SetLocale("deDE")
Tab:Refresh()
Expect("...the dungeon's name in the client's language", RowFor("Verlies von Stormwind") ~= nil, true)
stub.SetLocale("enUS")
Tab:Refresh()
Tab:Open(DARK_IRON)
list = Shown()
Expect("in a zone with several dungeons, a line for each inside Dungeons and Raids",
    Has(list, "Blackrock Depths") and Has(list, "Blackrock Spire") and RowFor("Blackrock Depths").row.style == "group"
    and RowFor("Blackrock Depths").row.nest, 2)
Click("Dungeons and Raids")
Expect("...the line's page with its zone's portrait, not the question mark", page.headFace.speaker.icon ~= [[Interface\Icons\INV_Misc_QuestionMark]], true)
Click("Dungeons and Raids")
Expect("...the dungeon's quests inside its own line", Has(list, "Dark Iron Legacy") and RowFor("Dark Iron Legacy").row.nest >= 3, true)
Click("Blackrock Spire")
Expect("...a dungeon's page in the zone of its entrance, counting its quests", page.title.text == "Blackrock Spire"
    and page.sub.text.text:match("^In Searing Gorge · 0 of %d+ completed$") ~= nil, true)
do
    list = Shown()
    Click("Searing Gorge")
    -- Places' picture of the place above its page, where Places has one.
    Expect("a place's page has no picture while Places has none", page.body.picture:IsShown(), false)
    _G.Spoken.PlacePicture = function(_, mapID, key) return "pic" .. mapID .. (key or ""), "mask" end
    Tab:Refresh()
    Expect("...and Places' picture of the place when it has", page.body.picture:IsShown() and page.body.picture:GetTexture(), "pic1427")
    _G.Spoken.PlacePicture = nil
    list = Shown()
    Click("Searing Gorge")
    list = Shown()
    Click("Blackrock Spire")
    list = Shown()
end

-- The line under a page's title is plain words: it leads nowhere.
Tab:Open(STOCKADE)
Expect("the line under a quest's title is not a link", page.sub.onClick, nil)
Tab:Open(IRONDEEP)

-- The quest giver's window: the Compendium's tome beside its controls, for a quest the tab lists.
local giver = Tab.giverButton
stub.world.questID = KOBOLDS
stub.ShowPanel("QuestFrameDetailPanel")
stub.FireEvent("QUEST_DETAIL")
Expect("the quest giver's window has Open in Azeroth's Compendium", giver ~= nil and giver:IsShown(), true)
C:Hide()
giver.scripts.OnClick(giver)
Expect("...which opens the Compendium on that quest", C:IsOpen("quests") and page.title.text, "Kobold Camp Cleanup")
local tooltip = {}
local gameTooltip = _G.GameTooltip
_G.GameTooltip = { SetOwner = function() end, SetText = function(_, text) tooltip.title = text end,
    AddLine = function(_, text) tooltip.line = text end, Show = function() end, Hide = function() end }
for _, handler in ipairs(giver.hooks and giver.hooks.OnEnter or {}) do handler(giver) end
_G.GameTooltip = gameTooltip
Expect("...and says so", tooltip.title, L.OPEN_IN_COMPENDIUM)
stub.world.questID = 999999
stub.FireEvent("QUEST_DETAIL")
Expect("...not for a quest the tab does not list", giver:IsShown(), false)
completed[SHARPTALON] = true
stub.world.questID = SHARPTALON
stub.FireEvent("QUEST_DETAIL")
Expect("...nor for one of another race's, the list leaving it out for this character", giver:IsShown(), false)
completed[SHARPTALON] = nil
-- Offered and not started, a quest's page is the padlock: no Open, unless it would show the words.
stub.world.questID = WOLVES
stub.FireEvent("QUEST_DETAIL")
Expect("...nor on the offer of a quest not started, whose page is locked", giver:IsShown(), false)
C:Tab("quests").unlock.set(true)
Expect("...but there once Unlock Unstarted Quests is switched on, the window still open", giver:IsShown()
    and giver.questID, WOLVES)
VO.Addon.db.global.Compendium.FoundOnly = true
stub.FireEvent("QUEST_DETAIL")
Expect("...and with Started Only on too: the page opens though the list leaves the quest's row out",
    giver:IsShown() and giver.questID, WOLVES)
VO.Addon.db.global.Compendium.FoundOnly = false
C:Tab("quests").unlock.set(false)
Expect("...and gone once Unlock Unstarted Quests is switched off", giver:IsShown(), false)
questLog = { WOLVES }
stub.ShowPanel("QuestFrameProgressPanel")
stub.FireEvent("QUEST_PROGRESS")
Expect("...there once the quest is in the quest log", giver:IsShown() and giver.questID, WOLVES)
questLog = {}
stub.ShowPanel("QuestFrameDetailPanel")
stub.world.questID = 0
stub.ShowPanel(nil)
stub.FireEvent("QUEST_FINISHED")

-- The quest log's details, on either log.
questLog, logQuest = { HEIRLOOM, CANDLES }, HEIRLOOM
QuestLog_UpdateQuestDetails()
Tab.logButton.scripts.OnClick(Tab.logButton)
Expect("the quest log's Open on a quest in progress shows its words", page.title.text == "The Forgotten Heirloom"
    and PageWords() ~= L.QUEST_NOT_FOUND, true)
logQuest = CANDLES
QuestLog_UpdateQuestDetails()
Expect("Classic Era's quest log details have it", Tab.logButton:IsShown() and Tab.logButton.questID, CANDLES)
Tab.logButton.scripts.OnClick(Tab.logButton)
Expect("...and open the quest", page.title.text, "Kobold Candles")
questLog, logQuest = {}, nil
QuestLog_UpdateQuestDetails()
Expect("...not with no quest chosen", Tab.logButton:IsShown(), false)
questLog = { HEIRLOOM }
QuestMapFrame_ShowQuestDetails(HEIRLOOM)
Expect("the map's quest log details have it", Tab.mapButton:IsShown() and Tab.mapButton.questID, HEIRLOOM)
Spoken:SetPartOn("quests", false)
QuestMapFrame_ShowQuestDetails(HEIRLOOM)
Expect("...not with Quests off", Tab.mapButton:IsShown(), false)
Spoken:SetPartOn("quests", true)
questLog = {}
QuestMapFrame_ShowQuestDetails(HEIRLOOM)
Expect("...nor for a quest not started", Tab.mapButton:IsShown(), false)

---------------------------------------------------------------- another language
-- A German client: the words and the title the quest's window shows are kept, for every
-- character, and shown over the English.
stub.SetLocale("deDE")
stub.world.questID = KOBOLDS
stub.world.title = "Säuberung des Koboldlagers"
stub.world.questText = "Tester, Ihr müsst die Kobolde vertreiben."
stub.FireEvent("QUEST_DETAIL")
stub.world.questID = 0
Tab:Refresh()
Click("Säuberung des Koboldlagers")
words = PageWords() or ""
Expect("the title the window showed", page.title.text, "Säuberung des Koboldlagers")
Expect("...and its words, over the English", words:find("Ihr müsst die Kobolde vertreiben.", 1, true) ~= nil, true)
Expect("...the moments the window has not shown yet still in English",
    words:find(SpokenQuestsText[KOBOLDS].complete:sub(1, 20), 1, true) ~= nil, true)
stub.world.playerName = "Zweite"
Tab:Refresh()
Expect("...another character's name where the player's was", (PageWords() or ""):find("Zweite, Ihr müsst", 1, true) ~= nil, true)
stub.world.playerName = "Tester"
local kept = VO.Addon.db.global.CompendiumText
Expect("...kept by language", kept.deDE[KOBOLDS] ~= nil and kept.enUS == nil, true)
-- A window whose id, title and words the game hands over as secrets keeps nothing.
stub.world.questID = JENNEA
stub.world.title = "Versiegelte Befehle"
stub.world.questText = "Verbrennt dies nach dem Lesen."
stub.Secrets(JENNEA, "Versiegelte Befehle", "Verbrennt dies nach dem Lesen.")
Expect("a secret quest window raises no error", (pcall(stub.FireEvent, "QUEST_DETAIL")), true)
stub.Secrets()
stub.world.questID = 0
Expect("...and keeps nothing", kept.deDE[JENNEA], nil)
-- A quest whose English has a word for each sex: what a man was told is not shown to a woman.
stub.world.questID = CANDLES
stub.world.title = "Koboldkerzen"
stub.world.questText = "Hallo, werter Herr!"
stub.FireEvent("QUEST_DETAIL")
stub.world.questID = 0
Tab:Refresh()
Click("Koboldkerzen")
Expect("words kept from a man's window, shown to a man", (PageWords() or ""):find("Hallo, werter Herr!", 1, true) ~= nil, true)
stub.world.unitSex = 3
Tab:Refresh()
Expect("...and to a woman, the English, with her word", (PageWords() or ""):find("Hello, my lady!", 1, true) ~= nil, true)
stub.world.unitSex = 2
stub.SetLocale("enUS")
stub.world.questID = CANDLES
stub.FireEvent("QUEST_DETAIL")
stub.world.questID = 0
Expect("an English client keeps nothing: the English ships", VO.Addon.db.global.CompendiumText.enUS, nil)

-- With DialogueUI too, each part is headed by the Small Window's face, with who says it over the
-- part's name, all centred on the face, as the buttons are.
do
    local isLoaded = _G.IsAddOnLoaded
    _G.IsAddOnLoaded = function(name) return name == "DialogueUI" or (isLoaded ~= nil and isLoaded(name)) end
    _G.DialogueUI_DB = { Theme = 1, FrameSize = 2 }
    _G.DUIQuestFrame = CreateFrame("Frame")
    _G.DUIQuestFrame.frameWidth, _G.DUIQuestFrame.frameHeight = 624, 734
    _G.DUIFont_Quest_Paragraph = { GetFont = function() return "Interface/AddOns/DialogueUI/Fonts/frizqt__.ttf", 14 end }
    -- The client's own heading for a quest's text, in its quest window.
    _G.QUEST_DESCRIPTION = "Quest Description"
    SpokenQuestsCompendium.quests[KOBOLDS].ender = DUGHAN
    Tab:Open(KOBOLDS)
    local offer, handIn = page.body.lastParts[1], page.body.lastParts[#page.body.lastParts]
    Expect("with DialogueUI, still the Small Window's face, no DialogueUI header",
        tostring(offer.header) .. " " .. tostring(offer.face ~= nil and offer.face:IsShown()), "nil true")
    Expect("...the giver as the heading, the client's word for the offer over it", offer.heading .. "|" .. offer.caption,
        "Marshal McBride|Quest Description")
    Expect("...the one it is handed in to as the heading, its completion over it", handIn.heading .. "|" .. handIn.caption,
        "Marshal Dughan|" .. L.QUEST_PART_COMPLETE)
    _G.QUEST_DESCRIPTION = nil
    Tab:Refresh()
    Expect("a client with no word for it: Spoken's", page.body.lastParts[1].caption, L.QUEST_PART_ACCEPT)
    _G.IsAddOnLoaded, _G.DialogueUI_DB, _G.DUIQuestFrame, _G.DUIFont_Quest_Paragraph = isLoaded, nil, nil, nil
end

-- A client without the art: the list is drawn in plain colours instead, and still works.
_G.C_Texture = { GetAtlasInfo = function() return nil end }
Tab:Open(KOBOLDS)
local plainBanner, plainCard = RowFor("Eastern Kingdoms"), RowFor("Elwynn Forest")
Expect("with no campaign header, a banner is a dark band with gold edges", plainBanner.bannerFill:IsShown()
    and plainBanner.headMiddle:IsShown(), false)
Expect("...its plus or minus the older buttons", plainBanner.toggle.texture, [[Interface\Buttons\UI-MinusButton-Up]])
Click("Elwynn Forest")
plainCard = RowFor("Elwynn Forest")
Expect("...chosen, the list's own light full with its gold edge", plainCard.selected and plainCard.wash:IsShown()
    and plainCard.wash.alpha == 1 and plainCard.edge:IsShown(), true)
_G.C_Texture = { GetAtlasInfo = stub.ListAtlas }

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll quests compendium tests passed")
