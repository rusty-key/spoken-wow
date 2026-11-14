-- A Leatrix Maps dungeon boss pin keeps its source row on the button. Spoken Bosses hooks that
-- optional button and sends a matching creature to Spoken Places' map panel.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)

stub.ResetFrames(); stub.ResetTimers()
dofile(here .. "/../../addons/Spoken/Data/Dungeons.lua")
dofile(here .. "/../../addons/Spoken_Bosses/Data/Bosses.lua")
dofile(here .. "/../../addons/Spoken_Bosses/Data/Creatures.lua")

local shown
local clearedMap
_G.SpokenCompendium = {
    DungeonName = function(map)
        if map == 36 then return "The Deadmines" end
        if map == 90 then return "Gnomeregan" end
        if map == 329 then return "Stratholme" end
        return tostring(map)
    end,
    NotWritten = function() return "Nothing has been written for this yet." end,
}
_G.SpokenPlaces = {
	L = { BOSS_LORE_TITLE = "Boss Story" },
	Dungeons = {
		[1413] = { { dungeon = 36, mapID = 1436, key = "deadmines" } },
		[1426] = { { dungeon = 90, mapID = 1426, key = "gnomeregan" } },
	},
	Subzones = {
		[1426] = { gnomeregan = { full = "Gnomeregan lore" } },
		[1436] = { deadmines = { full = "Deadmines lore" } },
	},
	GetLoreWithFallback = function(_, map)
		if map == 1413 then return { full = "Westfall lore" }, map end
		if map == 1426 then return { full = "Dun Morogh lore" }, map end
		return nil, map
	end,
	GetMapName = function(_, map)
		if map == 1413 then return "Westfall" end
		if map == 1426 then return "Dun Morogh" end
		if map == 1436 then return "Westfall" end
		return tostring(map)
	end,
	PlaceLine = function(_, map, key)
		if map == 1426 and key then return "In Dun Morogh" end
		if map == 1436 and key then return "In Westfall" end
		return map == 1413 and "Eastern Kingdoms" or map == 1426 and "Kalimdor" or ""
	end,
    IsLocked = function() return false end,
    IsPending = function() return false end,
	ShowMapStory = function(_, map, entry) shown = { map = map, entry = entry }; return true end,
	ClearMapStory = function(_, map) clearedMap = map; shown = nil; return true end,
}
_G.C_Map = {
	GetMapInfo = function(map)
		if map == 226 then return { parentMapID = 90 } end
		if map == 317 then return { parentMapID = 329 } end
	end,
}
_G.IsAddOnLoaded = function(name) return name == "Leatrix_Maps" end
_G.WorldMapFrame = CreateFrame("Frame", "WorldMapFrame")
WorldMapFrame.mapID = 36
WorldMapFrame.ScrollContainer = CreateFrame("Frame", nil, WorldMapFrame)
local pin = CreateFrame("Button", nil, WorldMapFrame.ScrollContainer)
pin.row = { "boss", 0.5, 0.5, 639, "Edwin VanCleef" }
local overlay = CreateFrame("Frame", nil, WorldMapFrame.ScrollContainer)
overlay:Hide()
overlay:SetScript("OnMouseUp", function() end)
overlay:SetScript("OnMouseWheel", function() end)
local invalidPin = CreateFrame("Frame", nil, WorldMapFrame.ScrollContainer)
invalidPin.row = { "boss", 0.5, 0.5, 639, "Edwin VanCleef" }
local dungeonMenuRow = CreateFrame("Button", nil, WorldMapFrame)
dungeonMenuRow.Text = dungeonMenuRow:CreateFontString()
dungeonMenuRow.Text:SetText("Gnomeregan")

local Bosses = { L = { BOSS_NOT_FOUND = "not found" } }
function Bosses:StoryClip(map, key)
    return { present = { transcript = map .. ":" .. key .. " lore" } }
end
function Bosses:IsBossFound() return true end
function Bosses:GetAudioClip() return nil end
function Bosses:QueuedStory() return nil end
function Bosses:PlayStory() end
Bosses.ReportAction = { has = function() return true end, open = function() end, title = "Report a Problem" }
Bosses.Name = function(entry) return entry[GetLocale()] or entry[1] end
Bosses.Model = function(map, key)
    local entry = SpokenBossCreatures[map] and SpokenBossCreatures[map][key]
    return entry and entry.display and { creatureID = entry.creature, displayID = entry.display }
