-- Contributing in the background: the store, the first-click choice, and what the quests and
-- readables addons keep while the player simply plays. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local SPOKEN = here .. "/../../addons/Spoken/"
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local READABLES = here .. "/../../addons/Spoken_Readables/"
local Expect, Failures = H.Expecter(print)

stub.SetClient("16001")
stub.SetAddOns({
    { folder = "Spoken_Quests", meta = { Version = "9.9.9" } },
    { folder = "TestPack", meta = { ["X-VoiceOver-DataModule-Version"] = "1", Version = "1.2.1", Title = "TestPack" } },
})
local VoiceOver = stub.LoadQuests(QUESTS, SPOKEN)
local Spoken = SpokenEnv.Spoken
local Gather = Spoken.Gather

------------------------------------------------------------------------------- the store
Expect("gathering is on until the player opts out", Gather:IsEnabled(), true)
SlashCmdList.SPOKEN("collect")
Expect("/sp collect turns it off", Gather:IsEnabled(), false)
SlashCmdList.SPOKEN("collect")
Expect("...and on again", Gather:IsEnabled(), true)
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
dofile(QUESTS .. "UI/ContributeButton.lua")
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

-- A line that plays in words other than the ones its corpus text has is kept, for the site to
-- correct: Blizzard changed it, or the corpus copy carries some player's name. Tokens, breaks,
-- case and spacing are not a difference.
local pack = VoiceOver.DataModules.registeredModules.TestPack
local questText = _G.SpokenQuestsText
_G.SpokenQuestsText = { [9124] = { accept = "Kill six of them, $N.  $B$BThen come $gback:back;." } }
world.questText = "Kill six of them, Tester.\n\nThen come back."
stub.FireEvent("QUEST_DETAIL")
Expect("a voiced line saying what its text says is not gathered", Gather:Count(), 3)
world.questText = "Kill seven of them, Tester.\n\nThen come back."
do
    local asked, isTextKnown = 0, VoiceOver.DataModules.IsTextKnown
    VoiceOver.DataModules.IsTextKnown = function(...) asked = asked + 1; return isTextKnown(...) end
    VoiceOver.Contribute:HasGap()
    VoiceOver.DataModules.IsTextKnown = isTextKnown
    Expect("a changed line is compared once, by the pass that gathers it", asked, 1)
end
stub.FireEvent("QUEST_DETAIL")
Expect("a voiced line in other words is gathered", Gather:Count(), 4)
Expect("...with the reader's name as its token",
    ((_G.SpokenContributionsDB.Lines[4] or {}).envelope or ""):find("Kill seven of them, $N.", 1, true) ~= nil, true)
Expect("...and offers no Contribute button, since it plays", VoiceOver.ContributeButton.button:IsShown(), false)
world.questText = "Kill six of them.\nThen come back."
world.questID = 9123
_G.SpokenQuestsText = questText

stub.HidePanels()
local before = Gather:Count()
pack.SoundLengthLookupByFileName["gossip-roads"] = 1
pack.GossipLookupByNPCID = { [12345] = { ["Well met, $N. The roads are safe tonight."] = "gossip-roads" } }
stub.ShowGossip("Well met, Tester. The roads are safe tonight.")
stub.FireEvent("GOSSIP_SHOW")
Expect("gossip saying what its text says is not gathered", Gather:Count(), before)
stub.ShowGossip("Well met, Tester. The roads are not safe tonight.")
local reworded = { event = VoiceOver.Enums.SoundEvent.Gossip, unitGUID = world.npcGUID, name = world.npcName,
    text = "Well met, Tester. The roads are not safe tonight." }
Expect("(the reworded gossip plays the old line)",
    VoiceOver.DataModules:PrepareSound(reworded) and reworded.fileName, "gossip-roads")
stub.FireEvent("GOSSIP_SHOW")
Expect("gossip in other words, close enough to play the old line, is gathered", Gather:Count(), before + 1)
pack.GossipLookupByNPCID = nil

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

-- The window closing: QUEST_FINISHED refreshes while the panel's text still reads and the NPC
-- is already gone. That is the line just kept, less its speaker, and it is not kept again.
Gather:Clear()
stub.ShowPanel("QuestFrameDetailPanel")
stub.FireEvent("QUEST_DETAIL")
Expect("a quest line is kept with its speaker", Gather:Count(), 1)
world.npcGUID, world.npcName = nil, nil
stub.FireEvent("QUEST_FINISHED")
Expect("the window closing does not keep it a second time without its speaker", Gather:Count(), 1)
Expect("...the one kept names the speaker", _G.SpokenContributionsDB.Lines[1].key, "q:9123:accept:12345")

