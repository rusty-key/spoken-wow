-- The areas the client puts in another zone than the one their story is kept under
-- (Data/AreaZones.lua): Strahnbrad and eleven more kept under Hillsbrad Foothills and in Alterac
-- Mountains in Classic, the Great Lift and two lakes at a border, the Valley of Bones in Forever's
-- Shen'dralas. Each is listed, found and told in the client's zone, by its story's frozen ids.
-- First the data against the stories, then the real Core, Autoplay and Discovery, then Azeroth's
-- Compendium and the map's panel. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local Expect, Failures = H.Expecter(print)
local SPOKEN = here .. "/../../addons/Spoken/"
local ZONES = here .. "/../../addons/Spoken_Places/"

local ALTERAC, HILLSBRAD, BARRENS, NEEDLES, DESOLACE, SHENDRALAS = 1416, 1424, 1413, 1441, 1443, 2652

---------------------------------------------------------------- the data
local data, loader = {}, { ShouldLoadLanguage = function() return true end }
function loader:RegisterLoreData(_, kind, t) data[kind] = t end
for _, file in ipairs({ "enUS/Zones.lua", "enUS/Subzones.lua", "AreaZones.lua" }) do
    assert(loadfile(ZONES .. "Data/" .. file))("Spoken_Places", loader)
end
dofile(ZONES .. "../Spoken/Data/Dungeons.lua")
local zones, subzones, moved = data.zones, data.subzones, loader.AreaZones

local isDungeon = {}
for _, dungeon in pairs(SpokenDungeons.dungeons) do
    if dungeon.story then isDungeon[dungeon.story[1] .. "/" .. dungeon.story[2]] = true end
end
local missing, unknownZone, clash, dungeon, neither = {}, {}, {}, {}, {}
for storyMapID, areas in pairs(moved) do
    for key, area in pairs(areas) do
        local name = storyMapID .. "/" .. key
        if not (subzones[storyMapID] and subzones[storyMapID][key]) then table.insert(missing, name) end
        if isDungeon[name] then table.insert(dungeon, name) end
        if not area.zone and not area.also then table.insert(neither, name) end
        local maps = { area.zone }
        for _, mapID in ipairs(area.also or {}) do table.insert(maps, mapID) end
        for _, mapID in ipairs(maps) do
            if not zones[mapID] then table.insert(unknownZone, name .. " in " .. mapID) end
            if subzones[mapID] and subzones[mapID][key] then table.insert(clash, name .. " in " .. mapID) end
        end
    end
end
Expect("every area moved is a story kept where the table says", table.concat(missing, ", "), "")
Expect("...shown in zones with a story of their own", table.concat(unknownZone, ", "), "")
Expect("...none of which keeps a story of the same name", table.concat(clash, ", "), "")
Expect("...no dungeon among them, which Spoken's Data/Dungeons.lua places", table.concat(dungeon, ", "), "")
Expect("...each with a zone or more zones it is found in", table.concat(neither, ", "), "")
local alterac = {}
for key, area in pairs(moved[HILLSBRAD]) do if area.zone == ALTERAC then table.insert(alterac, key) end end
table.sort(alterac)
Expect("the twelve areas kept under Hillsbrad Foothills are Alterac Mountains'", table.concat(alterac, ", "),
    "chillwind point, corrahns dagger, crushridge hold, gallows corner, gavins naze, growless cave, headland, "
    .. "misty shore, ravenholdt manor, slaughter hollow, soferas naze, strahnbrad")

---------------------------------------------------------------- Core, Autoplay, Discovery
local after = C_Timer.After
local getMapInfo = C_Map.GetMapInfo

