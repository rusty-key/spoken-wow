-- OpenMap's dungeon maps open dungeon and boss stories beside the map: Blizzard's dungeon map
-- through OpenMapAPI's callbacks, OpenMap's own dungeon view through its private frame and rows.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)

stub.ResetFrames(); stub.ResetTimers()
dofile(here .. "/../../addons/Spoken_Bosses/Data/Bosses.lua")
dofile(here .. "/../../addons/Spoken_Bosses/Data/Creatures.lua")

local DEADMINES, UBRS, CUSTOM, STRATHOLME = 36, 229, 9001, 329
local shown, cleared
_G.SpokenCompendium = {
    DungeonName = function(map) return ({ [DEADMINES] = "The Deadmines", [CUSTOM] = "Custom Halls" })[map] end,
    NotWritten = function() return "Nothing has been written for this yet." end,
}
_G.SpokenPlaces = {
    L = { BOSS_LORE_TITLE = "Boss Story" },
    Dungeons = { [1413] = {
        { dungeon = DEADMINES, mapID = 1436, key = "deadmines" },
        { dungeon = CUSTOM, mapID = 1436, key = "custom halls" },
    } },
    Subzones = { [1436] = { deadmines = { full = "Deadmines lore" }, ["custom halls"] = { full = "Custom lore" } } },
    IsLocked = function() return false end,
    IsPending = function() return false end,
    PlaceLine = function() return "In Westfall" end,
    ShowMapStory = function(_, map, entry) shown = { map = map, entry = entry }; return true end,
    ClearMapStory = function(_, map) cleared = map end,
}
_G.SpokenDungeons = { dungeons = {
    [DEADMINES] = { enUS = "The Deadmines" },
    [UBRS] = { enUS = "Upper Blackrock Spire", esES = "Cumbre de Roca Negra Superior" },
    [CUSTOM] = { enUS = "Custom Halls" },
} }
_G.IsAddOnLoaded = function(name) return name == "OpenMap" end

-- CallbackHandler-1.0 as OpenMap uses it: a method named by string is called as
-- owner[method](owner, event, ...).
local registry = {}
_G.OpenMapAPI = {}
function OpenMapAPI.RegisterCallback(owner, event, method)
    registry[event] = function(...) owner[method](owner, event, ...) end
end
local function Fire(event, ...) if registry[event] then registry[event](...) end end

_G.WorldMapFrame = CreateFrame("Frame", "WorldMapFrame")
-- Westfall's UI map: never an instance ID, whatever the number.
WorldMapFrame.mapID = 1436
WorldMapFrame.GetMapID = function(self) return self.mapID end
local elsewhere = CreateFrame("Button", nil, WorldMapFrame)

local Bosses = { L = { BOSS_NOT_FOUND = "not found" } }
Bosses.ReportAction = { title = "Report a Problem" }
function Bosses:StoryClip(map, key)
    return { present = { transcript = map .. ":" .. key .. " lore" } }
end
function Bosses:IsBossFound() return true end
function Bosses:GetAudioClip() return nil end
function Bosses:QueuedStory() return nil end
function Bosses:PlayStory() end

assert(loadfile(here .. "/../../addons/Spoken_Bosses/MapLore.lua"))("Spoken_Bosses", Bosses)
assert(loadfile(here .. "/../../addons/Spoken_Bosses/OpenMap.lua"))("Spoken_Bosses", Bosses)
stub.FireEvent("PLAYER_ENTERING_WORLD")
stub.Advance(0.01)

-- Blizzard's own dungeon map.
Fire("OpenMap_DungeonMapShown", { mapID = 1581, instances = { { name = "The Deadmines" } } })
Expect("Blizzard's dungeon map, through OpenMap's callback, shows the dungeon's story",
    shown and shown.entry.text, "Deadmines lore")
Expect("...beside the map the client has open", shown and shown.map, 1436)
Expect("...titled with the dungeon", shown and shown.entry.title, "The Deadmines")
Fire("OpenMap_DungeonMapHidden")
Expect("...and the story goes with the map", cleared, 1436)

