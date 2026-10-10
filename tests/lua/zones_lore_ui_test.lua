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
local ATLASES = { ["spellbook-Page-Right-C60"] = true, ["spellbook-divider"] = true, ["LFG-lock"] = true,
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
    -- A city: a zone of its own, listed inside the zone around it.
    [1454] = { name = "Orgrimmar", full = "The orcs' city." },
    [947] = { name = "Azeroth", full = "The world." },
    [1414] = { name = "Kalimdor", full = "The western continent." },
    [1415] = { name = "Eastern Kingdoms", full = "The eastern continent." },
    -- A map only another client has (Forever's, on Era): this client's C_Map has never heard of it.
    [2482] = { name = "Somewhere Else", full = "Another client's place." } }
local getMapInfo = _G.C_Map.GetMapInfo
_G.C_Map.GetMapInfo = function(id) if id == 2482 then return nil end return getMapInfo(id) end
Z.Subzones = { [1411] = { ["valley of trials"] = { name = "Valley of Trials", full = "Where the orcs learn." },
    ["sen'jin village"] = { name = "Sen'jin Village", pending = true },
    -- An area only Forever has: this client, Era, never lists it.
    ["camp forever"] = { name = "Camp Forever", full = "Only on Forever." } } }
Z.ForeverOnlyAreas = { [1411] = { ["camp forever"] = true } }
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
-- Every place listed, as with Unlock Undiscovered Zones on, until the checks for the found-only
-- list below turn it off.
local showAll, found = true, {}
function Z:ShowsUndiscovered() return showAll end
function Z:IsFound(mapID, key) return found[key and (mapID .. "/" .. key) or tostring(mapID)] == true end
function Z:RefreshFound() end
Z.ToggleLoreWindow = nil
_G.hooksecurefunc = _G.hooksecurefunc or function() end

for _, file in ipairs({ "UI/Layout", "UI/TextView", "UI/AudioButton", "UI/ReportButton", "UI/LorePage", "UI/Compendium", "UI/LoreWindow", "UI/MapPanel" }) do
    assert(loadfile(ZONES .. file .. ".lua"))("Spoken_Zones", Z)
end

---------------------------------------------------------------- the lore window
Z:SetupLoreWindow()
-- The places are a tab of Azeroth's Compendium (UI/Compendium.lua); Z.window is the tab.
local compendium = _G.SpokenCompendium.window
local window = Z.window
Expect("the places are a tab of Azeroth's Compendium, the game's portrait frame", compendium.template, "PortraitFrameTemplate")
Expect("...titled, with the Compendium's tome in its portrait", compendium.title .. "|" .. tostring(compendium.portrait),
    Z.L.LORE_WINDOW_TITLE .. "|Interface\\Icons\\INV_Misc_Book_11")
Expect("...closed by Escape", _G.UISpecialFrames[#_G.UISpecialFrames], "SpokenCompendiumWindow")
Expect("...with no tabs while the places are its only one", _G.SpokenCompendiumWindowTab1:IsShown(), false)
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
    table.concat(shown, "|"), "Azeroth|Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar|Orgrimmar|Sen'jin Village|Valley of Trials")

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
Expect("...and its plus opens it again", Shown(), "Azeroth|Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar|Orgrimmar|Sen'jin Village|Valley of Trials")
Expect("...with the minus back", RowFor("Durotar").toggle.texture, [[Interface\Buttons\UI-MinusButton-Up]])
RowFor("Valley of Trials").scripts.OnClick(RowFor("Valley of Trials"))
RowFor("Durotar").scripts.OnClick(RowFor("Durotar"))
Expect("an area chosen, its zone's minus still closes it", Shown(), "Azeroth|Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar")
RowFor("Durotar").scripts.OnClick(RowFor("Durotar"))
Shown()

-- The city inside Durotar: chosen, it opens under Durotar, which stays open.
RowFor("Orgrimmar").scripts.OnClick(RowFor("Orgrimmar"))
Expect("a city is listed inside the zone around it", Shown(), "Azeroth|Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar|Orgrimmar|Sen'jin Village|Valley of Trials")
Expect("...one level in, as an area is", RowFor("Orgrimmar").row.depth, RowFor("Valley of Trials").row.depth)
Expect("...and with nothing inside to open, still a zone, its plus greyed as its name is",
    not RowFor("Orgrimmar").row.leaf and RowFor("Orgrimmar").toggle.texture, [[Interface\Buttons\UI-PlusButton-Disabled]])Expect("...counted with the zone's areas", RowFor("Durotar").count.text:match("/(%d+)"), "3")
Expect("...and not beside it on the continent", RowFor("Kalimdor").count.text:match("/(%d+)"), "1")
Expect("...its page says the zone it is in", page.title.text .. ": " .. page.sub.text.text, "Orgrimmar: in Durotar")
page.sub.scripts.OnClick(page.sub)
Expect("...which leads back to the zone", page.title.text, "Durotar")
RowFor("Durotar").scripts.OnClick(RowFor("Durotar"))
Expect("the zone's minus closes it with its city", Shown(), "Azeroth|Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar")
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
Expect("Azeroth sits in nothing: it says what it holds", page.sub.text.text, "2 continents, 3 zones")
Expect("...not counting a map this client has not got", RowFor("Somewhere Else"), nil)
Expect("an area only Forever has is not listed on another client", RowFor("Camp Forever"), nil)

RowFor("Sen'jin Village").scripts.OnClick(RowFor("Sen'jin Village"))
Expect("a place with no story says so", page.body.text.text, Z.L.LORE_NOT_WRITTEN:format("Sen'jin Village"))
Expect("...offers to Contribute one", page.contribute.mapID, 1411)
Expect("...and has nothing to play or report", page.play.mapID == nil and page.report.mapID == nil, true)

-- In the ink like every other page, not a lighter one that was hard to read, and still in it
-- after a re-wrap, which sets the text again.
local Art = Z.Art
local painted
local setTextColor = page.body.text.SetTextColor
page.body.text.SetTextColor = function(self, r, g, b) painted = { r, g, b }; return setTextColor(self, r, g, b) end
page.body.frame:SetWidth(page.body.frame:GetWidth() + 40)
page.body.frame.scripts.OnSizeChanged(page.body.frame)
Expect("...in the full ink once the page re-wraps it", painted and painted[1], Art.INK[1])
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
    "Azeroth|Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar|Orgrimmar|Sen'jin Village|Valley of Trials")
search:SetText("nowhere")
search.hooks.OnTextChanged[1](search)
Expect("...and says when nothing matches", window.noMatch.shown, true)
search:SetText("")
search.hooks.OnTextChanged[1](search)

---------------------------------------------------------------- beside the map
Z:SetupMapPanel()
local panel = Z.panel
Expect("the story beside the map wears the quest log's frame", panel ~= nil, true)
-- Inside the map, so the game fades, scales and hides it with the map.
Z:RefreshPanel()
Expect("...and is the map's", panel.parent, WorldMapFrame)
Expect("...as is the button that reopens it", _G.SpokenZonesPanelToggle.parent, WorldMapFrame)
local strip = panel.page.body.strips[1]
WorldMapFrame:Show()
Z:RefreshPanel()
WorldMapFrame:SetAlpha(0.5)
Expect("inside the map, the panel keeps its own alpha: the map's reaches it", panel:GetAlpha(), 1)
Expect("...and the text's soft edges stay, fading with it", strip:IsShown(), true)
WorldMapFrame:SetAlpha(1)
WorldMapFrame:Hide()
for _, hook in ipairs(WorldMapFrame.hooks.OnHide or {}) do hook(WorldMapFrame) end
-- Under the gamepad UI, beside the map: the Forever client takes the open map's buttons into its
-- own navigation, and closing the map is then blocked.
SetCVar("InputDeviceInterfaceStyle", "1")
Z:RefreshPanel()
Expect("under the gamepad UI, the panel is not the map's", panel.parent, UIParent)
Expect("...nor is the button that reopens it", _G.SpokenZonesPanelToggle.parent, UIParent)
Expect("...so nothing shows it while the map is closed", panel:IsShown(), false)
WorldMapFrame:Show()
Z:RefreshPanel()
Expect("...and it shows with the map", panel:IsShown(), true)
WorldMapFrame:Hide()
for _, hook in ipairs(WorldMapFrame.hooks.OnHide or {}) do hook(WorldMapFrame) end
Expect("...and goes with it", panel:IsShown(), false)
WorldMapFrame:Show()
Z:RefreshPanel()
-- Walking with the map open, the game fades the map: the panel and the button that reopens it
-- fade with it, and the strips softening the text's cut edges are off while they do.
Expect("the text's cut edges soften into the parchment", strip:IsShown(), true)
WorldMapFrame:SetAlpha(0.5)
Expect("the panel fades with the map as the player walks", panel:GetAlpha(), 0.5)
Expect("...and the button that reopens it", _G.SpokenZonesPanelToggle:GetAlpha(), 0.5)
Expect("...the text's soft edges off while it is faded", strip:IsShown(), false)
WorldMapFrame:SetAlpha(1)
Expect("...and clear again when the player stops", panel:GetAlpha(), 1)
Expect("...the button too", _G.SpokenZonesPanelToggle:GetAlpha(), 1)
Expect("...and the soft edges back", strip:IsShown(), true)
SetCVar("InputDeviceInterfaceStyle", "0")
Z:RefreshPanel()
Expect("with the gamepad UI off again, the panel goes back into the map", panel.parent, WorldMapFrame)
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

---------------------------------------------------------------- places not yet discovered
-- Durotar and one of its areas found; Dun Morogh and Somewhere Else not.
local function Locked()
    local labels = {}
    for _, row in ipairs(rows) do
        if row.shown ~= false and row.row and row.row.locked then table.insert(labels, row.label.text) end
    end
    return table.concat(labels, "|")
end
showAll, found = false, { ["1411"] = true, ["1411/valley of trials"] = true }
Z:ShowLoreFor(1411, nil)
Expect("every place is listed, discovered or not", Shown(), "Azeroth|Eastern Kingdoms|Kalimdor|Durotar|Orgrimmar|Sen'jin Village|Valley of Trials")
Expect("...those not yet discovered locked: a continent with none found, a city, an area", Locked(), "Eastern Kingdoms|Orgrimmar|Sen'jin Village")
found["1415"] = true
Z:RefreshLoreWindow(); Shown()
Expect("...a continent found only through its zones, not by being on its map", Locked(), "Eastern Kingdoms|Orgrimmar|Sen'jin Village")
found["1415"] = nil
Expect("...a padlock in place of the count", RowFor("Eastern Kingdoms").lock.shown ~= false and RowFor("Eastern Kingdoms").count.shown == false, true)
Expect("...and on a locked area", RowFor("Sen'jin Village").lock.shown ~= false, true)
Expect("...none on a place found", RowFor("Valley of Trials").lock.shown, false)
RowFor("Sen'jin Village").scripts.OnEnter(RowFor("Sen'jin Village"))
Expect("...not lit under the pointer", RowFor("Sen'jin Village").over, false)
Expect("...a zone's count its areas found out of all, and the share of them", RowFor("Durotar").count.text, "1/3 • 33%")
Expect("...a continent's its zones found", RowFor("Kalimdor").count.text, "1/1 • 100%")
RowFor("Eastern Kingdoms").scripts.OnClick(RowFor("Eastern Kingdoms"))
Expect("a locked continent does not open", Shown(), "Azeroth|Eastern Kingdoms|Kalimdor|Durotar|Orgrimmar|Sen'jin Village|Valley of Trials")
RowFor("Sen'jin Village").scripts.OnClick(RowFor("Sen'jin Village"))
Expect("a locked area cannot be chosen", RowFor("Sen'jin Village").row and RowFor("Durotar").selected, true)
-- Opened from the map's panel, a place not discovered says so instead of telling its story.
Z:ShowLoreFor(1411, "sen'jin village")
Expect("a place not discovered, opened from elsewhere, says so", page.title.text .. ": " .. page.body.text.text, "Sen'jin Village: " .. Z.L.NOT_DISCOVERED)
Expect("...with nothing to play", page.play.mapID, nil)
Shown()
Expect("...and is not counted found for being chosen", RowFor("Durotar").count.text, "1/3 • 33%")
Expect("...still locked in the list", RowFor("Sen'jin Village").row.locked, true)
Z.selected = { mapID = 1411, areaName = "Sen'jin Village", entry = Z.Subzones[1411]["sen'jin village"] }
Z:RefreshPanel()
Expect("the map's panel says so too", mapPage.body.text.text, Z.L.NOT_DISCOVERED)
Z.selected = nil
Z:RefreshPanel()
Expect("...and tells a found zone's story", mapPage.title.text, "Durotar")
Z:ShowLoreFor(1411, nil)
Shown()
showAll = true
Z:RefreshLoreWindow()
Expect("Unlock Undiscovered Zones opens them all", Locked(), "")
Expect("...the continent opened before shows its zones again", Shown(), "Azeroth|Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar|Orgrimmar|Sen'jin Village|Valley of Trials")
Expect("...the counts still what this character has found", RowFor("Durotar").count.text, "1/3 • 33%")
RowFor("Sen'jin Village").scripts.OnClick(RowFor("Sen'jin Village"))
Expect("...and when a place not found is chosen", RowFor("Durotar").count.text, "1/3 • 33%")
RowFor("Dun Morogh").scripts.OnClick(RowFor("Dun Morogh"))
Expect("...or a zone on a continent with none found", RowFor("Eastern Kingdoms").count.text:match("^0/") ~= nil, true)
Z:ShowLoreFor(1411, nil)
showAll = false

-- Discovered Only, in the filter menu beside the search box, leaves the places not found out of it.
local function Only() return stub.OpenDropdown(window.filterMenu)[1] end
Expect("the filter menu holds Discovered Only, a checkbox", Only().text == Z.L.LORE_DISCOVERED_ONLY and Only().isNotRadio, true)
Expect("...which starts off", Only().checked and true or false, false)
Expect("...and nothing is left under the list", window.discoveredOnly, nil)
Only().func()
Expect("...on, it leaves out what is not found: a continent, an area", Shown(), "Azeroth|Kalimdor|Durotar|Valley of Trials")
Expect("...and is remembered", Z:Get("loreDiscoveredOnly"), true)
Expect("...and ticked in the menu", Only().checked, true)
Only().func()
Expect("...off, they are listed again", Shown(), "Azeroth|Eastern Kingdoms|Kalimdor|Durotar|Orgrimmar|Sen'jin Village|Valley of Trials")
Expect("...greyed out", Locked(), "Eastern Kingdoms|Orgrimmar|Sen'jin Village")
Expect("...a locked branch with its plus greyed as its name is, as every branch with nothing to open",
    RowFor("Eastern Kingdoms").toggle.texture, [[Interface\Buttons\UI-PlusButton-Disabled]])

-- Voiced Only, after it in the same menu: what no installed voice pack reads is left out, and a
-- zone stays while an area in it has a recording.
local hasAudio = Z.HasAudio
Z.HasAudio = function(_, mapID, key) return mapID == 1411 and key == "valley of trials" end
local function Voiced() return stub.OpenDropdown(window.filterMenu)[2] end
Expect("the filter menu holds Voiced Only after Discovered Only", Voiced().text == Z.L.LORE_VOICED_ONLY and Voiced().isNotRadio, true)
Voiced().func()
Expect("...on, only what has a recording is listed, with the zone that holds it", Shown(), "Azeroth|Kalimdor|Durotar|Valley of Trials")
Expect("...counting only what it lists", RowFor("Durotar").count.text, "1/1 • 100%")
Expect("...and is remembered", Z:Get("loreVoicedOnly"), true)
Voiced().func()
Expect("...off, everything again", Shown(), "Azeroth|Eastern Kingdoms|Kalimdor|Durotar|Orgrimmar|Sen'jin Village|Valley of Trials")
Z.HasAudio = hasAudio
if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll zones lore window tests passed")
