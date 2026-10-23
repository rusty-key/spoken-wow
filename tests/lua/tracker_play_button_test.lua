-- The Play button on the objective tracker's quests sits at the block's top right, where the client
-- puts a quest's item button. The item (and any button chained after it) moves left of Play.
-- Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local print = stub.print
stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()

stub.SetModernQuestLog({ { questID = 748, title = "Poison Water", level = 8 } })
-- GetBlock hands back a block as the client does: reset, in the module's used blocks.
local blocks = {}
_G.QuestObjectiveTracker = {
    AddBlock = function() end,
    blockTemplate = "QuestObjectiveTrackerBlockTemplate",
    usedBlocks = { QuestObjectiveTrackerBlockTemplate = blocks },
    GetBlock = function(_, id)
        local block = blocks[id]
        block.rightEdgeOffset = 0
        return block
    end,
}

local VO = stub.LoadQuestsOverlay(here .. "/../../addons/Spoken_Quests/", here .. "/../../addons/Spoken/")
local failures = 0
local CreateFrame = _G.CreateFrame

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

-- What the client lays out for a quest with a find-group button and an item: the first anchored to
-- the block's top right at the offsets the client gives the find-group button, the next to the left
-- of it.
local function Block()
    local block = CreateFrame("Frame")
    block.id = 748
    block.rightEdgeOffset = 0
    function block:AdjustRightEdgeOffset(offset) self.rightEdgeOffset = self.rightEdgeOffset + offset end
    blocks[748] = block
    local group = CreateFrame("Button")
    group:SetPoint("TOPRIGHT", block, "TOPRIGHT", 5, 2)
    local item = CreateFrame("Button")
    item:SetPoint("RIGHT", group, "LEFT", -2, 0)
    block.rightEdgeFrame = item
    return block, group, item
end

local block, group, item = Block()
-- The title and objectives are cut to the buttons' edge when they are added, so the room for Play is
-- taken off before that, when the block is fetched.
QuestObjectiveTracker:GetBlock(748)
Expect("the room for Play is taken off the right edge the title is cut to", block.rightEdgeOffset, -19)
QuestObjectiveTracker:AddBlock(block)
Expect("the first button of the chain is moved left of Play", group.anchor.x, 5 - 19)
Expect("...with the height it had", group.anchor.y, 2)
Expect("...and the next one is left where it was, still chained to it", item.anchor.relativeTo, group)
Expect("...at the spacing it had", item.anchor.x, -2)

QuestObjectiveTracker:AddBlock(block)
Expect("laying the block out again before the client does not move it twice", group.anchor.x, 5 - 19)

-- The client lays the block out afresh on its next pass.
group:SetPoint("TOPRIGHT", block, "TOPRIGHT", 5, 2)
QuestObjectiveTracker:AddBlock(block)
Expect("a fresh layout is moved once", group.anchor.x, 5 - 19)

-- A quest with only an item: it is the one anchored to the block.
local soloBlock = Block()
local solo = CreateFrame("Button")
solo:SetPoint("TOPRIGHT", soloBlock, "TOPRIGHT", 0, 0)
soloBlock.rightEdgeFrame = solo
QuestObjectiveTracker:AddBlock(soloBlock)
Expect("an item alone is moved left of Play", solo.anchor.x, -19)

-- A quest with no buttons of its own has nothing to move.
local bare = CreateFrame("Frame")
bare.id = 748
QuestObjectiveTracker:AddBlock(bare)
Expect("a block with no buttons is left alone", bare.rightEdgeFrame, nil)

-- With the Play button switched off the item goes back.
VO.Addon.db.profile.TrackerPlayButton = false
blocks[748] = block
QuestObjectiveTracker:GetBlock(748)
Expect("...and no room is taken off the title", block.rightEdgeOffset, 0)
QuestObjectiveTracker:AddBlock(block)
Expect("with the Play button off the first button is back where the client put it", group.anchor.x, 5)

if failures > 0 then print(string.format("\n%d failure(s)", failures)); os.exit(1) end
print("\nAll tracker Play button tests passed")