local function Boot(where, client)
    stub.SetClient("11509")
    stub.ResetSound(); stub.ResetTimers()
    stub.world.inCombat = false
    stub.world.playerLevel = 40
    -- Shen'dralas is a map only Forever's client has.
    C_Map.GetMapInfo = function(id)
        if id == SHENDRALAS and client ~= "forever" then return nil end
        return getMapInfo(id)
    end
    SpokenZonesSettings = nil
    SpokenZonesCharacter = { greeted = true }
    SpokenZonesAudioPacks = {
        SpokenZonesAudio = { version = 1, addon = "SpokenZonesAudio", language = "enUS", zones = {},
            subzones = { [HILLSBRAD] = { strahnbrad = { file = "1424\\strahnbrad", len = 40 } },
                [NEEDLES] = { ["great lift"] = { file = "1441\\great-lift", len = 30 } } } },
    }
    local env = stub.LoadSpoken(SPOKEN)
    env.Addon:Enable()
    C_Timer.After = after
    local Z = H.LoadZones(ZONES)
    assert(loadfile(ZONES .. "Locale/enUS.lua"))("Spoken_Places", Z)
    for _, file in ipairs({ "Autoplay", "Discovery", "Data/AreaZones", "UI/LoreWindow" }) do
        assert(loadfile(ZONES .. file .. ".lua"))("Spoken_Places", Z)
    end
    Z.Zones[ALTERAC] = { name = "Alterac Mountains", full = "Snow." }
    Z.Zones[HILLSBRAD] = { name = "Hillsbrad Foothills", full = "Hills." }
    Z.Zones[BARRENS] = { name = "The Barrens", full = "Dry land." }
    Z.Zones[NEEDLES] = { name = "Thousand Needles", full = "Spires." }
    Z.Subzones[ALTERAC] = { dalaran = { name = "Dalaran", full = "Behind a dome." } }
    Z.Subzones[HILLSBRAD] = { strahnbrad = { name = "Strahnbrad", full = "A town in the mountains." },
        southshore = { name = "Southshore", full = "A town by the sea." } }
    Z.Subzones[NEEDLES] = { ["great lift"] = { name = "Great Lift", full = "A lift." } }
    Z.Subzones[DESOLACE] = { ["valley of bones"] = { name = "Valley of Bones", full = "Bones." } }
    Z.pictures = { [HILLSBRAD] = { strahnbrad = { "1424-strahnbrad", 3 } } }
    Z.GetMapName = function(_, mapID) return Z.Zones[mapID] and Z.Zones[mapID].name end
    stub.SetZone(where)
    stub.FireEvent("ADDON_LOADED", "Spoken_Places")
    Z:SetupAudio()
    Z:SetupAutoplay()
    Z:SetupDiscovery()
    return Z
end

local STRAHNBRAD = { map = ALTERAC, zone = "Alterac Mountains", subzone = "Strahnbrad" }
local Z = Boot(STRAHNBRAD)
local entry, key, story = Z:GetSubzoneLore(ALTERAC, "Strahnbrad")
Expect("in Alterac Mountains, Strahnbrad finds its story under Hillsbrad Foothills",
    (entry and entry.full) .. "|" .. tostring(key) .. "|" .. tostring(story), "A town in the mountains.|strahnbrad|1424")
Expect("...as the minimap button's tooltip and /spz status read it", Z:GetSubzoneLore(ALTERAC, "Strahnbrad") == entry, true)
Expect("...listed in Alterac Mountains", Z:AreaZone(HILLSBRAD, "strahnbrad"), ALTERAC)
local function Keys(list)
    local keys = {}
    for _, area in ipairs(list) do table.insert(keys, area.mapID .. "/" .. area.key) end
    table.sort(keys)
    return table.concat(keys, " ")
end
Expect("...among Alterac Mountains' areas", Keys(Z:AreasIn(ALTERAC)), "1416/dalaran 1424/strahnbrad")
Expect("...and not Hillsbrad Foothills'", Keys(Z:AreasIn(HILLSBRAD)), "1424/southshore")
Expect("an area at a border is found on both sides", table.concat({ Z:StoryPlace(BARRENS, "great lift") }, "|") .. " "
    .. table.concat({ Z:StoryPlace(NEEDLES, "great lift") }, "|"), "1441|great lift 1441|great lift")
Expect("...listed once, where its story is", Z:AreaZone(NEEDLES, "great lift") .. "|" .. Keys(Z:AreasIn(BARRENS)), "1441|")
Expect("on Era, which has no Shen'dralas, the Valley of Bones stays in Desolace",
    Z:AreaZone(DESOLACE, "valley of bones") .. "|" .. Keys(Z:AreasIn(DESOLACE)), "1443|1443/valley of bones")

-- With Autoplay Explored Areas on, standing in it is enough.
Z:Set("autoplayExplored", true)
stub.FireEvent("ZONE_CHANGED")
local clip = Spoken:GetCurrent()
Expect("standing in Strahnbrad plays its story by its own id", clip and clip.key, "s:1424:strahnbrad")
Expect("...headed by Alterac Mountains, where it is listed", clip and clip.present.header, "Alterac Mountains")
Expect("...with its picture", clip and clip.present.picture and clip.present.picture.file,
    [[Interface\AddOns\Spoken_Places\Textures\Pictures\1424-strahnbrad]])
