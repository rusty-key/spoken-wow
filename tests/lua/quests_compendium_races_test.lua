-- Who may take a quest in Azeroth's Compendium, for Forever's Skyborne: their races (ids 95 and 96)
-- are bits 32 and 33 of a quest's race mask, past the eighth race and past bit.band's 32 bits.
-- A High Order Skyborne (Alliance) is shown the quests whose mask has bit 32, and not those of
-- the Windshaper Skyborne or of the Alliance's Classic races alone. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local Expect, Failures = H.Expecter(print)
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local SPOKEN = here .. "/../../addons/Spoken/"

stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
stub.world.questID = 0; stub.ShowPanel(nil)

local MAPS = { [947] = { "Azeroth" }, [1415] = { "Eastern Kingdoms", 947 }, [1429] = { "Elwynn Forest", 1415 } }
_G.C_Map.GetMapInfo = function(id)
    local map = MAPS[id]
    return { mapType = 3, name = map and map[1] or ("Map " .. id), parentMapID = map and map[2] or nil }
end
_G.C_Texture = { GetAtlasInfo = function() return nil end }
_G.UISpecialFrames = _G.UISpecialFrames or {}
local createFrame = _G.CreateFrame
_G.CreateFrame = function(kind, name, parent, template)
    local frame = createFrame(kind, name, parent, template)
    if template == "PortraitFrameTemplate" then
        function frame:SetTitle(text) self.title = text end
        function frame:SetPortraitToAsset(path) self.portrait = path end
    end
    return frame
end

_G.UnitRace = function() return "High Order Skyborne", "HighOrderSkyborne", 95 end
_G.UnitClass = function() return "Mage", "MAGE", 8 end
_G.GetQuestsCompleted = function() return {} end

local VO = stub.LoadQuests(QUESTS, SPOKEN)
VO.Addon:OnInitialize()
local ns = {}
for _, file in ipairs({ "Data/Compendium", "Data/QuestText", "UI/QuestsTab" }) do
    assert(loadfile(QUESTS .. file .. ".lua"))("Spoken_Quests", ns)
end
local HIGH_ORDER, WINDSHAPER, CLASSIC_ALLIANCE = 2 ^ 32, 2 ^ 33, 1 + 4 + 8 + 64
SpokenQuestsCompendium.quests = {
    [90001] = { "High Order Errand", zones = { 1429 }, races = HIGH_ORDER },
    [90002] = { "Windshaper Errand", zones = { 1429 }, races = WINDSHAPER },
    [90003] = { "Alliance Errand", zones = { 1429 }, races = CLASSIC_ALLIANCE + HIGH_ORDER },
    [90004] = { "Classic Alliance Errand", zones = { 1429 }, races = CLASSIC_ALLIANCE },
    [90005] = { "Errand for Anyone", zones = { 1429 } },
}

stub.FireEvent("PLAYER_ENTERING_WORLD")
stub.world.playerMapID = 1429
-- The test is about which races see which quests, so Started Only is off: none is started.
VO.Addon.db.global.Compendium = { FoundOnly = false }
VO.QuestsTab:Open()
local panel = VO.QuestsTab.panel

local function Shown()
    local labels = {}
    local function Collect(frame)
        for _, child in ipairs(frame.children or {}) do
            if child.row and child.shown ~= false then table.insert(labels, child.label.text) end
            Collect(child)
        end
    end
    Collect(panel)
    return "|" .. table.concat(labels, "|") .. "|"
end
local function Has(label) return Shown():find("|" .. label .. "|", 1, true) ~= nil end

Expect("a High Order Skyborne is shown a quest for the High Order alone", Has("High Order Errand"), true)
Expect("...and one for the Alliance with the High Order in it", Has("Alliance Errand"), true)
Expect("...and one for anyone", Has("Errand for Anyone"), true)
Expect("...not one for the Windshapers", Has("Windshaper Errand"), false)
Expect("...nor one for the Alliance's Classic races alone", Has("Classic Alliance Errand"), false)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll quests compendium races tests passed")
