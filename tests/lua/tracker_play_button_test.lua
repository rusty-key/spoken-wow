-- The Play button on the objective tracker's quests sits under the quest's item button, which stays
-- where the client puts it, and takes the block's top right where there is no item.
-- Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local print = stub.print
stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()

stub.SetModernQuestLog({ { questID = 748, title = "Poison Water", level = 8 } })
_G.QuestObjectiveTracker = {
    AddBlock = function() end,
    blockTemplate = "QuestObjectiveTrackerBlockTemplate",
    usedBlocks = {},
}

local VO = stub.LoadQuestsOverlay(here .. "/../../addons/Spoken_Quests/", here .. "/../../addons/Spoken/")
local failures = 0
local CreateFrame = _G.CreateFrame

-- The button the addon makes for a block: the frame created while it was added and parented to it.
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

local function Expect(what, actual, expected)
    if actual == expected then
        print(string.format("ok   %s\n     %s", what, tostring(actual)))
    else
        failures = failures + 1
        print(string.format("FAIL %s\n     expected: %s\n     actual:   %s", what, tostring(expected),
            tostring(actual)))
    end
end

VO.Addon:OnInitialize()
VO.DataModules:Register("TestPack", {
    SoundLengthLookupByFileName = { ["748-accept"] = 1 },
    GetSoundPath = function(_, fileName) return fileName .. ".ogg" end,
})
stub.Advance(2)

-- The block as the client lays it out for a quest with a find-group button and an item: the first
-- anchored to the block's top right, the next to the left of it.
local function Block()
    local block = CreateFrame("Frame")
    block.id = 748
    local group = CreateFrame("Button")
    group:SetPoint("TOPRIGHT", block, "TOPRIGHT", 5, 2)
    group:Show()
    local item = CreateFrame("Button")
    item:SetPoint("RIGHT", group, "LEFT", -2, 0)
    item:Show()
    block.rightEdgeFrame = item
    return block, group, item
end

-- What the client owns on a block: its fields, its anchors, and the methods that write them. The
-- tracker's secure code reads these when it sets up the item button, so one written from addon code
-- taints it and a click on the item can be blocked.
local WRITERS = { "AdjustRightEdgeOffset", "SetRightEdgeOffset", "SetRightEdgeFrame", "SetPoint",
    "ClearAllPoints", "SetWidth", "SetHeight", "SetSize", "SetParent" }
local function IsWriter(key)
    for _, name in ipairs(WRITERS) do if key == name then return true end end
end
local function Watch(...)
    local watched = { calls = {}, frames = { ... }, fields = {}, anchors = {} }
    for _, frame in ipairs(watched.frames) do
        local fields = {}
        for key, value in pairs(frame) do fields[key] = value end
        watched.fields[frame] = fields
        local a = frame.anchor
        watched.anchors[frame] = a and { a.point, a.relativeTo, a.relativePoint, a.x, a.y }
        for _, name in ipairs(WRITERS) do
            frame[name] = function() watched.calls[#watched.calls + 1] = name end
        end
    end
    return watched
end
-- What changed on the watched frames since Watch: a method called, a field written, an anchor moved.
local function Changed(watched)
    local changes = {}
    for _, name in ipairs(watched.calls) do changes[#changes + 1] = "called " .. name end
    for _, frame in ipairs(watched.frames) do
        local before = watched.fields[frame]
        for key, value in pairs(frame) do
            if not IsWriter(key) and before[key] ~= value then changes[#changes + 1] = "wrote " .. tostring(key) end
        end
        local a, b = frame.anchor, watched.anchors[frame]
        if (a == nil) ~= (b == nil) or (a and (a.point ~= b[1] or a.relativeTo ~= b[2]
            or a.relativePoint ~= b[3] or a.x ~= b[4] or a.y ~= b[5])) then
            changes[#changes + 1] = "moved anchor"
        end
    end
    return table.concat(changes, ", ")
end

local block, group, item = Block()
block.rightEdgeOffset = 30
local watched = Watch(block, group, item)
local play = PlayOf(block)
local anchor = play and play.anchor
Expect("Play is anchored under the button against the block's edge", anchor and anchor.relativeTo, group)
Expect("...at its bottom right", anchor and anchor.point .. " " .. anchor.relativePoint, "TOPRIGHT BOTTOMRIGHT")
Expect("...a little below it", anchor and anchor.y, -2)
Expect("the block and the client's buttons are not written to or moved", Changed(watched), "")
Expect("...the first still sits 5 right and 2 up of the block's corner", group.anchor.x .. " " .. group.anchor.y, "5 2")
Expect("...the next one is still chained to the first", item.anchor.relativeTo, group)
Expect("...and the block's right edge offset is the client's", block.rightEdgeOffset, 30)

-- A quest with only an item: it is the one anchored to the block.
local soloBlock = CreateFrame("Frame")
soloBlock.id = 748
local solo = CreateFrame("Button")
solo:SetPoint("TOPRIGHT", soloBlock, "TOPRIGHT", 0, 0)
solo:Show()
soloBlock.rightEdgeFrame = solo
local soloWatched = Watch(soloBlock, solo)
local soloPlay = PlayOf(soloBlock)
Expect("Play sits under an item that is alone", soloPlay and soloPlay.anchor.relativeTo, solo)
Expect("...and the block and the item are left alone", Changed(soloWatched), "")

-- A quest with no buttons of its own: Play takes the corner.
local bare = CreateFrame("Frame")
bare.id = 748
local bareWatched = Watch(bare)
local barePlay = PlayOf(bare)
Expect("with no item Play takes the block's top right", barePlay and barePlay.anchor.relativeTo, bare)
Expect("...and the block is left alone", Changed(bareWatched), "")

-- The item arrives after the block was dressed, or the packs load late and the tracker is swept:
-- Play moves under it and nothing of the client's is touched.
local lateBlock = CreateFrame("Frame")
lateBlock.id = 748
local latePlay = PlayOf(lateBlock)
Expect("before its item exists Play is in the corner", latePlay and latePlay.anchor.relativeTo, lateBlock)
local lateItem = CreateFrame("Button")
lateItem:SetPoint("TOPRIGHT", lateBlock, "TOPRIGHT", 0, 0)
lateItem:Show()
lateBlock.rightEdgeFrame = lateItem
local lateWatched = Watch(lateBlock, lateItem)
QuestObjectiveTracker.usedBlocks = { [QuestObjectiveTracker.blockTemplate] = { lateBlock } }
VO.QuestOverlayUI.UpdateTrackerButtons()
Expect("a sweep puts Play under the item that came later", latePlay.anchor.relativeTo, lateItem)
Expect("...without touching the block or the item", Changed(lateWatched), "")

-- An item that is hidden takes no room: Play goes back to the corner.
lateItem:Hide()
VO.QuestOverlayUI.UpdateTrackerButtons()
Expect("a hidden item leaves Play in the corner", latePlay.anchor.relativeTo, lateBlock)

if failures > 0 then print(string.format("\n%d failure(s)", failures)); os.exit(1) end
print("\nAll tracker Play button tests passed")
