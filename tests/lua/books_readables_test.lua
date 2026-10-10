-- The readables in Azeroth's Compendium: every book, letter, note and plaque, by the zone it is
-- in and what it is, or by what it is alone, found or not; a readable's page with
-- where it comes from; the search, Found Only and Unlock Unfound Readables; and the tabs once the
-- places are there too. Against the shipped data (Data/Books.lua, Data/Places.lua). Run with
-- `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local Expect, Failures = H.Expecter(print)
local BOOKS = here .. "/../../addons/Spoken_Books/"
local SPOKEN = here .. "/../../addons/Spoken/"

stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()

-- The maps the client names, and where each is.
local MAPS = { [947] = { "Azeroth" }, [1414] = { "Kalimdor", 947 }, [1415] = { "Eastern Kingdoms", 947 },
    [1429] = { "Elwynn Forest", 1415 }, [1453] = { "Stormwind City", 1415 }, [1436] = { "Westfall", 1415 },
    [1455] = { "Ironforge", 1415 }, [1426] = { "Dun Morogh", 1415 } }
_G.C_Map.GetMapInfo = function(id)
    local map = MAPS[id]
    return { mapType = 3, name = map and map[1] or ("Map " .. id), parentMapID = map and map[2] or nil }
end
_G.C_Texture = { GetAtlasInfo = function(name) return (name == "LFG-lock" or name == "Professions_Recipe_Hover") and {} or nil end }
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

local env = stub.LoadSpoken(SPOKEN)
env.Addon:Enable()
_G.SpokenBooksSettings, _G.SpokenBooksCharacter = nil, nil
local B = {}
for _, file in ipairs({ "Locale/enUS", "Checksum", "Core", "Language", "Reader", "Audio", "Playlist",
    "UI/Layout", "UI/TextView", "UI/Compendium", "UI/Readables", "Events", "Commands" }) do
    assert(loadfile(BOOKS .. file .. ".lua"))("Spoken_Books", B)
end
B:InitDB()
B:SetupSource()
dofile(BOOKS .. "Data/Books.lua")
dofile(BOOKS .. "Data/Places.lua")
local L = B.L

-- Kurdran Wildhammer and Alleria Windrunner stand in Stormwind; A Dusty Unsent Letter is carried
-- from Westfall; An Exotic Cookbook is had across Azeroth.
local KURDRAN, ALLERIA, LETTER, COOKBOOK = 287, 288, 16, 410
SpokenBooksCharacter.found[KURDRAN] = true

B:SetupReadables()
B:ShowReadables()
local window = _G.SpokenCompendium.window
local panel = B.readables
Expect("the readables are a tab of Azeroth's Compendium", window.title, L.COMPENDIUM_TITLE)
Expect("...with no tabs while they are its only one", _G.SpokenCompendiumWindowTab1:IsShown(), false)

local rows
local function Collect(frame)
    for _, child in ipairs(frame.children or {}) do
        if child.row then table.insert(rows, child) end
        Collect(child)
    end
end
local function Shown()
    rows = {}
    Collect(panel)
    local labels = {}
    for _, row in ipairs(rows) do if row.shown ~= false and row.row then table.insert(labels, row.label.text) end end
    return table.concat(labels, "|")
end
local function RowFor(label)
    Shown()
    for _, row in ipairs(rows) do if row.shown ~= false and row.row and row.label.text == label then return row end end
end
local function Click(label)
    local row = RowFor(label)
    assert(row, "no row " .. label)
    row.scripts.OnClick(row)
end
local function Has(list, label)
    return ("|" .. list .. "|"):find("|" .. label .. "|", 1, true) ~= nil
end

local list = Shown()
Expect("the tree is the places': Azeroth, its continents, their zones", Has(list, "Azeroth") and Has(list, "Eastern Kingdoms")
    and Has(list, "Elwynn Forest") and Has(list, "Westfall"), true)
Expect("...a city inside the zone around it, not beside it", Has(list, "Stormwind City"), false)
Expect("...the readables after the continents: those found across Azeroth and those of no known origin",
    Has(list, L.GROUP_WIDE) and Has(list, L.GROUP_UNKNOWN), true)
Expect("...each zone counted, found out of all, its city's included", RowFor("Elwynn Forest").count.text:match("^1/") ~= nil, true)

Click("Elwynn Forest")
Click("Stormwind City")
list = Shown()
Expect("the city opens inside its zone, its readables by what they are", Has(list, L.TYPE_PLAQUE) and Has(list, "Kurdran Wildhammer"), true)
Expect("...a readable not found greyed, with the padlock", RowFor("Ranger Captain Alleria Windrunner").row.locked, true)
Expect("...one found open to read", RowFor("Kurdran Wildhammer").row.locked, false)

Click("Kurdran Wildhammer")
local page = panel.page
Expect("a readable's page: its title", page.title.text, "Kurdran Wildhammer")
Expect("...where it is", page.sub.text, L.KIND_WORLD .. " · Stormwind City")
Expect("...and its words", page.body.text.text ~= nil and #page.body.text.text > 40, true)
Click("Ranger Captain Alleria Windrunner")
Expect("a readable not found does not open", page.title.text, "Kurdran Wildhammer")

SpokenBooksSettings.unlockUnfound = true
B:RefreshReadables()
Expect("Unlock Unfound Readables opens it", RowFor("Ranger Captain Alleria Windrunner").row.locked, false)
-- Opening one is not finding it: the counts stay what the character has found.
local before = RowFor("Stormwind City").count.text
Click("Ranger Captain Alleria Windrunner")
Expect("...and choosing it leaves the counts as they were", RowFor("Stormwind City").count.text, before)
SpokenBooksSettings.unlockUnfound = false

SpokenBooksCharacter.found[LETTER] = true
Click("Westfall")
Click("A Dusty Unsent Letter")
Expect("opened on a readable carried from a zone", page.title.text, "A Dusty Unsent Letter")
Expect("...said to be carried, and from where", page.sub.text, L.KIND_CARRIED .. " · Westfall")
Expect("...how it is had first, the name and the zone", (page.body.text.text or ""):find(
    L.FROM_IN_ZONES:format(L.FROM_QUEST_START:format("The Legend of Stalvan"), "Westfall"), 1, true) == 1, true)

-- The search: every match, with what holds it, opened.
local box
for _, child in ipairs(panel.children or {}) do if child.template == "SearchBoxTemplate" then box = child end end
box:SetText("cookbook")
box.hooks.OnTextChanged[1](box)
list = Shown()
Expect("a search shows what matches, under what holds it", Has(list, L.GROUP_WIDE) and Has(list, "An Exotic Cookbook")
    and not Has(list, "Kurdran Wildhammer"), true)
box:SetText("")
box.hooks.OnTextChanged[1](box)

-- Found Only: the readables not found, and what holds none found, left out.
SpokenBooksSettings.compendiumFoundOnly = true
B:RefreshReadables()
list = Shown()
Expect("Found Only leaves out what is not found", Has(list, "Ranger Captain Alleria Windrunner") or Has(list, L.GROUP_UNKNOWN), false)
Expect("...and keeps what is", Has(list, "Westfall") and Has(list, "Elwynn Forest"), true)
SpokenBooksSettings.compendiumFoundOnly = false

-- Opening one in the world finds it, and the tree says so.
SpokenBooksCharacter.found[ALLERIA] = true
Click("Elwynn Forest")
Click("Stormwind City")
Expect("a readable found since opens", RowFor("Ranger Captain Alleria Windrunner").row.locked, false)

-- The type it is listed under closes and opens again, as the zone does.
local typeRow
do
    Shown()
    for _, row in ipairs(rows) do
        if row.shown ~= false and row.row and row.row.kind == "group" and row.row.mapID then typeRow = row.label.text end
        if row.row and row.label.text == "Ranger Captain Alleria Windrunner" then break end
    end
end
Expect("a zone's readables are under their type, open", typeRow ~= nil and RowFor(typeRow).row.open, true)
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
choices[2].func()
list = Shown()
Expect("Voiced Only leaves out what has no recording", Has(list, "Kurdran Wildhammer") or Has(list, "Westfall"), false)
Expect("...and keeps what has one, with the zone that holds it", Has(list, "Ranger Captain Alleria Windrunner")
    and Has(list, "Elwynn Forest"), true)
Expect("...counting only what it lists", RowFor("Elwynn Forest").count.text:match("^%d+/%d+"), "1/1")
Expect("...and is remembered", SpokenBooksSettings.compendiumVoicedOnly, true)
_, choices = Menu()
choices[2].func()
Expect("...off, everything again", Has(Shown(), "Westfall"), true)
B.HasAudio = hasAudio

-- The readables places.mjs leaves out (the Deprecated and TEST items, whose page is "Missing
-- Text") are neither listed nor counted, so every count can reach all.
local placed = 0
for _ in pairs(SpokenBooksPlaces.books) do placed = placed + 1 end
Expect("Azeroth counts only the readables the places know", RowFor("Azeroth").count.text:match("/(%d+)"), tostring(placed))

_, choices = Menu()
choices[5].func()
list = Shown()
Click(L.TYPE_OTHER)
Expect("By Type does not list one the places leave out", RowFor("Test Language Item"), nil)
Click(L.TYPE_OTHER)
Expect("By Type: the tree is the types alone", Has(list, L.TYPE_PLAQUE) and Has(list, L.TYPE_LETTER) and not Has(list, "Elwynn Forest"), true)
_, choices = Menu()
Expect("...and the menu says so", choices[5].checked and not choices[4].checked, true)
Click(L.TYPE_PLAQUE)
Expect("...a type opens on its readables", Has(Shown(), "Kurdran Wildhammer"), true)
Expect("...counted found out of all", RowFor(L.TYPE_PLAQUE).count.text:match("^2/") ~= nil, true)
_, choices = Menu()
choices[4].func()
Expect("...and By Zone again, the zones", Has(Shown(), "Elwynn Forest"), true)

-- The places' tab joins: the tabs show, and each shows its own panel.
_G.SpokenCompendium:Register("places", { label = "Zones", order = 1, title = L.COMPENDIUM_TITLE,
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
    B.source = { Enqueue = function() return true end, StopAll = function() end }
    B.ClipFor = function() return {} end
    B.IsQueued = function() return false end
    SpokenBooksCharacter.read[KURDRAN] = nil
    B:SyncTo(SpokenBooksData.books[KURDRAN].pages[1], true)
    Expect("Play in the Compendium does not count for Read Only Once", B:HasReadBook(KURDRAN), false)
    B:SyncTo(SpokenBooksData.books[KURDRAN].pages[1])
    Expect("...a book read in the world does", B:HasReadBook(KURDRAN), true)
    B.source, B.ClipFor, B.IsQueued = source, clipFor, isQueued
end

-- Listening is not finding: a book heard (Read Only Once's record) stays unfound until it is
-- opened in the world. One heard before Found was kept still is.
SpokenBooksCharacter.found[ALLERIA] = nil
B:MarkBookRead(ALLERIA)
Expect("a book heard is not found by it", B:IsBookFound(ALLERIA), false)
_G.SpokenBooksCharacter = { read = { [LETTER] = true } }
B:InitDB()
Expect("...one heard before Found was kept is found", B:IsBookFound(LETTER), true)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll readables tests passed")
