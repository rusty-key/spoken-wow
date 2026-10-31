-- The bosses tab of Azeroth's Compendium (Spoken Bosses): the data against the dungeon table, then
-- the list built against the stub client: a banner for each continent, dungeons and raids directly
-- beneath it, bosses under their dungeon, and a boss's page; bosses found by their fight, greyed
-- until then, counted with a bar, left out by Found Only and opened by Unlock Unfound Bosses. Run
-- with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local ADDONS = here .. "/../../addons/"
local Expect, Failures = H.Expecter(print)

---------------------------------------------------------------- the data
dofile(ADDONS .. "Spoken/Data/Dungeons.lua")
dofile(ADDONS .. "Spoken_Bosses/Data/Bosses.lua")
dofile(ADDONS .. "Spoken_Bosses/Data/Stories.lua")
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

dofile(ADDONS .. "Spoken_Bosses/Data/Creatures.lua")
local creatures = SpokenBossCreatures
local isBoss, notBoss, shared, owner = {}, {}, {}, {}
for map, bosses in pairs(SpokenBosses.maps) do
    for _, boss in ipairs(bosses) do isBoss[map .. "/" .. boss.key] = true end
end
for map, entries in pairs(creatures) do
    for key, entry in pairs(entries) do
        if not isBoss[map .. "/" .. key] then table.insert(notBoss, map .. "/" .. key) end
        if entry.creature and owner[entry.creature] then table.insert(shared, entry.creature) end
        if entry.creature then owner[entry.creature] = true end
    end
end
table.sort(notBoss)
table.sort(shared)
Expect("every entry of Data/Creatures.lua is a boss of Data/Bosses.lua", table.concat(notBoss, ","), "")
Expect("...no creature is two bosses', so a creature's death is one boss's", table.concat(shared, ","), "")
local function Face(map, key)
    local entry = creatures[map] and creatures[map][key]
    return entry and tostring(entry.creature) .. "/" .. tostring(entry.display) or "none"
end
local function Faces(map, keys)
    local out = {}
    for _, key in ipairs(keys) do table.insert(out, Face(map, key)) end
    return table.concat(out, ",")
end
Expect("the Ruins of Lordaeron's bosses have their creature and portrait from the database",
    Faces(2999, { "witherfang", "the abandoned", "rathmael", "bjork" }), "250483/144189,250631/138667,250657/144175,256097/144170")
Expect("...The Butcher is the game's The Baron, the abomination", Face(2999, "the butcher"), "250660/144188")
Expect("the Hall of Thanes' bosses have theirs, Infurnus as the game's Magmatus",
    Faces(3065, { "faldrim anvilmar", "plunder", "durgen dirgehammer", "infurnus" }), "261306/142826,261311/142840,261319/142837,261316/1070")
Expect("bosses the database lacks have theirs from Efficient Games' records: the City of Dalaran",
    Faces(2959, { "fel ancient", "mana devourer", "unstable sentinel", "shade of the archmage", "lyn the ignored", "atrexis the grave knight" }),
    "246003/129894,246008/129895,246017/129954,246020/130061,247032/130235,247126/145787")
Expect("...the Excavation Site: Wetlands", Faces(2998, { "saltspine", "shadetooth", "relic guardian", "highland horror" }),
    "260322/144209,260325/144210,260326/144224,260808/9010")
Expect("...and two of the Karazhan Crypts' Marylas", Faces(2875, { "kaigy maryla", "sairuh maryla" }), "256275/139545,256273/139544")
Expect("bosses have the model Forever draws them with: Sneed himself on his spawned Shredder, Grubbis, Gandling, Sapphiron",
    Face(36, "sneed") .. "," .. Face(90, "grubbis") .. "," .. Face(289, "darkmaster gandling") .. "," .. Face(533, "sapphiron"),
    "642/7125,7361/144378,1853/11070,15989/16033")
Expect("...the City of Dalaran's Arcane Anomaly is Forever's, not Karazhan's", Face(2959, "arcane anomaly"), "245999/129891")
Expect("a boss known only by a namesake has no creature, so the namesake's death does not tell its story",
    Face(2856, "balnazzar") .. "," .. Face(2959, "mana elemental") .. "," .. tostring(owner[10813]) .. "," .. tostring(owner[16488]),
    "none,none,nil,nil")
Expect("a boss whose model the client lacks has no portrait rather than an empty one", Face(329, "crimson hammersmith"), "11120/nil")
local LACKED = { [40322] = true, [113690] = true, [34424] = true, [34497] = true, [16216] = true }
local lacked = {}
for map, entries in pairs(creatures) do
    for key, entry in pairs(entries) do
        if entry.display and LACKED[entry.display] then table.insert(lacked, map .. "/" .. key) end
    end
end
table.sort(lacked)
Expect("...none has a model the client is known to lack", table.concat(lacked, ","), "")

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

-- Keep the modern stub APIs used by this test, but exercise the Classic Era map filter.
SpokenEnv.Version.Variant = "era"

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

local Bosses = {}
for _, file in ipairs({ "Locale/enUS", "Core", "Audio", "UI/Bosses", "UI/Options", "Events" }) do
    local chunk = assert(loadfile(ADDONS .. "Spoken_Bosses/" .. file .. ".lua"))
    chunk("Spoken_Bosses", Bosses)
