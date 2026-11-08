-- OpenMap keeps its dungeon boss rows private, but each row retains the item used to render it.
-- Spoken Bosses hooks those rows and opens the matching story in Spoken Places.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)

stub.ResetFrames(); stub.ResetTimers()
dofile(here .. "/../../addons/Spoken_Bosses/Data/Bosses.lua")
dofile(here .. "/../../addons/Spoken_Bosses/Data/Creatures.lua")

local shown
_G.SpokenCompendium = {
    DungeonName = function(map) return map == 36 and "The Deadmines" or tostring(map) end,
    NotWritten = function() return "Nothing has been written for this yet." end,
}
_G.SpokenPlaces = {
    L = { BOSS_LORE_TITLE = "Boss Story" },
    Dungeons = { [1413] = { { dungeon = 36, mapID = 1436, key = "deadmines" } } },
    Subzones = { [1436] = { deadmines = { full = "Deadmines lore" } } },
    IsLocked = function() return false end,
    IsPending = function() return false end,
    PlaceLine = function() return "In Westfall" end,
    ShowMapStory = function(_, map, entry) shown = { map = map, entry = entry }; return true end,
}
_G.SpokenDungeons = { dungeons = { [36] = { enUS = "The Deadmines" } } }
_G.IsAddOnLoaded = function(name) return name == "OpenMap" end
_G.OpenMapAPI = { callbacks = {} }
function OpenMapAPI.RegisterCallback(owner, event, method)
    OpenMapAPI.callbacks[event] = { owner = owner, method = method }
end
_G.WorldMapFrame = CreateFrame("Frame", "WorldMapFrame")
WorldMapFrame.mapID = 36
WorldMapFrame.GetMapID = function(self) return self.mapID end
local side = CreateFrame("Frame", nil, WorldMapFrame)
local row = CreateFrame("Button", nil, side)
row.item = { kind = "row", "|cff9988668.|r  Edwin VanCleef" }

local Bosses = { L = { BOSS_NOT_FOUND = "not found" } }
function Bosses:StoryClip(map, key)
    return { present = { transcript = map .. ":" .. key .. " lore" } }
end
function Bosses:IsBossFound() return true end
function Bosses:GetAudioClip() return nil end
function Bosses:QueuedStory() return nil end
function Bosses:PlayStory() end

local load = assert(loadfile(here .. "/../../addons/Spoken_Bosses/OpenMap.lua"))
load("Spoken_Bosses", Bosses)

stub.FireEvent("PLAYER_ENTERING_WORLD")
stub.Advance(0.01)
Expect("OpenMap setup watches the world map", WorldMapFrame.hooks.OnShow and #WorldMapFrame.hooks.OnShow > 0, true)
Expect("OpenMap setup hooks the boss row", row.hooks.OnClick and #row.hooks.OnClick > 0, true)
Expect("OpenMap shown callback is registered", OpenMapAPI.callbacks.OpenMap_DungeonMapShown.owner, Bosses)
Expect("OpenMap hidden callback is registered", OpenMapAPI.callbacks.OpenMap_DungeonMapHidden.owner, Bosses)
row:Click()
Expect("an OpenMap boss row opens the map story", shown ~= nil, true)
Expect("...on the current dungeon map", shown and shown.map, 36)
Expect("...with the boss title", shown and shown.entry.title, "Edwin VanCleef")
Expect("...with the boss panel title", shown and shown.entry.panelTitle, "Boss Story")
Expect("...with the boss story", shown and shown.entry.text, "36:edwin vancleef lore")
Expect("...with the boss model creature", shown and shown.entry.model and shown.entry.model.creatureID, 639)
Expect("...with the boss model display", shown and shown.entry.model and shown.entry.model.displayID, 2029)
Expect("...without a Places report action", shown and shown.entry.reportAction, false)

shown = nil
Bosses:OpenMapDungeonMapShown({ mapID = 36, instances = { { name = "The Deadmines" } } })
Expect("opening an OpenMap dungeon shows its lore", shown ~= nil, true)
Expect("...on the dungeon map", shown and shown.map, 36)
Expect("...with the dungeon title", shown and shown.entry.title, "The Deadmines")
Expect("...with the dungeon story", shown and shown.entry.text, "Deadmines lore")

stub.SetLocale("esES")
_G.SpokenDungeons.dungeons[229] = { enUS = "Upper Blackrock Spire", esES = "Cumbre de Roca Negra Superior" }
Bosses:OpenMapDungeonMapShown({ mapID = 229, instances = { { name = "Cumbre de Roca Negra Superior" } } })
shown = nil
Bosses:ShowOpenMapBoss(229, "Jefe de Guerra Desgarro Puño Negro", 11)
Expect("a translated OpenMap boss name can use its dungeon position", shown ~= nil, true)
Expect("...with the localized Rend title", shown and shown.entry.title, "Jefe de Guerra Rend Puño Negro")
stub.SetLocale("enUS")

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll OpenMap boss map tests passed")
