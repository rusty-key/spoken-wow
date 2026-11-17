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

---------------------------------------------------------------- a text pack's words
-- Polish has no client: a text pack (Spoken's Texts.lua) brings its words by line id, read where
-- Polish is the Text Language, over whatever voice plays.
local function Ids(fileName) return table.concat(VO.DataModules:LineIds(fileName), " ") end
VO, env, Spoken = Boot()
world.unitSex = 2
Expect("a quest's file is its line id, the player's sex's first", Ids("101-accept"), "q:101:accept:m q:101:accept")
Expect("...a wording's too", Ids("101-complete-w2"), "q:101:complete:w2:m q:101:complete:w2")
Expect("...a file made for one sex names that sex", Ids("f-101-progress"), "q:101:progress:f q:101:progress")
Expect("an English gossip hash is g:", Ids(GREETING_HASH), "g:" .. GREETING_HASH .. ":m g:" .. GREETING_HASH)
Expect("...a broadcast stem too", Ids("b6029-orc-female-standard"), "g:b6029-orc-female-standard:m g:b6029-orc-female-standard")
Expect("...and a language's own", Ids("deDE-" .. GREETING_HASH), "g:deDE-" .. GREETING_HASH .. ":m g:deDE-" .. GREETING_HASH)
Expect("a follow-up's is f:", Ids("4377-dwarf-male-standard"), "f:4377:dwarf-male-standard:m f:4377:dwarf-male-standard")
Expect("a name none fits stands for nothing", Ids("readme"), "")

local function Polish()
    _G.SpokenEnv.Addon.db.profile.Language.Text = "plPL"
    Spoken:RegisterText("plPL", "quests", {
        lines = { ["q:101:accept"] = "Idź, $N.", ["q:102:accept:m"] = "Dla niego.", ["q:102:accept:f"] = "Dla niej.",
            ["g:" .. GREETING_HASH] = "Witaj, wędrowcze." },
        titles = { [101] = "Zadanie testowe" } })
end
VO, env, Spoken = Boot()
Polish()
world.questID = 101
stub.ShowPanel("QuestFrameDetailPanel")
VO.Addon:QUEST_DETAIL()
Expect("Polish chosen, an English voice is captioned in the text pack's words, the player named",
    Spoken:GetCurrent().present.transcript, "Idź, " .. UnitName("player") .. ".")
Expect("...timed by estimate, as they are not the recording's", Spoken:GetCurrent().present.timings, nil)
Expect("...and the clip's text stays the window's, which matching reads", Spoken:GetCurrent().text, "Go.")
Spoken:StopAll()
stub.ShowPanel(nil)
world.questID = 0
VO, env, Spoken = Boot()
Polish()
world.gossipText = "Greetings, traveller."
VO.Addon:GOSSIP_SHOW()
Expect("...a gossip line too, matched by its English", Spoken:GetCurrent().present.transcript, "Witaj, wędrowcze.")
Spoken:StopAll()
world.gossipText = nil
VO, env, Spoken = Boot()
Polish()
world.questID = 102
stub.ShowPanel("QuestFrameDetailPanel")
VO.Addon:QUEST_DETAIL()
Expect("a line the pack splits by sex reads the player's", Spoken:GetCurrent().present.transcript, "Dla niego.")
Spoken:StopAll()
world.questID = 103
VO.Addon:QUEST_DETAIL()
Expect("a line the pack lacks keeps the window's words", Spoken:GetCurrent().present.transcript, nil)
Spoken:StopAll()
stub.ShowPanel(nil)
world.questID = 0
_G.SpokenEnv.Addon.db.profile.Language.Text = nil

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll quests pack text tests passed")