end
Expect("the tab is registered once the world is up", SpokenCompendium:Tab("bosses") ~= nil, false)
Bosses:InitDB()
Bosses:SetupBosses()
local tab = SpokenCompendium:Tab("bosses")
Expect("...after Setup", tab ~= nil and tab.label, "Bosses")
Expect("...a tab of its own after the readables'", tab.order, 3)
Expect("...with Unlock Unfound Bosses, off", tab.unlock ~= nil and tab.unlock.get(), false)
Expect("Found Only is on in a fresh profile", SpokenBossesSettings.compendiumFoundOnly, true)
Expect("Unlock Unfound Bosses is off in a fresh profile", SpokenBossesSettings.unlockUnfound, false)
SpokenBossesSettings.compendiumFoundOnly = false
Bosses:InitDB()
Expect("...and an explicit off stays off through the next start", SpokenBossesSettings.compendiumFoundOnly, false)
-- A profile saved before the marker existed.
SpokenBossesSettings.foundOnlyDefaultOn = nil
Bosses:InitDB()
Expect("...an off stored before it was on by default is turned on once", SpokenBossesSettings.compendiumFoundOnly, true)
SpokenBossesSettings.compendiumFoundOnly = false
Bosses:InitDB()
Expect("...and turned off again, it stays off", SpokenBossesSettings.compendiumFoundOnly, false)
-- The tests below are about the unfiltered list, so Found Only stays off.

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
Bosses:ShowBosses()
window = SpokenCompendium:Window()
page = Bosses.bosses.page
Shown()
Expect("with the player in a dungeon, its line is opened and chosen, its bosses listed",
    RowFor("Deadmines") ~= nil and RowFor("Deadmines").selected and Has(Shown(), "Edwin VanCleef"), true)
Expect("Era leaves out Forever-only dungeons from the bosses tab", Has(Shown(), "The Hall of Thanes"), false)
Expect("Era leaves out Demon Fall Canyon", Has(Shown(), "Demon Fall Canyon"), false)
Expect("Era leaves out Scarlet Enclave", Has(Shown(), "Scarlet Enclave"), false)
Expect("Era leaves out Karazhan Crypts", Has(Shown(), "Karazhan Crypts"), false)
local function OnClient(variant)
    SpokenEnv.Version.Variant = variant
    local maps = {}
    for _, map in ipairs({ 36, 533, 2784, 2856, 2875, 2959, 3065 }) do
        if _G.Spoken:IsDungeonOnClient(map) then table.insert(maps, map) end
    end
    SpokenEnv.Version.Variant = "era"
    return table.concat(maps, " ")
end
Expect("the vanilla dungeons are on every client", OnClient("era") .. "|" .. OnClient("anniversary"), "36 533|36 533")
Expect("...Season of Discovery has its own three as well", OnClient("sod"), "36 533 2784 2856 2875")
Expect("...and Forever every one", OnClient("forever"), "36 533 2784 2856 2875 2959 3065")
Expect("...a boss not met greyed, with the padlock", RowFor("Edwin VanCleef").row.locked, true)
-- Back out in Westfall: the line chosen for the player gives way to the continent's.
here_map = 1436
_G.GetInstanceInfo = function() return "Outland", "none", 0, "", 0, 0, false, 0 end
Bosses:ShowBosses()
local shown = Shown()
Expect("opened where the player stands: its continent's dungeon lines are shown", Has(shown, "Deadmines") and not Has(shown, "Westfall"), true)
Expect("...a banner for each continent, Kalimdor first", shown:match("^Eastern Kingdoms|") ~= nil or shown:match("^Kalimdor|") ~= nil, true)
Expect("...no zone lines are mixed in with the dungeon lines",
    not Has(shown, "Mulgore") and not Has(shown, "Elwynn Forest") and not Has(shown, "Durotar")
        and not Has(shown, "Stormwind City") and not Has(shown, "Orgrimmar"), true)
Expect("...the continent's line chosen", RowFor("Eastern Kingdoms").selected, true)
Expect("...its page is the continent and counts its bosses",
    page.title.text == "Eastern Kingdoms" and page.sub.text.text:match("^0 of %d+ found$") ~= nil, true)
Expect("...the continent's banner counts them too", RowFor("Kalimdor").count.text:match("^0/%d+$") ~= nil, true)

SpokenBossesSettings.compendiumFoundOnly = true
Bosses:ShowBosses()
Shown()
Expect("with Found Only on and none met in the Eastern Kingdoms, the tab does not land on its banner, which the list leaves out too",
    RowFor("Eastern Kingdoms") == nil and page.title.text ~= "Eastern Kingdoms", true)
Expect("...the empty Bosses section uses the dragon icon", page.headFace.speaker.icon, Bosses.ICON)
Expect("...and its small socket uses the in-game skull", page.headFace.speaker.bullet .. "|"
    .. page.headFace.badge.texture, "boss|Interface\\Minimap\\Minimap_skull_normal")
Expect("a dungeon boss uses the normal skull badge", Spoken:GetBullet("boss").texture,
    [[Interface\Minimap\Minimap_skull_normal]])
Expect("a raid boss uses the elite skull badge", Spoken:GetBullet("boss-raid").texture,
    [[Interface\Minimap\Minimap_skull_elite]])
