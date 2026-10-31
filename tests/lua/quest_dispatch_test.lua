-- Which line the player reads for a quest interaction, across the three ways a client can
-- present one. Run with `make test-player`.
--
-- The interesting case is the third: DialogueUI calls QuestFrame:UnregisterAllEvents() and
-- draws its own dialog, so no Blizzard quest panel is ever shown. Classifying a quest
-- interaction by which panel is visible therefore has to have a fallback, and that fallback
-- used to assume "accept" - which read the offer text again at every turn-in.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local print = stub.print
stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()
local VO = stub.LoadQuests(here .. "/../../addons/Spoken_Quests/", here .. "/../../addons/Spoken/")
local Spoken = _G.Spoken

local world = stub.world
local failures = 0

-- Observed through the player's public seam rather than by monkeypatching the queue: what
-- the client would hear is what CLIP_STARTED reports.
local played = {}
Spoken:RegisterCallback("CLIP_STARTED", function(clip)
    table.insert(played, clip.fileName)
end)

local function Expect(scenario, expected)
    local actual = table.concat(played, ", ")
    if actual == expected then
        print(string.format("ok   %s\n     played: %s", scenario, actual ~= "" and actual or "(nothing)"))
    else
        failures = failures + 1
        print(string.format("FAIL %s\n     expected: %s\n     actual:   %s", scenario,
            expected ~= "" and expected or "(nothing)", actual ~= "" and actual or "(nothing)"))
    end
end

local function StartScenario()
    Spoken:StopAll()
    world.questID = 0
    stub.ShowPanel(nil)
    stub.FireEvent("QUEST_FINISHED")
    stub.Advance(10)
    -- Cleared last, so a line the previous scenario left behind cannot pass for this one's.
    Spoken:StopAll()
    for i = #played, 1, -1 do played[i] = nil end
end

local quests = { 101, 102, 103 }
local lookup = {}
for _, quest in ipairs(quests) do
    lookup[string.format("%d-accept", quest)] = 1
    lookup[string.format("%d-complete", quest)] = 1
end

VO.Addon:OnInitialize()
local testPack = {
    SoundLengthLookupByFileName = lookup,
    GetSoundPath = function(_, fileName) return fileName .. ".ogg" end,
}
VO.DataModules:Register("TestPack", testPack)

world.title = "Test Quest"
world.questText = "Go and do the thing."
world.progressText = "Have you done the thing?"
world.rewardText = "You have done the thing."

-- Wait out the deferred data module load that OnInitialize schedules.
stub.Advance(2)

-- A quest hand-off as the default UI presents it: the reward panel is what is on screen.
local quest = quests[1]
StartScenario()
world.questID = quest
stub.ShowPanel("QuestFrameDetailPanel")
stub.FireEvent("QUEST_DETAIL")
stub.Advance(3)
world.questID = 0
stub.ShowPanel(nil)
stub.FireEvent("QUEST_FINISHED")
stub.Advance(120)
world.questID = quest
stub.ShowPanel("QuestFrameRewardPanel")
stub.FireEvent("QUEST_COMPLETE")
stub.Advance(3)
world.questID = 0
stub.ShowPanel(nil)
stub.FireEvent("QUEST_FINISHED")
stub.Advance(3)
Expect("default UI: offer reads accept, turn-in reads complete",
    string.format("%d-accept, %d-complete", quest, quest))

-- The same hand-off on a client that keeps reporting the quest ID after its frame closes.
-- Nothing may be read once the dialog is gone.
quest = quests[2]
StartScenario()
world.questID = quest
stub.ShowPanel("QuestFrameDetailPanel")
stub.FireEvent("QUEST_DETAIL")
stub.Advance(3)
world.questID = 0
stub.ShowPanel(nil)
stub.FireEvent("QUEST_FINISHED")
stub.Advance(120)
world.questID = quest
stub.ShowPanel("QuestFrameRewardPanel")
stub.FireEvent("QUEST_COMPLETE")
stub.Advance(3)
stub.ShowPanel(nil)
stub.FireEvent("QUEST_FINISHED")   -- The quest ID is deliberately left set.
stub.Advance(3)
Expect("stale quest ID after the frame closes reads nothing more",
    string.format("%d-accept, %d-complete", quest, quest))

