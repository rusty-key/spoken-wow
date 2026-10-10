-- Contributing in the background: the store, the first-click choice, and what the quests and
-- books addons keep while the player simply plays. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local SPOKEN = here .. "/../../addons/Spoken/"
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local BOOKS = here .. "/../../addons/Spoken_Books/"
local Expect, Failures = H.Expecter(print)

stub.SetClient("11509")
stub.SetAddOns({
    { folder = "Spoken_Quests", meta = { Version = "9.9.9" } },
    { folder = "TestPack", meta = { ["X-VoiceOver-DataModule-Version"] = "1", Version = "1.2.1", Title = "TestPack" } },
})
local VoiceOver = stub.LoadQuests(QUESTS, SPOKEN)
local Spoken = SpokenEnv.Spoken
local Gather = Spoken.Gather

------------------------------------------------------------------------------- the store
Expect("gathering is on until the player opts out", Gather:IsEnabled(), true)
Gather:SetEnabled(false)
Expect("...so opting out keeps nothing", Gather:Add("q:1:accept:2", "!SPOKEN1 quests\n"), false)
Expect("...and nothing is counted", Gather:Count(), 0)

Gather:SetEnabled(true)
Expect("once on, Add keeps a line", Gather:Add("q:1:accept:2", "first"), true)
Gather:Add("q:1:accept:2", "second")
Expect("the same key is kept once", Gather:Count(), 1)
Expect("...holding the newer capture", _G.SpokenContributionsDB.Lines[1].envelope, "second")
Expect("an empty key is refused", Gather:Add("", "x"), false)
Expect("an empty envelope is refused", Gather:Add("k", ""), false)

for i = 1, Gather.CAP + 5 do
    Gather:Add("cap:" .. i, "e" .. i)