Expect("...and its report names the story's map", clip and Z:ReportURL(clip.mapID, clip.areaKey),
    "https://spoken.rusty.one/zones/r/1424/strahnbrad")
Expect("...the visit recorded in Alterac Mountains, where it is found",
    tostring(SpokenZonesCharacter.visited["1416/strahnbrad"]) .. "|" .. tostring(Z:IsFound(HILLSBRAD, "strahnbrad")),
    "true|true")
Expect("...which finds Alterac Mountains too", Z:IsFound(ALTERAC), true)

Z = Boot(STRAHNBRAD)
SlashCmdList["SPOKENZONES"]("play")
clip = Spoken:GetCurrent()
Expect("/spz play in Strahnbrad plays its story", clip and clip.key, "s:1424:strahnbrad")

Z = Boot(STRAHNBRAD)
stub.FireEvent("CHAT_MSG_SYSTEM", "Discovered Strahnbrad: 10 experience gained.")
clip = Spoken:GetCurrent()
Expect("discovering it in Alterac Mountains plays the same story", clip and clip.key, "s:1424:strahnbrad")

Z = Boot({ map = BARRENS, zone = "The Barrens", subzone = "The Great Lift" })
Z:Set("autoplayExplored", true)
stub.FireEvent("ZONE_CHANGED")
clip = Spoken:GetCurrent()
Expect("standing at the Great Lift's top in The Barrens plays its story", clip and clip.key, "s:1441:great lift")
Expect("...headed by Thousand Needles, where it is listed", clip and clip.present.header, "Thousand Needles")

Z = Boot({ map = HILLSBRAD, zone = "Hillsbrad Foothills", subzone = "Southshore" })
Expect("not found before it is stood in", Z:IsFound(HILLSBRAD, "strahnbrad"), false)
SpokenZonesCharacter.visited["1424/strahnbrad"] = true
Expect("...a visit recorded under Hillsbrad Foothills still counts", Z:IsFound(HILLSBRAD, "strahnbrad"), true)
SpokenZonesCharacter.visited["1424/strahnbrad"] = nil
-- Alterac Mountains' map, with Strahnbrad's overlay explored.
local before = { CreateVector2D, C_Map.GetMapArtLayers, C_Map.GetAreaInfo }
_G.CreateVector2D = function(x, y) return { x = x, y = y } end
C_Map.GetMapArtLayers = function() return { { layerWidth = 1000, layerHeight = 500 } } end
C_Map.GetAreaInfo = function(id) return ({ [1] = "Strahnbrad", [2] = "The Great Lift" })[id] end
local overlays = { [ALTERAC] = 1, [BARRENS] = 2 }
_G.C_MapExplorationInfo = {
    GetExploredMapTextures = function(mapID)
        return overlays[mapID] and { { hitRect = { left = 0, right = 1000, top = 0, bottom = 500 } } } or {}
    end,
    GetExploredAreaIDsAtPosition = function(mapID) return overlays[mapID] and { overlays[mapID] } or nil end,
}
Z:RefreshFound()
Expect("...found explored on Alterac Mountains' map",
    tostring(Z:IsFound(HILLSBRAD, "strahnbrad")) .. "|" .. select(2, Z:IsFound(HILLSBRAD, "strahnbrad")), "true|explored on map 1416")
Expect("the Great Lift is found explored on The Barrens' map", Z:IsFound(NEEDLES, "great lift"), true)
_G.C_MapExplorationInfo = nil
_G.CreateVector2D, C_Map.GetMapArtLayers, C_Map.GetAreaInfo = before[1], before[2], before[3]
Z:RefreshFound()

Z = Boot(STRAHNBRAD, "forever")
Expect("on Forever the Valley of Bones is Shen'dralas'",
    Z:AreaZone(DESOLACE, "valley of bones") .. "|" .. Keys(Z:AreasIn(SHENDRALAS)) .. "|" .. Keys(Z:AreasIn(DESOLACE)),
    "2652|1443/valley of bones|")
Expect("...found there", (Z:StoryPlace(SHENDRALAS, "valley of bones")), DESOLACE)
C_Map.GetMapInfo = getMapInfo