_G.SpokenBossStories[2856] = { balnazzar = "A raid story." }
local raidClip = Bosses:StoryClip(2856, "balnazzar")
Expect("a raid story uses the raid badge", raidClip and raidClip.present.bullet, "boss-raid")
Expect("a raid story without a portrait uses the elite skull", raidClip and raidClip.present.portrait.texture,
    [[Interface\Minimap\Minimap_skull_elite]])
_G.SpokenBossStories[2856] = nil
_G.SpokenBossStories[2789] = { ["lord kazzak"] = "A world-boss story." }
local worldBossClip = Bosses:StoryClip(2789, "lord kazzak")
Expect("a world-boss story uses the elite badge", worldBossClip and worldBossClip.present.bullet, "boss-raid")
_G.SpokenBossStories[2789] = nil
local function Raids(variant)
    SpokenEnv.Version.Variant = variant
    local maps = {}
    for _, map in ipairs({ 36, 48, 90, 109, 409, 2856 }) do
        if _G.Spoken:IsRaid(map) then table.insert(maps, map) end
    end
    SpokenEnv.Version.Variant = "era"
    return table.concat(maps, " ")
end
Expect("Blackfathom Deeps, Gnomeregan and Sunken Temple are raids only on Season of Discovery",
    Raids("era") .. "|" .. Raids("sod"), "409 2856|48 90 109 409 2856")
SpokenBossesSettings.compendiumFoundOnly = false
Bosses:ShowBosses()
Shown()
Expect("...and off, it lands on the Eastern Kingdoms again", RowFor("Eastern Kingdoms") ~= nil and RowFor("Eastern Kingdoms").selected, true)

Click("Deadmines")
Expect("a click on an open dungeon's line closes it", Has(Shown(), "Edwin VanCleef"), false)
Click("Deadmines")
Expect("...and on a closed one opens it", Has(Shown(), "Edwin VanCleef"), true)
Expect("...its dungeon is a line directly under the continent",
	RowFor("Deadmines").row.style .. "|" .. RowFor("Deadmines").row.nest, "group|0")
Expect("...no Dungeons and Raids line", Has(Shown(), "Dungeons and Raids"), false)
Expect("...its bosses listed under it, as it was opened for the player", Has(Shown(), "Edwin VanCleef"), true)
Click("Deadmines")
Expect("...a click on it closes it", Has(Shown(), "Edwin VanCleef"), false)
Click("Deadmines")
Expect("...and on a closed one lists its bosses one level further in", Has(Shown(), "Edwin VanCleef") and RowFor("Edwin VanCleef").row.nest, 1)
Expect("...a boss is a line with no numbers", RowFor("Edwin VanCleef").row.leaf, true)
Expect("a boss not met cannot be chosen: its row does nothing", RowFor("Edwin VanCleef").row.locked, true)

-- Meeting the boss: its fight starts, whichever difficulty's encounter.
local edwin
for _, boss in ipairs(SpokenBosses.maps[36]) do if boss.key == "edwin vancleef" then edwin = boss end end
Expect("an encounter that is no boss of the table is not met", Bosses:FoundEncounter(1), false)
Expect("a boss's encounter is met the first time", Bosses:FoundEncounter(edwin.ids[1]), true)
Expect("...and not again", Bosses:FoundEncounter(edwin.ids[1]), false)
Expect("...kept for the character", SpokenBossesCharacter.found["36:edwin vancleef"], true)
local sunken
for map, bosses in pairs(SpokenBosses.maps) do
    for _, boss in ipairs(bosses) do if boss.key == "weaver" then sunken = map end end
end
Bosses:FoundEncounter(2955)
Expect("an encounter of two bosses at once meets both",
    tostring(Bosses:IsBossFound(sunken, "weaver")) .. "|" .. tostring(Bosses:IsBossFound(sunken, "dreamscythe")), "true|true")
Shown()
Expect("...its row open, ticked as found", tostring(RowFor("Edwin VanCleef").row.locked) .. "|" .. tostring(RowFor("Edwin VanCleef").row.done), "false|true")
Expect("...counted on its continent's line", RowFor("Eastern Kingdoms").count.text:match("^%d+/%d+") ~= nil, true)
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
-- A boss with a creature in Data/Creatures.lua: its story, under its portrait over its dungeon and name.
_G.SpokenBossCreatures = { [36] = { ["edwin vancleef"] = { creature = 639, display = 1305 } } }
Bosses:RefreshBosses()
Shown()
Click("Edwin VanCleef")
Expect("a boss with a creature has its story as one block", page.body.text.text, "He led the Brotherhood.")
Expect("...and its portrait at the left of its name, the title moved right of it", page.face:IsShown() and page.shift > 0, true)
Expect("...the boss badge on it", page.headFace.speaker.bullet, "boss")
local badge = page.headFace and page.headFace.badge
Expect("...the dungeon portrait's small socket holds the normal skull", badge and badge:IsShown() and badge.texture, [[Interface\Minimap\Minimap_skull_normal]])
_G.SpokenBossCreatures = { [36] = { ["edwin vancleef"] = { creature = 639 } } }
Click("Edwin VanCleef")
Expect("a boss with a creature but no model has the question mark for its portrait", page.headFace.speaker.icon,
    [[Interface\Icons\INV_Misc_QuestionMark]])
