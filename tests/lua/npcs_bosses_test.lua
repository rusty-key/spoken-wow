-- The bosses tab of Azeroth's Compendium (Spoken NPCs): the data against the dungeon table, then
-- the list built against the stub client: a banner for each continent, a line for each zone that
-- has a dungeon or a raid and none without, the dungeons under their zone and the bosses under
-- their dungeon, and a boss's page; bosses found by their fight, greyed until then, counted with a
-- bar, left out by Found Only and opened by Unlock Unfound Bosses. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local ADDONS = here .. "/../../addons/"
local Expect, Failures = H.Expecter(print)

---------------------------------------------------------------- the data
dofile(ADDONS .. "Spoken/Data/Dungeons.lua")
dofile(ADDONS .. "Spoken_NPCs/Data/Bosses.lua")
dofile(ADDONS .. "Spoken_NPCs/Data/Stories.lua")
_G.SpokenBossStories = {} -- the tests write their own stories, not the generated ones
local dungeons = SpokenDungeons.dungeons
local worlds = SpokenDungeons.worldBosses
local strays, empty, twice, unnamed = {}, {}, {}, {}
local count = 0
for map, bosses in pairs(SpokenBosses.maps) do
    if not dungeons[map] and not worlds[map] then table.insert(strays, map) end
    if #bosses == 0 then table.insert(empty, map) end
    local keys = {}
    for _, boss in ipairs(bosses) do
        count = count + 1
        if keys[boss.key] then table.insert(twice, map .. "/" .. boss.key) end
        keys[boss.key] = true
        if type(boss[1]) ~= "string" or boss[1] == "" or boss.key == "" then table.insert(unnamed, map .. "/" .. tostring(boss.id)) end
        if type(boss.ids) ~= "table" or #boss.ids == 0 then table.insert(unnamed, map .. "/" .. boss.key .. " has no encounter") end
        if type(boss.ids) ~= "table" or #boss.ids == 0 then table.insert(unnamed, map .. "/" .. boss.key .. " has no encounter") end
        if type(boss.ids) ~= "table" or #boss.ids == 0 then table.insert(unnamed, map .. "/" .. boss.key .. " has no encounter") end
        if type(boss.ids) ~= "table" or #boss.ids == 0 then table.insert(unnamed, map .. "/" .. boss.key .. " has no encounter") end
    end