local function Keys()
    local keys = {}
    for _, line in ipairs(_G.SpokenContributionsDB.Lines) do
        keys[#keys + 1] = line.key
    end
    return table.concat(keys, " ")
end
world.questID = 9126
stub.FireEvent("QUEST_DETAIL")
Expect("a quest line with no speaker on screen at all is still kept", Keys(), "q:9123:accept:12345 q:9126:accept:")
world.npcGUID, world.npcName = "Creature-0-0-0-0-12345-0", "Deathguard Linnea"
stub.FireEvent("QUEST_DETAIL")
Expect("...and its speaker's copy, once seen, takes its place", Keys(), "q:9123:accept:12345 q:9126:accept:12345")
world.questID = 9123

-- Gathering reads no kept line to do it: a store full of speakerless lines costs no more to add to.
do
    local fill = {}
    for n = 1, 400 do
        fill[n] = { key = "q:" .. (5000 + n) .. ":accept:", envelope = Spoken.Contribute:Envelope("quests", { { "quest", "x" } }, "Line " .. n) }
    end
    _G.SpokenContributionsDB.Lines = fill
    local parse, reads = Spoken.Contribute.Parse, 0
    Spoken.Contribute.Parse = function(...) reads = reads + 1; return parse(...) end
    world.questID = 9127
    world.npcGUID, world.npcName = "Creature-0-0-0-0-12345-0", "Deathguard Linnea"
    stub.ShowPanel("QuestFrameDetailPanel")
    stub.FireEvent("QUEST_DETAIL")
    world.npcGUID, world.npcName = nil, nil
    stub.FireEvent("QUEST_FINISHED")
    Spoken.Contribute.Parse = parse
    Expect("a quest line is kept beside them", _G.SpokenContributionsDB.Lines[401].key, "q:9127:accept:12345")
    Expect("...once, the window closing not keeping it again", Gather:Count(), 401)
    Expect("...with no kept line read to do it", reads, 0)
    world.npcGUID, world.npcName, world.questID = "Creature-0-0-0-0-12345-0", "Deathguard Linnea", 9123
end

-- A speakerless copy saying something else stays when its speaker's copy comes in: it is the only
-- record of those words.
do
    Gather:Clear()
    _G.SpokenContributionsDB.Lines = {
        { key = "q:9128:accept:", envelope = Spoken.Contribute:Envelope("quests", { { "quest", "9128" } }, "Other words entirely.") },
    }
    world.questID = 9128
    stub.FireEvent("QUEST_DETAIL")
    Expect("a speakerless copy saying something else stays beside its speaker's", Keys(), "q:9128:accept: q:9128:accept:12345")
end

-- The window's closing copy and the speaker's say the same words whatever line endings the client
-- wrote them with.
do
    Gather:Clear()
    world.questID = 9129
    world.questText = "Kill six of them.\r\nThen come back."
    world.npcGUID, world.npcName = nil, nil
    stub.FireEvent("QUEST_DETAIL")
    Expect("a quest line with no speaker is kept", Keys(), "q:9129:accept:")
    world.npcGUID, world.npcName = "Creature-0-0-0-0-12345-0", "Deathguard Linnea"
    stub.FireEvent("QUEST_DETAIL")
    Expect("...and its speaker's copy takes its place when the words hold carriage returns", Keys(), "q:9129:accept:12345")
    world.questID, world.questText = 9123, "Kill six of them.\nThen come back."
end

-- Copies kept before this was fixed go at login. A speakerless copy saying something else, or
-- with no copy from a speaker beside it, stays: it is the only record of those words.
-- Lines kept by earlier versions are tidied once, so a login that stands for the first one clears the
-- file's mark first.
local function Login()
    _G.SpokenContributionsDB.Tidied = nil
    stub.FireEvent("PLAYER_LOGIN")
end
local function Kept(text)
    return Spoken.Contribute:Envelope("quests", { { "quest", "3117" } }, text)
end
_G.SpokenContributionsDB.Lines = {
    { key = "q:3117:progress:3596", envelope = Kept("You've arrived, $N.") },
    { key = "q:3117:progress:", envelope = Kept("You've arrived, $N.") },
    { key = "q:3117:complete:", envelope = Kept("Well done.") },
    { key = "q:3118:accept:", envelope = Kept("Other words.") },
    { key = "q:3118:accept:77", envelope = Kept("Different words.") },
}
Login()
Expect("login drops a speakerless copy of a line kept with its speaker, and nothing else", Keys(),
    "q:3117:progress:3596 q:3117:complete: q:3118:accept: q:3118:accept:77")
Expect("...and the file says the lines were tidied", Gather:IsTidied(), true)
do
    local parse, reads = Spoken.Contribute.Parse, 0
    Spoken.Contribute.Parse = function(...) reads = reads + 1; return parse(...) end
    _G.SpokenContributionsDB.Lines = {
        { key = "q:3117:progress:3596", envelope = Kept("You've arrived, $N.") },
        { key = "q:3117:progress:", envelope = Kept("You've arrived, $N.") },
    }
    stub.FireEvent("PLAYER_LOGIN")
    Spoken.Contribute.Parse = parse
    Expect("a later login reads no kept line", reads, 0)
    Expect("...and tidies none", Gather:Count(), 2)
end

-- This character's name in lines kept earlier is left where it is: the file is the account's, a
-- line another character kept may hold the same word as a name of its own ("The Light keeps
-- you."), and nothing here knows who kept which.
world.playerName = "Light"
local sum = Spoken.Contribute.Checksum
local function Said(text)
    return Spoken.Contribute:Envelope("quests", { { "npc", "12345 Linnea" } }, text)
end
local kept = {
    { key = "q:3117:accept:3596", envelope = Kept("Welcome, Light. A warrior's road.") },
    { key = "g:12345:" .. sum(nil, "The Light keeps you.") .. ":f", envelope = Said("The Light keeps you.") },
    { key = "g:12345:" .. sum(nil, "LIGHT, stay a while.") .. ":f", envelope = Said("LIGHT, stay a while.") },
}
_G.SpokenContributionsDB.Lines = {}
for i, line in ipairs(kept) do _G.SpokenContributionsDB.Lines[i] = { key = line.key, envelope = line.envelope } end
Login()
local unchanged = Gather:Count() == #kept
for i, line in ipairs(kept) do
    local now = _G.SpokenContributionsDB.Lines[i]
    unchanged = unchanged and now and now.key == line.key and now.envelope == line.envelope
end
Expect("login leaves a kept line holding this character's name as it was, key and words", unchanged, true)

-- A line that does not read back (its checksum is wrong) is left as it is, whatever it holds.
local damaged = Said("Take this."):gsub("npc=12345 Linnea", "npc=Sharingfriend")
_G.SpokenContributionsDB.Lines = { { key = "q:3120:accept:", envelope = damaged } }
Login()
Expect("login leaves an envelope that does not read back as it was", _G.SpokenContributionsDB.Lines[1].envelope, damaged)

-- A quest another player shared was kept with their name as its npc, no id and no kind, and their
-- look as the speaker's. After login the name and the look are gone; an NPC's stay, whatever its
-- name, with an id or a kind, or two words.
local function From(...)
    local fields = { { "quest", "3119" } }
    for _, field in ipairs({ ... }) do fields[#fields + 1] = field end
    return Spoken.Contribute:Envelope("quests", fields, "Take this.")
end
_G.SpokenContributionsDB.Lines = {
    { key = "q:3119:accept:", envelope = From({ "npc", "Sharingfriend" }, { "model", "777" }, { "displays", "1,2" },
        { "sex", "3" }, { "creature", "Humanoid" }, { "title", "A Task" }) },
    { key = "q:3119:progress:", envelope = From({ "npc", "Deathguard Linnea" }, { "sex", "3" }) },
    { key = "q:3119:complete:", envelope = From({ "npc", "Hearthstone" }, { "kind", "item" }) },
    { key = "q:3119:turnin:4242", envelope = From({ "npc", "4242 Linnea" }, { "sex", "3" }) },
    { key = "q:3119:abandon:", envelope = From({ "npc", "4242" }, { "model", "888" }) },
}
Login()
local lines = _G.SpokenContributionsDB.Lines
Expect("login takes another player's name and look out of a quest they shared",
    lines[1].envelope, From({ "npc", "" }, { "title", "A Task" }))
Expect("...and leaves an NPC's, named in two words,", lines[2].envelope, From({ "npc", "Deathguard Linnea" }, { "sex", "3" }))
Expect("...an item's,", lines[3].envelope, From({ "npc", "Hearthstone" }, { "kind", "item" }))
Expect("...and one with its id as it was", lines[4].envelope, From({ "npc", "4242 Linnea" }, { "sex", "3" }))
Expect("...and one with only its id", lines[5].envelope, From({ "npc", "4242" }, { "model", "888" }))
Expect("...every line kept", Gather:Count(), 5)
world.playerName = nil
Gather:Clear()

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

--------------------------------------------------------------------------- readables
local SpokenReadables = {}
for _, file in ipairs({ "Locale/enUS", "Checksum", "Core", "Language", "Reader", "Audio", "Contribute" }) do
    assert(loadfile(READABLES .. file .. ".lua"))("Spoken_Readables", SpokenReadables)
end
SpokenReadables:InitDB()
dofile(READABLES .. "Data/Books.lua")

Gather:Clear()
local UNKNOWN = "A page no corpus has ever held.\n\nWritten for this test alone."
stub.ShowPage({ title = "Ledger of Nothing", number = 2, text = UNKNOWN })
Expect("an unknown page is gathered", SpokenReadables:GatherContribution(), true)
Expect("...keyed on its checksum", _G.SpokenContributionsDB.Lines[1].key, "b:" .. SpokenReadables:ChecksumOf(UNKNOWN))
SpokenReadables:GatherContribution()
Expect("...once", Gather:Count(), 1)

stub.ShowPage({ title = "A letter", number = 1, text = "Private words.", creator = "Somebody" })
Expect("mail is never gathered", SpokenReadables:GatherContribution(), false)

Gather:SetEnabled(false)
stub.ShowPage({ title = "Another", number = 1, text = "Another unknown page, for the switch." })
Expect("nothing is gathered once the player opts out", SpokenReadables:GatherContribution(), false)

os.exit(Failures() == 0 and 0 or 1)
