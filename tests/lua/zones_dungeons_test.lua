-- The dungeons and raids on the Zones tab of Azeroth's Compendium: each a card inside the card of
-- the zone of its entrance, under a Dungeons and Raids line where the zone has several, as the
-- Quests tab files their quests. First the data (Spoken's Data/Dungeons.lua, which every tab reads)
-- against the areas' stories and the Quests data, then the list built against the stub client. Run
-- with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local ADDONS = here .. "/../../addons/"
local ZONES = ADDONS .. "Spoken_Places/"
local Expect, Failures = H.Expecter(print)

---------------------------------------------------------------- the data
local function Normalise(name)
    return (name:lower():gsub("'", ""):gsub("^the%s+", ""):gsub("[^a-z0-9]+", " "):gsub("^%s+", ""):gsub("%s+$", ""))
end

local data = {}
local loader = { ShouldLoadLanguage = function() return true end }
function loader:RegisterLoreData(_, kind, t) data[kind] = t end
for _, file in ipairs({ "enUS/Zones.lua", "enUS/Subzones.lua" }) do
    assert(loadfile(ZONES .. "Data/" .. file))("Spoken_Places", loader)
end
dofile(ADDONS .. "Spoken/Data/Dungeons.lua")
local all = _G.SpokenDungeons.dungeons
-- By the zone of each's entrance, as Spoken Zones' Core.lua reads them.
local core = {}
assert(loadfile(ZONES .. "Core.lua"))("Spoken_Places", core)
local subzones, dungeons = data.subzones, core.Dungeons
assert(loadfile(ADDONS .. "Spoken_Quests/Data/Compendium.lua"))()
local quests = _G.SpokenQuestsCompendium

-- Where the Quests data files each dungeon's quests: the zone of its entrance.
local questZone = {}
for _, quest in pairs(quests.quests) do
    if quest.dungeon and quest.zones then questZone[quest.dungeon] = quest.zones[1] end
end

local missing, unknown, elsewhere, mapped, twice = {}, {}, {}, {}, {}
for zone, list in pairs(dungeons) do
    for _, dungeon in ipairs(list) do
        local name = dungeon.mapID .. "/" .. dungeon.key
        if not (subzones[dungeon.mapID] and subzones[dungeon.mapID][dungeon.key]) then table.insert(missing, name) end
        if not all[dungeon.dungeon] then table.insert(unknown, name) end
        if questZone[dungeon.dungeon] and questZone[dungeon.dungeon] ~= zone then table.insert(elsewhere, name) end
        if mapped[dungeon.dungeon] then table.insert(twice, name) end
        mapped[dungeon.dungeon] = true
    end
end
Expect("every dungeon is an area with a story", table.concat(missing, ", "), "")
Expect("...named by its instance's map", table.concat(unknown, ", "), "")
Expect("...under the zone the Quests tab files its quests in", table.concat(elsewhere, ", "), "")
Expect("...each once", table.concat(twice, ", "), "")

-- A dungeon with an area of its name anywhere is one of them.
local unmapped, filed = {}, {}
for id, names in pairs(all) do
    local key = Normalise(names[1])
    for mapID, areas in pairs(subzones) do
        if areas[key] and not mapped[id] then table.insert(unmapped, names[1] .. " in " .. mapID) end
    end
end
table.sort(unmapped)
Expect("every dungeon with an area of its name is marked", table.concat(unmapped, ", "), "")
-- Every dungeon the Quests data files quests under is one of the table's, in the same zone.
for _, quest in pairs(quests.quests) do
    if quest.dungeon and not (all[quest.dungeon] and quest.zones and quest.zones[1] == all[quest.dungeon].zone) then
        filed[quest.dungeon] = true
    end
end
local strays = {}
for id in pairs(filed) do table.insert(strays, id) end
table.sort(strays)
Expect("every dungeon the Quests data names is in the table, under its entrance's zone", table.concat(strays, ", "), "")
Expect("Forever's City of Dalaran is Alterac Mountains' Dalaran, and Ruins of Lordaeron the Undercity's",
    all[2959].zone .. "/" .. all[2959].story[2] .. "|" .. all[2999].zone .. "/" .. all[2999].story[2],
    "1416/dalaran|1458/ruins of lordaeron")
Expect("the Sunken Temple is the Temple of Atal'Hakkar's area", dungeons[1435][1].key .. "|" .. dungeons[1435][1].dungeon,
    "temple of atalhakkar|109")
Expect("Razorfen Downs is listed in The Barrens, its story kept under Thousand Needles",
    dungeons[1413][2].key .. "|" .. dungeons[1413][2].mapID, "razorfen downs|1441")

---------------------------------------------------------------- the list
stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
-- Spoken, which the module runs on: its round buttons are the pages' Play and Report.
stub.LoadSpoken(here .. "/../../addons/Spoken/").Addon:Enable()
_G.C_Texture = { GetAtlasInfo = function(name) return stub.ListAtlas(name) end }
_G.SPELLBOOK_FONT_COLOR = { GetRGB = function() return 0.24, 0.15, 0.07 end }
-- The game's portrait frame, as PortraitFrameMixin has it, and each frame's template kept.
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
_G.WorldMapFrame = _G.WorldMapFrame or CreateFrame("Frame", "WorldMapFrame", UIParent)
_G.GetSubZoneText = function() return "" end
_G.tinsert = _G.tinsert or table.insert
_G.GameFontHighlight = _G.GameFontHighlight or { GetFont = function() return "font.ttf", 12 end }
_G.hooksecurefunc = _G.hooksecurefunc or function() end

local Z = H.NewZoneLore()
Z.Zones = { [1414] = { name = "Kalimdor", full = "West." },
    [1415] = { name = "Eastern Kingdoms", full = "East." }, [1411] = { name = "Durotar", full = "Red land." },
    [1454] = { name = "Orgrimmar", full = "The orcs' city." }, [1413] = { name = "The Barrens", full = "Dry land." },
    [1441] = { name = "Thousand Needles", full = "Spires." }, [1436] = { name = "Westfall", full = "Farms." } }
Z.Subzones = {
    [1411] = { ["valley of trials"] = { name = "Valley of Trials", full = "Where the orcs learn." },
        ["skull rock"] = { name = "Skull Rock", full = "A pretend dungeon beside a city." } },
    [1454] = { ["ragefire chasm"] = { name = "Ragefire Chasm", full = "Under the city." },
        ["valley of strength"] = { name = "Valley of Strength", full = "The city's heart." } },
    [1413] = { crossroads = { name = "Crossroads", full = "A fort." },
        ["wailing caverns"] = { name = "Wailing Caverns", full = "Caves of nightmares." } },
    [1441] = { ["razorfen downs"] = { name = "Razorfen Downs", full = "The quilboars' barrows." },
        highperch = { name = "Highperch", full = "Wyverns." } },
    [1436] = { deadmines = { name = "Deadmines", full = "The Defias' mine." }, moonbrook = { name = "Moonbrook", full = "A town." } },
}
Z.Dungeons = {
    [1413] = { { mapID = 1413, key = "wailing caverns", dungeon = 43 }, { mapID = 1441, key = "razorfen downs", dungeon = 129 } },
    [1436] = { { mapID = 1436, key = "deadmines", dungeon = 36 } },
    [1454] = { { mapID = 1454, key = "ragefire chasm", dungeon = 389 } },
    [1411] = { { mapID = 1411, key = "skull rock", dungeon = 1 } },
}
function Z:GetLore(mapID) return self.Zones[mapID] end
function Z:IsPending(entry) return entry and entry.pending or false end
function Z:GetLoreWithFallback(mapID) return self.Zones[mapID], mapID end
function Z:GetPlayerMapID() return 1436 end
function Z:GetDisplayedMapID() return 1436 end
function Z:GetMapName(mapID) return self.Zones[mapID] and self.Zones[mapID].name end
function Z:IsVoiceEnabled() return true end
function Z:HasAudio() return true end
function Z:IsPlayingLore() return false end
function Z:IsLoreAtHead() return false end
function Z:LoreClip() end
function Z:OnAudioChanged() end
function Z:OnMapChanged() end
function Z:CanContribute() return true end
function Z:Picture() end
local showAll, found = true, {}
function Z:ShowsUndiscovered() return showAll end
function Z:IsFound(mapID, key) return found[key and (mapID .. "/" .. key) or tostring(mapID)] == true end
function Z:RefreshFound() end
Z.ToggleLoreWindow = nil
local audio = setmetatable({}, { __index = Z })
assert(loadfile(ZONES .. "Audio.lua"))("Spoken_Places", audio)
Z.PlaceAbove = audio.PlaceAbove
-- Where an area found on a map has its story, as Core.lua finds it.
local core = setmetatable({}, { __index = Z })
assert(loadfile(ZONES .. "Core.lua"))("Spoken_Places", core)
Z.Aliases = {}
for _, name in ipairs({ "StoryPlace", "AreaZone", "FoundOn", "AreasIn", "GetSubzoneLore", "ResolveAreaKey", "NormaliseAreaKey" }) do
    Z[name] = core[name]
end
function Z:ClearSubzone() self.selected = nil; self:RefreshPanel() end
for _, file in ipairs({ "UI/ContributeButton", "UI/LorePage", "UI/LoreWindow", "UI/MapPanel" }) do
    assert(loadfile(ZONES .. file .. ".lua"))("Spoken_Places", Z)
end
Z:SetupLoreWindow()
local window = Z.window
local page = window.page

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

Z:ToggleLoreWindow()
Expect("opened on Westfall, its dungeon a line of its own before its areas", Shown(),
    "Eastern Kingdoms|Westfall|Deadmines|Moonbrook|Kalimdor|Durotar|The Barrens|Thousand Needles")

-- Standing at Razorfen Downs' entrance in The Barrens, the tab opens on its card there.
Z.GetPlayerMapID = function() return 1413 end
_G.GetSubZoneText = function() return "Razorfen Downs" end
Z:ToggleLoreWindow(); Z:ToggleLoreWindow()
local listed = 0
for label in (Shown() .. "|"):gmatch("([^|]*)|") do if label == "Razorfen Downs" then listed = listed + 1 end end
Expect("at Razorfen Downs' entrance the tab opens on its card, listed once", RowFor("Razorfen Downs").selected and listed, 1)
Expect("...its story under Thousand Needles", page.title.text .. ": " .. page.body.text.text .. "|" .. page.target[1],
    "Razorfen Downs: The quilboars' barrows.|1441")
Z.GetPlayerMapID = function() return 1436 end
_G.GetSubZoneText = function() return "" end
Click("Dungeons and Raids")
Expect("...its line and its zone's card closing again on a click each", Click("The Barrens"),
    "Eastern Kingdoms|Westfall|Deadmines|Moonbrook|Kalimdor|Durotar|The Barrens|Thousand Needles")
Expect("...a line, one level in, as a city's is", RowFor("Deadmines").row.style .. "|" .. RowFor("Deadmines").row.nest, "group|1")
Expect("...counted as one of the zone's places", RowFor("Westfall").count.text:match("/(%d+)"), "2")
Expect("...no numbers of its own", RowFor("Deadmines").count.text, "")
Expect("...greyed while not found", RowFor("Deadmines").row.none, true)
found["1436/deadmines"] = true
Z:RefreshLoreWindow(); Shown()
Expect("...ticked once found, as its area's row was", RowFor("Deadmines").status:IsShown() and not RowFor("Deadmines").row.none, true)
found["1436/deadmines"] = nil
showAll = false
Z:RefreshLoreWindow(); Shown()
Expect("...not locked, as no zone or city is", RowFor("Deadmines").row.locked or false, false)
Click("Deadmines")
Expect("...chosen, its page says it is not discovered", page.title.text .. ": " .. page.body.text.text,
    "Deadmines: " .. Z.L.NOT_DISCOVERED)
showAll = true
Click("Deadmines")
Expect("its page is its area's story", page.title.text .. ": " .. page.body.text.text, "Deadmines: The Defias' mine.")
Expect("...in its zone", page.sub.text.text, "In Westfall")

Click("The Barrens")
Expect("a zone with several has a Dungeons and Raids line, closed, before its areas", Shown(),
    "Eastern Kingdoms|Westfall|Deadmines|Moonbrook|Kalimdor|Durotar|The Barrens|Dungeons and Raids|Crossroads|Thousand Needles")
Expect("...a line with no dungeon of its own", RowFor("Dungeons and Raids").row.style .. "|" .. RowFor("Dungeons and Raids").row.nest, "group|1")
Expect("...counting its dungeons found out of all", RowFor("Dungeons and Raids").count.text, "0/2 • 0%")
Expect("...a story under Thousand Needles counted in the zone of its entrance",
    RowFor("The Barrens").count.text:match("/(%d+)") .. "|" .. RowFor("Thousand Needles").count.text:match("/(%d+)"), "3|1")
Click("Dungeons and Raids")
Expect("...opening on a click, a line for each under it by name", Shown(),
    "Eastern Kingdoms|Westfall|Deadmines|Moonbrook|Kalimdor|Durotar|The Barrens|Dungeons and Raids|Razorfen Downs|Wailing Caverns|Crossroads|Thousand Needles")
Expect("...one level further in", RowFor("Razorfen Downs").row.style .. "|" .. RowFor("Razorfen Downs").row.nest, "group|2")
Expect("...the line chosen, its page counting its dungeons in its zone",
    page.title.text .. "|" .. page.sub.text.text .. "|" .. page.body.text.text,
    "Dungeons and Raids|In The Barrens · 0 of 2 discovered|" .. Z.L.DUNGEONS_PICK)
Expect("...its row lit as chosen", RowFor("Dungeons and Raids").selected, true)
Click("Razorfen Downs")
Expect("Razorfen Downs' page is its story", page.title.text .. ": " .. page.body.text.text, "Razorfen Downs: The quilboars' barrows.")
Expect("...in The Barrens, where its entrance is", page.sub.text.text, "In The Barrens")
Click("Thousand Needles")
Expect("...and is not an area of Thousand Needles", Shown(),
    "Eastern Kingdoms|Westfall|Deadmines|Moonbrook|Kalimdor|Durotar|The Barrens|Dungeons and Raids|Razorfen Downs|Wailing Caverns|Crossroads|Thousand Needles|Highperch")
Click("Thousand Needles")
Click("Dungeons and Raids")
Expect("the line closes on another click", Shown(),
    "Eastern Kingdoms|Westfall|Deadmines|Moonbrook|Kalimdor|Durotar|The Barrens|Dungeons and Raids|Crossroads|Thousand Needles")

Click("Durotar")
Expect("a zone's dungeon after its city's card and before its areas", Shown(),
    "Eastern Kingdoms|Westfall|Deadmines|Moonbrook|Kalimdor|Durotar|Orgrimmar|Skull Rock|Valley of Trials|The Barrens|Dungeons and Raids|Crossroads|Thousand Needles")
Click("Orgrimmar")
Expect("a city's dungeon in the city's card", Shown(),
    "Eastern Kingdoms|Westfall|Deadmines|Moonbrook|Kalimdor|Durotar|Orgrimmar|Ragefire Chasm|Valley of Strength|Skull Rock|Valley of Trials|The Barrens|Dungeons and Raids|Crossroads|Thousand Needles")
Expect("...two levels in", RowFor("Ragefire Chasm").row.nest, 2)
Click("Orgrimmar")
Click("Durotar")

-- Opened on a dungeon from elsewhere (the map's panel): its zone and its line open to show it.
Click("The Barrens")
Z:ShowLoreFor(1441, "razorfen downs")
Expect("opened on a dungeon, its entrance's zone and its line open", Shown(),
    "Eastern Kingdoms|Westfall|Deadmines|Moonbrook|Kalimdor|Durotar|The Barrens|Dungeons and Raids|Razorfen Downs|Wailing Caverns|Crossroads|Thousand Needles")
Expect("...the dungeon's line chosen", RowFor("Razorfen Downs").selected, true)
Expect("...its page with the dungeon's round portrait left of the title, the zone badge on it",
    page.headFace ~= nil and page.headFace.speaker.bullet == "zone" and page.shift > 0, true)
showAll = false
Z:RefreshLoreWindow()
Expect("...not discovered, its page says so, in The Barrens", page.sub.text.text .. "|" .. page.body.text.text,
    "In The Barrens|" .. Z.L.NOT_DISCOVERED)
showAll = true
Click("Dungeons and Raids")

-- A search lists the dungeons that match, and every one where it names the line.
local search
for _, child in ipairs(window.children or {}) do if child.template == "SearchBoxTemplate" then search = child end end
local function Search(text)
    search:SetText(text)
    search.hooks.OnTextChanged[1](search)
    return Shown()
end
Expect("a search lists a dungeon under its line and zone", Search("wailing"), "Kalimdor|The Barrens|Dungeons and Raids|Wailing Caverns")
Expect("...one naming the line lists all under it", Search("raids"),
    "Kalimdor|The Barrens|Dungeons and Raids|Razorfen Downs|Wailing Caverns")
Click("Dungeons and Raids")
Expect("...the line closing on a click for this search", Shown(), "Kalimdor|The Barrens|Dungeons and Raids")
Expect("...and a dungeon of its own by name", Search("deadmines"), "Eastern Kingdoms|Westfall|Deadmines")
Search("")

-- Discovered Only and Voiced Only leave dungeons out as they do areas.
local filters = stub.OpenDropdown(window.filterMenu)
found = { ["1413"] = true, ["1413/wailing caverns"] = true, ["1413/crossroads"] = true }
filters[1].func()
Click("Dungeons and Raids")
Expect("Discovered Only leaves out the dungeons not found", Shown(),
    "Kalimdor|The Barrens|Dungeons and Raids|Wailing Caverns|Crossroads")
Expect("...the line still counting them, as a zone's card does", RowFor("Dungeons and Raids").count.text, "1/2 • 50%")
filters[1].func()
found = {}
local hasAudio = Z.HasAudio
Z.HasAudio = function(_, mapID, key) return mapID == 1441 and key == "razorfen downs" end
stub.OpenDropdown(window.filterMenu)[2].func()
Expect("Voiced Only keeps a zone whose dungeon has a recording, and only that", Shown(),
    "Kalimdor|The Barrens|Dungeons and Raids|Razorfen Downs")
Expect("...counting only it", RowFor("Dungeons and Raids").count.text .. "|" .. RowFor("The Barrens").count.text, "0/1 • 0%|0/1 • 0%")
stub.OpenDropdown(window.filterMenu)[2].func()
Z.HasAudio = hasAudio

-- Clicked on The Barrens' map, the panel beside it tells its story by its own ids.
Z.GetDisplayedMapID = function() return 1413 end
Z:SetupMapPanel()
WorldMapFrame:Show()
Z.selected = { mapID = 1413, areaName = "Razorfen Downs", entry = Z.Subzones[1441]["razorfen downs"] }
Z:RefreshPanel()
local mapPage = Z.panel.page
Expect("Razorfen Downs clicked on The Barrens' map: its story beside the map, in The Barrens",
    mapPage.title.text .. ": " .. mapPage.body.text.text .. "|" .. mapPage.sub.text.text,
    "Razorfen Downs: The quilboars' barrows.|In The Barrens")
Expect("...Play, Report and Open on its story under Thousand Needles",
    table.concat({ mapPage.target[1], mapPage.target[2], tostring(mapPage.play:IsShown()), tostring(mapPage.report:IsShown()),
        mapPage.open.mapID, mapPage.open.areaKey }, "|"),
    "1441|razorfen downs|true|true|1441|razorfen downs")
showAll = false
Z:RefreshPanel()
Expect("...not discovered while not found at its entrance", mapPage.body.text.text, Z.L.NOT_DISCOVERED)
found["1441/razorfen downs"] = true
Z:RefreshPanel()
Expect("...and told once it is", mapPage.body.text.text, "The quilboars' barrows.")
showAll, found = true, {}

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll zones dungeons tests passed")
