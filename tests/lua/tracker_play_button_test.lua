-- The tracker's Play button sits under a quest's item without moving it, or at the block's top right.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()

stub.SetModernQuestLog({ { questID = 748, title = "Poison Water", level = 8 } })
_G.QuestObjectiveTracker = {
    AddBlock = function() end,
    blockTemplate = "QuestObjectiveTrackerBlockTemplate",
    usedBlocks = {},
}

local VO = stub.LoadQuestsOverlay(here .. "/../../addons/Spoken_Quests/", here .. "/../../addons/Spoken/")
local Expect, Failures = H.Expecter(print)
local CreateFrame = _G.CreateFrame

local function PlayOf(block)
    local made = {}
    _G.CreateFrame = function(...)
        local frame = CreateFrame(...)
        made[#made + 1] = frame
        return frame
    end
    QuestObjectiveTracker:AddBlock(block)
    _G.CreateFrame = CreateFrame
    for _, frame in ipairs(made) do
        if frame.GetParent and frame:GetParent() == block then return frame end
    end
end

VO.Addon:OnInitialize()
VO.DataModules:Register("TestPack", {
    SoundLengthLookupByFileName = { ["748-accept"] = 1 },
    GetSoundPath = function(_, fileName) return fileName .. ".ogg" end,
})
stub.Advance(2)

local function Block()
    local block = CreateFrame("Frame")
    block.id = 748
    return block
end

-- The tracker's secure code reads what these write when it sets up the item button, so calling one
-- from addon code taints it and can block a click on the item.
local WRITERS = { "AdjustRightEdgeOffset", "SetRightEdgeOffset", "SetRightEdgeFrame", "SetPoint",
    "ClearAllPoints", "SetWidth", "SetHeight", "SetSize", "SetParent" }
local function Watch(...)
    local watched = { calls = {}, frames = { ... }, fields = {} }
    for _, frame in ipairs(watched.frames) do
        for _, name in ipairs(WRITERS) do
            frame[name] = function() watched.calls[#watched.calls + 1] = name end
        end
        local fields = {}
        for key, value in pairs(frame) do fields[key] = value end
        watched.fields[frame] = fields
    end
    return watched
end
local function Changed(watched)
    local changes = {}
    for _, name in ipairs(watched.calls) do changes[#changes + 1] = "called " .. name end
    for _, frame in ipairs(watched.frames) do
        local before = watched.fields[frame]
        for key, value in pairs(frame) do
            if before[key] ~= value then changes[#changes + 1] = "wrote " .. tostring(key) end
        end
    end
    return table.concat(changes, ", ")
end

-- The client lays a find-group button against the block's edge and the item to the left of it.
local block = Block()
local group = CreateFrame("Button")
group:SetPoint("TOPRIGHT", block, "TOPRIGHT", 5, 2)
group:Show()
local item = CreateFrame("Button")
item:SetPoint("RIGHT", group, "LEFT", -2, 0)
item:Show()
block.rightEdgeFrame = item
block.rightEdgeOffset = 30
local watched = Watch(block, group, item)
local anchor = PlayOf(block).anchor
Expect("Play is anchored under the item when there is a find-group button too", anchor.relativeTo, item)
Expect("...at its bottom right", anchor.point .. " " .. anchor.relativePoint, "TOPRIGHT BOTTOMRIGHT")
Expect("...a little below it", anchor.y, -2)
Expect("the block and the client's buttons are not written to or moved", Changed(watched), "")

local bare = Block()
local bareWatched = Watch(bare)
Expect("with no item Play takes the block's top right", PlayOf(bare).anchor.relativeTo, bare)
Expect("...and the block is left alone", Changed(bareWatched), "")

local lateBlock = Block()
local latePlay = PlayOf(lateBlock)
Expect("before its item exists Play is in the corner", latePlay.anchor.relativeTo, lateBlock)
local lateItem = CreateFrame("Button")
lateItem:SetPoint("TOPRIGHT", lateBlock, "TOPRIGHT", 0, 0)
lateItem:Show()
lateBlock.rightEdgeFrame = lateItem
local lateWatched = Watch(lateBlock, lateItem)
QuestObjectiveTracker.usedBlocks = { [QuestObjectiveTracker.blockTemplate] = { lateBlock } }
VO.QuestOverlayUI.UpdateTrackerButtons()
Expect("a sweep puts Play under the item that came later", latePlay.anchor.relativeTo, lateItem)
Expect("...without touching the block or the item", Changed(lateWatched), "")

lateItem:Hide()
VO.QuestOverlayUI.UpdateTrackerButtons()
Expect("a hidden item leaves Play in the corner", latePlay.anchor.relativeTo, lateBlock)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll tracker Play button tests passed")