---------------------------------------------------------------- Azeroth's Compendium and the map's panel
stub.ResetFrames()
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
_G.WorldMapFrame = _G.WorldMapFrame or CreateFrame("Frame", "WorldMapFrame", UIParent)
_G.GetSubZoneText = function() return "" end
_G.tinsert = _G.tinsert or table.insert
_G.GameFontHighlight = _G.GameFontHighlight or { GetFont = function() return "font.ttf", 12 end }
_G.hooksecurefunc = _G.hooksecurefunc or function() end

Z = H.NewZoneLore()
Z.Zones = { [1415] = { name = "Eastern Kingdoms", full = "East." },
    [1414] = { name = "Kalimdor", full = "West." },
    [ALTERAC] = { name = "Alterac Mountains", full = "Snow." }, [HILLSBRAD] = { name = "Hillsbrad Foothills", full = "Hills." },
    [BARRENS] = { name = "The Barrens", full = "Dry land." }, [NEEDLES] = { name = "Thousand Needles", full = "Spires." } }
Z.Subzones = {
    [ALTERAC] = { dalaran = { name = "Dalaran", full = "Behind a dome." } },
    [HILLSBRAD] = { strahnbrad = { name = "Strahnbrad", full = "A town in the mountains." },
        southshore = { name = "Southshore", full = "A town by the sea." } },
    [BARRENS] = { crossroads = { name = "Crossroads", full = "A fort." } },
    [NEEDLES] = { ["great lift"] = { name = "Great Lift", full = "A lift." } },
}
Z.Dungeons = {}
Z.AreaZones = { [HILLSBRAD] = { strahnbrad = { zone = ALTERAC } }, [NEEDLES] = { ["great lift"] = { also = { BARRENS } } } }
function Z:GetLore(mapID) return self.Zones[mapID] end
function Z:IsPending(e) return e and e.pending or false end
function Z:GetLoreWithFallback(mapID) return self.Zones[mapID], mapID end
function Z:GetPlayerMapID() return HILLSBRAD end
function Z:GetDisplayedMapID() return HILLSBRAD end
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
function Z:IsFound(mapID, k) return found[k and (mapID .. "/" .. k) or tostring(mapID)] == true end
function Z:RefreshFound() end
Z.ToggleLoreWindow = nil
local audio = setmetatable({}, { __index = Z })
assert(loadfile(ZONES .. "Audio.lua"))("Spoken_Places", audio)
Z.PlaceAbove = audio.PlaceAbove
local core = setmetatable({}, { __index = Z })
assert(loadfile(ZONES .. "Core.lua"))("Spoken_Places", core)
Z.Aliases = {}
for _, name in ipairs({ "StoryPlace", "AreaZone", "FoundOn", "AreasIn", "GetSubzoneLore", "ResolveAreaKey", "NormaliseAreaKey" }) do
    Z[name] = core[name]
end
function Z:ClearSubzone() self.selected = nil; self:RefreshPanel() end
for _, file in ipairs({ "UI/LorePage", "UI/LoreWindow", "UI/MapPanel" }) do
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
local function Total(label) return RowFor(label).count.text:match("/(%d+)") end

-- Standing in Strahnbrad, the tab opens on its row.
Z.GetPlayerMapID = function() return ALTERAC end
_G.GetSubZoneText = function() return "Strahnbrad" end
Z:ToggleLoreWindow(); Shown()
Expect("standing in Strahnbrad the tab opens on its row in Alterac Mountains",
    tostring(RowFor("Strahnbrad") and RowFor("Strahnbrad").selected) .. "|" .. page.title.text, "true|Strahnbrad")
Z.GetPlayerMapID = function() return HILLSBRAD end
_G.GetSubZoneText = function() return "" end
-- Hillsbrad Foothills' card is open since the tab was built, where the player stood then.
Click("Alterac Mountains")
Expect("Hillsbrad Foothills' card open, Strahnbrad is not among its areas", Shown(),
    "Eastern Kingdoms|Alterac Mountains|Hillsbrad Foothills|Southshore|Kalimdor|The Barrens|Thousand Needles")
Click("Hillsbrad Foothills")
Click("Alterac Mountains")
Expect("...it is one of Alterac Mountains'", Shown(),
    "Eastern Kingdoms|Alterac Mountains|Dalaran|Strahnbrad|Hillsbrad Foothills|Kalimdor|The Barrens|Thousand Needles")