_G.SpokenBossCreatures = {}
Click("Edwin VanCleef")
Expect("a boss with no creature there has the words alone", page.body.text.text, "He led the Brotherhood.")
Expect("...and the portrait is still there, as the question mark, with the boss badge",
    page.face ~= nil and page.shift > 0 and page.headFace.speaker.icon == [[Interface\Icons\INV_Misc_QuestionMark]]
        and page.headFace.speaker.bullet == "boss", true)
_G.SpokenBossCreatures = {}
Bosses:RefreshBosses()
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

Click("Kalimdor")
Click("Kalimdor")
local barrens = Shown()
Expect("a continent lists its dungeons by name at its level",
	Has(barrens, "Razorfen Kraul") and Has(barrens, "Wailing Caverns") and RowFor("Wailing Caverns").row.nest, 0)
Expect("...and no Dungeons and Raids line above them", Has(barrens, "Dungeons and Raids"), false)
Expect("...the continent's page counts all their bosses", page.title.text,
    "Kalimdor")

-- World bosses have no line of their map or zone: the continent lists them directly.
Click("Eastern Kingdoms")
Click("Eastern Kingdoms")
local blasted = Shown()
Expect("a continent with a world boss lists the boss directly, with no zone or map line",
    Has(blasted, "Lord Kazzak") and not Has(blasted, "The Tainted Scar") and not Has(blasted, "Blasted Lands")
        and RowFor("Lord Kazzak").row.nest, 0)
Expect("...a boss not met greyed like any other", RowFor("Lord Kazzak").row.locked, true)
local kazzak = SpokenBosses.maps[2789][1]
Bosses:FoundEncounter(kazzak.ids[1])
Shown()
Click("Lord Kazzak")
Expect("...its page names the zone alone", page.title.text .. "|" .. page.sub.text.text, "Lord Kazzak|In Blasted Lands")

-- A world-boss map whose bosses stand in several zones lists each boss directly under the continent.
local dragons = Shown()
Expect("Nightmare Grove's dragons are listed without their zones",
    Has(dragons, "Emeriss") and Has(dragons, "Lethon") and Has(dragons, "Taerar") and Has(dragons, "Ysondre")
        and not Has(dragons, "Duskwood") and not Has(dragons, "Feralas") and not Has(dragons, "Ashenvale")
        and not Has(dragons, "The Hinterlands"), true)
Expect("...and in the order of the names shown: Lethon (Feralas) before Taerar (Ashenvale)",
    dragons:find("Lethon", 1, true) < dragons:find("Taerar", 1, true), true)
for _, boss in ipairs(SpokenBosses.maps[2832]) do
    if boss.key == "lethon" then Bosses:FoundEncounter(boss.ids[1]) end
end
Shown()
Click("Lethon")
Expect("...whose page names Feralas", page.title.text .. "|" .. page.sub.text.text, "Lethon|In Feralas")

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
Expect("the list has a Found Only switch, off", Bosses.list.opts.only .. "|" .. tostring(Bosses.list.opts.onlyGet()), "Found Only|false")
Bosses.list.opts.onlySet(true)
Bosses.list.opts.onHidden()
local only = Shown()
Expect("Found Only leaves out dungeons with no boss met", Has(only, "Razorfen Downs") or Has(only, "Durotar"), false)
Expect("...and keeps the dungeon and its continent", Has(only, "Deadmines") and not Has(only, "Westfall") and Has(only, "Eastern Kingdoms"), true)
Bosses:FoundEncounter(SpokenBosses.maps[36][1].ids[1])
if not Has(Shown(), "Edwin VanCleef") then Click("Deadmines") end
Expect("...a dungeon lists only the bosses met", Has(Shown(), "Edwin VanCleef") and not Has(Shown(), SpokenBosses.maps[36][2][1]), true)
Bosses.list.opts.onlySet(false)
tab.unlock.set(true)
Shown()
local second = SpokenBosses.maps[36][2][1]
Expect("Unlock Unfound Bosses opens every one", RowFor(second).row.locked, false)
Expect("...and greys nothing for having none found: not the dungeon, nor the continent", tostring(RowFor("Deadmines").row.none) .. "|" .. tostring(RowFor("Eastern Kingdoms").row.none), "false|false")
Click(second)
Expect("...and its page has the words, met or not", page.body.text.text, _G.SpokenCompendium.NotWritten())
tab.unlock.set(false)

---------------------------------------------------------------- a search
local list = Bosses.list
list.opts.onSearch("anacondra")
local found = Shown()
Expect("a search lists the dungeon and boss that have the word, each opened",
    not Has(found, "The Barrens") and Has(found, "Wailing Caverns") and Has(found, "Lady Anacondra"), true)
Expect("...and no other boss or zone", Has(found, "Edwin VanCleef") or Has(found, "Westfall"), false)
list.opts.onSearch("wailing")
found = Shown()
Expect("a dungeon's name lists all its bosses", Has(found, "Lady Anacondra") and Has(found, "Mutanus the Devourer"), true)
list.opts.onSearch("")
Expect("clearing it brings the list back", Has(Shown(), "Deadmines") and not Has(Shown(), "Westfall"), true)

