-- The places' tab with a zone on neither continent (Forever's Zephras Isle, whose map hangs under
-- Azeroth): under a banner of its own after the continents, opened and closed as they are. Then
-- the battlegrounds, under a banner after it wherever the client hangs their maps. The set-up is
-- the lore window's test's. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local ZONES = here .. "/../../addons/Spoken_Places/"
local Expect, Failures = H.Expecter(print)

stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
-- Spoken, which the module runs on: its round buttons are the pages' Play and Report.
stub.LoadSpoken(here .. "/../../addons/Spoken/").Addon:Enable()

-- The atlases the client has, as Blizzard's own frames use them (wow-ui-source, forever).
local ATLASES = { ["spellbook-Page-Right-C60"] = true, ["spellbook-divider"] = true, ["LFG-lock"] = true,
    ["QuestDetailsBackgrounds"] = true, ["questlog-frame"] = true, ["questlog-frame-filigree"] = true }
_G.C_Texture = { GetAtlasInfo = function(name) return stub.ListAtlas(name) or ATLASES[name] and { width = 64, height = 11 } or nil end }
_G.SPELLBOOK_FONT_COLOR = { GetRGB = function() return 0.24, 0.15, 0.07 end }

-- The game's portrait frame: its title and portrait, as PortraitFrameMixin has them.
local createFrame = _G.CreateFrame
_G.CreateFrame = function(kind, name, parent, template)
    local frame = createFrame(kind, name, parent, template)
    if template == "PortraitFrameTemplate" then
        function frame:SetTitle(text) self.title = text end
        function frame:SetPortraitToAsset(path) self.portrait = path end
    end
    frame.template = template
    -- A colour painted on a texture, kept to be read back: a page with no art is one.
    local createTexture = frame.CreateTexture
    function frame:CreateTexture(...)
        local texture = createTexture(self, ...)
        function texture:SetColorTexture(r, g, b, a) self.color = { r, g, b, a } end
        return texture
    end
    return frame
end
_G.UISpecialFrames = _G.UISpecialFrames or {}
_G.WorldMapFrame = _G.WorldMapFrame or createFrame("Frame", "WorldMapFrame", UIParent)
_G.GetSubZoneText = function() return "" end
_G.tinsert = _G.tinsert or table.insert
_G.GameFontHighlight = _G.GameFontHighlight or { GetFont = function() return "font.ttf", 12 end }