Expect("...counted there and not in Hillsbrad Foothills", Total("Alterac Mountains") .. "|" .. Total("Hillsbrad Foothills"), "2|1")
Expect("...and once in the continent's count", Total("Eastern Kingdoms"), "3")
Expect("the Great Lift is counted once, in Thousand Needles",
    Total("Thousand Needles") .. "|" .. Total("The Barrens") .. "|" .. Total("Kalimdor"), "1|1|2")
Click("Strahnbrad")
Expect("Strahnbrad's page is its story, in Alterac Mountains",
    page.title.text .. ": " .. page.body.text.text .. "|" .. page.sub.text.text, "Strahnbrad: A town in the mountains.|In Alterac Mountains")
Expect("...played and reported by its story's keys",
    table.concat({ page.target[1], page.target[2], tostring(page.play:IsShown()), tostring(page.report:IsShown()) }, "|"),
    "1424|strahnbrad|true|true")
found["1424/strahnbrad"] = true
Z:RefreshLoreWindow(); Shown()
Expect("found, it is ticked and counted in Alterac Mountains",
    tostring(RowFor("Strahnbrad").row.done) .. "|" .. RowFor("Alterac Mountains").count.text:match("^(%d+)/"), "true|1")
found = {}
Click("Alterac Mountains")

local search
for _, child in ipairs(window.children or {}) do if child.template == "SearchBoxTemplate" then search = child end end
local function Search(text)
    search:SetText(text)
    search.hooks.OnTextChanged[1](search)
    return Shown()
end
Expect("a search finds it under Alterac Mountains", Search("strahn"), "Eastern Kingdoms|Alterac Mountains|Strahnbrad")
Expect("...and a search naming Hillsbrad Foothills does not list it", Search("hillsbrad"),
    "Eastern Kingdoms|Hillsbrad Foothills|Southshore")
Search("")

Click("Eastern Kingdoms")
Z:ShowLoreFor(HILLSBRAD, "strahnbrad")
Expect("opened on it from elsewhere, Alterac Mountains opens to show it", Shown(),
    "Eastern Kingdoms|Alterac Mountains|Dalaran|Strahnbrad|Hillsbrad Foothills|Kalimdor|The Barrens|Thousand Needles")
Expect("...its row chosen", RowFor("Strahnbrad").selected, true)
showAll = false
Z:RefreshLoreWindow()
Expect("...not discovered, its page says so, in Alterac Mountains", page.sub.text.text .. "|" .. page.body.text.text,
    "In Alterac Mountains|" .. Z.L.NOT_DISCOVERED)
showAll = true
Click("Alterac Mountains")

-- The map's panel.
Z:SetupMapPanel()
WorldMapFrame:Show()
Z.GetDisplayedMapID = function() return HILLSBRAD end
Z:RefreshPanel()
local mapPage = Z.panel.page
Expect("Hillsbrad Foothills' map: its panel counts its own areas only", mapPage.sub.text.text, "In Eastern Kingdoms · 0 of 1 discovered")
Z.GetDisplayedMapID = function() return ALTERAC end
Z:RefreshPanel()
Expect("Alterac Mountains' map: its panel counts Strahnbrad", mapPage.sub.text.text, "In Eastern Kingdoms · 0 of 2 discovered")
Z.selected = { mapID = ALTERAC, areaName = "Strahnbrad", entry = Z.Subzones[HILLSBRAD].strahnbrad }
Z:RefreshPanel()
Expect("Strahnbrad clicked on Alterac Mountains' map: its story, in Alterac Mountains",
    mapPage.title.text .. ": " .. mapPage.body.text.text .. "|" .. mapPage.sub.text.text,
    "Strahnbrad: A town in the mountains.|In Alterac Mountains")
Expect("...Play, Report and Open on its story under Hillsbrad Foothills",
    table.concat({ mapPage.target[1], mapPage.target[2], tostring(mapPage.play:IsShown()), tostring(mapPage.report:IsShown()),
        mapPage.open.mapID, mapPage.open.areaKey }, "|"),
    "1424|strahnbrad|true|true|1424|strahnbrad")
showAll = false
Z:RefreshPanel()
Expect("...not discovered while not found", mapPage.body.text.text, Z.L.NOT_DISCOVERED)
showAll = true

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll zones area zones tests passed")
