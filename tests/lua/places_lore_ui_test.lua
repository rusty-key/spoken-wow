-- The lore window and the story beside the map, built against the stub client with the art the
-- game has: the portrait frame, the spellbook's parchment and divider, the quest log's frame.
-- Each place is chosen, searched for and read back the way a player would. Run with
-- `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local PLACES = here .. "/../../addons/Spoken_Places/"
local Expect, Failures = H.Expecter(print)

stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
-- Spoken, which the module runs on: its round buttons are the pages' Play and Report.
-- Places is loaded, as the Compendium's page checks for the art it ships.
_G.IsAddOnLoaded = function(name) return name == "Spoken_Places" end
_G.SPELLBOOK_FONT_COLOR = { GetRGB = function() return 0.24, 0.15, 0.07 end }
stub.LoadSpoken(here .. "/../../addons/Spoken/").Addon:Enable()

-- The atlases the client has, as Blizzard's own frames use them (wow-ui-source, forever).
local ATLASES = { ["spellbook-Page-Right-C60"] = true, ["spellbook-divider"] = true, ["LFG-lock"] = true,
    ["QuestDetailsBackgrounds"] = true, ["questlog-frame"] = true, ["questlog-frame-filigree"] = true }
_G.C_Texture = { GetAtlasInfo = function(name) return stub.ListAtlas(name) or ATLASES[name] and { width = 64, height = 11 } or nil end }

-- The game's portrait frame: its title, portrait and close button, as PortraitFrameMixin has them.
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
    [2482] = { name = "Somewhere Else", full = "Another client's place." } }
local getMapInfo = _G.C_Map.GetMapInfo
_G.C_Map.GetMapInfo = function(id)
    if id == 2482 then return nil end
    if id == 947 then return { mapType = 0, name = "Azeroth" } end
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
function Z:GetPlayerMapID() return 1411 end
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
-- Every place listed, as with Unlock Undiscovered Places on, until the checks for the found-only
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
assert(loadfile(PLACES .. "Audio.lua"))("Spoken_Places", audio)
Z.PlaceAbove = audio.PlaceAbove
dofile(here .. "/../../addons/Spoken/UI/Layout.lua")
for _, file in ipairs({ "UI/LorePage", "UI/LoreWindow", "UI/MapPanel" }) do
    assert(loadfile(PLACES .. file .. ".lua"))("Spoken_Places", Z)
end

---------------------------------------------------------------- the lore window
Z:SetupLoreWindow()
-- The places are a tab of Azeroth's Compendium (UI/Compendium.lua); Z.window is the tab.
local compendium = _G.SpokenCompendium.window
local window = Z.window
Expect("built at login, hidden, and not made the tab the window first opens on",
    tostring(window ~= nil) .. "|" .. tostring(compendium:IsShown()) .. "|" .. tostring(_G.SpokenCompendium:Active()), "true|false|nil")
Expect("the places are a tab of Azeroth's Compendium, the game's portrait frame", compendium.template, "PortraitFrameTemplate")
Expect("...titled, with the Compendium's tome in its portrait", compendium.title .. "|" .. tostring(compendium.portrait),
    SpokenEnv.L.OPT_COMPENDIUM_TITLE .. "|Interface\\Icons\\INV_Misc_Book_11")
Expect("...closed by Escape", _G.UISpecialFrames[#_G.UISpecialFrames], "SpokenCompendiumWindow")
local page = window.page
Expect("its story is on the spellbook's parchment", page.parchment, "spellbook-Page-Right-C60")
Expect("...in an inset of its own, as the list is, so their borders part them", window.pageInset.template,
    SpokenEnv.Version.IsRetailVanilla and "BackdropTemplate" or "InsetFrameTemplate")
Expect("...with no credit line on the page", page.credit, nil)
Expect("Report is the player's round button, the ring round the bug", page.report.ring ~= nil and page.report.glyph ~= nil, true)
Expect("...under the spellbook's divider", page.divider.atlas or page.divider.layoutAtlas or true, true)
Expect("built with nothing chosen, it is on where the player stands, never an empty page", page.title.text, "Durotar")

-- Where nothing the player stands in has a story: the continent they are on, not Azeroth, which
-- the list no longer holds.
local withFallback = Z.GetLoreWithFallback
Z.GetLoreWithFallback = function() return nil end
Z:ToggleLoreWindow()
Expect("with no story where the player stands, it lands on the continent they are on", page.title.text, "Kalimdor")
Expect("...the window with no tabs while the places are its only one", _G.SpokenCompendiumWindowTab1:IsShown(), false)
Z.GetLoreWithFallback = withFallback
_G.SpokenCompendium:Hide()
Z:ToggleLoreWindow()
Expect("opening it lands on where the player stands", page.title.text, "Durotar")
Expect("...the story in the spellbook's ink", page.body.ink and page.body.ink[1], 0.24)
Expect("...with Play and Report for it", page.target[1] == 1411 and page.play:IsShown() and page.report:IsShown(), true)
-- Hide Report Buttons is Spoken's; here, a Spoken that answers it, and the redraw its
-- REPORT_SETTINGS_CHANGED runs.
local spoken, reportsHidden = _G.Spoken, true
_G.Spoken = setmetatable({ AreReportButtonsHidden = function() return reportsHidden end }, { __index = spoken })
Z:RefreshLoreWindow()
Expect("Hide Report Buttons, in Spoken's settings, takes Report off the Compendium's page",
    page.report:IsShown(), false)
Expect("...Play taking its corner", page.play.anchor.point .. " " .. tostring(page.play.anchor.relativeTo == page.frame),
    "TOPRIGHT true")
Expect("...at the scroll bar's right edge, where the bar stands whether or not it shows",
    page.play.anchor.x, -page.right)
reportsHidden = false
Z:RefreshLoreWindow()
Expect("...and gives it back when it is off", page.report:IsShown(), true)
_G.Spoken = spoken

-- Play's tooltip as every Play of the Compendium's has it: Spoken's names, and under Stop and Replay
-- Spoken's words for what they do; under Play, what is read. A click redraws it while the pointer is
-- still on the button. Report's ends with the debug log's menu hint.
do
    local env, state = _G.SpokenEnv, { started = false, paused = false }
    local clip = {}
    _G.SpokenEnv = { L = { PLAY = "Spoken Play", STOP = "Spoken Stop", REPLAY = "Spoken Replay",
        STOP_READING_TIP = "Stops the reading.", REPLAY_READING_TIP = "Reads it again." } }
    -- The story's line, in the queue once Play has started it, as Spoken's queue says it.
    local saved = { Z.LoreClip, Z.PlayLore }
    Z.LoreClip = function() return state.started and clip or nil end
    Z.PlayLore = function() state.started = true end
    _G.Spoken = setmetatable({ TogglePause = function() state.paused = not state.paused end,
        GetCurrent = function() return state.started and clip or nil end,
        IsPaused = function() return state.paused end,
        GetNowPlaying = function() return not state.paused and clip or nil end,
        LogMenuHint = function() return "Right-click: the debug log" end }, { __index = spoken })
    -- A button's tooltip, its lines as one, the pointer put on it; or as it stands, with `asIs`.
    local function Tip(button, asIs)
        if not asIs then
            GameTooltip.lines = nil
            if button.scripts.OnEnter then button.scripts.OnEnter(button) end
            for _, hook in ipairs(button.hooks.OnEnter or {}) do hook(button) end
        end
        return table.concat(GameTooltip.lines or {}, "|")
    end
    page:RefreshPlay()
    Expect("Play's tooltip: Spoken's Play, and what it reads", Tip(page.play), "Spoken Play|" .. Z.L.AUDIO_READ_TIP)
    page.play.scripts.OnClick(page.play)
    Expect("...a click, the pointer still on it, redrawing it for Stop, in Spoken's words", Tip(page.play, true),
        "Spoken Stop|Stops the reading.")
    page.play.scripts.OnClick(page.play)
    Expect("...and for Replay", Tip(page.play, true), "Spoken Replay|Reads it again.")
    Expect("Report's tooltip ends with the debug log's menu hint", Tip(page.report),
        Z.L.OPT_REPORT_PROBLEM .. "|" .. Z.L.OPT_REPORT_LINE_TIP .. "|Right-click: the debug log")
    _G.Spoken, _G.SpokenEnv = spoken, env
    Z.LoreClip, Z.PlayLore = saved[1], saved[2]
    page:RefreshPlay()
end
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
-- By each item's own name: a banner draws its name in capitals.
local shown = {}
for _, row in ipairs(rows) do if row.shown ~= false and row.row then table.insert(shown, row.row.label) end end
Expect("the places are a banner for each continent, no Azeroth above them, their zones' lines, the chosen zone open",
    table.concat(shown, "|"), "Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar|Orgrimmar|Sen'jin Village|Valley of Trials")

local function RowFor(label)
    for _, row in ipairs(rows) do if row.shown ~= false and row.row and row.row.label == label then return row end end
end
local function Shown()
    rows = {}; Collect(window)
    local labels = {}
    for _, row in ipairs(rows) do if row.shown ~= false and row.row then table.insert(labels, row.row.label) end end
    return table.concat(labels, "|")
end
Expect("a continent is a banner across the list, its name as it is", RowFor("Kalimdor").row.style == "banner"
    and RowFor("Kalimdor").label.text, "Kalimdor")
Expect("a zone is a line under it, with no picture or bar", RowFor("Durotar").row.style == "group" and RowFor("Durotar").row.nest, 0)
Expect("...the places found in it out of all and the share, beside its name", RowFor("Durotar").count.text,
    "0/3 • 0%")
Expect("...greyed with none found", RowFor("Durotar").row.none, true)
Expect("...its areas rows inside it", RowFor("Valley of Trials").row.leaf and RowFor("Valley of Trials").row.nest, 1)

-- The zone opened on is the chosen one, and its minus closes it: it used to open again at once.
RowFor("Durotar").scripts.OnClick(RowFor("Durotar"))
Expect("a click on the open zone's line closes it, its areas gone", Shown(), "Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar")
Expect("...the line no longer open", RowFor("Durotar").row.open, false)
Expect("...and the zone still the one chosen", page.title.text, "Durotar")
Expect("...its page with the zone's round portrait left of the title, the zone badge on it",
    page.headFace ~= nil and page.headFace.speaker.bullet == "zone" and page.shift > 0, true)
RowFor("Durotar").scripts.OnClick(RowFor("Durotar"))
Expect("...and another opens it again", Shown(), "Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar|Orgrimmar|Sen'jin Village|Valley of Trials")
Expect("...open once more", RowFor("Durotar").row.open, true)
Expect("...the banner's line beside it solid again, not left fading from when the line ended it",
    RowFor("Durotar").bannerRail.gradient.from.a, RowFor("Durotar").bannerRail.gradient.to.a)
RowFor("Valley of Trials").scripts.OnClick(RowFor("Valley of Trials"))
RowFor("Durotar").scripts.OnClick(RowFor("Durotar"))
Expect("an area chosen, a click on its zone's line still closes it", Shown(), "Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar")
RowFor("Durotar").scripts.OnClick(RowFor("Durotar"))
Shown()

-- The city inside Durotar: chosen, it opens under Durotar, which stays open.
RowFor("Orgrimmar").scripts.OnClick(RowFor("Orgrimmar"))
Expect("a city is listed inside the zone around it", Shown(), "Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar|Orgrimmar|Sen'jin Village|Valley of Trials")
Expect("...a line, one level in, as an area is", RowFor("Orgrimmar").row.style == "group" and RowFor("Orgrimmar").row.nest,
    RowFor("Valley of Trials").row.nest)
Expect("...indented under its zone's line, 16 further in",
    RowFor("Orgrimmar").indent - RowFor("Durotar").indent, 16)
Expect("...with the line down the open zone's contents beside it", RowFor("Orgrimmar").rails[1]:IsShown()
    and RowFor("Valley of Trials").rails[1]:IsShown(), true)
Expect("...the line fading out at the last row it runs past, not before", RowFor("Valley of Trials").rails[1].fades
    and not RowFor("Orgrimmar").rails[1].fades, true)
Expect("...and the banner's line at the last row under the banner", RowFor("Valley of Trials").bannerRail.fades
    and not RowFor("Durotar").bannerRail.fades, true)
Expect("...and with no areas of its own, no numbers on it", RowFor("Orgrimmar").count.text, "")
Expect("...a line down the left of what a continent's banner holds, as down an open zone's",
    RowFor("Durotar").bannerRail ~= nil and RowFor("Durotar").bannerRail:IsShown()
    and RowFor("Kalimdor").bannerRail == nil or not RowFor("Kalimdor").bannerRail:IsShown(), true)
Expect("...a found area's tick at the end of its row, where a padlock goes", RowFor("Valley of Trials").status.anchor.point,
    "CENTER")
Expect("...counted with the zone's areas", RowFor("Durotar").count.text:match("/(%d+)"), "3")
Expect("...the continent's banner counting what its zones' cards count, the city once",
    RowFor("Kalimdor").count.text:match("/(%d+)"), "3")
Expect("...its page says the zone it is in", page.title.text .. ": " .. page.sub.text.text, "Orgrimmar: In Durotar")
RowFor("Durotar").scripts.OnClick(RowFor("Durotar"))
Expect("a click on the zone's line closes it with its city", Shown(), "Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar")
RowFor("Durotar").scripts.OnClick(RowFor("Durotar"))
Shown()
Expect("...opened again, its city's line is open as it was left", RowFor("Orgrimmar").row.open, true)
RowFor("Orgrimmar").scripts.OnClick(RowFor("Orgrimmar"))
Expect("a click on the open city's line closes it alone, its zone still open",
    tostring(RowFor("Orgrimmar").row.open) .. "|" .. tostring(RowFor("Durotar").row.open), "false|true")

-- Dun Morogh given an area here, so its line has rows to open.
Z.Subzones[1426] = { coldridge = { name = "Coldridge Valley", full = "Where the dwarves start." } }
RowFor("Dun Morogh").scripts.OnClick(RowFor("Dun Morogh"))
Expect("a click on another zone's line opens it beside the open one, both keeping their areas", Shown(),
    "Eastern Kingdoms|Dun Morogh|Coldridge Valley|Kalimdor|Durotar|Orgrimmar|Sen'jin Village|Valley of Trials")
RowFor("Dun Morogh").scripts.OnClick(RowFor("Dun Morogh"))
Expect("...and closing it leaves the other open", Shown(),
    "Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar|Orgrimmar|Sen'jin Village|Valley of Trials")
Z.Subzones[1426] = nil
Z:RefreshLoreWindow(); Shown()

-- A city with areas of its own: the city one place in its zone, and each of its areas another.
Z.Subzones[1454] = { ["valley of strength"] = { name = "Valley of Strength", full = "The city's heart." } }
Z:RefreshLoreWindow(); Shown()
Expect("a zone's line counts its city and the city's areas", RowFor("Durotar").count.text:match("/(%d+)"), "4")
Expect("...the city's line its own areas", RowFor("Orgrimmar").count.text:match("/(%d+)"), "1")
Expect("...the continent's banner what its zones' lines count", RowFor("Kalimdor").count.text:match("/(%d+)"), "4")
Expect("...and the zone's page what its line counts", (Z:PlaceLine(1411)), "In Kalimdor · 0 of 4 discovered")
Z.Subzones[1454] = nil
Z:RefreshLoreWindow(); Shown()

RowFor("Valley of Trials").scripts.OnClick(RowFor("Valley of Trials"))
Expect("choosing an area shows its story", page.title.text .. ": " .. page.body.text.text, "Valley of Trials: Where the orcs learn.")
Expect("...its page with the zone badge by the title, as a zone's", page.headFace.speaker.bullet == "zone" and page.shift > 0, true)
Expect("...says which zone it is in, in plain words", page.sub.text.text .. "|" .. tostring(page.sub.onClick), "In Durotar|nil")
Expect("a zone says which continent it is on, and its places discovered out of all, its city one of them, as its line counts",
    Z:PlaceLine(1411) .. "|" .. RowFor("Durotar").count.text:match("/(%d+)"), "In Kalimdor · 0 of 3 discovered|3")
Expect("a continent says it is in Azeroth, and what its banner counts", Z:PlaceLine(1414), "In Azeroth · 0 of 3 discovered")
Expect("...not counting a map this client has not got", RowFor("Somewhere Else"), nil)
Expect("an area only Forever has is not listed on another client", RowFor("Camp Forever"), nil)

-- Azeroth with a story: a banner of its own above the continents, which opens its page.
Z.Zones[947] = { name = "Azeroth", full = "The world." }
Z:RefreshLoreWindow()
Expect("Azeroth with a story is a banner above the continents, not a zone of Other Lands", Shown(),
    "Azeroth|Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar|Orgrimmar|Sen'jin Village|Valley of Trials")
Expect("...with nothing under it to open or count", RowFor("Azeroth").row.style .. "|" .. RowFor("Azeroth").count.text
    .. "|" .. tostring(RowFor("Azeroth").toggle:IsShown()), "banner||false")
Expect("...never locked", Z:IsLocked(947), false)
RowFor("Azeroth").scripts.OnClick(RowFor("Azeroth"))
Expect("a click on it shows its story", page.title.text .. ": " .. page.body.text.text, "Azeroth: The world.")
Expect("...its line saying what it holds", page.sub.text.text, "2 continents, 3 zones")
Expect("...read and reported as the world's", page.target[1] .. "|" .. tostring(page.target[2]), "947|nil")
Expect("...its row lit as chosen", RowFor("Azeroth").selected, true)
Expect("...and the continents still open below it", Shown(),
    "Azeroth|Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar|Orgrimmar|Sen'jin Village|Valley of Trials")
Z.Zones[947] = nil

RowFor("Sen'jin Village").scripts.OnClick(RowFor("Sen'jin Village"))
Expect("a place with no story says so, as every tab does", page.body.text.text, _G.SpokenCompendium.NotWritten())
Expect("...offers to Contribute one", page.contribute:IsShown(), true)
Expect("...a greyed Play, nothing to report", page.target == nil and page.play:IsShown() and not page.play:IsEnabled()
    and not page.report:IsShown(), true)
_G.SpokenCompendium.tabs.places.onShow(window); window.Refresh()
Expect("come back to from another tab, a place the player chose stays chosen", page.title.text, "Sen'jin Village")
_G.SpokenCompendium:Hide()
Z:ToggleLoreWindow()
Expect("closed and opened again, a place the player chose stays chosen", page.title.text, "Sen'jin Village")
-- The window's fold button: the game's template where the client has it, else the plain one.
local function Fold()
    for _, child in ipairs(compendium.children or {}) do
        if type(child.MinimizeButton) == "table" then return child.MinimizeButton.scripts.OnClick(child.MinimizeButton) end
        if child.normalTexture and tostring(child.normalTexture.texture):find("SmallerButton", 1, true) then
            return child.scripts.OnClick(child)
        end
    end
end
Fold()
Expect("folded, the window is the list without its page", window.pageInset:IsShown(), false)
_G.SpokenCompendium:Hide()
Z:ToggleLoreWindow()
Expect("...and opened again, it unfolds to its page", window.pageInset:IsShown(), true)

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

-- Opened on a place far down the list, from the window closed and never laid out: the client's
-- scroll frame takes an offset only within the range it last measured, and has no height until
-- the window is laid out, a frame after it is shown.
do
    local scroll, measured = listBar.frame, 0
    local setScroll = scroll.SetVerticalScroll
    _G.SpokenCompendium:Hide()
    scroll.height, scroll.verticalScroll = 0, 0
    function scroll:UpdateScrollChildRect() measured = math.max(0, self.scrollChild.height - self.height) end
    function scroll:SetVerticalScroll(v) setScroll(self, math.min(v, measured)) end
    Z:ShowLoreFor(1411, "valley of trials")
    scroll.height = 60
    stub.Advance(0.1)
    Shown()
    local row = RowFor("Valley of Trials")
    local top, offset = -row.anchor.y, scroll:GetVerticalScroll()
    Expect("opened on a place far down the list, a frame later its row is in view",
        offset > 0 and top >= offset and top + row.height <= offset + scroll.height, true)
    scroll.SetVerticalScroll, scroll.UpdateScrollChildRect, scroll.height = setScroll, nil, 120
end

---------------------------------------------------------------- search
local search
for _, child in ipairs(window.children or {}) do if child.template == "SearchBoxTemplate" then search = child end end
Expect("a search box sits over the list", search ~= nil, true)
search:SetText("trials")
search.hooks.OnTextChanged[1](search)
Expect("searching shows the matches, under their zone and continent", Shown(), "Kalimdor|Durotar|Valley of Trials")
-- A card clicked in the results is chosen and closed for this search only: the tree under the
-- search is left as it was.
RowFor("Durotar").scripts.OnClick(RowFor("Durotar"))
Expect("choosing a match shows its story", page.title.text, "Durotar")
Expect("...the card the search opened closing on the click", Shown() .. "|" .. tostring(RowFor("Durotar").row.open),
    "Kalimdor|Durotar|false")
Expect("...the results from the top", listBar.frame:GetVerticalScroll(), 0)
RowFor("Durotar").scripts.OnClick(RowFor("Durotar"))
Expect("...and another click opening it again", Shown(), "Kalimdor|Durotar|Valley of Trials")
RowFor("Durotar").scripts.OnClick(RowFor("Durotar"))
search:SetText("trial")
search.hooks.OnTextChanged[1](search)
Expect("...a new search opening it again", Shown(), "Kalimdor|Durotar|Valley of Trials")
search:SetText("")
search.hooks.OnTextChanged[1](search)
Expect("...and the list comes back as it was before the search", Shown(), "Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar|Orgrimmar|Sen'jin Village|Valley of Trials")
Expect("...on the chosen place, not at the top", listBar.frame:GetVerticalScroll() > 0, true)
search:SetText("nowhere")
search.hooks.OnTextChanged[1](search)
Expect("...and says when nothing matches", window.noMatch.shown, true)

-- A search naming a zone lists all it holds; one naming a banner lists its cards as the player
-- left them, each opening and closing on a click as unsearched.
search:SetText("durotar")
search.hooks.OnTextChanged[1](search)
Expect("a search naming a zone lists its city and every area in it, matching or not", Shown(),
    "Kalimdor|Durotar|Orgrimmar|Sen'jin Village|Valley of Trials")
RowFor("Durotar").scripts.OnClick(RowFor("Durotar"))
Expect("...its card closing on a click", Shown(), "Kalimdor|Durotar")
RowFor("Durotar").scripts.OnClick(RowFor("Durotar"))
Expect("...and opening on another", Shown(), "Kalimdor|Durotar|Orgrimmar|Sen'jin Village|Valley of Trials")
search:SetText("orgrim")
search.hooks.OnTextChanged[1](search)
Expect("...a search naming a city lists it under its zone", Shown(), "Kalimdor|Durotar|Orgrimmar")
search:SetText("eastern")
search.hooks.OnTextChanged[1](search)
Expect("a search naming a continent lists its zones' cards, not an empty banner", Shown(), "Eastern Kingdoms|Dun Morogh")
Expect("...closed as the player left them", RowFor("Dun Morogh").row.open, false)
search:SetText("kalimdor")
search.hooks.OnTextChanged[1](search)
Expect("...an open one open, with all it holds", Shown(), "Kalimdor|Durotar|Orgrimmar|Sen'jin Village|Valley of Trials")
RowFor("Durotar").scripts.OnClick(RowFor("Durotar"))
Expect("...a click closing it as unsearched", Shown(), "Kalimdor|Durotar")
search:SetText("")
search.hooks.OnTextChanged[1](search)
Expect("...which it stays once the search is cleared", Shown(), "Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar")
search:SetText("kalimdor")
search.hooks.OnTextChanged[1](search)
RowFor("Durotar").scripts.OnClick(RowFor("Durotar"))
Expect("...and another click opening it", Shown(), "Kalimdor|Durotar|Orgrimmar|Sen'jin Village|Valley of Trials")
search:SetText("")
search.hooks.OnTextChanged[1](search)
Expect("...open again unsearched", Shown(), "Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar|Orgrimmar|Sen'jin Village|Valley of Trials")

---------------------------------------------------------------- beside the map
Z:SetupMapPanel()
local panel = Z.panel
Expect("the story beside the map wears the quest log's frame", panel ~= nil, true)
-- Inside the map, so the game fades, scales and hides it with the map.
Z:RefreshPanel()
Expect("...and is the map's", panel.parent, WorldMapFrame)
Expect("...as is the button that reopens it", _G.SpokenPlacesPanelToggle.parent, WorldMapFrame)
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
Expect("...nor is the button that reopens it", _G.SpokenPlacesPanelToggle.parent, UIParent)
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
Expect("...and the button that reopens it", _G.SpokenPlacesPanelToggle:GetAlpha(), 0.5)
Expect("...the text's soft edges off while it is faded", strip:IsShown(), false)
WorldMapFrame:SetAlpha(1)
Expect("...and clear again when the player stops", panel:GetAlpha(), 1)
Expect("...the button too", _G.SpokenPlacesPanelToggle:GetAlpha(), 1)
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
Expect("...with the zone portrait and badge in its history header",
    mapPage.headFace and mapPage.headFace.speaker.bullet, "zone")
Z.selected = { mapID = 1411, areaName = "Valley of Trials", entry = Z.Subzones[1411]["valley of trials"] }
Z:RefreshPanel()
Expect("an area clicked on the map says which zone it is in, as Lore of Azeroth does",
    mapPage.title.text .. "|" .. mapPage.sub.text.text, "Valley of Trials|" .. Z.L.IN_ZONE_FMT:format("Durotar"))
mapPage.sub.scripts.OnClick(mapPage.sub)
Expect("...and the line goes back to the zone's story", mapPage.title.text, "Durotar")
Expect("a zone's line is Lore of Azeroth's: its continent, and how many areas", mapPage.sub.text.text,
    (Z:PlaceLine(1411)))

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
Z.Zones[947] = { name = "Azeroth", full = "The world." }
Z.GetDisplayedMapID = function() return 947 end
Z:RefreshPanel()
Expect("the world map shows Azeroth's story, with what it holds under its name",
    mapPage.title.text .. ": " .. mapPage.body.text.text .. "|" .. mapPage.sub.text.text, "Azeroth: The world.|2 continents, 3 zones")
Z.Zones[947] = nil
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
local ART = [[Interface\AddOns\Spoken_Places\Textures\Art\]]
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
-- Durotar and one of its areas found; Dun Morogh, given an area here, and Somewhere Else not. As on
-- the Quests and Readables tabs, every banner and card lists and opens, and only an area's row locks.
local function Locked()
    local labels = {}
    for _, row in ipairs(rows) do
        if row.shown ~= false and row.row and row.row.locked then table.insert(labels, row.row.label) end
    end
    return table.concat(labels, "|")
end
local function Greyed()
    local labels = {}
    for _, row in ipairs(rows) do
        if row.shown ~= false and row.row and row.row.style == "group" and row.row.none then table.insert(labels, row.row.label) end
    end
    return table.concat(labels, "|")
end
Z.Subzones[1426] = { coldridge = { name = "Coldridge Valley", full = "Where the dwarves start." } }
showAll, found = false, { ["1411"] = true, ["1411/valley of trials"] = true }
Z:ShowLoreFor(1411, nil)
Expect("every place is listed, discovered or not", Shown(), "Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar|Orgrimmar|Sen'jin Village|Valley of Trials")
Expect("...only an area not yet discovered locked", Locked(), "Sen'jin Village")
Expect("...a zone or a city not discovered greyed, as a line with none found is on the other tabs", Greyed(), "Dun Morogh|Orgrimmar")
Expect("...a banner none of whose zones is found neither locked nor without its count",
    tostring(RowFor("Eastern Kingdoms").lock.shown ~= false) .. "|" .. RowFor("Eastern Kingdoms").count.text, "false|0/1")
Expect("...a padlock on a locked area", RowFor("Sen'jin Village").lock.shown ~= false, true)
Expect("...none on a place found", RowFor("Valley of Trials").lock.shown, false)
Expect("...a place found marked with the quest log's gold tick, as a completed quest is",
    RowFor("Valley of Trials").status.shown ~= false and RowFor("Sen'jin Village").status.shown == false, true)
RowFor("Sen'jin Village").scripts.OnEnter(RowFor("Sen'jin Village"))
Expect("...not lit under the pointer", RowFor("Sen'jin Village").over, false)
Expect("...a zone's line its areas found out of all, and the share of them", RowFor("Durotar").count.text, "1/3 • 33%")
Expect("...not greyed with some found", RowFor("Durotar").row.none, false)
Expect("...a continent's banner the places its zones' cards count, found out of all", RowFor("Kalimdor").count.text, "1/3")
RowFor("Eastern Kingdoms").scripts.OnClick(RowFor("Eastern Kingdoms"))
Expect("a banner none of whose zones is found closes on a click", Shown(),
    "Eastern Kingdoms|Kalimdor|Durotar|Orgrimmar|Sen'jin Village|Valley of Trials")
Expect("...its page says it is not discovered", page.title.text .. ": " .. page.body.text.text,
    "Eastern Kingdoms: " .. Z.L.NOT_DISCOVERED)
found["1415"] = true
Z:RefreshLoreWindow()
Expect("...a continent found only through its zones, not by being on its map", page.body.text.text, Z.L.NOT_DISCOVERED)
found["1415"] = nil
RowFor("Eastern Kingdoms").scripts.OnClick(RowFor("Eastern Kingdoms"))
Expect("...and opens on another", Shown(), "Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar|Orgrimmar|Sen'jin Village|Valley of Trials")
RowFor("Dun Morogh").scripts.OnClick(RowFor("Dun Morogh"))
Expect("a zone not discovered opens, its areas listed, those not found locked", Shown() .. " / " .. Locked(),
    "Eastern Kingdoms|Dun Morogh|Coldridge Valley|Kalimdor|Durotar|Orgrimmar|Sen'jin Village|Valley of Trials / Coldridge Valley|Sen'jin Village")
Expect("...its page says it is not discovered", page.title.text .. ": " .. page.body.text.text,
    "Dun Morogh: " .. Z.L.NOT_DISCOVERED)
Expect("...under where it sits and what is found in it, as any card's page", page.sub.text.text,
    Z.L.IN_ZONE_FMT:format("Eastern Kingdoms") .. " · " .. Z.L.DISCOVERED_FMT:format(0, 1))
RowFor("Sen'jin Village").scripts.OnClick(RowFor("Sen'jin Village"))
Expect("a locked area cannot be chosen", RowFor("Sen'jin Village").row and RowFor("Dun Morogh").selected, true)
RowFor("Dun Morogh").scripts.OnClick(RowFor("Dun Morogh"))
-- A city not discovered is still in its zone, not its continent.
Z:ShowLoreFor(1454, nil)
Expect("a city not discovered is in its zone, not its continent, and says it is not discovered",
    page.title.text .. "|" .. page.sub.text.text .. "|" .. page.body.text.text,
    "Orgrimmar|" .. Z.L.IN_ZONE_FMT:format("Durotar") .. "|" .. Z.L.NOT_DISCOVERED)
-- Opened from the map's panel, a place not discovered says so instead of telling its story.
Z:ShowLoreFor(1411, "sen'jin village")
Expect("a place not discovered, opened from elsewhere, says so and to go there to read its story",
    page.title.text .. ": " .. page.body.text.text,
    "Sen'jin Village: You have not discovered this place yet. Go there to read its story.")
Expect("...with nothing to play", page.target, nil)
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

-- A search lists every match, greyed as browsing lists it: in a zone not found, under a banner none
-- of whose zones is found. A zone's line is greyed while nothing in it is found, as a line with
-- nothing started or found in it is on the Quests and Readables tabs.
local wasFound = found
found = { ["1411/valley of trials"] = true }
local function Search(text)
    search:SetText(text)
    search.hooks.OnTextChanged[1](search)
    return Shown()
end
Expect("a search lists an area found in a zone not found", Search("trials"), "Kalimdor|Durotar|Valley of Trials")
Expect("...the zone's line not greyed, an area in it found", Greyed(), "")
Expect("...and an area not found, locked", Search("coldridge") .. " / " .. Locked(),
    "Eastern Kingdoms|Dun Morogh|Coldridge Valley / Coldridge Valley")
Expect("...a banner none of whose zones is found listing its cards as the player left them", Search("eastern"),
    "Eastern Kingdoms|Dun Morogh")
found = { ["1411"] = true, ["1411/valley of trials"] = true }
Expect("...a city not found in an open zone, greyed", Search("orgrimmar") .. " / " .. Greyed(), "Kalimdor|Durotar|Orgrimmar / Orgrimmar")
Search("")
found = wasFound
Z.Subzones[1426] = nil
Z:RefreshLoreWindow(); Shown()

showAll = true
Z:RefreshLoreWindow()
Expect("Unlock Undiscovered Places opens every area", Locked(), "")
Expect("...the places not found still greyed", Greyed(), "Dun Morogh|Orgrimmar")
Expect("...the counts still what this character has found", RowFor("Durotar").count.text, "1/3 • 33%")
RowFor("Sen'jin Village").scripts.OnClick(RowFor("Sen'jin Village"))
Expect("...and when a place not found is chosen", RowFor("Durotar").count.text, "1/3 • 33%")
Expect("...its story told", page.body.text.text, _G.SpokenCompendium.NotWritten())
RowFor("Dun Morogh").scripts.OnClick(RowFor("Dun Morogh"))
Expect("...a zone not found tells its story", page.body.text.text, _G.SpokenCompendium.NotWritten())
Expect("...or a zone on a continent with none found, whose zones have no areas to count", RowFor("Eastern Kingdoms").count.text, "")
RowFor("Dun Morogh").scripts.OnClick(RowFor("Dun Morogh"))
Z:ShowLoreFor(1411, nil)
showAll = false

-- Discovered Only, in the filter menu beside the search box, leaves the places not found out of it.
local function Only() return stub.OpenDropdown(window.filterMenu)[1] end
Expect("the filter menu holds Discovered Only, a checkbox", Only().text == Z.L.LORE_DISCOVERED_ONLY and Only().isNotRadio, true)
Expect("...which starts off", Only().checked and true or false, false)
Expect("...and nothing is left under the list", window.discoveredOnly, nil)
-- A viewport shorter than the three lines left, so the list has somewhere to scroll.
listBar.frame:SetHeight(60)
Only().func()
Expect("...on, it leaves out what is not found: a continent, a zone, a city, an area", Shown(), "Kalimdor|Durotar|Valley of Trials")
Expect("...the list on the chosen place, still listed, not at the top", page.title.text .. "|"
    .. tostring(listBar.frame:GetVerticalScroll() > 0), "Durotar|true")
listBar.frame:SetHeight(120)
Expect("...and is remembered", Z:Get("loreDiscoveredOnly"), true)
Expect("...and ticked in the menu", Only().checked, true)
Only().func()
Expect("...off, they are listed again", Shown(), "Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar|Orgrimmar|Sen'jin Village|Valley of Trials")
Expect("...greyed out", Greyed() .. " / " .. Locked(), "Dun Morogh|Orgrimmar / Sen'jin Village")
RowFor("Orgrimmar").scripts.OnClick(RowFor("Orgrimmar"))
Only().func()
Expect("...on with a place chosen it leaves out, what holds it is chosen, as on Quests",
    page.title.text .. "|" .. tostring(RowFor("Durotar").selected), "Durotar|true")
Only().func()
RowFor("Orgrimmar").scripts.OnClick(RowFor("Orgrimmar"))
Z:ShowLoreFor(1411, nil)

-- Voiced Only, after it in the same menu: what no installed voice pack reads is left out, and a
-- zone stays while an area in it has a recording.
local hasAudio = Z.HasAudio
Z.HasAudio = function(_, mapID, key) return mapID == 1411 and key == "valley of trials" end
local function Voiced() return stub.OpenDropdown(window.filterMenu)[2] end
Expect("the filter menu holds Voiced Only after Discovered Only", Voiced().text == Z.L.LORE_VOICED_ONLY and Voiced().isNotRadio, true)
Voiced().func()
Expect("...on, only what has a recording is listed, with the zone that holds it", Shown(), "Kalimdor|Durotar|Valley of Trials")
Expect("...counting only what it lists", RowFor("Durotar").count.text, "1/1")
Expect("...its continent's banner the same", RowFor("Kalimdor").count.text, "1/1")
Expect("...all of it found: the gold tick after its numbers, no share", RowFor("Durotar").status:IsShown()
    and RowFor("Durotar").count.text == "1/1" and RowFor("Durotar").row.tick, true)
Expect("...14 by 14, as an Era line's tick is", RowFor("Durotar").status.width .. "x" .. RowFor("Durotar").status.height, "14x14")
Expect("...and is remembered", Z:Get("loreVoicedOnly"), true)
Voiced().func()
Expect("...off, everything again", Shown(), "Eastern Kingdoms|Dun Morogh|Kalimdor|Durotar|Orgrimmar|Sen'jin Village|Valley of Trials")
Z.HasAudio = hasAudio

---------------------------------------------------------------- a new session
-- A fresh Compendium with a first tab before the places, and Places' tab set up again in it.
local partOn = true
local function NewSession()
    _G.SpokenCompendium:Hide()
    _G.SpokenCompendium = nil
    local session = setmetatable({}, { __index = Z })
    function session:IsPartOn() return partOn end
    dofile(here .. "/../../addons/Spoken/UI/Compendium.lua")
    assert(loadfile(PLACES .. "UI/LoreWindow.lua"))("Spoken_Places", session)
    _G.SpokenCompendium:Register("first", { label = "First", order = 0, build = function() end })
    session:SetupLoreWindow()
    return session
end
NewSession()
_G.SpokenCompendium:Toggle()
Expect("the Compendium first opened from the minimap or Spoken's page opens on its first tab, not the places",
    _G.SpokenCompendium:Active(), "first")
partOn = false
local late = NewSession()
Expect("with Places off at login, the places' tab is not built", rawget(late, "window"), nil)
partOn = true
late:ToggleLoreWindow()
Expect("...switched on later, opening it builds the tab and opens it on where the player stands",
    tostring(_G.SpokenCompendium:IsOpen("places")) .. "|" .. late.window.page.title.text, "true|Durotar")
partOn = false
late = NewSession()
partOn = true
late:ShowLoreFor(1411, "valley of trials")
Expect("...and the map's panel opens it on a place", tostring(_G.SpokenCompendium:IsOpen("places")) .. "|"
    .. late.window.page.title.text, "true|Valley of Trials")
partOn = false
late = NewSession()
late:ToggleLoreWindow()
Expect("...while Places stays off, nothing opens", _G.SpokenCompendium:IsOpen(), false)

-- Text Size, on Spoken's page: Spoken says when it changes, and the story is drawn again at it.
partOn = true
local said = {}
_G.Spoken = setmetatable({ RegisterCallback = function(_, event, fn) said[event] = fn end }, { __index = spoken })
local sized = NewSession()
_G.Spoken = spoken
sized:ToggleLoreWindow()
local body = sized.window.page.body.text
local setFont, drawnAt = body.SetFont, nil
body.SetFont = function(self, face, size, ...) drawnAt = size; if setFont then return setFont(self, face, size, ...) end end
spoken:SetCompendiumFontSize(16)
Expect("Places listens for Spoken's COMPENDIUM_FONT_CHANGED", said.COMPENDIUM_FONT_CHANGED ~= nil, true)
said.COMPENDIUM_FONT_CHANGED()
-- The parchment's ink is drawn a point larger than the Text Size.
Expect("...and draws the story again at the new Text Size", drawnAt, 16 + 1)
body.SetFont = setFont
spoken:SetCompendiumFontSize(12)
-- The words run to the page's edge while they fit, and leave the scroll bar room, with a gap,
-- only while they run past the view; the header's buttons stay at the scroll bar's edge.
do
    local body = page.body
    local stringHeight = body.text.GetStringHeight
    body.frame:SetWidth(300)
    body.frame:SetHeight(1000)
    body.text.GetStringHeight = function() return 20 end
    body:SetText("Short.")
    Expect("words that fit leave no room for a scroll bar", body:BarRoom(), 0)
    local fitX = page.report.anchor.x
    body.frame:SetHeight(100)
    body.text.GetStringHeight = function() return 400 end
    body:SetText("Long.")
    Expect("...words that run past the view leave the bar its room and a gap", body:BarRoom() > body.barWidth, true)
    Expect("...the words that much narrower", body.text.width, 300 - body:BarRoom())
    Expect("...and the header's buttons where they were, at the bar's edge", page.report.anchor.x, fitX)
    body.text.GetStringHeight = stringHeight
end

-- Forever titles many areas "The ...": the lists file them under the word after it.
Expect("a leading The is left out of the name the lists sort by", Z.SortName("The Barrens"), "Barrens")
Expect("...only a leading one, as its own word", Z.SortName("Theramore Isle") .. "|" .. Z.SortName("Shrine of the Fallen"),
    "Theramore Isle|Shrine of the Fallen")
do
    local names = { "The Crossroads", "Durotar", "Ashenvale", "The Barrens", "Desolace" }
    table.sort(names, function(a, b) return Z.SortName(a) < Z.SortName(b) end)
    Expect("...so The Barrens sorts between Ashenvale and The Crossroads", table.concat(names, "|"),
        "Ashenvale|The Barrens|The Crossroads|Desolace|Durotar")
end

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll places lore window tests passed")