end
Bosses.Unlocked = function() return false end
assert(loadfile(here .. "/../../addons/Spoken_Bosses/MapLore.lua"))("Spoken_Bosses", Bosses)
local load = assert(loadfile(here .. "/../../addons/Spoken_Bosses/Leatrix.lua"))
load("Spoken_Bosses", Bosses)

stub.FireEvent("PLAYER_ENTERING_WORLD")
stub.Advance(0.01)
Expect("an ordinary Leatrix frame is not hooked as a button", invalidPin.hooks.OnClick, nil)
WorldMapFrame.mapID = 1426
shown = nil
dungeonMenuRow:Click()
stub.Advance(0.01)
Expect("switching the world-map dungeon selection opens its dungeon lore", shown ~= nil, true)
Expect("...with the selected dungeon's story", shown and shown.entry.text, "Gnomeregan lore")
WorldMapFrame.mapID = 36
pin:Click()
Expect("a matching Leatrix boss pin opens the map story", shown ~= nil, true)
Expect("...on its dungeon map", shown and shown.map, 36)
Expect("...with the boss title", shown and shown.entry.title, "Edwin VanCleef")
Expect("...with the boss panel title", shown and shown.entry.panelTitle, "Boss Story")
Expect("...with the boss story", shown and shown.entry.text, "36:edwin vancleef lore")
Expect("...with the boss model creature", shown and shown.entry.model and shown.entry.model.creatureID, 639)
Expect("...with the boss model display", shown and shown.entry.model and shown.entry.model.displayID, 2029)
Expect("...without a boss header portrait", shown and shown.entry.icon, nil)
Expect("...with the boss report action", shown and shown.entry.reportAction, Bosses.ReportAction)

-- Leatrix uses Balnazzar's alternate phase creature 10813, while Spoken stores 10812.
WorldMapFrame.mapID = 317
pin.row = { "boss", 0.5, 0.5, 10813, "Balnazzar" }
shown = nil
pin:Click()
Expect("Balnazzar's alternate Leatrix creature opens its lore", shown ~= nil, true)
Expect("...with Balnazzar's dreadlord model", shown and shown.entry.model and shown.entry.model.displayID, 10691)

-- A dungeon preview keeps the world map on its entrance zone, so the selected dungeon remains
-- available to pins drawn over that zone.
WorldMapFrame.mapID = 1420
shown = nil
pin:Click()
Expect("Balnazzar opens from the parent map without a preview", shown ~= nil, true)
Expect("...with Stratholme's Balnazzar lore without a preview", shown and shown.entry.subtitle, "Stratholme")

shown = nil
pin.row = { "boss", 0.5, 0.5, 999999, "Unknown" }
pin:Click()
Expect("an unmapped pin is ignored", shown, nil)
WorldMapFrame.mapID = 36

-- Leatrix creates its overlay before the dungeon pins and fills the pins when the overlay shows.
local latePin = CreateFrame("Button", nil, overlay)
latePin.row = { "boss", 0.5, 0.5, 639, "Edwin VanCleef" }
overlay:Show()
stub.Advance(0.01)
shown = nil
latePin:Click()
Expect("a boss pin created before the Leatrix overlay shows is hooked", shown ~= nil, true)

local entrance = CreateFrame("Button", nil, overlay)
entrance.row = { "entrance", 0.5, 0.5 }
overlay:Hide()
-- Hiding the overlay ends the menu's Gnomeregan preview, as it does in the client.
for _, hook in ipairs(overlay.hooks.OnHide or {}) do hook(overlay) end
overlay:Show()
stub.Advance(0.01)
shown = nil
entrance:Click()
Expect("the dungeon entrance pin opens the dungeon's lore", shown ~= nil, true)
Expect("...on the dungeon map", shown and shown.map, 36)
Expect("...with the dungeon title", shown and shown.entry.title, "The Deadmines")
Expect("...with the dungeon story", shown and shown.entry.text, "Deadmines lore")

-- Leatrix can recycle a level pin as an entrance after it has already been hooked.
WorldMapFrame.mapID = 36
local reusedPin = CreateFrame("Button", nil, overlay)
reusedPin.row = { "level", 0.5, 0.5 }
overlay:Hide()
overlay:Show()
stub.Advance(0.01)
reusedPin.row = { "entrance", 0.5, 0.5 }
shown = nil
reusedPin:Click()
Expect("a recycled entrance pin opens the dungeon's lore", shown ~= nil, true)