-- A replacement dialog addon: the client is in a quest dialog the whole time, but no
-- Blizzard panel is ever visible, so only the events say which interaction this is.
quest = quests[3]
StartScenario()
world.questID = quest
stub.FireEvent("QUEST_DETAIL")
stub.Advance(3)
world.questID = 0
stub.FireEvent("QUEST_FINISHED")
stub.Advance(120)
world.questID = quest
stub.FireEvent("QUEST_PROGRESS")
stub.Advance(1)
stub.FireEvent("QUEST_COMPLETE")
stub.Advance(3)
Expect("replacement dialog UI: turn-in reads complete, not accept",
    string.format("%d-accept, %d-complete", quest, quest))

-- An auto-accept addon (Leatrix Plus, and the auto-turn-in addons besides it) calls
-- AcceptQuest from its own QUEST_DETAIL handler, so the quest dialog is gone in the same
-- frame the offer arrived in. The 10 Hz watcher never sees a quest ID to stabilize, so the
-- event snapshot is the only record that the interaction happened.
quest = quests[1]
StartScenario()
world.questID = quest
stub.FireEvent("QUEST_DETAIL")
world.questID = 0
stub.FireEvent("QUEST_FINISHED")
stub.Advance(3)
Expect("auto-accepted quest still reads accept", string.format("%d-accept", quest))

-- The turn-in half of the same addon: it answers QUEST_PROGRESS with CompleteQuest and
-- QUEST_COMPLETE with GetQuestReward, so both arrive and close within one frame.
quest = quests[2]
StartScenario()
world.questID = quest
stub.FireEvent("QUEST_PROGRESS")
stub.FireEvent("QUEST_COMPLETE")
world.questID = 0
stub.FireEvent("QUEST_FINISHED")
stub.Advance(3)
Expect("auto-turned-in quest still reads complete", string.format("%d-complete", quest))

-- The rest use quests with every line, progress included, and the events that say what became
-- of the quest: QUEST_ACCEPTED (questID) and QUEST_TURNED_IN (questID, xp, money).
local full, followUp = 104, 105
lookup[string.format("%d-accept", full)] = 1
lookup[string.format("%d-progress", full)] = 1
lookup[string.format("%d-complete", full)] = 1
lookup[string.format("%d-accept", followUp)] = 1

-- A page whose event arrives with neither a quest ID nor a title names no quest, and nothing that
-- comes later can tie it to one: a quest accepted within seconds, one nobody was shown (an escort a
-- party member starts), is not read as if that page had been its offer.
StartScenario()
world.questID = 0
world.title = ""
stub.FireEvent("QUEST_FINISHED")
stub.FireEvent("QUEST_DETAIL")
stub.Advance(0.3)
world.title = "Test Quest"
stub.FireEvent("QUEST_ACCEPTED", full)
stub.Advance(3)
Expect("an accept after a page that names no quest reads nothing", "")

-- Auto-accept closing the window at once, followed by the server's accept event: one read.
StartScenario()
world.questID = full
stub.FireEvent("QUEST_DETAIL")
world.questID = 0
stub.FireEvent("QUEST_FINISHED")
stub.Advance(0.3)
stub.FireEvent("QUEST_ACCEPTED", full)
stub.Advance(3)
Expect("auto-accept closing the window at once reads accept once", string.format("%d-accept", full))

-- The same on a client that keeps reporting the quest ID after the window has closed: the ID
-- never drops to 0, so the accept event is what says the window closed on an accepted quest.
StartScenario()
world.questID = full
stub.FireEvent("QUEST_DETAIL")
stub.FireEvent("QUEST_FINISHED")
stub.Advance(0.3)
stub.FireEvent("QUEST_ACCEPTED", full)
stub.Advance(3)
Expect("auto-accept with a quest ID left set after the window closes reads accept once",
    string.format("%d-accept", full))

-- A player who reads the offer and accepts it: the watcher reads it, the accept event adds nothing.
StartScenario()
world.questID = full
stub.ShowPanel("QuestFrameDetailPanel")
stub.FireEvent("QUEST_DETAIL")
stub.Advance(3)
world.questID = 0
stub.ShowPanel(nil)
stub.FireEvent("QUEST_FINISHED")
stub.FireEvent("QUEST_ACCEPTED", full)
stub.Advance(3)
Expect("normal accept reads accept once", string.format("%d-accept", full))