end
local lines = _G.SpokenContributionsDB.Lines
Expect("the store never grows past its cap", Gather:Count(), Gather.CAP)
Expect("...dropping the oldest first", lines[1].key, "cap:6")
Expect("...and keeping the newest", lines[#lines].key, "cap:" .. (Gather.CAP + 5))
Gather:Clear()
Expect("Clear forgets everything", Gather:Count(), 0)
Gather:SetEnabled(false)

------------------------------------------------------------------------------- quests
dofile(SPOKEN .. "Dialogue/ContributeButton.lua")
VoiceOver.Addon:OnInitialize()
stub.Advance(2)

world.questID = 9123
world.title = "A Rough Start"
world.questText = "Kill six of them.\nThen come back."
world.npcName = "Deathguard Linnea"
world.npcGUID = "Creature-0-0-0-0-12345-0"
stub.ShowPanel("QuestFrameDetailPanel")

stub.FireEvent("QUEST_DETAIL")
Expect("a missing line is not gathered while gathering is off", Gather:Count(), 0)

Gather:SetEnabled(true)
SpokenEnv.Addon.db.profile.Contribute.HideButtons = true
stub.FireEvent("QUEST_DETAIL")
Expect("with gathering on, a missing quest line is kept even with the buttons hidden", Gather:Count(), 1)
local kept = _G.SpokenContributionsDB.Lines[1]
Expect("...keyed on the quest, the moment and the speaker", kept.key, "q:9123:accept:12345")
Expect("...holding the same envelope a click would send",
    kept.envelope, (VoiceOver.Contribute:Capture()))
SpokenEnv.Addon.db.profile.Contribute.HideButtons = false

stub.FireEvent("QUEST_DETAIL")
stub.Advance(2)
Expect("the same panel again keeps it once", Gather:Count(), 1)

world.rewardText = "Here is your reward."
stub.ShowPanel("QuestFrameRewardPanel")
stub.FireEvent("QUEST_COMPLETE")
Expect("the turn-in is a line of its own", Gather:Count(), 2)
Expect("...keyed as the complete moment", _G.SpokenContributionsDB.Lines[2].key, "q:9123:complete:12345")

stub.HidePanels()
stub.ShowGossip("We stand ready.")
stub.FireEvent("GOSSIP_SHOW")
Expect("gossip is gathered too", Gather:Count(), 3)
Expect("...keyed on the speaker and the words",
    _G.SpokenContributionsDB.Lines[3].key,
    "g:12345:" .. Spoken.Contribute:Checksum("We stand ready."))

-- A line a pack already voices is not a gap, and is not kept.
VoiceOver.DataModules:Register("TestPack", {
    SoundLengthLookupByFileName = { ["9124-accept"] = 1 },
})
world.questID = 9124
stub.ShowPanel("QuestFrameDetailPanel")
stub.FireEvent("QUEST_DETAIL")
Expect("a line some pack voices is not gathered", Gather:Count(), 3)
world.questID = 9123

-- The NPC's model loads after the panel opens. The line is kept at once, without it, and
-- taken again under the same key the moment the load finishes.
Gather:Clear()
world.questID = 9125
world.npcGUID = "Creature-0-0-0-0-777-0"
world.modelFileID = 123456
world.modelStillLoading = true
stub.ShowPanel("QuestFrameDetailPanel")
stub.FireEvent("QUEST_DETAIL")
local early = _G.SpokenContributionsDB.Lines[1]
Expect("a line whose model is still loading is kept at once", Gather:Count(), 1)
Expect("...without the model", early and early.envelope:match("\nmodel=") == nil, true)
world.modelStillLoading = false
stub.FinishModelLoad()
Expect("...and replaced, not added to, once the model is in", Gather:Count(), 1)
Expect("...now carrying it", _G.SpokenContributionsDB.Lines[1].envelope:match("\nmodel=123456\n") ~= nil, true)
world.questID, world.npcGUID, world.modelFileID = 9123, "Creature-0-0-0-0-12345-0", nil

-------------------------------------------------------------------- the first click
Gather:Clear()
Gather:SetEnabled(false)
stub.ShowPanel("QuestFrameDetailPanel")
VoiceOver.Contribute:Show()
local box = Spoken.ContributeBox
Expect("the first click offers a choice instead of a link", box.justThis:IsShown(), true)
Expect("...between this line and gathering", box.gather:IsShown(), true)
Expect("...explaining both", box.body:GetText(), SpokenEnv.L.CONTRIBUTE_INTRO)
Expect("...with no payload to copy yet", box.scroll:IsShown(), false)

box.justThis:Click()
Expect("choosing one line shows the link", box.editBox:GetText():match("^https://spoken%.rusty%.one/contribute#e1=") ~= nil, true)
Expect("...and hides the choice", box.gather:IsShown(), false)
Expect("...without turning gathering on", Gather:IsEnabled(), false)

VoiceOver.Contribute:Show()
Expect("the choice is offered once, not on every click", box.gather:IsShown(), false)

_G.SpokenContributionsDB.Introduced = false
VoiceOver.Contribute:Show()
box.gather:Click()
Expect("choosing to gather turns gathering on", Gather:IsEnabled(), true)
Expect("...keeps the line that was clicked", Gather:Count(), 1)
Expect("...and says how to send the file",
    box.body:GetText():match("SavedVariables\\SpokenContributions%.lua") ~= nil, true)
Expect("...counting what is kept", box.body:GetText():match("1 line") ~= nil, true)

------------------------------------------------------------------------------- books
local SpokenBooks = {}
for _, file in ipairs({ "Locale/enUS", "Checksum", "Core", "Language", "Reader", "Audio", "Contribute" }) do
    assert(loadfile(BOOKS .. file .. ".lua"))("Spoken_Books", SpokenBooks)
end
SpokenBooks:InitDB()
dofile(BOOKS .. "Data/Books.lua")

Gather:Clear()
local UNKNOWN = "A page no corpus has ever held.\n\nWritten for this test alone."
stub.ShowPage({ title = "Ledger of Nothing", number = 2, text = UNKNOWN })
Expect("an unknown page is gathered", SpokenBooks:GatherContribution(), true)
Expect("...keyed on its checksum", _G.SpokenContributionsDB.Lines[1].key, "b:" .. SpokenBooks:ChecksumOf(UNKNOWN))
SpokenBooks:GatherContribution()
Expect("...once", Gather:Count(), 1)

stub.ShowPage({ title = "A letter", number = 1, text = "Private words.", creator = "Somebody" })
Expect("mail is never gathered", SpokenBooks:GatherContribution(), false)

Gather:SetEnabled(false)
stub.ShowPage({ title = "Another", number = 1, text = "Another unknown page, for the switch." })
Expect("nothing is gathered once the player opts out", SpokenBooks:GatherContribution(), false)

os.exit(Failures() == 0 and 0 or 1)