-- OpenMap's own dungeon view, built the first time a dungeon is opened.
local view = CreateFrame("Frame", "OpenMapDungeonView", WorldMapFrame)
view:Hide()
view.side = CreateFrame("Frame", nil, view)
view.sideTabs = CreateFrame("Frame", nil, WorldMapFrame)
local bossesTab = CreateFrame("Button", nil, view.sideTabs)
local function Row(text)
    local row = CreateFrame("Button", nil, view.side)
    row.item = { kind = "row", text }
    return row
end
-- The stub's Hide runs no OnHide hooks; the client's does.
local function Close()
    view:Hide()
    for _, fn in ipairs(view.hooks.OnHide or {}) do fn(view) end
end
local vancleef = Row("|cff9988668.|r  Edwin VanCleef")
stub.FireEvent("GLOBAL_MOUSE_UP", "LeftButton")
stub.Advance(0.01)

shown = nil
view.inst = { DEADMINES, "The Deadmines" }
view:Show()
stub.Advance(0.01)
Expect("OpenMap's dungeon view shows the dungeon's story", shown and shown.entry.text, "Deadmines lore")
Expect("its boss rows are hooked", vancleef.hooks.OnClick and #vancleef.hooks.OnClick, 1)
Expect("...and nothing else on the map is", elsewhere.hooks.OnClick, nil)

shown = nil
vancleef:Click()
Expect("a boss row shows the boss's story", shown and shown.entry.text, "36:edwin vancleef lore")
Expect("...with its name", shown and shown.entry.title, "Edwin VanCleef")
Expect("...the boss panel's title", shown and shown.entry.panelTitle, "Boss Story")
Expect("...its model", shown and shown.entry.model and shown.entry.model.displayID, 2029)
Expect("...and a Report button, as from Leatrix Maps", shown and shown.entry.reportAction, Bosses.ReportAction)
Expect("...beside the map the client has open", shown and shown.map, 1436)

-- A row a tab click draws from the pool is hooked once the list is filled.
local sneed = Row("|cff9988662.|r  Sneed")
bossesTab:Click()
stub.Advance(0.01)
shown = nil
sneed:Click()
Expect("a row drawn after a tab click opens its boss", shown and shown.entry.title, "Sneed")

-- Another instance opened on the view as it is: Show again, no OnShow in the client.
stub.SetLocale("esES")
view.inst = { UBRS, "Cumbre de Roca Negra Superior" }
view:Show()
local rend = Row("|cff99886611.|r  Jefe de Guerra Desgarro Puño Negro")
bossesTab:Click()
stub.Advance(0.01)
shown = nil
rend:Click()
Expect("the dungeon opened next is the one a boss row is matched in", shown and shown.entry.title,
    "Jefe de Guerra Rend Puño Negro")
stub.SetLocale("enUS")

-- WoW Forever's own dungeons are missing from OpenMap's tables: instance 0, and the name.
shown = nil
Close()
view.inst = { 0, "Custom Halls" }
view:Show()
Expect("a dungeon OpenMap has no ID for is found by its name", shown and shown.entry.text, "Custom lore")
cleared = nil
Close()
Expect("closing the view takes its story away", cleared, 1436)

-- Balnazzar is Stratholme's and Scarlet Enclave's.
local balnazzar = Row("|cff9988666.|r  Balnazzar")
bossesTab:Click()
view.inst = { STRATHOLME, "Stratholme" }
view:Show()
stub.Advance(0.01)
shown = nil
balnazzar:Click()
Expect("a name two dungeons share opens the one shown", shown and shown.entry.text, "329:balnazzar lore")
Close()
shown = nil
Bosses:ShowOpenMapBoss("Balnazzar", 6)
Expect("...and with no dungeon shown, neither", shown, nil)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll OpenMap boss map tests passed")