-- A player who declines: no accept event comes, and nothing is read beyond what the open window read.
StartScenario()
world.questID = full
stub.ShowPanel("QuestFrameDetailPanel")
stub.FireEvent("QUEST_DETAIL")
stub.Advance(3)
world.questID = 0
stub.ShowPanel(nil)
stub.FireEvent("QUEST_FINISHED")
stub.Advance(15)
Expect("declined quest reads its offer once and nothing more", string.format("%d-accept", full))

-- Auto turn-in: CompleteQuest answers the progress page, the server sends the reward page a moment
-- later and GetQuestReward closes it. Each page is read, in order, as a player clicking through hears them.
StartScenario()
world.questID = full
stub.FireEvent("QUEST_PROGRESS")
stub.Advance(0.1)
stub.FireEvent("QUEST_COMPLETE")
world.questID = 0
stub.FireEvent("QUEST_FINISHED")
stub.Advance(0.1)
stub.FireEvent("QUEST_TURNED_IN", full, 0, 0)
stub.Advance(5)
Expect("auto turn-in reads progress then complete",
    string.format("%d-progress, %d-complete", full, full))

-- A turn-in after a page that names no quest reads nothing either.
StartScenario()
world.questID = 0
world.title = ""
stub.FireEvent("QUEST_FINISHED")
stub.FireEvent("QUEST_COMPLETE")
stub.Advance(0.3)
world.title = "Test Quest"
stub.FireEvent("QUEST_TURNED_IN", full, 0, 0)
stub.Advance(3)
Expect("a turn-in after a page that names no quest reads nothing", "")

-- Auto turn-in and the follow-up's auto-accept within one poll of the watcher: no page is lost to the next.
StartScenario()
world.questID = full
stub.FireEvent("QUEST_PROGRESS")
stub.FireEvent("QUEST_COMPLETE")
world.questID = 0
stub.FireEvent("QUEST_FINISHED")
stub.FireEvent("QUEST_TURNED_IN", full, 0, 0)
world.questID = followUp
stub.FireEvent("QUEST_DETAIL")
world.questID = 0
stub.FireEvent("QUEST_FINISHED")
stub.FireEvent("QUEST_ACCEPTED", followUp)
stub.Advance(5)
Expect("auto turn-in then the follow-up's auto-accept reads all three pages",
    string.format("%d-progress, %d-complete, %d-accept", full, full, followUp))

-- Classic's QUEST_DETAIL can fire before the globals change: the record holds the previous quest's
-- ID, and the page the player then reads in the open window is the new quest's. That page is the
-- newest record's, so the old quest's offer is not read after it.
StartScenario()
world.questID = full
stub.FireEvent("QUEST_DETAIL")
world.questID = followUp
stub.ShowPanel("QuestFrameDetailPanel")
stub.Advance(3)
world.questID = 0
stub.ShowPanel(nil)
stub.FireEvent("QUEST_FINISHED")
stub.Advance(5)
Expect("a record made from the previous quest's globals is not read once the new page was",
    string.format("%d-accept", followUp))

-- A page shown again after it was read keeps its mark: closing the window does not read it twice.
StartScenario()
world.questID = full
stub.ShowPanel("QuestFrameDetailPanel")
stub.FireEvent("QUEST_DETAIL")
stub.Advance(3)
stub.FireEvent("QUEST_DETAIL")
stub.Advance(6)
world.questID = 0
stub.ShowPanel(nil)
stub.FireEvent("QUEST_FINISHED")
stub.Advance(5)
Expect("a page shown again after it was read is not read again when the window closes",
    string.format("%d-accept", full))

-- A turn-in's pages wait for their turn-in event, even when the follow-up's offer is read first.
StartScenario()
world.questID = full
stub.FireEvent("QUEST_PROGRESS")
stub.FireEvent("QUEST_COMPLETE")
world.questID = followUp
stub.FireEvent("QUEST_DETAIL")
stub.ShowPanel("QuestFrameDetailPanel")
stub.Advance(1)
stub.FireEvent("QUEST_TURNED_IN", full, 0, 0)
stub.Advance(5)
Expect("the follow-up's page read in the window leaves the turn-in's pages for QUEST_TURNED_IN",
    string.format("%d-accept, %d-progress, %d-complete", followUp, full, full))

