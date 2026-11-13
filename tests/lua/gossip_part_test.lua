-- Gossip is a part of Spoken of its own, inside the Quests addon: its own source, its own switch
-- on Spoken's page, its own settings page. What NPCs say in their gossip and greeting windows is
-- read by the gossip source, every quest window by the quests source, and switching one part off
-- leaves the other speaking. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

local lookup = { ["101-accept"] = 2 }
local GREETING_HASH = "9fdeb82237b72e8801030487901e690f"
lookup[GREETING_HASH] = 3

local function Boot()
    stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers()
    stub.ldbObjects = {}; stub.dbIcons = {}
    world.questID = 0; stub.ShowPanel(nil); world.gossipText = nil; world.greetingText = nil
    local VO, env = stub.LoadQuests(QUESTS, SPOKEN)
    VO.Addon:OnInitialize()
    -- Once per Greeting is the default, and the profile outlives a scenario: each starts as a stranger.
    VO.Addon.db.char.hasSeenGossipForNPC = {}
    VO.DataModules:Register("TestPack", {
        SoundLengthLookupByFileName = lookup,
        GetSoundPath = function(_, fileName) return fileName .. ".ogg" end,
        GossipLookupByNPCID = { [1234] = { ["Greetings, traveller."] = GREETING_HASH } },
    })
    stub.Advance(2)
    world.title = "Test Quest"; world.questText = "Go."; world.progressText = "Done?"; world.rewardText = "Done."
    world.npcName = "Innkeeper Test"; world.npcGUID = "Creature-0-0-0-0-1234-0"
    return VO, env, _G.Spoken
end

---------------------------------------------------------------- two sources, one addon
local VO, env, Spoken = Boot()
local quests, gossip = Spoken:GetSource("quests"), Spoken:GetSource("gossip")
Expect("the quests addon registers the quests source", quests ~= nil and quests == VO.Player.source, true)
Expect("...and a gossip source of its own", gossip ~= nil and gossip == VO.Player.gossipSource, true)
Expect("...a different one", gossip ~= quests, true)
Expect("...from the same addon", gossip.addon, quests.addon)

world.gossipText = "Greetings, traveller."
VO.Addon:GOSSIP_SHOW()
local greeting = Spoken:GetCurrent()
Expect("a greeting is read by the gossip source", greeting and greeting.source == gossip, true)
Expect("...which the addon knows for its own", VO.Player:Owns(greeting), true)
Expect("...and which Stop Gossip is offered on", greeting.present.actions[2] and greeting.present.actions[2].id, "stopGossip")
Spoken:StopAll()
world.questID = 101
VO.Addon:QUEST_DETAIL()
local accept = Spoken:GetCurrent()
Expect("a quest is read by the quests source", accept and accept.source == quests, true)
Expect("...which the addon knows for its own", VO.Player:Owns(accept), true)

---------------------------------------------------------------- the window decides the part
Expect("a gossip window belongs to Gossip", VO.Addon:PartOfPage("GOSSIP_SHOW"), "gossip")
Expect("...so does a greeting window", VO.Addon:PartOfPage("QUEST_GREETING"), "gossip")
Expect("a quest's offer belongs to Quests", VO.Addon:PartOfPage("QUEST_DETAIL"), "quests")
Expect("...and its progress and its reward", VO.Addon:PartOfPage("QUEST_PROGRESS") .. VO.Addon:PartOfPage("QUEST_COMPLETE"),
    "questsquests")
Expect("no window is Quests'", VO.Addon:PartOfPage(nil), "quests")

---------------------------------------------------------------- one part off, the other speaks
VO, env, Spoken = Boot()
Spoken:SetPartOn("gossip", false)
Expect("with gossip off, its part is off", VO.Addon:IsPartOn("gossip"), false)
Expect("...and quests' is on", VO.Addon:IsPartOn(), true)
Expect("...a gossip window is off", VO.Addon:IsPageOn("GOSSIP_SHOW"), false)
Expect("...a quest window is on", VO.Addon:IsPageOn("QUEST_DETAIL"), true)
world.gossipText = "Greetings, traveller."
VO.Addon:GOSSIP_SHOW()
Expect("...the NPC's greeting is not read", Spoken:GetQueueSize(), 0)
world.questID = 101
VO.Addon:QUEST_DETAIL()
Expect("...a quest line still is", Spoken:GetCurrent() and Spoken:GetCurrent().fileName, "101-accept")
-- The switches are saved with the profile, which the next scenario boots on.
Spoken:SetPartOn("gossip", true)

VO, env, Spoken = Boot()
Spoken:SetPartOn("quests", false)
Expect("with quests off, a gossip window is still on", VO.Addon:IsPageOn("GOSSIP_SHOW"), true)
world.gossipText = "Greetings, traveller."
VO.Addon:GOSSIP_SHOW()
Expect("...and the NPC's greeting is read", Spoken:GetCurrent() and Spoken:GetCurrent().source == Spoken:GetSource("gossip"), true)
Spoken:SetPartOn("quests", true)

---------------------------------------------------------------- switching a part off clears its line
VO, env, Spoken = Boot()
world.gossipText = "Greetings, traveller."
VO.Addon:GOSSIP_SHOW()
Expect("a greeting is speaking", Spoken:GetCurrent() ~= nil, true)
Spoken:SetPartOn("gossip", false)
Expect("switching gossip off silences it", Spoken:GetCurrent(), nil)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll gossip part tests passed")