end
Expect("every map with bosses is a dungeon, a raid or a world boss's of the table", table.concat(strays, ","), "")
Expect("...none without a boss", table.concat(empty, ","), "")
Expect("...each boss once in its instance", table.concat(twice, ","), "")
Expect("...each with a name and a key", table.concat(unnamed, ","), "")
local without = {}
for map in pairs(dungeons) do if not SpokenBosses.maps[map] then table.insert(without, map) end end
table.sort(without)
Expect("every dungeon and raid of the table has its bosses", table.concat(without, ","), "")
Expect("Wailing Caverns has the Lady Anacondra and Mutanus first and last",
    SpokenBosses.maps[43][1][1] .. "|" .. SpokenBosses.maps[43][#SpokenBosses.maps[43]][1], "Lady Anacondra|Mutanus the Devourer")
Expect("a boss's name in another language is there", SpokenBosses.maps[33][1][1] .. "|" .. tostring(SpokenBosses.maps[33][1].deDE),
    "Rethilgore|Rotkralle")

---------------------------------------------------------------- the list
stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
stub.LoadSpoken(here .. "/../../addons/Spoken/").Addon:Enable()
_G.C_Texture = { GetAtlasInfo = function(name) return stub.ListAtlas(name) end }
_G.SPELLBOOK_FONT_COLOR = { GetRGB = function() return 0.24, 0.15, 0.07 end }
local createFrame = _G.CreateFrame
_G.CreateFrame = function(kind, name, parent, template)
    local frame = createFrame(kind, name, parent, template)
    if template == "PortraitFrameTemplate" then
        function frame:SetTitle(text) self.title = text end
        function frame:SetPortraitToAsset(path) self.portrait = path end
        frame.CloseButton = createFrame("Button", nil, frame)
    elseif template == "MaximizeMinimizeButtonFrameTemplate" then
        frame.MinimizeButton, frame.MaximizeButton = createFrame("Button", nil, frame), createFrame("Button", nil, frame)
    end
    frame.template = template
    return frame
end
_G.UISpecialFrames = _G.UISpecialFrames or {}
_G.tinsert = _G.tinsert or table.insert
_G.GameFontHighlight = _G.GameFontHighlight or { GetFont = function() return "font.ttf", 12 end }
_G.hooksecurefunc = _G.hooksecurefunc or function() end

local MAPS = { [947] = "Azeroth", [1414] = "Kalimdor", [1415] = "Eastern Kingdoms", [1411] = "Durotar",
    [1413] = "The Barrens", [1416] = "Alterac Mountains", [1418] = "Badlands", [1420] = "Tirisfal Glades",
    [1421] = "Silverpine Forest", [1422] = "Western Plaguelands", [1423] = "Eastern Plaguelands",
    [1426] = "Dun Morogh", [1427] = "Searing Gorge", [1429] = "Elwynn Forest", [1434] = "Stranglethorn Vale",
    [1435] = "Swamp of Sorrows", [1436] = "Westfall", [1440] = "Ashenvale", [1441] = "Thousand Needles",
    [1443] = "Desolace", [1444] = "Feralas", [1445] = "Dustwallow Marsh", [1446] = "Tanaris",
    [1451] = "Silithus", [1453] = "Stormwind City", [1454] = "Orgrimmar", [1458] = "Undercity",
    [1412] = "Mulgore", [1437] = "Wetlands", [1419] = "Blasted Lands", [1431] = "Duskwood", [1425] = "The Hinterlands" }
local here_map = 1436
_G.C_Map = {
    GetMapInfo = function(id) return MAPS[id] and { name = MAPS[id], mapID = id } or nil end,
    GetBestMapForUnit = function() return here_map end,
}
_G.GetInstanceInfo = function() return "Outland", "none", 0, "", 0, 0, false, 0 end

local NPCs = {}
for _, file in ipairs({ "Locale/enUS", "Core", "UI/Bosses", "UI/Options", "Events" }) do
    local chunk = assert(loadfile(ADDONS .. "Spoken_NPCs/" .. file .. ".lua"))
    chunk("Spoken_NPCs", NPCs)
end
Expect("the tab is registered once the world is up", SpokenCompendium:Tab("bosses") ~= nil, false)
NPCs:InitDB()
NPCs:SetupBosses()
local tab = SpokenCompendium:Tab("bosses")
Expect("...after Setup", tab ~= nil and tab.label, "Bosses")
Expect("...a tab of its own after the readables'", tab.order, 3)
Expect("...with Unlock Unfound Bosses, off", tab.unlock ~= nil and tab.unlock.get(), false)
Expect("Show Boss Abilities is on by default", SpokenNPCsSettings.showAbilities, true)

local window
local rows = {}
local function Collect(frame)
    for _, child in ipairs(frame.children or {}) do
        if child.row then table.insert(rows, child) end
        Collect(child)
    end
end
local function Shown()
    rows = {}; Collect(window)
    local labels = {}
    for _, row in ipairs(rows) do if row.shown ~= false and row.row then table.insert(labels, row.row.label) end end
    return table.concat(labels, "|")
end
local function RowFor(label)
    for _, row in ipairs(rows) do if row.shown ~= false and row.row and row.row.label == label then return row end end
end
local function Click(label) local row = RowFor(label); row.scripts.OnClick(row); return Shown() end
local function Has(list, label)
    for entry in (list .. "|"):gmatch("([^|]*)|") do if entry == label then return true end end
    return false
end

-- Standing in a dungeon, the tab opens on its line, opened.
here_map = 1413
_G.GetInstanceInfo = function() return "Deadmines", "party", 1, "", 5, 0, false, 36 end
NPCs:ShowBosses()
window = SpokenCompendium:Window()
local page = NPCs.bosses.page
Shown()
Expect("with the player in a dungeon, its line is opened and chosen, its bosses listed",
    RowFor("Deadmines") ~= nil and RowFor("Deadmines").selected and Has(Shown(), "Edwin VanCleef"), true)
Expect("...a boss not met greyed, with the padlock", RowFor("Edwin VanCleef").row.locked, true)
-- Back out in Westfall: the line chosen for the player gives way to the zone's.
here_map = 1436
_G.GetInstanceInfo = function() return "Outland", "none", 0, "", 0, 0, false, 0 end
NPCs:ShowBosses()
local shown = Shown()
Expect("opened where the player stands: Westfall's line, opened, its dungeon under it", Has(shown, "Westfall") and Has(shown, "Deadmines"), true)
Expect("...a banner for each continent, Kalimdor first", shown:match("^Eastern Kingdoms|") ~= nil or shown:match("^Kalimdor|") ~= nil, true)
Expect("...no zone without a dungeon: Mulgore is not listed", Has(shown, "Mulgore"), false)
Expect("...the cities' dungeons under the zone around them: Elwynn Forest and Durotar, not the cities",
    Has(shown, "Elwynn Forest") and Has(shown, "Durotar") and not Has(shown, "Stormwind City") and not Has(shown, "Orgrimmar"), true)
Expect("...the zone's line chosen", RowFor("Westfall").selected, true)
local westfall = #SpokenBosses.maps[36]
Expect("...its page counts the bosses met", page.title.text .. "|" .. page.sub.text.text,
    "Westfall|In Eastern Kingdoms · 0 of " .. westfall .. " found")
Expect("...with the zone's round portrait left of the title, the zone badge on it",
    page.headFace ~= nil and page.headFace.speaker.bullet == "zone" and page.shift > 0, true)
Expect("...a line with what is met out of all and the share, no picture or bar",
    RowFor("Westfall").row.style .. "|" .. RowFor("Westfall").count.text, "group|0/" .. westfall .. " • 0%")
Expect("...the continent's banner counts them too", RowFor("Kalimdor").count.text:match("^0/%d+$") ~= nil, true)

Click("Westfall")
Expect("a click on an open zone's line closes it", Has(Shown(), "Deadmines"), false)
Click("Westfall")
Expect("...and on a closed one opens it", Has(Shown(), "Deadmines"), true)
Expect("...its one dungeon is a line, one level in",
    RowFor("Deadmines").row.style .. "|" .. RowFor("Deadmines").row.nest, "group|1")
Expect("...no Dungeons and Raids line", Has(Shown(), "Dungeons and Raids"), false)
Expect("...its bosses listed under it, as it was opened for the player", Has(Shown(), "Edwin VanCleef"), true)
Click("Deadmines")
Expect("...a click on it closes it", Has(Shown(), "Edwin VanCleef"), false)
Click("Deadmines")
Expect("...and on a closed one lists its bosses, one level further in", Has(Shown(), "Edwin VanCleef") and RowFor("Edwin VanCleef").row.nest, 2)
Expect("...a boss is a line with no numbers", RowFor("Edwin VanCleef").row.leaf, true)
Expect("a boss not met cannot be chosen: its row does nothing", RowFor("Edwin VanCleef").row.locked, true)

-- Meeting the boss: its fight starts, whichever difficulty's encounter.
local edwin
for _, boss in ipairs(SpokenBosses.maps[36]) do if boss.key == "edwin vancleef" then edwin = boss end end
Expect("an encounter that is no boss of the table is not met", NPCs:FoundEncounter(1), false)
Expect("a boss's encounter is met the first time", NPCs:FoundEncounter(edwin.ids[1]), true)
Expect("...and not again", NPCs:FoundEncounter(edwin.ids[1]), false)
Expect("...kept for the character", SpokenNPCsCharacter.found["36:edwin vancleef"], true)
Shown()
Expect("...its row open, ticked as found", tostring(RowFor("Edwin VanCleef").row.locked) .. "|" .. tostring(RowFor("Edwin VanCleef").row.done), "false|true")
Expect("...counted on its zone's line", RowFor("Westfall").count.text, "1/" .. westfall .. " • " .. math.floor(100 / westfall) .. "%")
Click("Edwin VanCleef")
Expect("...its page names its dungeon and zone", page.title.text .. "|" .. page.sub.text.text, "Edwin VanCleef|In Deadmines · Westfall")
Expect("...and has the words, the story not written yet", page.body.text.text .. "|" .. tostring(page.contribute:IsShown()), _G.SpokenCompendium.NotWritten() .. "|true")
Expect("...its row dulled, as one with nothing written is", RowFor("Edwin VanCleef").row.missing, true)
do
	local was = Spoken.AreContributeButtonsHidden
	Spoken.AreContributeButtonsHidden = function() return true end
	page:RefreshContribute()
	Expect("...and no Contribute where the player hid those buttons", page.contribute:IsShown(), false)
	Spoken.AreContributeButtonsHidden = was
	page:RefreshContribute()
end
Expect("...and a greyed Play", page.play:IsShown() and not page.play:IsEnabled(), true)
_G.SpokenBossStories[36] = { ["edwin vancleef"] = "He led the Brotherhood.", _ = "Mines under Moonbrook." }
Click("Edwin VanCleef")
Expect("...or the story where there is one", page.body.text.text, "He led the Brotherhood.")
Expect("...its row lit as chosen", RowFor("Edwin VanCleef").selected, true)
_G.SpokenBossStories[36]["edwin vancleef"] = { "He led the Brotherhood.", deDE = "Er führte die Bruderschaft.", [2] = nil }
Click("Edwin VanCleef")
Expect("...a story with other languages beside it, the English where the client's has none", page.body.text.text, "He led the Brotherhood.")
_G.GetLocale = function() return "deDE" end
Click("Edwin VanCleef")
Expect("...in the client's language where it has one", page.body.text.text, "Er führte die Bruderschaft.")
_G.GetLocale = function() return "enUS" end
-- A boss with a creature in Data/Creatures.lua: its story, then its portrait over its dungeon and
-- name, then a button for each spell the client names.
_G.SpokenBossCreatures = { [36] = { ["edwin vancleef"] = { creature = 639, display = 1305, spells = { 3391, 5200, 99999 } } } }
local SPELLS = { [3391] = { name = "Thrash", iconID = 132152 }, [5200] = { name = "VanCleef's Allies", iconID = 136235 } }
_G.C_Spell = { GetSpellInfo = function(id) return SPELLS[id] end }
NPCs:RefreshBosses()
Shown()
SpokenNPCsSettings.showAbilities = false
NPCs:RefreshBosses()
Click("Edwin VanCleef")
Expect("with Show Boss Abilities off, no spell cards: the story and the portrait only",
    (page.body.partButtons == nil or #page.body.partButtons == 0) and page.body.text.text .. "|" .. tostring(page.face:IsShown()),
    "He led the Brotherhood.|true")
SpokenNPCsSettings.showAbilities = true
NPCs:RefreshBosses()
Click("Edwin VanCleef")
local parts = page.body.parts
local names = {}
for _, shown in ipairs(page.body.partButtons or {}) do
    if shown.name then table.insert(names, shown.name:GetText() .. ":" .. tostring(shown.icon.texture)) end
end
Expect("a boss with a creature has its story, then its spells with no heading", parts[1].words:GetText() .. "|" .. tostring(parts[2].heading:IsShown()),
    "He led the Brotherhood.|false")
Expect("...and its portrait at the left of its name, the title moved right of it", page.face:IsShown() and page.shift > 0, true)
Expect("...the boss badge on it", page.headFace.speaker.bullet, "boss")
local badge = page.headFace and page.headFace.badge
Expect("...the portrait's small socket holds the skull", badge and badge:IsShown() and badge.texture, [[Interface\TargetingFrame\UI-RaidTargetingIcon_8]])
Expect("...a button for each spell the client names, with its icon", table.concat(names, ","), "Thrash:132152,VanCleef's Allies:136235")
_G.SpokenBossCreatures = {}
Click("Edwin VanCleef")
Expect("a boss with no creature there has the words alone", (page.body.partButtons == nil or #page.body.partButtons == 0) and page.body.text.text, "He led the Brotherhood.")
Expect("...and the portrait is still there, as the question mark, with the boss badge",
    page.face ~= nil and page.shift > 0 and page.headFace.speaker.icon == [[Interface\Icons\INV_Misc_QuestionMark]]
        and page.headFace.speaker.bullet == "boss", true)
_G.SpokenBossCreatures = {}
NPCs:RefreshBosses()
Shown()
Click("Deadmines")
Expect("a dungeon's page has no words, a mark in their place, and no Play", page.title.text == "Deadmines" and page.body.text.text == ""
    and page.mark:IsShown() and not page.play:IsShown(), true)
Expect("...with the dungeon's round portrait left of the title, the zone badge on it",
    page.headFace.speaker.bullet == "zone" and page.shift > 0, true)
local noPicture = SpokenCompendium.PlaceIcon(nil, 424242)
Expect("a place with no picture yet has the question mark, with the zone badge, not no portrait",
    noPicture ~= nil and noPicture.icon == [[Interface\Icons\INV_Misc_QuestionMark]] and noPicture.bullet, "zone")
Expect("a click on the dungeon's line closes it, and chose it", Has(Shown(), "Edwin VanCleef") == false and RowFor("Deadmines").selected, true)

Click("The Barrens")
local barrens = Shown()
Expect("a zone with several dungeons has a line for each, by name, one level in",
    Has(barrens, "Razorfen Kraul") and Has(barrens, "Wailing Caverns") and RowFor("Wailing Caverns").row.nest, 1)
Expect("...and no Dungeons and Raids line above them", Has(barrens, "Dungeons and Raids"), false)
Expect("...the zone's page counts all their bosses", page.title.text .. "|" .. page.sub.text.text,
    "The Barrens|In Kalimdor · 0 of " .. (#SpokenBosses.maps[43] + #SpokenBosses.maps[47] + #SpokenBosses.maps[129]) .. " found")

-- A world boss has no line of its map: the zone lists it directly.
Click("Blasted Lands")
local blasted = Shown()
Expect("a zone with a world boss lists the boss straight under it, with no line for its map",
    Has(blasted, "Lord Kazzak") and not Has(blasted, "The Tainted Scar") and RowFor("Lord Kazzak").row.nest, 1)
Expect("...a boss not met greyed like any other", RowFor("Lord Kazzak").row.locked, true)
local kazzak = SpokenBosses.maps[2789][1]
NPCs:FoundEncounter(kazzak.ids[1])
Shown()
Click("Lord Kazzak")
Expect("...its page names the zone alone", page.title.text .. "|" .. page.sub.text.text, "Lord Kazzak|In Blasted Lands")
Expect("...the zone's line counts it", RowFor("Blasted Lands").count.text:match("^1/%d+") ~= nil, true)
Click("Blasted Lands")

-- A world-boss map whose bosses stand in several zones lists each boss under its own.
Click("Duskwood")
local duskwood = Shown()
Expect("Nightmare Grove's dragons are each in their own zone: Duskwood lists Emeriss alone",
    Has(duskwood, "Emeriss") and not Has(duskwood, "Lethon") and not Has(duskwood, "Taerar") and not Has(duskwood, "Ysondre"), true)
Click("Duskwood")
Click("Feralas")
Expect("...Feralas has Lethon", Has(Shown(), "Lethon") and not Has(Shown(), "Emeriss"), true)
for _, boss in ipairs(SpokenBosses.maps[2832]) do
    if boss.key == "lethon" then NPCs:FoundEncounter(boss.ids[1]) end
end
Shown()
Click("Lethon")
Expect("...whose page names Feralas", page.title.text .. "|" .. page.sub.text.text, "Lethon|In Feralas")
Click("Feralas")
Click("Ashenvale")
Expect("...Ashenvale has Taerar", Has(Shown(), "Taerar"), true)
Click("Ashenvale")
Click("The Hinterlands")
Expect("...the Hinterlands have Ysondre", Has(Shown(), "Ysondre"), true)
Click("The Hinterlands")

-- What no Forever source shows as a boss of its dungeon is not listed.
local unconfirmed = { [90] = "mechanical menagerie", [109] = "festering rotslime", [230] = "the vault", [409] = "the molten core",
    [2875] = "three little wolves", [2959] = "mana wraith" }
local listed = {}
for map, key in pairs(unconfirmed) do
    for _, boss in ipairs(SpokenBosses.maps[map] or {}) do
        if boss.key == key then table.insert(listed, map .. ":" .. key) end
    end
end
Expect("bosses no Forever source confirms are left out", table.concat(listed, ","), "")

---------------------------------------------------------------- Found Only and Unlock
Expect("the list has a Found Only switch, off", NPCs.list.opts.only .. "|" .. tostring(NPCs.list.opts.onlyGet()), "Found Only|false")
NPCs.list.opts.onlySet(true)
NPCs.list.opts.onHidden()
local only = Shown()
Expect("Found Only leaves out what holds no boss met", Has(only, "The Barrens") or Has(only, "Durotar"), false)
Expect("...and keeps the zone and dungeon of one met", Has(only, "Westfall") and Has(only, "Deadmines") and Has(only, "Eastern Kingdoms"), true)
NPCs:FoundEncounter(SpokenBosses.maps[36][1].ids[1])
if not Has(Shown(), "Edwin VanCleef") then Click("Deadmines") end
Expect("...a dungeon lists only the bosses met", Has(Shown(), "Edwin VanCleef") and not Has(Shown(), SpokenBosses.maps[36][2][1]), true)
NPCs.list.opts.onlySet(false)
tab.unlock.set(true)
Shown()
local second = SpokenBosses.maps[36][2][1]
Expect("Unlock Unfound Bosses opens every one", RowFor(second).row.locked, false)
Expect("...and greys nothing for having none found: not the zone, nor the continent", tostring(RowFor("Westfall").row.none) .. "|" .. tostring(RowFor("Eastern Kingdoms").row.none), "false|false")
Click(second)
Expect("...and its page has the words, met or not", page.body.text.text, _G.SpokenCompendium.NotWritten())
tab.unlock.set(false)

---------------------------------------------------------------- a search
local list = NPCs.list
list.opts.onSearch("anacondra")
local found = Shown()
Expect("a search lists the zone, dungeon and boss that have the word, each opened",
    Has(found, "The Barrens") and Has(found, "Wailing Caverns") and Has(found, "Lady Anacondra"), true)
Expect("...and no other boss or zone", Has(found, "Edwin VanCleef") or Has(found, "Westfall"), false)
list.opts.onSearch("wailing")
found = Shown()
Expect("a dungeon's name lists all its bosses", Has(found, "Lady Anacondra") and Has(found, "Mutanus the Devourer"), true)
list.opts.onSearch("")
Expect("clearing it brings the list back", Has(Shown(), "Westfall"), true)

---------------------------------------------------------------- the Bosses page in the settings
NPCs:SetupOptions()
local panel = NPCs.optionsPanel
Expect("the Bosses page is built", panel ~= nil and panel.layout ~= nil, true)
local abilitiesRow
for _, entry in ipairs(panel.layout.entries) do
    if entry.label == NPCs.L.OPT_SHOW_ABILITIES then abilitiesRow = entry end
end
Expect("...with Show Boss Abilities on it", abilitiesRow ~= nil, true)
SpokenNPCsSettings.showAbilities = false
SpokenNPCsSettings.unlockUnfound = true
SpokenNPCsCharacter.found["36:edwin vancleef"] = true
local reset = panel.layout.defaults
reset.scripts.OnClick(reset)
stub.popups[#stub.popups].dialog.OnAccept()
Expect("its Defaults put Show Boss Abilities back on", SpokenNPCsSettings.showAbilities, true)
Expect("...and leave Unlock Unfound Bosses, which Spoken's page resets", SpokenNPCsSettings.unlockUnfound, true)
Expect("...and keep the bosses this character has met", SpokenNPCsCharacter.found["36:edwin vancleef"], true)

if Failures() > 0 then os.exit(1) end
