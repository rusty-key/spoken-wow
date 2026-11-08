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
    ShowMapStory = function(_, map, entry) shown = { map = map, entry = entry }; return true end,
}
_G.IsAddOnLoaded = function(name) return name == "OpenMap" end
_G.WorldMapFrame = CreateFrame("Frame", "WorldMapFrame")
WorldMapFrame.mapID = 36
WorldMapFrame.GetMapID = function(self) return self.mapID end
local side = CreateFrame("Frame", nil, WorldMapFrame)
local row = CreateFrame("Button", nil, side)
row.item = { kind = "row", "|cff9988661.|r  Edwin VanCleef" }

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
row:Click()
Expect("an OpenMap boss row opens the map story", shown ~= nil, true)
Expect("...on the current dungeon map", shown and shown.map, 36)
Expect("...with the boss title", shown and shown.entry.title, "Edwin VanCleef")
Expect("...with the boss panel title", shown and shown.entry.panelTitle, "Boss Story")
Expect("...with the boss story", shown and shown.entry.text, "36:edwin vancleef lore")
Expect("...with the boss model creature", shown and shown.entry.model and shown.entry.model.creatureID, 639)
Expect("...with the boss model display", shown and shown.entry.model and shown.entry.model.displayID, 2029)
Expect("...without a Places report action", shown and shown.entry.reportAction, false)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll OpenMap boss map tests passed")