-- Gnomeregan's entrance pin is on one of Leatrix's floor maps, whose parent is the instance map.
WorldMapFrame.mapID = 226
local gnomereganEntrance = CreateFrame("Button", nil, overlay)
gnomereganEntrance.row = { "entrance", 0.5, 0.5 }
overlay:Hide()
overlay:Show()
stub.Advance(0.01)
shown = nil
gnomereganEntrance:Click()
Expect("the Gnomeregan entrance pin opens the dungeon's lore", shown ~= nil, true)
Expect("...on the Gnomeregan floor map", shown and shown.map, 226)
Expect("...with Gnomeregan's dungeon title", shown and shown.entry.title, "Gnomeregan")
Expect("...with Gnomeregan's dungeon story", shown and shown.entry.text, "Gnomeregan lore")

-- During a preview the world map remains Dun Morogh (1426) while Leatrix draws Gnomeregan.
WorldMapFrame.mapID = 1426
dungeonMenuRow:Click()
stub.Advance(0.01)
local previewEntrance = CreateFrame("Button", nil, overlay)
previewEntrance.row = { "entrance", 0.5, 0.5 }
overlay:Hide()
overlay:Show()
stub.Advance(0.01)
shown = nil
previewEntrance:Click()
Expect("a preview entrance pin opens the dungeon lore", shown ~= nil, true)
Expect("...beside the zone map that holds the preview", shown and shown.map, 1426)
Expect("...with the preview dungeon title", shown and shown.entry.title, "Gnomeregan")
Expect("...with the preview dungeon story", shown and shown.entry.text, "Gnomeregan lore")

-- Right-clicking the dungeon overlay hides it without changing WorldMapFrame.mapID. The Places
-- panel must drop the selected dungeon story and redraw the normal zone story.
clearedMap = nil
overlay:Hide()
for _, hook in ipairs(overlay.hooks.OnHide or {}) do hook(overlay) end
Expect("leaving the dungeon map clears the selected lore", clearedMap, 1426)

-- Zone-map icons click through ScrollContainer:OnMouseUp, named by Leatrix's tooltip owner.
local dungeonPOI = CreateFrame("Frame")
dungeonPOI.data = { "Dungeon", 0.5, 0.5, "Gnomeregan" }
_G.LeaMapsPOITooltip = { GetOwner = function() return dungeonPOI end }
WorldMapFrame.mapID = 1426
shown = nil
for _, hook in ipairs(WorldMapFrame.ScrollContainer.hooks.OnMouseDown or {}) do hook(WorldMapFrame.ScrollContainer, "LeftButton") end
for _, hook in ipairs(WorldMapFrame.ScrollContainer.hooks.OnMouseUp or {}) do hook(WorldMapFrame.ScrollContainer, "LeftButton") end
stub.Advance(0.01)
Expect("the zone-map POI click opens lore from the hovered dungeon destination", shown ~= nil, true)
Expect("...with the hovered dungeon's story", shown and shown.entry.text, "Gnomeregan lore")

-- Pressing on an icon and dragging moves the map; no preview opens.
local cursorX = 100
_G.GetCursorPosition = function() return cursorX, 100 end
shown = nil
for _, hook in ipairs(WorldMapFrame.ScrollContainer.hooks.OnMouseDown or {}) do hook(WorldMapFrame.ScrollContainer, "LeftButton") end
cursorX = 200
for _, hook in ipairs(WorldMapFrame.ScrollContainer.hooks.OnMouseUp or {}) do hook(WorldMapFrame.ScrollContainer, "LeftButton") end
stub.Advance(0.01)
Expect("dragging the map from a dungeon icon opens no lore", shown, nil)
_G.GetCursorPosition = nil

-- A hidden tooltip keeps its owner after the cursor has left the icon.
_G.LeaMapsPOITooltip = { GetOwner = function() return dungeonPOI end, IsShown = function() return false end }
shown = nil
for _, hook in ipairs(WorldMapFrame.ScrollContainer.hooks.OnMouseDown or {}) do hook(WorldMapFrame.ScrollContainer, "LeftButton") end
for _, hook in ipairs(WorldMapFrame.ScrollContainer.hooks.OnMouseUp or {}) do hook(WorldMapFrame.ScrollContainer, "LeftButton") end
stub.Advance(0.01)
Expect("a hidden tooltip's old owner opens no lore", shown, nil)
_G.LeaMapsPOITooltip = nil

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll Leatrix boss map tests passed")