---------------------------------------------------------------- the Bosses page in the settings
Bosses:SetupOptions()
local panel = Bosses.optionsPanel
Expect("the Bosses page is built", panel ~= nil and panel.layout ~= nil, true)
do
    -- The voice packs, as on the Places and Readables pages: English's row with its Download button
    -- while no pack is installed, its version once one is, and a word where nothing can be heard.
    assert(loadfile(ADDONS .. "Spoken_Bosses/UI/CopyLink.lua"))("Spoken_Bosses", Bosses)
    local W = Spoken:Words()
    local sections, voice = {}, nil
    for _, item in ipairs(panel.layout.items) do
        if item.kind == "section" then
            table.insert(sections, item.text)
            if item.text == W.PART_VOICE then voice = item end
        end
    end
    Expect("the page has its voice packs, then the history", table.concat(sections, "|"), "Voice Packs|Reading History")
    local function English()
        for _, row in ipairs(voice.rows) do
            local label = row.control.layoutLabel
            if label and label.text == Spoken:LanguageName("enUS") then return row end
        end
    end
    local language = SpokenEnv.Addon.db.profile.Language
    _G.SpokenBossesAudioPacks = nil
    panel.layout:Refresh()
    local english = English()
    Expect("English's pack is listed with no pack installed", english ~= nil and english.shown, true)
    Expect("...with its Download button", english.control.layoutGet, true)
    local button = english.control.layoutButton
    local shown = #stub.popups
    button.scripts.OnClick(button)
    local popup = stub.popups[#stub.popups]
    Expect("...which offers the pack's store address to copy", #stub.popups > shown and popup.key, "SPOKENBOSSES_COPY_LINK")
    Expect("...saying what it is for", popup.args[1], Bosses.L.OPT_DOWNLOAD_ADDRESS)
    _G.SpokenBossesAudioPacks = { SpokenBossesAudio = { version = 1, language = "enUS", bosses = {} } }
    panel.layout:Refresh()
    Expect("an installed pack shows no button", english.control.layoutGet, false)
    _G.SpokenBossesAudioPacks = nil

    local function Silent()
        for _, row in ipairs(voice.rows) do
            local text = row.control.GetText and row.control:GetText()
            if row.shown and type(text) == "string" and text ~= "" then return text end
        end
        return nil
    end
    language.Voice, language.Fallback = "deDE", "none"
    panel.layout:Refresh()
    Expect("a voice language with no boss pack and Stay Silent is said under the voice packs",
        Silent(), SpokenEnv.L.MODULE_NO_VOICE_FMT:format(Spoken:LanguageName("deDE")))
    Expect("...and English's is not offered, nothing falling back on it", English().shown, false)
    language.Fallback = "enUS"
    panel.layout:Refresh()
    Expect("with English filling in, nothing is said, and English's pack is the one to get",
        tostring(Silent()) .. " " .. tostring(English().shown), "nil true")
    language.Voice, language.Fallback = nil, nil
    panel.layout:Refresh()
end
SpokenBossesSettings.unlockUnfound = true
SpokenBossesSettings.compendiumFoundOnly = false
SpokenBossesCharacter.found["36:edwin vancleef"] = true
local reset = panel.layout.defaults
reset.scripts.OnClick(reset)
stub.popups[#stub.popups].dialog.OnAccept()
Expect("its Defaults put Found Only back on", SpokenBossesSettings.compendiumFoundOnly, true)
Expect("...and leave Unlock Unfound Bosses, which Spoken's page resets", SpokenBossesSettings.unlockUnfound, true)
Expect("...and keep the bosses this character has met", SpokenBossesCharacter.found["36:edwin vancleef"], true)

---------------------------------------------------------------- a boss's story in the narrator
assert(loadfile(ADDONS .. "Spoken_Bosses/Story.lua"))("Spoken_Bosses", Bosses)
Bosses:SetupStories()
local storySource = Spoken:GetSource("bosses")
Expect("the bosses' stories are a part of Spoken's, voiced where a pack has them", storySource ~= nil and storySource.textOnly, nil)
_G.SpokenBossStories[36]["edwin vancleef"] = "He led the Brotherhood."
_G.SpokenBossCreatures = creatures
local clip = Bosses:StoryClip(36, "edwin vancleef")
Expect("with no pack, a boss's story is a line with no recording", tostring(clip.path) .. "|" .. tostring(clip.textOnly), "nil|true")
Expect("...headed by its dungeon, named for the boss", clip.present.header .. "|" .. clip.present.label, "Deadmines|Edwin VanCleef")
Expect("...with its story and its face", clip.present.transcript .. "|" .. tostring(clip.present.portrait.creatureID),
    "He led the Brotherhood.|639")
Expect("...shown for six seconds at least", clip.length, 6)
Expect("a boss with no story has no line", Bosses:StoryClip(36, "no such boss"), nil)

local world = stub.world
local Q = SpokenEnv.SoundQueue
local function Showing() local head = Q:GetCurrentSound(); return head and head.key or "nothing" end
local function Clear() Q:RemoveAllSoundsFromQueue(); stub.Advance(2) end
local EDWIN = "boss:36:edwin vancleef"
world.npcGUID = "Creature-0-1-2-3-639-0000ABCDEF"
SpokenBossesCharacter.found["36:edwin vancleef"] = nil
Bosses:UnitSeen()
Expect("targeting a boss shows no story", Showing(), "nothing")
Bosses:EncounterEnded(edwin.id, 0)
Expect("...nor does a fight the party lost", Showing(), "nothing")
Bosses:EncounterEnded(edwin.id, 1)
Expect("killing the boss shows its story", Showing(), EDWIN)
Expect("...and the boss is met, as its page is no longer locked", SpokenBossesCharacter.found["36:edwin vancleef"], true)
Expect("...as words alone, with no pack", Q:GetCurrentSound().textOnly, true)
Expect("...noted for the character", SpokenBossesCharacter.storiesRead["36:edwin vancleef"], true)
Clear()
SpokenBossesCharacter.found["36:edwin vancleef"] = nil
Q:PauseQueue()
Bosses:ForgetStories()
Bosses:EncounterEnded(edwin.id, 1)
Expect("a story waiting behind a stop is queued", Showing(), EDWIN)
Expect("...as low as gossip", Q:GetCurrentSound().priority, "low")
Expect("...and not noted until it shows", SpokenBossesCharacter.storiesRead["36:edwin vancleef"], nil)
Expect("...but the boss is met at the kill, not when its story shows", SpokenBossesCharacter.found["36:edwin vancleef"], true)
Clear()
Q:ResumeQueue()
Bosses:EncounterEnded(edwin.id, 1)
Expect("...so cleared, it shows the next time", Showing(), EDWIN)
Clear()
Bosses:EncounterEnded(edwin.id, 1)
Expect("...once", Showing(), "nothing")
Expect("Forget Stories Shown counts what it forgot", Bosses:ForgetStories(), 1)
Bosses:EncounterEnded(edwin.id, 1)
Expect("...and the story shows again", Showing(), EDWIN)
Clear(); Bosses:ForgetStories()
SpokenBossesCharacter.found["36:edwin vancleef"] = nil
SpokenEnv.Addon.db.profile.Transcript.Enabled = false
Bosses:EncounterEnded(edwin.id, 1)
Expect("no boss shows its story with Show Narrator off, and the kill still meets it",
    Showing() .. "|" .. tostring(SpokenBossesCharacter.storiesRead["36:edwin vancleef"]) .. "|"
        .. tostring(SpokenBossesCharacter.found["36:edwin vancleef"]),
    "nothing|nil|true")
SpokenBossesCharacter.found["36:edwin vancleef"] = nil
_G.SpokenBossesAudioPacks = { SpokenBossesAudio = { version = 1, addon = "SpokenBossesAudio", language = "enUS",
    bitrate = 128, bosses = { [36] = { ["edwin vancleef"] = { file = "36\\edwin-vancleef", len = 41.2 } } } } }
local VOICED = "Interface\\AddOns\\SpokenBossesAudio\\Sounds\\36\\edwin-vancleef.mp3"
Bosses:EncounterEnded(edwin.id, 1)
Expect("with a pack and Show Narrator off, the story is still heard, as every voiced line is",
    Showing() .. "|" .. tostring(world.played[#world.played]), EDWIN .. "|" .. VOICED)
Clear(); Bosses:ForgetStories()
SpokenEnv.Addon.db.profile.Transcript.Enabled = true
local style = SpokenEnv.Addon.db.profile.Frame.Style
SpokenEnv.Addon.db.profile.Frame.Style = "none"
SpokenBossesCharacter.found["36:edwin vancleef"] = nil
Bosses:EncounterEnded(edwin.id, 1)
Expect("...and in Voice Only", Showing() .. "|" .. tostring(world.played[#world.played]), EDWIN .. "|" .. VOICED)
SpokenEnv.Addon.db.profile.Frame.Style = style
Clear(); Bosses:ForgetStories()
Click("Edwin VanCleef")
Expect("with a pack, a boss's page has Play lit", page.play:IsShown() and page.play:IsEnabled(), true)
page.play.scripts.OnClick(page.play)
Expect("...which plays the voiced story", Showing() .. "|" .. tostring(world.played[#world.played]), EDWIN .. "|" .. VOICED)
Expect("...not noted, so the boss still tells it when it falls", SpokenBossesCharacter.storiesRead["36:edwin vancleef"], nil)
Expect("...and finds it in the queue", Bosses:QueuedStory(36, "edwin vancleef") ~= nil, true)
Clear()
_G.SpokenBossesAudioPacks = nil
Click("Edwin VanCleef")
Expect("with no pack, Play is greyed again", page.play:IsEnabled(), false)
Clear(); Bosses:ForgetStories()
SpokenBossesCharacter.found["36:edwin vancleef"] = nil
world.cvars.Sound_EnableAllSound = "0"
Bosses:EncounterEnded(edwin.id, 1)
Expect("with sound off and no pack, the story still shows as words", Showing(), EDWIN)
world.cvars.Sound_EnableAllSound = nil
Clear(); Bosses:ForgetStories()

-- The events as the client sends them: Forever reports a won dungeon fight as ENCOUNTER_END with
-- success 0 and fires BOSS_KILL.
stub.FireEvent("ENCOUNTER_END", edwin.id, "Edwin VanCleef", 1, 5, 0)
Expect("ENCOUNTER_END with success 0 shows nothing", Showing(), "nothing")
stub.FireEvent("BOSS_KILL", edwin.id, "Edwin VanCleef")
Expect("...and BOSS_KILL shows the story", Showing(), EDWIN)
Clear(); Bosses:ForgetStories()
stub.FireEvent("ENCOUNTER_END", edwin.id, "Edwin VanCleef", 1, 5, 1)
Expect("ENCOUNTER_END with success 1 shows it too", Showing(), EDWIN)
Clear(); Bosses:ForgetStories()
stub.FireEvent("BOSS_KILL", edwin.id, "Edwin VanCleef")
stub.FireEvent("ENCOUNTER_END", edwin.id, "Edwin VanCleef", 1, 5, 1)
local both = {}
for _, queued in ipairs(Q.sounds) do both[#both + 1] = queued.key end
Expect("...and both for one kill show it once", table.concat(both, "|"), EDWIN)
Clear(); Bosses:ForgetStories()

local instanceInfo = _G.GetInstanceInfo
local sunkenMap
for map, bosses in pairs(SpokenBosses.maps) do
    for _, boss in ipairs(bosses) do
        if boss.key == "weaver" then sunkenMap = map end
    end
end
_G.SpokenBossStories[sunkenMap] = { weaver = "It weaves.", dreamscythe = "It reaps dreams." }
Bosses:EncounterEnded(2955, 1)
local keys = {}
for _, queued in ipairs(Q.sounds) do keys[#keys + 1] = queued.key end
Expect("...and an encounter of two bosses shows both stories", table.concat(keys, "|"),
    "boss:" .. sunkenMap .. ":weaver|boss:" .. sunkenMap .. ":dreamscythe")
Clear()

-- A boss whose fight may start no encounter (the world bosses): the game sends no kill for it, so its
-- death is watched once the player targeted it or saw its nameplate.
local function Listed(map, key)
    for _, boss in ipairs(SpokenBosses.maps[map] or {}) do
        if boss.key == key then return boss end
    end
end
Expect("Ribbly Screwspigot and Plugger Spazzring are listed in Blackrock Depths",
    tostring(Listed(230, "ribbly screwspigot") ~= nil) .. "|" .. tostring(Listed(230, "plugger spazzring") ~= nil), "true|true")
-- What each unit is: the client clears the target as the boss dies, and still reports it, dead, on a
-- nameplate or the soft target.
local units, dead = {}, false
local unitGUID, unitTokenFromGUID, unitIsDead = _G.UnitGUID, _G.UnitTokenFromGUID, _G.UnitIsDead
_G.UnitGUID = function(unit) return units[unit] end
_G.UnitIsDead = function() return dead end
_G.UnitTokenFromGUID = function(guid)
    for unit, unitGuid in pairs(units) do
        if unitGuid == guid then return unit end
    end
end
local KAZZAK = "Creature-0-1-2-3-12397-0000ABCDEF"
local EDWIN_GUID = "Creature-0-1-2-3-639-0000ABCDEF"
local function Health(unit) stub.FireEvent("UNIT_HEALTH", unit) end

SpokenBossesCharacter.found = {}
_G.GetInstanceInfo = function() return "Eastern Kingdoms", "none", 0, "", 0, 0, false, 0 end
_G.SpokenBossStories[2789] = { ["lord kazzak"] = "He burns." }
Bosses:ForgetStories()
units.target = KAZZAK
Bosses:UnitSeen()
Expect("a world boss targeted alive is not met and shows nothing", tostring(Bosses:IsBossFound(2789, "lord kazzak")) .. "|" .. Showing(),
    "false|nothing")
Health("target")
Expect("...nor does its health changing while it lives", tostring(Bosses:IsBossFound(2789, "lord kazzak")) .. "|" .. Showing(),
    "false|nothing")
units.target = nil
Bosses:UnitSeen()
units.nameplate1 = KAZZAK
dead = true
Health("nameplate2")
Expect("...nor does another unit dying", Showing(), "nothing")
Health("nameplate1")
Expect("...its death on a nameplate shows its story, though the target was cleared", Showing(), "boss:2789:lord kazzak")
Expect("...and meets it", Bosses:IsBossFound(2789, "lord kazzak"), true)
Clear()
Health("nameplate1")
Expect("...once", Showing(), "nothing")

-- The poll finds it where the event does not come.
dead = false
units.nameplate1 = nil
Bosses:ForgetStories()
units.target = KAZZAK
Bosses:UnitSeen()
units.target = nil
stub.Advance(2)
Expect("a boss no unit shows is not a kill", Showing(), "nothing")
units.mouseover = KAZZAK
dead = true
stub.Advance(2)
Expect("...and its death on the unit the mouse is over is, within a second", Showing(), "boss:2789:lord kazzak")
Clear()
units.mouseover = nil

-- Two bosses are watched at once, and a watch ends after half an hour or on leaving the zone.
local AZUREGOS = "Creature-0-1-2-3-6109-0000ABCDEF"
_G.SpokenBossStories[2791] = { ["azuregos"] = "He freezes." }
stub.SetZone({ zone = "Azshara" })
dead = false
Bosses:ForgetStories()
units.target = KAZZAK
Bosses:UnitSeen()
units.target = AZUREGOS
Bosses:UnitSeen()
units.target, units.nameplate1 = nil, KAZZAK
dead = true
Health("nameplate1")
Expect("a second boss targeted does not drop the first", Showing(), "boss:2789:lord kazzak")
Clear()
units.nameplate1 = AZUREGOS
Health("nameplate1")
Expect("...and the second is found when it dies", Showing(), "boss:2791:azuregos")
Clear()
units.nameplate1 = nil
dead = false
Bosses:ForgetStories()
units.target = KAZZAK
Bosses:UnitSeen()
stub.Advance(1801, 1)
units.target, units.nameplate1 = nil, KAZZAK
dead = true
Health("nameplate1")
Expect("a watch lasts while the boss is seen, however long", Showing(), "boss:2789:lord kazzak")
Clear()
units.nameplate1 = nil
dead = false
Bosses:ForgetStories()
units.target = KAZZAK
Bosses:UnitSeen()
units.target = nil
stub.Advance(1801, 1)
units.nameplate1 = KAZZAK
dead = true
Health("nameplate1")
Expect("a watch ends half an hour after the boss was last seen", Showing(), "nothing")
dead = false
Bosses:ForgetStories()
units.target = KAZZAK
Bosses:UnitSeen()
stub.SetZone({ zone = "" })
stub.Advance(2, 1)
stub.SetZone({ zone = "Azshara" })
units.target, units.nameplate1 = nil, KAZZAK
dead = true
Health("nameplate1")
Expect("...a blank zone name, as in a loading screen, does not end it", Showing(), "boss:2789:lord kazzak")
Clear()
dead = false
Bosses:ForgetStories()
units.target = KAZZAK
Bosses:UnitSeen()
stub.SetZone({ zone = "Orgrimmar" })
stub.Advance(2, 1)
units.target, units.nameplate1 = nil, KAZZAK
dead = true
Health("nameplate1")
Expect("...and leaving the zone it began in does", Showing(), "nothing")
units.nameplate1 = nil
stub.SetZone({ zone = "" })

-- A boss that comes into view is watched without being targeted, and a death on a boss or focus unit counts.
dead = false
Bosses:ForgetStories()
units.nameplate1 = KAZZAK
stub.FireEvent("NAME_PLATE_UNIT_ADDED", "nameplate1")
units.nameplate1, units.boss1 = nil, KAZZAK
dead = true
Health("boss1")
Expect("a boss whose nameplate appeared is watched though never targeted, and a death on boss1 counts", Showing(), "boss:2789:lord kazzak")
Clear()
units.boss1 = nil

-- A dead flag the client hides is not a kill; a client with no UnitTokenFromGUID still has the event;
-- a failure meeting the boss does not lose its story.
dead = false
Bosses:ForgetStories()
units.target = KAZZAK
Bosses:UnitSeen()
units.target, units.nameplate1 = nil, KAZZAK
dead = true
stub.Secrets(true)
Health("nameplate1")
stub.Secrets()
Expect("a dead flag the client hides is not a kill", Showing(), "nothing")
Health("nameplate1")
Expect("...until it can be read", Showing(), "boss:2789:lord kazzak")
Clear()
units.nameplate1 = nil
local tokenFromGUID = _G.UnitTokenFromGUID
_G.UnitTokenFromGUID = nil
dead = false
Bosses:ForgetStories()
units.target = KAZZAK
Bosses:UnitSeen()
units.target = nil
stub.Advance(2, 1)
units.nameplate1 = KAZZAK
dead = true
Health("nameplate1")
Expect("a client with no UnitTokenFromGUID still finds the death by its event", Showing(), "boss:2789:lord kazzak")
Clear()
_G.UnitTokenFromGUID = tokenFromGUID
units.nameplate1 = nil
local foundBoss = Bosses.FoundBoss
Bosses.FoundBoss = function() error("the list failed to draw") end
dead = false
Bosses:ForgetStories()
units.target = KAZZAK
Bosses:UnitSeen()
units.target, units.nameplate1 = nil, KAZZAK
dead = true
Health("nameplate1")
Bosses.FoundBoss = foundBoss
Expect("a failure meeting the boss still shows its story", Showing(), "boss:2789:lord kazzak")
Clear()
units.nameplate1 = nil

-- A corpse targeted, another boss and a player are not watched.
dead = true
Bosses:ForgetStories()
units.target = KAZZAK
Bosses:UnitSeen()
Health("target")
Expect("a corpse targeted is not a kill", Showing(), "nothing")
dead = false
units.target = EDWIN_GUID
Bosses:UnitSeen()
dead = true
Health("target")
Expect("a boss whose fight starts an encounter is not watched", Showing(), "nothing")
dead = false
units.target = "Player-1-0000ABCD"
Bosses:UnitSeen()
dead = true
Health("target")
Expect("a player is not watched", Showing(), "nothing")

-- Inside an instance the client hides a unit's GUID.
dead = false
Bosses:ForgetStories()
units.target = KAZZAK
stub.Secrets(KAZZAK)
Bosses:UnitSeen()
stub.Secrets()
units.target, units.nameplate1 = nil, KAZZAK
dead = true
Health("nameplate1")
Expect("a boss whose GUID the client hides is not watched", Showing(), "nothing")
_G.UnitGUID, _G.UnitTokenFromGUID, _G.UnitIsDead = unitGUID, unitTokenFromGUID, unitIsDead
_G.GetInstanceInfo = instanceInfo

if Failures() > 0 then os.exit(1) end