-- The follow-up's offer is recorded from the globals of the quest just turned in, and the player
-- reads it in the open window. That page is the follow-up's, so the turn-in's pages are not marked
-- read with it: they wait for QUEST_TURNED_IN.
StartScenario()
world.questID = full
stub.FireEvent("QUEST_PROGRESS")
stub.FireEvent("QUEST_COMPLETE")
stub.FireEvent("QUEST_DETAIL")
world.questID = followUp
stub.ShowPanel("QuestFrameDetailPanel")
stub.Advance(3)
stub.FireEvent("QUEST_TURNED_IN", full, 0, 0)
stub.Advance(5)
Expect("a follow-up recorded from the turn-in's globals, read in the window, leaves the turn-in's pages",
    string.format("%d-accept, %d-progress, %d-complete", followUp, full, full))

-- The same record, never read in a window: it holds the turn-in's text under the turn-in's quest
-- ID, so it is not read as that quest's offer once the quest is handed in.
StartScenario()
world.questID = full
stub.FireEvent("QUEST_PROGRESS")
stub.FireEvent("QUEST_COMPLETE")
stub.FireEvent("QUEST_DETAIL")
world.questID = 0
stub.FireEvent("QUEST_FINISHED")
stub.FireEvent("QUEST_TURNED_IN", full, 0, 0)
stub.FireEvent("QUEST_ACCEPTED", followUp)
stub.Advance(5)
Expect("an offer recorded after its quest's own pages is not read as that quest's offer",
    string.format("%d-progress, %d-complete", full, full))

-- Offers opened and closed unread: the last is the one the player was left with.
StartScenario()
for _, id in ipairs(quests) do
    world.questID = id
    stub.FireEvent("QUEST_DETAIL")
    stub.ShowPanel("QuestFrameDetailPanel")
    stub.Advance(0.2)
end
world.questID = 0
stub.ShowPanel(nil)
stub.FireEvent("QUEST_FINISHED")
stub.Advance(5)
Expect("several offers closed unread read the newest only", string.format("%d-accept", quests[3]))

-- Two quests handed in one after the other: the window's close reads the newest page of each kind,
-- and the pages it passed over wait for their own turn-in.
lookup[string.format("%d-progress", followUp)] = 1
lookup[string.format("%d-complete", followUp)] = 1
StartScenario()
world.questID = full
stub.FireEvent("QUEST_PROGRESS")
stub.FireEvent("QUEST_COMPLETE")
world.questID = followUp
stub.FireEvent("QUEST_PROGRESS")
stub.FireEvent("QUEST_COMPLETE")
world.questID = 0
stub.FireEvent("QUEST_FINISHED")
stub.Advance(0.3)
stub.FireEvent("QUEST_TURNED_IN", full, 0, 0)
stub.FireEvent("QUEST_TURNED_IN", followUp, 0, 0)
stub.Advance(5)
Expect("a turn-in's pages passed over when the window closed are read by its own turn-in",
    string.format("%d-progress, %d-complete, %d-progress, %d-complete", followUp, followUp, full, full))

-- Classic's QUEST_ACCEPTED follows the quest log index with the quest ID.
StartScenario()
world.questID = full
stub.FireEvent("QUEST_DETAIL")
stub.FireEvent("QUEST_FINISHED")
stub.Advance(0.3)
stub.FireEvent("QUEST_ACCEPTED", 3, full)
stub.Advance(3)
Expect("QUEST_ACCEPTED with the quest log index first reads the offer", string.format("%d-accept", full))

-- A quest ID the client hands over as a secret is no ID, and the quest log index beside it is not
-- taken for one: a record that happens to hold that number is not read.
lookup["3-accept"] = 1
StartScenario()
world.questID = 3
stub.FireEvent("QUEST_DETAIL")
stub.FireEvent("QUEST_FINISHED")
stub.Advance(0.3)
stub.Secrets(full)
stub.FireEvent("QUEST_ACCEPTED", 3, full)
stub.Secrets()
stub.Advance(3)
Expect("a secret quest ID in QUEST_ACCEPTED does not read the quest at its log index", "")

