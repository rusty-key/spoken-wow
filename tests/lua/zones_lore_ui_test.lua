-- The lore window and the story beside the map, built against the stub client with the art the
-- game has: the portrait frame, the spellbook's parchment and divider, the quest log's frame.
-- Each place is chosen, searched for and read back the way a player would. Run with
-- `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local ZONES = here .. "/../../addons/Spoken_Zones/"
local Expect, Failures = H.Expecter(print)

stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()

-- The atlases the client has, as Blizzard's own frames use them (wow-ui-source, forever).
local ATLASES = { ["spellbook-Page-Right-C60"] = true, ["spellbook-divider"] = true,
    ["QuestDetailsBackgrounds"] = true, ["questlog-frame"] = true, ["questlog-frame-filigree"] = true,
    ["Professions_Recipe_Hover"] = true }
_G.C_Texture = { GetAtlasInfo = function(name) return ATLASES[name] and { width = 64, height = 11 } or nil end }
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
Z.Zones = { [1411] = { name = "Durotar", full = "Durotar is a cracked, red land." },
    [1426] = { name = "Dun Morogh", pending = true },
    [947] = { name = "Azeroth", full = "The world." },
    [1414] = { name = "Kalimdor", full = "The western continent." },
    [1415] = { name = "Eastern Kingdoms", full = "The eastern continent." },
    -- A map only another client has (Forever's, on Era): this client's C_Map has never heard of it.
    [2482] = { name = "Somewhere Else", full = "Another client's place." } }
local getMapInfo = _G.C_Map.GetMapInfo
_G.C_Map.GetMapInfo = function(id) if id == 2482 then return nil end return getMapInfo(id) end
Z.Subzones = { [1411] = { ["valley of trials"] = { name = "Valley of Trials", full = "Where the orcs learn." },
    ["sen'jin village"] = { name = "Sen'jin Village", pending = true } } }
function Z:GetLore(mapID) return self.Zones[mapID] end
function Z:IsPending(entry) return entry and entry.pending or false end
function Z:GetSubzoneLore() return nil end
function Z:GetLoreWithFallback(mapID) return self.Zones[mapID], mapID end
function Z:GetPlayerMapID() return 1411 end
function Z:GetDisplayedMapID() return 1411 end
function Z:IsVoiceEnabled() return true end
function Z:HasAudio() return true end
function Z:IsPlayingLore() return false end
function Z:IsLoreAtHead() return false end
function Z:OnAudioChanged() end
function Z:OnMapChanged() end
function Z:CanContribute() return true end
function Z:ResolveAreaKey(name) return name and string.lower(name) end
function Z:ClearSubzone() self.selected = nil; self:RefreshPanel() end
-- Durotar has a picture; its areas have none.
function Z:Picture(mapID, key)
    if mapID == 1411 and not key then return "Pictures/zone-1411", "Pictures/Mask2" end
end
Z.ToggleLoreWindow = nil
_G.hooksecurefunc = _G.hooksecurefunc or function() end

for _, file in ipairs({ "UI/Layout", "UI/TextView", "UI/AudioButton", "UI/ReportButton", "UI/LorePage", "UI/LoreWindow", "UI/MapPanel" }) do
    assert(loadfile(ZONES .. file .. ".lua"))("Spoken_Zones", Z)
end

---------------------------------------------------------------- the lore window
Z:SetupLoreWindow()
local window = Z.window
Expect("the lore window is the game's portrait frame", window.template, "PortraitFrameTemplate")
Expect("...titled, with the map in its portrait", window.title .. "|" .. tostring(window.portrait), "Lore of Azeroth|Interface\\Icons\\INV_Misc_Map_01")
Expect("...closed by Escape", _G.UISpecialFrames[#_G.UISpecialFrames], "SpokenZonesWindow")
local page = window.page
Expect("its story is on the spellbook's parchment", page.parchment, "spellbook-Page-Right-C60")
Expect("...in an inset of its own, as the list is, so their borders part them", window.pageInset.template, "InsetFrameTemplate")
Expect("...with no credit line on the page", page.credit, nil)
Expect("Report is the player's round button, the ring round the bug", page.report.ring ~= nil and page.report.glyph ~= nil, true)
Expect("...under the spellbook's divider", page.divider.atlas or page.divider.layoutAtlas or true, true)

Z:ToggleLoreWindow()
Expect("opening it lands on where the player stands", page.title.text, "Durotar")
Expect("...the story in the spellbook's ink", page.body.ink and page.body.ink[1], 0.24)
Expect("...with Play and Report for it", page.play.mapID == 1411 and page.report.mapID == 1411, true)
Expect("...and the zone's picture above the story", page.body.picture:IsShown() and page.body.picture:GetTexture(), "Pictures/zone-1411")
Expect("...its edge frayed by its mask", page.body.pictureMask:GetTexture(), "Pictures/Mask2")
Expect("...a little see-through, so the parchment shows in it", page.body.picture:GetAlpha(), 0.95)
Expect("...as wide as the words, up to its most", page.body.picture:GetWidth(), math.min(400, page.body.text:GetWidth()))
Expect("...centred over them", select(1, page.body.picture:GetPoint(1)) == "TOP"
    and select(2, page.body.picture:GetPoint(1)) == page.body.child, true)
local _, _, _, _, textTop = page.body.text:GetPoint(1)
Expect("...the words below it", textTop < -page.body.picture:GetHeight(), true)

-- The list: Durotar open, its two areas under it, Dun Morogh closed.
local rows = {}
local function Collect(frame)
    for _, child in ipairs(frame.children or {}) do
        if child.row then table.insert(rows, child) end
        Collect(child)
    end
end
Collect(window)
local shown = {}
for _, row in ipairs(rows) do if row.shown ~= false and row.row then table.insert(shown, row.label.text) end end
Expect("the places are a tree: Azeroth, its continents, their zones, the chosen zone open",
    table.concat(shown, "|"), "Azeroth|Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar|Sen'jin Village|Valley of Trials")

local function RowFor(label)
    for _, row in ipairs(rows) do if row.shown ~= false and row.row and row.label.text == label then return row end end
end
local function Shown()
    rows = {}; Collect(window)
    local labels = {}
    for _, row in ipairs(rows) do if row.shown ~= false and row.row then table.insert(labels, row.label.text) end end
    return table.concat(labels, "|")
end

-- The zone opened on is the chosen one, and its minus closes it: it used to open again at once.
RowFor("Durotar").scripts.OnClick(RowFor("Durotar"))
Expect("the open zone's minus closes it, its areas gone", Shown(), "Azeroth|Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar")
Expect("...with the plus in its place", RowFor("Durotar").toggle.texture, [[Interface\Buttons\UI-PlusButton-Up]])
Expect("...and the zone still the one chosen", page.title.text, "Durotar")
RowFor("Durotar").scripts.OnClick(RowFor("Durotar"))
Expect("...and its plus opens it again", Shown(), "Azeroth|Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar|Sen'jin Village|Valley of Trials")
Expect("...with the minus back", RowFor("Durotar").toggle.texture, [[Interface\Buttons\UI-MinusButton-Up]])
RowFor("Valley of Trials").scripts.OnClick(RowFor("Valley of Trials"))
RowFor("Durotar").scripts.OnClick(RowFor("Durotar"))
Expect("an area chosen, its zone's minus still closes it", Shown(), "Azeroth|Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar")
RowFor("Durotar").scripts.OnClick(RowFor("Durotar"))
Shown()

RowFor("Valley of Trials").scripts.OnClick(RowFor("Valley of Trials"))
Expect("choosing an area shows its story", page.title.text .. ": " .. page.body.text.text, "Valley of Trials: Where the orcs learn.")
Expect("...says which zone it is in, and leads back to it", page.sub.text.text, "in Durotar")
page.sub.scripts.OnClick(page.sub)
Expect("...which goes back to the zone", page.title.text, "Durotar")
Expect("a zone says which continent it is on, and how many areas it holds", page.sub.text.text, "in Kalimdor · 2 areas")
page.sub.scripts.OnClick(page.sub)
Expect("...leading up to the continent", page.title.text, "Kalimdor")
Expect("a continent says it is in Azeroth, and how many zones it holds", page.sub.text.text, "in Azeroth · 1 zone")
page.sub.scripts.OnClick(page.sub)
Expect("...leading up to Azeroth", page.title.text, "Azeroth")
Expect("Azeroth sits in nothing: it says what it holds", page.sub.text.text, "2 continents, 2 zones")
Expect("...not counting a map this client has not got", RowFor("Somewhere Else"), nil)

RowFor("Sen'jin Village").scripts.OnClick(RowFor("Sen'jin Village"))
Expect("a place with no story says so, faded", page.body.text.text, Z.L.LORE_NOT_WRITTEN:format("Sen'jin Village"))
Expect("...offers to Contribute one", page.contribute.mapID, 1411)
Expect("...and has nothing to play or report", page.play.mapID == nil and page.report.mapID == nil, true)

-- Its faded ink kept through a re-wrap, which sets the text again.
local Art = Z.Art
local painted
local setTextColor = page.body.text.SetTextColor
page.body.text.SetTextColor = function(self, r, g, b) painted = { r, g, b }; return setTextColor(self, r, g, b) end
page.body.frame:SetWidth(page.body.frame:GetWidth() + 40)
page.body.frame.scripts.OnSizeChanged(page.body.frame)
Expect("...still faded once the page re-wraps it", painted and painted[1], Art.FADED[1])
page.body.text.SetTextColor = setTextColor

-- A list scrolled further than it now reaches comes back to its end.
local listBar = window.listBar
listBar.frame:SetHeight(100)
listBar.child:SetHeight(300)
listBar.frame:SetVerticalScroll(500)
listBar:UpdateScrollBar()
Expect("a list shorter than where it was scrolled comes back to its end", listBar.frame:GetVerticalScroll(), 200)
listBar.child:SetHeight(50)
listBar:UpdateScrollBar()
Expect("...and to the top when it no longer scrolls", listBar.frame:GetVerticalScroll(), 0)

---------------------------------------------------------------- search
local search
for _, child in ipairs(window.children or {}) do if child.template == "SearchBoxTemplate" then search = child end end
Expect("a search box sits over the list", search ~= nil, true)
search:SetText("trials")
search.hooks.OnTextChanged[1](search)
rows = {}; Collect(window)
shown = {}
for _, row in ipairs(rows) do if row.shown ~= false and row.row then table.insert(shown, row.label.text) end end
Expect("searching shows the matches, under their zone, continent and Azeroth", table.concat(shown, "|"),
    "Azeroth|Kalimdor|Durotar|Valley of Trials")
-- A row clicked in the results only chooses it: the tree under the search is left as it was.
RowFor("Durotar").scripts.OnClick(RowFor("Durotar"))
Expect("choosing a match shows its story", page.title.text, "Durotar")
search:SetText("")
search.hooks.OnTextChanged[1](search)
rows = {}; Collect(window)
shown = {}
for _, row in ipairs(rows) do if row.shown ~= false and row.row then table.insert(shown, row.label.text) end end
Expect("...and the tree comes back as it was before the search", table.concat(shown, "|"),
    "Azeroth|Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar|Sen'jin Village|Valley of Trials")
search:SetText("nowhere")
search.hooks.OnTextChanged[1](search)
Expect("...and says when nothing matches", window.noMatch.shown, true)
search:SetText("")
search.hooks.OnTextChanged[1](search)

---------------------------------------------------------------- beside the map
Z:SetupMapPanel()
local panel = Z.panel
Expect("the story beside the map wears the quest log's frame", panel ~= nil, true)
-- Beside the map, not in it: the Forever client's gamepad UI takes the open map's buttons into
-- its own navigation, and closing the map is then blocked.
Expect("...and is not the map's", panel.parent, UIParent)
Expect("...nor is the button that reopens it", _G.SpokenZonesPanelToggle.parent, UIParent)
Z:RefreshPanel()
Expect("...so nothing shows it while the map is closed", panel:IsShown(), false)
WorldMapFrame:Show()
Z:RefreshPanel()
Expect("...and it shows with the map", panel:IsShown(), true)
WorldMapFrame:Hide()
for _, hook in ipairs(WorldMapFrame.hooks.OnHide or {}) do hook(WorldMapFrame) end
Expect("...and goes with it", panel:IsShown(), false)
WorldMapFrame:Show()
Z:RefreshPanel()
local mapPage = panel.page
Expect("...round the quest details' parchment", mapPage.parchment, "QuestDetailsBackgrounds")
-- The frame is nine-sliced, as the game draws it: stretched whole, its corners grew with the panel.
local border = panel.rim and panel.rim.border
local rim = panel.rim and panel.rim.anchor
Expect("...reaching past the parchment by its clear edge, so none shows past it",
    rim and (rim.point .. " " .. rim.x .. "," .. rim.y), "BOTTOMRIGHT 2,-3")
Expect("...its frame in nine pieces", border and #border, 9)
Expect("...the corners at their own size whatever the panel's", border and (border[1].width .. "x" .. border[1].height), "28x28")
Expect("...the middle stretched to the bottom-right corner's", border and border[9].anchor.relativeTo == border[4]
    and border[9].anchor.relativePoint, "TOPLEFT")
Expect("...and shows the zone the map is on, with its story", mapPage.title.text .. ": " .. mapPage.body.text.text,
    "Durotar: Durotar is a cracked, red land.")
Z.selected = { mapID = 1411, areaName = "Valley of Trials", entry = Z.Subzones[1411]["valley of trials"] }
Z:RefreshPanel()
Expect("an area clicked on the map says which zone it is in, as Lore of Azeroth does",
    mapPage.title.text .. "|" .. mapPage.sub.text.text, "Valley of Trials|" .. Z.L.IN_ZONE_FMT:format("Durotar"))
mapPage.sub.scripts.OnClick(mapPage.sub)
Expect("...and the line goes back to the zone's story", mapPage.title.text, "Durotar")
Expect("a zone's line is Lore of Azeroth's: its continent, and how many areas", mapPage.sub.text.text,
    (Z:PlaceLine(1411)))
local shownMap
WorldMapFrame.SetMapID = function(_, id) shownMap = id end
mapPage.sub.scripts.OnClick(mapPage.sub)
Expect("...a click taking the map up to the continent", shownMap, 1414)
WorldMapFrame.SetMapID = nil

---------------------------------------------------------------- Lore of Azeroth from the panel
local opened
local showLoreFor = Z.ShowLoreFor
Z.ShowLoreFor = function(_, mapID, key) opened = tostring(mapID) .. "|" .. tostring(key) end
Expect("the panel beside the map can open Lore of Azeroth", mapPage.open ~= nil and mapPage.open:IsShown(), true)
Expect("...in the same round button as Play and Report", mapPage.open.width, 24)
mapPage.open.scripts.OnClick(mapPage.open)
Expect("...on the place it is showing", opened, "1411|nil")
Expect("...and the window has no such button: it is the window", page.open, nil)
Z.selected = { mapID = 1411, areaName = "Sen'jin Village", entry = Z.Subzones[1411]["sen'jin village"] }
Z:RefreshPanel()
mapPage.open.scripts.OnClick(mapPage.open)
Expect("...an area with no story yet on its own row there", opened, "1411|sen'jin village")
Z.selected = nil
local displayed = Z.GetDisplayedMapID
Z.GetDisplayedMapID = function() return 9999 end
Z:RefreshPanel()
Expect("...and a map with no entry at all offers nothing to open", mapPage.open:IsShown(), false)
Z.GetDisplayedMapID = displayed
Z:RefreshPanel()
Z.ShowLoreFor = showLoreFor

---------------------------------------------------------------- the fades' solid edge
-- The view clips on whole pixels; the solid band under each fade reaches 2 past the clip line,
-- out of the view, so no row of text is left half covered there.
local body = page.body
Expect("the bottom fade's solid band reaches 2 below the view", body.fadeBottom.anchor.y, -2)
Expect("...and the top one 2 above it", body.fadeTop.anchor.y, 2)
Expect("each fade eases in three steps, so it shows no line where it starts", #body.ramps, 6)

---------------------------------------------------------------- the same page on every client
-- Era and Anniversary have not got the modern spellbook's page, and a client that has it may draw
-- it its own way. The page is drawn from the copies shipped in Textures/Art whatever the client has.
ATLASES["spellbook-Page-Right-C60"], ATLASES["QuestDetailsBackgrounds"] = nil, nil
ATLASES["spellbook-divider"], ATLASES["spellbook-list-backplate"] = nil, nil
local bare = Z:CreateLorePage(createFrame("Frame", nil, UIParent), "book")
local ART = [[Interface\AddOns\Spoken_Zones\Textures\Art\]]
Expect("a client without the spellbook's art still has its page", bare.bg.texture, ART .. "spellbook-Page-Right-C60")
Expect("...its divider", bare.divider.texture, ART .. "spellbook-divider")
Expect("...and its backplate", bare.backplate and bare.backplate.texture, ART .. "spellbook-list-backplate")
Expect("...written in the spellbook's ink, not white", bare.body.ink and bare.body.ink[1], 0.24)
Expect("...its text fading into the parchment", bare.body.fadeSource and bare.body.fadeSource.file,
    ART .. "spellbook-Page-Right-C60")
Expect("the map's panel on the quest details' copy", Z:CreateLorePage(createFrame("Frame", nil, UIParent),
    "log").bg.texture, ART .. "QuestDetailsBackgrounds")
ATLASES["spellbook-Page-Right-C60"], ATLASES["QuestDetailsBackgrounds"] = true, true
ATLASES["spellbook-divider"] = true

---------------------------------------------------------------- the tree for tools outside the game
local tree = Z:LoreTree()
local names = {}
for _, continent in ipairs(tree.continents) do
    local zones = {}
    for _, zone in ipairs(continent.zones) do
        local areas = {}
        for _, area in ipairs(zone.areas) do table.insert(areas, area.name .. "=" .. area.key) end
        table.insert(zones, zone.name .. "(" .. table.concat(areas, ",") .. ")")
    end
    table.insert(names, continent.name .. ":" .. table.concat(zones, ";"))
end
Expect("the tree is the list's: Azeroth, its continents, their zones and every area",
    tree.name .. "|" .. table.concat(names, "|"),
    "Azeroth|Eastern Kingdoms:Dun Morogh()|Kalimdor:Durotar(Sen'jin Village=sen'jin village,Valley of Trials=valley of trials)")
Expect("...a map this client has not got left out", #tree.zones, 0)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll zones lore window tests passed")
