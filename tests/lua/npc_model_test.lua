-- The model probe, shared by contributions and the body lookups. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

stub.SetClient("11509")
local VO = stub.LoadQuests(QUESTS, SPOKEN)
local world = stub.world
local GUID = "Creature-0-0-0-0-15906-0"

world.modelFileID = 119159
VO.NPCModel:Prime(GUID, "npc")
Expect("a load in flight is loading", VO.NPCModel:IsLoading(), true)
stub.FinishModelLoad()
Expect("once loaded, the model is cached per guid", VO.NPCModel:Get(GUID), 119159)
Expect("a finished load is no longer loading", VO.NPCModel:IsLoading(), false)
local calls = stub.SetUnitCount()
VO.NPCModel:Prime(GUID, "npc")
Expect("a cached guid is never loaded twice", stub.SetUnitCount(), calls)

local heard
table.insert(VO.NPCModel.onLoaded, function(guid) heard = guid end)
local OTHER = "Creature-0-0-0-0-68-0"
world.modelFileID = 119940
VO.NPCModel:Prime(OTHER, "target")
Expect("the unit asked for is the one probed", stub.playerModel.unit, "target")
stub.FinishModelLoad()
Expect("a finished load tells whoever listens", heard, OTHER)

local THIRD = "Creature-0-0-0-0-69-0"
VO.NPCModel:Prime(THIRD, "npc")
VO.NPCModel:Abandon()
Expect("an abandoned load is not loading", VO.NPCModel:IsLoading(), false)
Expect("...and is not cached", VO.NPCModel:Get(THIRD), nil)

-- Priming twice while the first load is still in flight asks the probe once.
local FOURTH = "Creature-0-0-0-0-70-0"
world.modelFileID = 118355
world.modelStillLoading = true
calls = stub.SetUnitCount()
VO.NPCModel:Prime(FOURTH, "npc")
VO.NPCModel:Prime(FOURTH, "npc")
Expect("a guid still loading is asked for once", stub.SetUnitCount(), calls + 1)
Expect("...and is still loading", VO.NPCModel:IsLoading(), true)
-- The probe answers before any callback says so: Get reads it for the guid still loading.
world.modelStillLoading = false
Expect("the loading guid's model is read straight off the probe", VO.NPCModel:Get(FOURTH), 118355)
Expect("...which finishes the load", VO.NPCModel:IsLoading(), false)

-- Targeting or pointing at a split creature asks for its model before its dialog opens;
-- anything else is never asked for.
stub.SetClient("11509")
_G.SpokenQuestsSettings = nil
stub.SetAddOns({ { folder = "Pack", meta = { ["X-SpokenQuests-DataModule-Version"] = "1",
    Version = "1.0.0", Title = "Pack" } } })
VO = stub.LoadQuests(QUESTS, SPOKEN)
VO.Addon:OnInitialize()
VO.DataModules:EnumerateAddons(false)
VO.DataModules:Register("Pack", {
    SoundLengthLookupByFileName = {},
    GossipFileLookupByNPCBody = { [15906] = { ["gnome-male"] = {} } },
    GetSoundPath = function(_, fileName) return fileName end,
})
world.modelFileID = 119159
world.npcGUID = "Creature-0-0-0-0-15906-7"
calls = stub.SetUnitCount()
stub.FireEvent("PLAYER_TARGET_CHANGED")
Expect("targeting a split creature asks for its model", stub.SetUnitCount(), calls + 1)
Expect("...through the target", stub.playerModel.unit, "target")
stub.FireEvent("UPDATE_MOUSEOVER_UNIT")
Expect("pointing at it after is no second load", stub.SetUnitCount(), calls + 1)
stub.FinishModelLoad()
Expect("its model is in for the greeting", VO.NPCModel:Get("Creature-0-0-0-0-15906-7"), 119159)
world.npcGUID = "Creature-0-0-0-0-1-7"
calls = stub.SetUnitCount()
stub.FireEvent("UPDATE_MOUSEOVER_UNIT")
Expect("pointing at an unsplit creature asks for nothing", stub.SetUnitCount(), calls)
-- Targeted with no dialog after, and a client that never says the model is in: the probe is
-- still put away within two seconds, having asked once.
stub.ResetTimers()
world.npcGUID = "Creature-0-0-0-0-15906-8"
world.modelStillLoading = true
calls = stub.SetUnitCount()
stub.FireEvent("PLAYER_TARGET_CHANGED")
Expect("a target with no dialog is loading", VO.NPCModel:IsLoading("Creature-0-0-0-0-15906-8"), true)
Expect("...with the probe shown", stub.playerModel.shown, true)
stub.Advance(2.1)
Expect("two seconds on, it is finished", VO.NPCModel:IsLoading(), false)
Expect("...and the probe put away", stub.playerModel.shown, false)
Expect("...having asked once", stub.SetUnitCount(), calls + 1)
world.modelStillLoading = false

-- A cursor swept over a crowd starts a load for each creature it passes and leaves it before
-- the model is in. That is no answer: the creature left is loaded again when next asked.
stub.ResetTimers()
local A, B = "Creature-0-0-0-0-15906-20", "Creature-0-0-0-0-15906-21"
world.modelFileID, world.modelStillLoading = 119159, true
calls = stub.SetUnitCount()
VO.NPCModel:Prime(A, "mouseover")
VO.NPCModel:Prime(B, "mouseover")
Expect("swept on before its model is in, a creature is not loading", VO.NPCModel:IsLoading(A), false)
Expect("...the next one is", VO.NPCModel:IsLoading(B), true)
VO.NPCModel:Prime(A, "target")
Expect("...and the one left is loaded again when asked", stub.SetUnitCount(), calls + 3)
world.modelStillLoading = false
stub.FinishModelLoad()
Expect("...whose model is then in", VO.NPCModel:Get(A), 119159)

-- Swept back and forth, each creature is loaded twice at most.
local E, F = "Creature-0-0-0-0-15906-22", "Creature-0-0-0-0-15906-23"
world.modelStillLoading = true
calls = stub.SetUnitCount()
VO.NPCModel:Prime(E, "mouseover")
VO.NPCModel:Prime(F, "mouseover")
VO.NPCModel:Prime(E, "mouseover")
VO.NPCModel:Prime(F, "mouseover")
VO.NPCModel:Prime(E, "mouseover")
Expect("a creature swept over a third time loads nothing", stub.SetUnitCount(), calls + 4)
Expect("...and nothing is left loading", VO.NPCModel:IsLoading(), false)
Expect("...with the probe put away", stub.playerModel.shown, false)

-- A load that times out is one attempt, not a miss for good, until the attempts run out.
stub.ResetTimers()
local D = "Creature-0-0-0-0-15906-24"
calls = stub.SetUnitCount()
VO.NPCModel:Prime(D, "npc")
stub.Advance(2.1)
Expect("a timed-out load is not loading", VO.NPCModel:IsLoading(D), false)
VO.NPCModel:Prime(D, "npc")
Expect("...and is loaded again when asked", stub.SetUnitCount(), calls + 2)
stub.Advance(2.1)
VO.NPCModel:Prime(D, "npc")
Expect("timed out twice, it is loaded no more", stub.SetUnitCount(), calls + 2)
Expect("...nor the probe shown", stub.playerModel.shown, false)
world.modelStillLoading = false
world.npcGUID = "Creature-0-0-0-0-1234-0"; world.modelFileID = nil

os.exit(Failures() == 0 and 0 or 1)