-- A page the player asked for by the Play button while the window was open is read: the watcher
-- finds it queued, and the window closing later does not read it again.
StartScenario()
world.questID = full
stub.ShowPanel("QuestFrameDetailPanel")
stub.FireEvent("QUEST_DETAIL")
VO.Addon:InvokeQuestHandler("QUEST_DETAIL", "test", true)
stub.Advance(8)
world.questID = 0
stub.ShowPanel(nil)
stub.FireEvent("QUEST_FINISHED")
stub.Advance(5)
Expect("a page already queued when the window closes is not read again",
    string.format("%d-accept", full))

-- Read When Window Closes holds the read until the window closes, and the page is read once. The
-- line is short, so it is over before the watcher sees the window gone and would read the page again.
lookup["106-accept"] = 0.02
StartScenario()
VO.Addon.db.profile.Audio.ReadAfterClose = true
world.questID = 106
stub.ShowPanel("QuestFrameDetailPanel")
stub.FireEvent("QUEST_DETAIL")
stub.Advance(8)
Expect("Read When Window Closes holds the offer while the window is open", "")
world.questID = 0
stub.ShowPanel(nil)
stub.FireEvent("QUEST_FINISHED")
stub.Advance(5)
VO.Addon.db.profile.Audio.ReadAfterClose = false
Expect("...and reads it once when the window closes", "106-accept")

-- A replay is not held back by DialogueUI's wait for its window: the window it waits for is not
-- the page's.
VO.DialogueUIBridge = { Defer = function() return true end, Read = function() end }
StartScenario()
world.questID = full
stub.FireEvent("QUEST_DETAIL")
stub.FireEvent("QUEST_FINISHED")
stub.Advance(0.3)
stub.FireEvent("QUEST_ACCEPTED", full)
stub.Advance(3)
VO.DialogueUIBridge = nil
Expect("a replayed page does not wait for DialogueUI's window", string.format("%d-accept", full))

-- A page shown again after the first record is old enough to be dropped is a new page.
StartScenario()
world.questID = full
stub.ShowPanel("QuestFrameDetailPanel")
stub.FireEvent("QUEST_DETAIL")
stub.Advance(3)
stub.ShowPanel(nil)
stub.FireEvent("QUEST_FINISHED")
stub.Advance(12)
stub.FireEvent("QUEST_DETAIL")
stub.FireEvent("QUEST_FINISHED")
stub.FireEvent("QUEST_ACCEPTED", full)
stub.Advance(3)
Expect("a page shown again long after it was read is read again",
    string.format("%d-accept, %d-accept", full, full))

-- A replayed line has no window left to close: another window closing does not cut it.
StartScenario()
VO.Addon.db.profile.Audio.StopAudioOnDisengage = true
world.questID = full
stub.FireEvent("QUEST_DETAIL")
stub.FireEvent("QUEST_FINISHED")
stub.Advance(0.3)
stub.FireEvent("QUEST_ACCEPTED", full)
stub.Advance(0.1)
VO.Addon:QUEST_FINISHED()
VO.Addon.db.profile.Audio.StopAudioOnDisengage = false
local stillPlaying = Spoken:GetCurrent() ~= nil
Expect("a replayed offer is not stopped by another window closing",
    stillPlaying and string.format("%d-accept", full) or "")

-- Classic's brief quest ID 0 as the offer arrives, on a client that then keeps reporting the ID
-- after the window closes: the record is found by its title, so the accept event still reads it.
lookup["107-accept"] = 1
testPack.QuestIDLookup = { accept = { ["Unnumbered Quest"] = 107 }, progress = {}, complete = {} }
StartScenario()
world.title = "Unnumbered Quest"
world.questID = 0
stub.FireEvent("QUEST_DETAIL")
world.questID = 107
stub.FireEvent("QUEST_FINISHED")
stub.Advance(0.3)
stub.FireEvent("QUEST_ACCEPTED", 107)
stub.Advance(3)
world.title = "Test Quest"
testPack.QuestIDLookup = nil
Expect("an offer recorded under quest ID 0 is read by its accept event", "107-accept")

if failures > 0 then
    print(string.format("\n%d scenario(s) failed", failures))
    os.exit(1)
end
print("\nall scenarios passed")
