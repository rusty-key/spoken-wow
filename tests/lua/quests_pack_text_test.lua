-- The words a sound pack carries, shown over the window's when the pack is in the client's
-- language. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

local BOOK = [[Interface\AddOns\Spoken_Quests\Textures\Book]]

local lookup = {}
for _, q in ipairs({ 101, 102, 103 }) do
    lookup[q .. "-accept"] = 2; lookup[q .. "-progress"] = 2; lookup[q .. "-complete"] = 2
end
-- A gossip line is content-addressed: md5(text + race + gender). The stub's pack answers
-- one fixed hash for the test NPC's greeting.
local GREETING_HASH = "9fdeb82237b72e8801030487901e690f"
lookup[GREETING_HASH] = 3

local function Boot()
    stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()
    stub.ldbObjects = {}; stub.dbIcons = {}
    -- The client state the previous scenario left: a quest ID and a visible panel would
    -- have the new addon's 10 Hz watcher queue a line before the scenario starts.
    world.questID = 0; stub.ShowPanel(nil); world.gossipText = nil; world.greetingText = nil
    local VO, env = stub.LoadQuests(QUESTS, SPOKEN)
    VO.Addon:OnInitialize()
    VO.DataModules:Register("TestPack", {
        SoundLengthLookupByFileName = lookup,
        WordTimesByFileName = { ["101-accept"] = "0 .5 1.25", [GREETING_HASH] = "0 .4" },
        TextByFileName = _G.TestPackText,
        GetSoundPath = function(_, fileName) return fileName .. ".ogg" end,
        GossipLookupByNPCID = { [1234] = { ["Greetings, traveller."] = GREETING_HASH } },
    })
    stub.Advance(2)   -- the deferred pack load
    world.title = "Test Quest"; world.questText = "Go."; world.progressText = "Done?"; world.rewardText = "Done."
    world.npcName = "Innkeeper Test"; world.npcGUID = "Creature-0-0-0-0-1234-0"
    return VO, env, _G.Spoken
end

---------------------------------------------------------------- the words a pack carries
_G.TestPackText = { ["101-accept"] = "Pack words.", [GREETING_HASH] = "Pack greeting." }
VO, env, Spoken = Boot()
world.questID = 101
stub.ShowPanel("QuestFrameDetailPanel")
VO.Addon:QUEST_DETAIL()
Expect("a pack in the client's language captions its own words", Spoken:GetCurrent().present.transcript, "Pack words.")
Expect("...and the clip's text stays the window's, which bubbles and highlighting find", Spoken:GetCurrent().text, "Go.")
Spoken:StopAll()
stub.ShowPanel(nil)
world.questID = 0
VO, env, Spoken = Boot()
world.gossipText = "Greetings, traveller."
VO.Addon:GOSSIP_SHOW()
Expect("...a gossip line too", Spoken:GetCurrent().present.transcript, "Pack greeting.")
Spoken:StopAll()
VO, env, Spoken = Boot()
VO.Addon.db.profile.Audio.OGThrall = true
world.gossipText = "Greetings, traveller."
VO.Addon:GOSSIP_SHOW()
Expect("...but not over an easter egg's own recording", Spoken:GetCurrent().present.transcript, nil)
Spoken:StopAll()
stub.SetLocale("deDE")
VO, env, Spoken = Boot()
world.questID = 101
stub.ShowPanel("QuestFrameDetailPanel")
VO.Addon:QUEST_DETAIL()
Expect("an English pack on a German client leaves the German words", Spoken:GetCurrent().present.transcript, nil)
Spoken:StopAll()
stub.SetLocale("enUS")
stub.ShowPanel(nil)
world.questID = 0
_G.TestPackText = nil
VO, env, Spoken = Boot()
world.questID = 101
stub.ShowPanel("QuestFrameDetailPanel")
VO.Addon:QUEST_DETAIL()
Expect("a pack from before it carried words leaves the window's", Spoken:GetCurrent().present.transcript, nil)
Spoken:StopAll()
stub.ShowPanel(nil)
world.questID = 0

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll quests pack text tests passed")