local Z = H.NewZoneLore()
-- The world's name is the client's: no story of its own to take it from.
local mapName = Z.GetMapName
function Z:GetMapName(id) return id == 947 and "Azeroth" or mapName(self, id) end
Z.Zones = { [1411] = { name = "Durotar", full = "Durotar is a cracked, red land." },
    [1426] = { name = "Dun Morogh", pending = true },
    -- A city: a zone of its own, listed inside the zone around it.
    [1454] = { name = "Orgrimmar", full = "The orcs' city." },
    [1414] = { name = "Kalimdor", full = "The western continent." },
    [1415] = { name = "Eastern Kingdoms", full = "The eastern continent." },
    -- A map only another client has (Forever's, on Era): this client's C_Map has never heard of it.
    [2482] = { name = "Somewhere Else", full = "Another client's place." },
    [2521] = { name = "Zephras Isle", full = "An isle of its own." },
    -- Battlegrounds: one on no continent, one the client hangs under Kalimdor. Arathi Basin has
    -- no story here, so it is not listed.
    [1460] = { name = "Warsong Gulch", full = "A gulch in Ashenvale." },
    [2524] = { name = "Darkspear Islands", full = "The trolls' isles." } }
local getMapInfo = _G.C_Map.GetMapInfo
_G.C_Map.GetMapInfo = function(id)
    if id == 2482 then return nil end
    if id == 947 then return { mapType = 0, name = "Azeroth" } end
    if id == 2521 then return { mapType = 3, name = "Zephras Isle", parentMapID = 947 } end
    if id == 2524 then return { mapType = 3, name = "Darkspear Islands", parentMapID = 1414 } end
    return getMapInfo(id)
end
Z.Subzones = { [1411] = { ["valley of trials"] = { name = "Valley of Trials", full = "Where the orcs learn." },
    ["sen'jin village"] = { name = "Sen'jin Village", pending = true },
    -- An area only Forever has: this client, Era, never lists it.
    ["camp forever"] = { name = "Camp Forever", full = "Only on Forever." } } }
Z.ForeverOnlyAreas = { [1411] = { ["camp forever"] = true } }
function Z:GetLore(mapID) return self.Zones[mapID] end
function Z:IsPending(entry) return entry and entry.pending or false end
function Z:GetSubzoneLore() return nil end
function Z:GetLoreWithFallback(mapID) return self.Zones[mapID], mapID end
local playerMap = 1411
function Z:GetPlayerMapID() return playerMap end
function Z:GetDisplayedMapID() return 1411 end
function Z:IsVoiceEnabled() return true end
function Z:HasAudio() return true end
function Z:IsPlayingLore() return false end
function Z:IsLoreAtHead() return false end
function Z:LoreClip() end
function Z:OnAudioChanged() end
function Z:OnMapChanged() end
function Z:CanContribute() return true end
function Z:ResolveAreaKey(name) return name and string.lower(name) end
function Z:ClearSubzone() self.selected = nil; self:RefreshPanel() end
-- Durotar has a picture; its areas have none.
function Z:Picture(mapID, key)
    if mapID == 1411 and not key then return "Pictures/zone-1411", "Pictures/Mask2" end
end
-- Every place listed, as with Unlock Undiscovered Zones on, until the checks for the found-only
-- list below turn it off.
local showAll, found = true, {}
function Z:ShowsUndiscovered() return showAll end
function Z:IsFound(mapID, key) return found[key and (mapID .. "/" .. key) or tostring(mapID)] == true end
function Z:RefreshFound() end
Z.ToggleLoreWindow = nil
_G.hooksecurefunc = _G.hooksecurefunc or function() end

-- The page's line over a place's name comes from Audio.lua's PlaceAbove; the rest of that file
-- would replace this test's stand-in packs.
local audio = setmetatable({}, { __index = Z })
assert(loadfile(ZONES .. "Audio.lua"))("Spoken_Places", audio)
Z.PlaceAbove = audio.PlaceAbove
for _, file in ipairs({ "UI/LorePage", "UI/LoreWindow", "UI/MapPanel" }) do
    assert(loadfile(ZONES .. file .. ".lua"))("Spoken_Places", Z)
end

---------------------------------------------------------------- the lore window
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
local function RowFor(label)
    for _, row in ipairs(rows) do if row.shown ~= false and row.row and row.row.label == label then return row end end
end
local function Shown()
    rows = {}; Collect(window)
    local labels = {}
    for _, row in ipairs(rows) do if row.shown ~= false and row.row then table.insert(labels, row.row.label) end end
    return table.concat(labels, "|")
end
local L = Z.L

---------------------------------------------------------------- the battlegrounds
-- Standing in one, the tab lands on it with its banner open. Durotar, landed on when the tab was
-- built, stays open beside it.
playerMap = 2524
Z:ToggleLoreWindow()
Expect("standing in a battleground, the tab lands on it, under the Battlegrounds banner after Other Lands",
    page.title.text .. "|" .. Shown(), "Darkspear Islands|Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar|Orgrimmar|"
    .. "Sen'jin Village|Valley of Trials|" .. L.OTHER_LANDS .. "|" .. L.BATTLEGROUNDS .. "|Darkspear Islands|Warsong Gulch")
Expect("...a banner", RowFor(L.BATTLEGROUNDS).row.style, "banner")
Expect("...one hung under a continent not counted there, one on none not under Other Lands: each banner counts its own zones' lines",
    RowFor("Kalimdor").row.total .. "|" .. RowFor(L.OTHER_LANDS).row.total, RowFor("Durotar").row.total .. "|0")
playerMap = 1411
_G.SpokenCompendium:Hide()
Z:ToggleLoreWindow()
Shown()
RowFor(L.BATTLEGROUNDS).scripts.OnClick(RowFor(L.BATTLEGROUNDS))
Expect("...closed by a click, its lines gone", Shown():find("Warsong Gulch", 1, true), nil)
Expect("...chosen, its page naming it, in Azeroth with no count where its zones have no areas, and asking for one",
    page.title.text .. "|" .. page.sub.text.text .. "|" .. page.body.text.text,
    L.BATTLEGROUNDS .. "|" .. L.IN_ZONE_FMT:format("Azeroth") .. "|")
Expect("...the banner the chosen row", RowFor(L.BATTLEGROUNDS).selected, true)
Z:ShowLoreFor(1460, nil)
Expect("opened on a battleground, its banner opens to show it", Shown():match("|" .. L.BATTLEGROUNDS
    .. "|Darkspear Islands|Warsong Gulch$") ~= nil and RowFor("Warsong Gulch").selected, true)
RowFor(L.BATTLEGROUNDS).scripts.OnClick(RowFor(L.BATTLEGROUNDS))
Z:ShowLoreFor(1411, nil)

---------------------------------------------------------------- other lands
Expect("a zone on neither continent is under a banner of its own after them, closed",
    Shown(), "Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar|Orgrimmar|Sen'jin Village|Valley of Trials|" .. L.OTHER_LANDS
    .. "|" .. L.BATTLEGROUNDS)
Expect("...a banner", RowFor(L.OTHER_LANDS).row.style, "banner")
RowFor(L.OTHER_LANDS).scripts.OnClick(RowFor(L.OTHER_LANDS))
Expect("...opened, its zone a line inside it", Shown():match("|" .. L.OTHER_LANDS .. "|Zephras Isle|" .. L.BATTLEGROUNDS .. "$") ~= nil
    and RowFor("Zephras Isle").row.style, "group")
Expect("...chosen, its page naming it, in Azeroth, and asking for one",
    page.title.text .. "|" .. page.sub.text.text .. "|" .. page.body.text.text,
    L.OTHER_LANDS .. "|" .. L.IN_ZONE_FMT:format("Azeroth") .. "|")
Expect("...the banner the chosen row", RowFor(L.OTHER_LANDS).selected, true)
Z.Subzones[2521] = { cove = { name = "Hidden Cove", full = "A cove." } }
found["2521/cove"] = true
Z:RefreshLoreWindow()
Expect("...and what its zones' lines count, where they have areas", page.sub.text.text,
    L.IN_ZONE_FMT:format("Azeroth") .. " · " .. L.DISCOVERED_FMT:format(1, 1))
Z.Subzones[2521], found["2521/cove"] = nil, nil
Shown()
RowFor(L.OTHER_LANDS).scripts.OnClick(RowFor(L.OTHER_LANDS))
Expect("...closed again, the line gone", Shown():find("Zephras Isle", 1, true), nil)
RowFor(L.OTHER_LANDS).scripts.OnClick(RowFor(L.OTHER_LANDS))
Shown()
RowFor("Zephras Isle").scripts.OnClick(RowFor("Zephras Isle"))
Expect("the zone chosen, its own story", page.title.text, "Zephras Isle")
Expect("...its page with the zone's round portrait left of the title, the zone badge on it",
    page.headFace ~= nil and page.headFace.speaker.bullet == "zone" and page.shift > 0, true)
Shown()
Expect("...the banner no longer the chosen row", RowFor(L.OTHER_LANDS).selected, false)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll zones other lands and battlegrounds tests passed")
