-- What the quests addon offers to send when it has no line. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local SPOKEN = here .. "/../../addons/Spoken/"
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local Expect, Failures = H.Expecter(print)

stub.SetClient("16001")
-- The loader quest_dispatch_test.lua and quest_overlay_test.lua use: it boots the player
-- itself, so there is no separate stub.LoadSpoken call here.
local VoiceOver = stub.LoadQuests(QUESTS, SPOKEN)

-- The addon's own .toc Version, as GetAddOnMetadata(AddonFolder, "Version") reads it -- picked
-- deliberately unlike anything in the real .toc, so the assertion below cannot pass by
-- coincidentally matching it; it is pinning that Contribute:Capture reads a real version, not
-- confirming a particular one. TestPack stays alongside it: OnInitialize's EnumerateAddons has
-- to see TestPack in this same list, or the DataModules:Register call further down (which
-- asserts a module was detected during enumeration) fails.
stub.SetAddOns({
    { folder = "Spoken_Quests", meta = { Version = "9.9.9" } },
    { folder = "TestPack", meta = { ["X-VoiceOver-DataModule-Version"] = "1", Version = "1.2.1", Title = "TestPack" } },
})

world.questID = 9123
world.title = "A Rough Start"
world.questText = "Kill six of them.\nThen come back."
world.npcName = "Deathguard Linnea"
world.npcGUID = "Creature-0-0-0-0-12345-0"
stub.ShowPanel("QuestFrameDetailPanel")

local envelope = VoiceOver.Contribute:Capture()
H.WriteCapturedFixture(here, "quests-accept", envelope)
Expect("the source is quests", envelope:match("^!SPOKEN1 quests\n") ~= nil, true)
Expect("the quest id is carried", envelope:match("\nquest=9123\n") ~= nil, true)
Expect("the event is the panel on screen", envelope:match("\nevent=accept\n") ~= nil, true)
Expect("the npc is carried", envelope:match("\nnpc=12345 Deathguard Linnea\n") ~= nil, true)
Expect("the title is carried", envelope:match("\ntitle=A Rough Start\n") ~= nil, true)
Expect("the text is the client's", envelope:match("\nKill six of them%.\nThen come back%.\n") ~= nil, true)
Expect("the locale is carried", envelope:match("\nlocale=enUS\n") ~= nil, true)
Expect("the pack language is carried beside it", envelope:match("\npack=enUS\n") ~= nil, true)
-- No pack is enumerated yet at this point of the test, so the version is the "none" a player
-- with no pack in the language sends.
Expect("...and the version of the pack speaking it, none without one", envelope:match("\npackVersion=none\n") ~= nil, true)
Expect("the build is carried", envelope:match("\nbuild=") ~= nil, true)
Expect("no character name is carried", envelope:match(world.playerName or "Tester") == nil, true)

-- A quest a party member shares opens the window with them as its "npc". Their name is a
-- player's, and does not go.
do
    local isPlayer, guid, name = _G.UnitIsPlayer, world.npcGUID, world.npcName
    local sex, modelFile = world.unitSex, world.modelFileID
    _G.UnitIsPlayer = function() return true end
    world.npcGUID, world.npcName = "Player-4401-0A1B2C3D", "Sharingfriend"
    world.unitSex, world.modelFileID = 3, 777
    local shared = VoiceOver.Contribute:Capture()
    Expect("a quest shared by another player sends no player's name", shared:find("Sharingfriend", 1, true), nil)
    Expect("...nor what they look like: no kind, model, sex or creature type",
        (shared:find("\nkind=", 1, true) or shared:find("\nmodel=", 1, true) or shared:find("\nsex=", 1, true)
            or shared:find("\ncreature=", 1, true)), nil)
    local primed, prime = 0, VoiceOver.NPCModel.Prime
    VoiceOver.NPCModel.Prime = function(...) primed = primed + 1; return prime(...) end
    VoiceOver.Contribute:HasGap()
    VoiceOver.NPCModel.Prime = prime
    Expect("...and no model is asked for them", primed, 0)
    world.unitSex, world.modelFileID = sex, modelFile
    _G.UnitIsPlayer = isPlayer
    stub.HidePanels()
    Expect("...nor does a report on its line after the window closed",
        VoiceOver.Contribute:ReportContext({ questID = 9123, event = VoiceOver.Enums.SoundEvent.QuestAccept,
            unitGUID = world.npcGUID, name = "Sharingfriend", text = "Kill six of them." }):find("Sharingfriend", 1, true), nil)
    world.npcGUID, world.npcName = guid, name
    stub.ShowPanel("QuestFrameDetailPanel")
end
-- Either sign alone is a player's: the client says the unit is one, or its GUID is a Player's.
do
    local isPlayer, guid, name = _G.UnitIsPlayer, world.npcGUID, world.npcName
    world.npcName = "Sharingfriend"
    _G.UnitIsPlayer = function() return true end
    Expect("a unit the client calls a player sends no name, whatever its GUID",
        VoiceOver.Contribute:Capture():find("Sharingfriend", 1, true), nil)
    _G.UnitIsPlayer = isPlayer
    world.npcGUID = "Player-4401-0A1B2C3D"
    Expect("a Player GUID sends no name, whatever the client calls the unit",
        VoiceOver.Contribute:Capture():find("Sharingfriend", 1, true), nil)
    world.npcGUID, world.npcName = guid, name
end
Expect("the addon field carries the real .toc version, not the \"dev\" fallback",
    envelope:match("\naddon=SpokenQuests/9%.9%.9\n") ~= nil, true)

-- Gossip: no quest, but an NPC and their words are worth having.
stub.HidePanels()
stub.ShowGossip("We stand ready.")
local gossip = VoiceOver.Contribute:Capture()
H.WriteCapturedFixture(here, "quests-gossip", gossip)
Expect("gossip carries the npc and no quest", gossip:match("\nquest=") == nil, true)
Expect("...and the gossip text", gossip:match("\nWe stand ready%.\n") ~= nil, true)

stub.HidePanels()
Expect("nothing on screen contributes nothing", VoiceOver.Contribute:Capture(), nil)

---------------------------------------------------------------- what a report carries
-- The window on screen when it still shows the clip, so the NPC can be observed.
stub.ShowPanel("QuestFrameDetailPanel")
local clip = { questID = 9123, event = VoiceOver.Enums.SoundEvent.QuestAccept, unitGUID = world.npcGUID,
    name = "Deathguard Linnea", title = "A Rough Start", text = "Kill six of them, Tester." }
local onScreen = VoiceOver.Contribute:ReportContext(clip)
Expect("a report on the clip on screen reads the window", onScreen
    and onScreen:match("\nKill six of them%.\nThen come back%.\n") ~= nil, true)

-- Report is offered after the window closes: the clip as it remembers itself.
stub.HidePanels()
local remembered = VoiceOver.Contribute:ReportContext(clip)
Expect("...a closed window's clip from what it remembers", remembered
    and remembered:match("\nquest=9123\nevent=accept\nnpc=12345 Deathguard Linnea\ntitle=A Rough Start\n") ~= nil, true)
Expect("...its text with the reader put back as a token", remembered
    and remembered:match("\nKill six of them, %$N%.\n") ~= nil, true)
Expect("...and the addon version", remembered and remembered:match("\naddon=SpokenQuests/9%.9%.9\n") ~= nil, true)
Expect("nothing on screen and no clip reports no context", VoiceOver.Contribute:ReportContext(nil), nil)

---------------------------------------------------------------- the reader put back as tokens
-- The client expands $N, $C and $R to whoever is reading, so the text is sent with the
-- tokens back in place of this character's name, class and race.
world.playerClass, world.playerClassFile = "Warrior", "WARRIOR"
world.playerRace, world.playerRaceFile = "Night Elf", "NightElf"
world.questText = "Tester! A Night Elf warrior, Tester's kind. Testers and Tester2 stay."
stub.ShowPanel("QuestFrameDetailPanel")
local swapped = VoiceOver.Contribute:Capture()
Expect("the name, class and race go back to tokens, whole words only",
    swapped:match("\n([^\n]*stay%.)\n"), "$N! A $R $c, $N's kind. Testers and Tester2 stay.")

_G.LOCALIZED_CLASS_NAMES_FEMALE = { WARRIOR = "Kriegerin" }
world.questText = "Eine Kriegerin, Tester."
local inflected = VoiceOver.Contribute:Capture()
Expect("...and the class in either gender's form", inflected:match("\nEine %$C, %$N%.\n") ~= nil, true)
_G.LOCALIZED_CLASS_NAMES_FEMALE = nil

-- A quest only the reader's class can take says the class as its own word, not as the reader's.
world.playerClass, world.playerClassFile, world.playerClassID = "Paladin", "PALADIN", 2
world.questText = "Tester, a paladin must reflect the Light."
_G.SpokenQuestsCompendium = { quests = { [9123] = { "A Rough Start", classes = 2 } } }
Expect("a quest only that class can take keeps the class as written",
    VoiceOver.Contribute:Capture():match("\n([^\n]*Light%.)\n"), "$N, a paladin must reflect the Light.")
Expect("...also from the quest log",
    VoiceOver.Contribute:Detemplate("A paladin, Tester.", 9123), "A paladin, $N.")
_G.SpokenQuestsCompendium.quests[9123].classes = 2 + 4
Expect("a quest two classes can take still puts the reader's class back",
    VoiceOver.Contribute:Capture():match("\n([^\n]*Light%.)\n"), "$N, a $c must reflect the Light.")
_G.SpokenQuestsCompendium.quests[9123].classes = nil
Expect("...as does a quest open to every class",
    VoiceOver.Contribute:Capture():match("\n([^\n]*Light%.)\n"), "$N, a $c must reflect the Light.")
_G.SpokenQuestsCompendium = nil
world.playerClassID = nil

world.playerName = "Valaas Dawnsight"
world.questText = "Greetings, young Valaas. The Dawnsight name is known, Valaas Dawnsight."
local surnamed = VoiceOver.Contribute:Capture()
Expect("a surnamed character is swapped whole and by either part",
    surnamed:match("\nGreetings, young %$N%. The %$N name is known, %$N%.\n") ~= nil, true)
world.questText = "VALAAS DAWNSIGHT! Valaas. VALAASWOOD stays."
Expect("...and in capitals, as some pages write it",
    VoiceOver.Contribute:Capture():match("\n([^\n]*stays%.)\n"), "$N! $N. VALAASWOOD stays.")
-- A part of the name inside a longer class phrase leaves that phrase to the class.
do
    local class = world.playerClass
    world.playerName, world.playerClass = "Valaas Hunter", "Demon Hunter"
    Expect("a part of the name inside the class's words does not take them first",
        VoiceOver.Contribute:Detemplate("Demon Hunter, rise. Valaas, Hunter."), "$C, rise. $N, $N.")
    world.playerClass = class
end
world.playerName = "Zöpf"
Expect("an accented name in capitals is the name too",
    VoiceOver.Contribute:Detemplate("ZÖPF, Zöpf, Zöpfe."), "$N, $N, Zöpfe.")
world.playerName = "Гримбалор"
Expect("...as is a Cyrillic one", VoiceOver.Contribute:Detemplate("ГРИМБАЛОР."), "$N.")
world.playerName = nil

stub.HidePanels()
stub.ShowGossip("Well met, Tester.")
local _, key = VoiceOver.Contribute:Capture()
Expect("gossip is keyed on the tokens, so every character gathers the same line",
    key, format("g:12345:%d", SpokenEnv.Spoken.Contribute:Checksum("Well met, $N.")))
stub.HidePanels()
world.playerClass, world.playerClassFile, world.playerRace, world.playerRaceFile = nil, nil, nil, nil
world.questText = "Kill six of them.\nThen come back."

-- The button: on the Blizzard quest frame, not stubbed out of LoadQuests the way
-- QuestOverlayUI and Options are, since this test is specifically about it. Built by
-- Addon:OnInitialize the same way ReportButton's popup is, and kept in sync by its own event
-- frame (registered in Setup, not a timer) -- stub.FireEvent is what lets a test trigger a
-- refresh the way the real events VoiceOver.lua already registers would.
dofile(QUESTS .. "UI/ContributeButton.lua")
VoiceOver.Addon:OnInitialize()
-- Wait out the deferred data module load OnInitialize schedules, as the other quests tests do.
stub.Advance(2)

world.questID = 9123
world.title = "A Rough Start"
world.questText = "Kill six of them.\nThen come back."
stub.ShowPanel("QuestFrameDetailPanel")
stub.FireEvent("QUEST_DETAIL")
Expect("the button appears on the quest detail panel when there is a gap",
    VoiceOver.ContributeButton.button:IsShown(), true)

-- The Spoken setting that hides every Contribute button. Toggling it fires no game
-- event, so the button must hear about it through the player's own callback.
SpokenEnv.Addon.db.profile.Contribute.HideButtons = true
SpokenEnv.Callbacks:Fire("CONTRIBUTE_SETTINGS_CHANGED")
Expect("hiding Contribute buttons in the player settings hides it at once",
    VoiceOver.ContributeButton.button:IsShown(), false)
stub.FireEvent("QUEST_DETAIL")
Expect("...and it stays hidden through the next quest event", VoiceOver.ContributeButton.button:IsShown(), false)
SpokenEnv.Addon.db.profile.Contribute.HideButtons = false
SpokenEnv.Callbacks:Fire("CONTRIBUTE_SETTINGS_CHANGED")
Expect("...and comes back when the setting is turned off", VoiceOver.ContributeButton.button:IsShown(), true)

-- A pack picks up the line: the gap closes, and the button goes with it on the next event.
VoiceOver.DataModules:Register("TestPack", {
    SoundLengthLookupByFileName = { ["9123-accept"] = 1 },
})
stub.FireEvent("QUEST_DETAIL")
Expect("...and disappears once a data module has the line", VoiceOver.ContributeButton.button:IsShown(), false)

stub.HidePanels()
stub.FireEvent("QUEST_FINISHED")
Expect("...and stays hidden once the panel closes", VoiceOver.ContributeButton.button:IsShown(), false)

-- Where the button sits: the quest frame's top right corner, where a Play button sits in the
-- quest log -- just left of the frame's own close button when the client draws one.
world.rewardText = "Here is your reward."
stub.ShowPanel("QuestFrameRewardPanel")
stub.FireEvent("QUEST_COMPLETE")
local button = VoiceOver.ContributeButton.button
Expect("the button shows on the reward panel too", button:IsShown(), true)
Expect("...in the quest frame's top right corner", button.anchor and button.anchor.point, "TOPRIGHT")
Expect("...of the quest frame itself", button.anchor and button.anchor.relativeTo == _G.QuestFrame, true)

_G.QuestFrameCloseButton = stub.Widget("Button", "QuestFrameCloseButton")
stub.FireEvent("QUEST_COMPLETE")
-- The stub lays every frame out from 100 at the top to 0 at the bottom, so the close button's
-- bottom edge is 100 below the frame's top: 12 more puts the button in the strip under it.
Expect("under the close button, where the client draws one", button.anchor and button.anchor.y, -112)
Expect("...in from the frame's right edge as far as the details Play is from its own",
    button.anchor and button.anchor.relativeTo == _G.QuestFrame and button.anchor.x, -11)
Expect("...by its top right corner", button.anchor and button.anchor.point, "TOPRIGHT")

button:GetScript("OnEnter")(button)
Expect("the tooltip says the quest is missing", GameTooltip.text, "Spoken Quests doesn't have this quest")
_G.QuestFrameCloseButton = nil
stub.HidePanels()

-- Gossip: the same corner of the gossip frame, and a tooltip about a line rather than a quest.
stub.ShowGossip("We stand ready.")
stub.FireEvent("GOSSIP_SHOW")
Expect("the button appears on gossip too", button:IsShown(), true)
Expect("...in the gossip frame's top right corner", button.anchor and button.anchor.relativeTo == _G.GossipFrame, true)
button:GetScript("OnEnter")(button)
Expect("...saying the line is missing", GameTooltip.text, "Spoken Quests doesn't have this line")

---------------------------------------------------------------- the closing gossip frame
-- CloseGossip fires GOSSIP_CLOSED, which refreshes the button, and on a real client the
-- gossip text is still readable for that instant while the unit behind it is already gone.
-- VoiceOver.lua's own GOSSIP_SHOW guards the same case -- "the player interacted with an NPC
-- while having main menu or options opened" -- because DataModules keys gossip on the NPC's
-- name when there is no GUID, and a nil name reaches string.gsub as nil.
stub.HidePanels()
stub.ShowGossip("Words with nobody left to say them.")
local savedName, savedGUID = world.npcName, world.npcGUID
world.npcName, world.npcGUID = nil, nil

local askedGap, gapAnswer = pcall(function() return VoiceOver.Contribute:HasGap() end)
Expect("a gossip frame closing under us does not error", askedGap, true)
Expect("...and offers nothing, having no NPC to attribute the words to", gapAnswer, false)

local askedCapture, captured = pcall(function() return VoiceOver.Contribute:Capture() end)
Expect("capturing the same moment does not error", askedCapture, true)
Expect("...and sends nothing, since the server keys gossip on the creature id", captured, nil)

world.npcName, world.npcGUID = savedName, savedGUID

---------------------------------------------------------- a Spoken older than this addon
-- What this addon calls in the Spoken folder beside it, new with the name swaps and the login tidy: an
-- older folder lacks it, and a player on it has no contribute button rather than an error.
do
    local Gather = SpokenEnv.Spoken.Gather
    local questID, text = world.questID, world.questText
    world.questID, world.questText = 9555, "Words no pack has."
    stub.ShowPanel("QuestFrameDetailPanel")
    local real = VoiceOver.Contribute.QuestLogDescription
    VoiceOver.Contribute.QuestLogDescription = function() return "From the log, Tester." end
    local clip = { questID = 9555, event = VoiceOver.Enums.SoundEvent.QuestAccept, unitGUID = world.npcGUID,
        name = "Deathguard Linnea", text = "Words no pack has, Tester." }
    for _, missing in ipairs({ { Spoken.Contribute, "NameWords" }, { Spoken.Contribute, "ReplaceWord" },
        { Spoken.Contribute, "Parse" }, { Gather, "Get" }, { Gather, "Remove" }, { Gather, "IsTidied" } }) do
        local owner, name = missing[1], missing[2]
        local method = owner[name]
        owner[name] = nil
        local label = "without " .. name
        local ok, gap = pcall(VoiceOver.Contribute.HasGap, VoiceOver.Contribute)
        Expect(label .. ", the gap check does not error", ok, true)
        Expect("...and finds no gap", gap, false)
        local captured, report, fromLog, tidied
        Expect("...capturing does not error", (pcall(function() captured = VoiceOver.Contribute:Capture() end)), true)
        Expect("...and sends nothing", captured, nil)
        Expect("...nor does a report", (pcall(function() report = VoiceOver.Contribute:ReportContext(clip) end)), true)
        Expect("...and it carries nothing", report, nil)
        Expect("...nor does the quest log's", (pcall(function() fromLog = VoiceOver.Contribute:CaptureFromLog(9555, "A Task") end)), true)
        Expect("...and it carries nothing either", fromLog, nil)
        Expect("...which offers no button", VoiceOver.Contribute:CanOfferFromLog(), false)
        Expect("...and the login tidy does not error", (pcall(VoiceOver.Contribute.TidyGathered, VoiceOver.Contribute)), true)
        owner[name] = method
    end
    VoiceOver.Contribute.QuestLogDescription = real
    stub.HidePanels()
    world.questID, world.questText = questID, text
end

------------------------------------------------------------------------------- Show()
-- The first-click choice between one line and gathering is gather_test.lua's; here the
-- player has already answered it, so Show() goes straight to the payload.
SpokenEnv.Spoken.Gather:SetIntroduced()
-- Compression must run on the click alone -- HasGap fires on every quest and gossip event --
-- and this spies on Encode rather than trusting the comment, so a future edit that moved the
-- call into Capture/HasGap would fail here rather than merely cost more.
world.title = "A Rough Start"
world.questText = "Kill six of them.\nThen come back."
stub.ShowPanel("QuestFrameDetailPanel")
local encodeCalls = 0
local realEncode = Spoken.Contribute.Encode
Spoken.Contribute.Encode = function(...)
    encodeCalls = encodeCalls + 1
    return realEncode(...)
end
VoiceOver.Contribute:HasGap()
VoiceOver.Contribute:Capture()
Expect("HasGap/Capture never encode", encodeCalls, 0)

VoiceOver.Contribute:Show()
Expect("...only Show() does", encodeCalls, 1)
local box = Spoken.ContributeBox
Expect("Show() puts a link in the box, not the raw envelope",
    box.editBox:GetText():match("^https://spoken%.rusty%.one/contribute#e1=") ~= nil, true)
Expect("...with the link hint", box.hint:GetText(), "Copy this and open it in your browser:")
Spoken.Contribute.Encode = realEncode

-- The fallback an older bundled Spoken still gets: no Encode at all.
Spoken.Contribute.Encode = nil
VoiceOver.Contribute:Show()
Expect("...falls back to the raw envelope when Encode is absent",
    box.editBox:GetText():match("^!SPOKEN1 quests\n") ~= nil, true)
Expect("...with the old two-copy hint", box.hint:GetText(), "Press Ctrl+C, then paste it at:")
Expect("...and the address shown again", box.address:GetText(), "https://spoken.rusty.one/contribute")
Spoken.Contribute.Encode = realEncode

---------------------------------------------------------------- what the client saw
-- The site works out the race from the model file id; the addon only reports it. PlayerModel
-- loads asynchronously -- probed against a live client, SetUnit followed immediately by
-- GetModelFileID answers nothing, and the same read a moment later answers the real file id
-- -- so the model is never read on the click. HasGap pre-warms it into a cache keyed by NPC
-- guid while the panel is still on screen (a player reads a quest for seconds), and Capture
-- only ever looks the guid up.
--
-- OnModelLoaded is a fast path here, not a requirement: whether a real client ever calls it
-- for a PlayerModel built this way has not been confirmed. Every guid below resolves either
-- through it firing (stub.FinishModelLoad) or through the fallback that reads the
-- still-shown probe directly on a later refresh (stub.modelCallbackDisabled) -- the same
-- outcome either way, which is the point.
--
-- Gathering stays off for this whole block: with it on, every HasGap below would
-- Capture through GatherLine, and Capture's click-time model read would resolve each
-- guid on the very first refresh -- the poll, the callback and the probe states under
-- test would never get their turn. Gathering itself is gather_test.lua's subject.
SpokenEnv.Spoken.Gather:SetEnabled(false)
stub.HidePanels()
world.questID = 9401
world.title = "Nothing Heard Yet"
world.questText = "Words with no line in the corpus."
world.npcName = "Deathguard Linnea"
-- Guids not reused anywhere else in this file: the model cache is keyed by guid and never
-- reset between scenarios, so a guid this test has seen before would already be cached (or
-- mid-load) from earlier in the run, and these tests would not be testing what they say.
world.npcGUID = "Creature-0-0-0-0-90001-0"
world.modelFileID = 122055
world.unitSex = 2
world.creatureType = "Humanoid"
stub.ShowPanel("QuestFrameDetailPanel")

local setUnitBefore = stub.SetUnitCount and stub.SetUnitCount() or 0
Expect("there is a gap to prime the model for", VoiceOver.Contribute:HasGap(), true)
Expect("priming a fresh NPC calls SetUnit once",
    (stub.SetUnitCount and stub.SetUnitCount() or 0), setUnitBefore + 1)
Expect("the probe is shown while the load is pending",
    stub.playerModel and stub.playerModel.shown, true)

-- OnModelLoaded firing (the fast path) resolves and hides the probe immediately, before any
-- click ever reads it -- checked without an intervening Capture(), since Capture's own
-- click-time read (below) would otherwise resolve this guid regardless of the callback.
stub.FinishModelLoad()
Expect("firing the callback hides the probe immediately, before any click",
    stub.playerModel and stub.playerModel.shown, false)

local seen = VoiceOver.Contribute:Capture()
H.WriteCapturedFixture(here, "quests-observed", seen)
Expect("the model file id is reported once the load has fired", seen:match("\nmodel=122055\n") ~= nil, true)
Expect("the sex the client reports is carried too", seen:match("\nsex=2\n") ~= nil, true)
Expect("the creature type is carried", seen:match("\ncreature=Humanoid\n") ~= nil, true)
Expect("a creature guid is reported as a creature", seen:match("\nkind=creature\n") ~= nil, true)
Expect("no race is decided here", seen:match("\nrace=") == nil, true)

-- Once cached, a further refresh for the same NPC must not ask again.
Expect("still a gap once cached", VoiceOver.Contribute:HasGap(), true)
Expect("...and no further SetUnit once the guid is cached",
    (stub.SetUnitCount and stub.SetUnitCount() or 0), setUnitBefore + 1)

-- A different NPC is a different guid, and is worth asking about once of its own. Left
-- mid-load deliberately (never resolved here) -- the next scenario switches away from it
-- again, which is exactly the retargeting case that follows.
world.npcGUID = "Creature-0-0-0-0-90002-0"
world.npcName = "Someone Else"
Expect("a different NPC is still a gap", VoiceOver.Contribute:HasGap(), true)
Expect("...and does call SetUnit once, for the new guid",
    (stub.SetUnitCount and stub.SetUnitCount() or 0), setUnitBefore + 2)

---------------------------------------------------------- reading at click time on a miss
-- The gossip case that made this whole design wrong the first time around: a gossip
-- interaction fires exactly one refresh (GOSSIP_SHOW) before the player reads the text and
-- clicks Contribute. There is never a second refresh for PollLoadingGUID to run on, so
-- without this, the model would be omitted on almost every gossip contribution -- the poll
-- and its bound never get the chance they assume. SetUnit ran once when the panel opened,
-- seconds before this click; live-client evidence says that is enough time to have loaded.
world.npcGUID = "Creature-0-0-0-0-90010-0"
world.npcName = "Read And Click"
world.modelFileID = 445566
local clickSetUnitBefore = stub.SetUnitCount and stub.SetUnitCount() or 0
Expect("priming on the one refresh a gossip interaction fires is a gap",
    VoiceOver.Contribute:HasGap(), true)
Expect("priming calls SetUnit once",
    (stub.SetUnitCount and stub.SetUnitCount() or 0), clickSetUnitBefore + 1)

-- No second HasGap(), no stub.FinishModelLoad(): Capture is the very first thing that reads
-- this guid again, exactly the way a player who reads and clicks does it.
local clicked = VoiceOver.Contribute:Capture()
Expect("the model is read at click time, with no second refresh and no callback ever firing",
    clicked:match("\nmodel=445566\n") ~= nil, true)
Expect("...without ever calling SetUnit again to get it",
    (stub.SetUnitCount and stub.SetUnitCount() or 0), clickSetUnitBefore + 1)

---------------------------------------------------------- an early click must not poison the guid
-- A click quick enough to beat the load is not the same thing as a load that has genuinely
-- finished with nothing to show: reading nothing here must leave the guid exactly as it was,
-- not cache a permanent miss that forecloses the callback or the next poll from ever
-- resolving it. modelStillLoading is what lets the stub represent "shown, but not answering
-- yet" at all -- without it GetModelFileID always answers immediately once shown, which is
-- why an early-click race was never once exercised before this existed.
world.npcGUID = "Creature-0-0-0-0-90011-0"
world.npcName = "Too Quick"
world.modelFileID = 778899
world.modelStillLoading = true
local earlyClickSetUnitBefore = stub.SetUnitCount and stub.SetUnitCount() or 0
Expect("priming this NPC is a gap", VoiceOver.Contribute:HasGap(), true)
Expect("priming calls SetUnit once",
    (stub.SetUnitCount and stub.SetUnitCount() or 0), earlyClickSetUnitBefore + 1)

local tooEarly = VoiceOver.Contribute:Capture()
Expect("clicking before the model has loaded omits the field, not a permanent miss",
    tooEarly:match("\nmodel=") == nil, true)
Expect("...and does not spend the only SetUnit this guid gets",
    (stub.SetUnitCount and stub.SetUnitCount() or 0), earlyClickSetUnitBefore + 1)

-- The model finishes loading after the early click; the callback still resolves the same
-- guid, which the failed early read must not have foreclosed.
world.modelStillLoading = false
stub.FinishModelLoad()
local afterLoad = VoiceOver.Contribute:Capture()
Expect("the same guid still resolves once the model actually loads",
    afterLoad:match("\nmodel=778899\n") ~= nil, true)

---------------------------------------------------------- retargeting mid-load
-- Switching to a different NPC before the current one's load resolves is ordinary play, not
-- an edge case -- quickly glancing between two quest givers. The probe must be put away from
-- the one left, which has not had its chance to load, so it is loaded again when returned to;
-- and glancing back and forth must still end, with each guid loaded twice at most.
stub.modelCallbackDisabled = true
world.modelFileID = nil
local retargetSetUnitBefore = stub.SetUnitCount and stub.SetUnitCount() or 0
world.npcGUID = "Creature-0-0-0-0-90007-0"
world.npcName = "Ding"
Expect("priming the first of two rapidly-retargeted NPCs is a gap", VoiceOver.Contribute:HasGap(), true)
Expect("its probe is shown while the load is pending",
    stub.playerModel and stub.playerModel.shown, true)

world.npcGUID = "Creature-0-0-0-0-90008-0"
world.npcName = "Dong"
Expect("retargeting before it resolves is still a gap", VoiceOver.Contribute:HasGap(), true)
Expect("retargeting still only calls SetUnit once for the new NPC",
    (stub.SetUnitCount and stub.SetUnitCount() or 0), retargetSetUnitBefore + 2)

world.npcGUID = "Creature-0-0-0-0-90007-0"
world.npcName = "Ding"
Expect("returning to the NPC left is still a gap", VoiceOver.Contribute:HasGap(), true)
Expect("...and loads it again, as it was left before its model was in",
    (stub.SetUnitCount and stub.SetUnitCount() or 0), retargetSetUnitBefore + 3)

world.npcGUID = "Creature-0-0-0-0-90008-0"
VoiceOver.Contribute:HasGap()
world.npcGUID = "Creature-0-0-0-0-90007-0"
VoiceOver.Contribute:HasGap()
Expect("glancing back and forth loads each NPC twice at most",
    (stub.SetUnitCount and stub.SetUnitCount() or 0), retargetSetUnitBefore + 4)
local backToDing = VoiceOver.Contribute:Capture()
Expect("its model resolved to a miss rather than staying unresolved forever",
    backToDing:match("\nmodel=") == nil, true)
Expect("the probe ends up hidden once nothing is left loading",
    stub.playerModel and stub.playerModel.shown, false)

---------------------------------------------------------- when OnModelLoaded never fires
-- Correctness must not depend on this script actually firing: pcall(SetScript, ...)
-- succeeding only proves it was registered, not that the client will ever call it.

-- A guid whose model does load, just with nothing ever announcing it: the second refresh,
-- still mid-load, must not call SetUnit again, and reading the still-shown probe directly
-- resolves it anyway. Checked via the probe's own shown state rather than an intervening
-- Capture() -- Capture's click-time read would otherwise resolve this guid on the very first
-- call and the poll would never get a chance to be the thing that resolved it.
world.npcGUID = "Creature-0-0-0-0-90003-0"
world.npcName = "Never Announces"
world.modelFileID = 987654
local pollSetUnitBefore = stub.SetUnitCount and stub.SetUnitCount() or 0
Expect("priming this NPC is still a gap", VoiceOver.Contribute:HasGap(), true)
Expect("priming calls SetUnit once",
    (stub.SetUnitCount and stub.SetUnitCount() or 0), pollSetUnitBefore + 1)
Expect("the probe is shown while the load is pending",
    stub.playerModel and stub.playerModel.shown, true)

Expect("a second refresh, with no callback ever firing, is still a gap",
    VoiceOver.Contribute:HasGap(), true)
Expect("...and does not call SetUnit again while still loading",
    (stub.SetUnitCount and stub.SetUnitCount() or 0), pollSetUnitBefore + 1)
Expect("...but the poll alone, with no click involved, has already resolved and hidden it",
    stub.playerModel and stub.playerModel.shown, false)
local polled = VoiceOver.Contribute:Capture()
Expect("the model the poll resolved is what Capture reports",
    polled:match("\nmodel=987654\n") ~= nil, true)

-- A guid whose model never loads at all: polling gives up after a couple of refreshes rather
-- than leaving the probe shown (and loading) forever.
world.npcGUID = "Creature-0-0-0-0-90004-0"
world.npcName = "Never Loads"
world.modelFileID = nil
local giveUpSetUnitBefore = stub.SetUnitCount and stub.SetUnitCount() or 0
Expect("priming this NPC is a gap too", VoiceOver.Contribute:HasGap(), true)
Expect("the probe is shown while its load is pending",
    stub.playerModel and stub.playerModel.shown, true)
Expect("one refresh in, still trying", VoiceOver.Contribute:HasGap(), true)
Expect("a second refresh gives up on this guid", VoiceOver.Contribute:HasGap(), true)
Expect("...and the probe is put away rather than left shown",
    stub.playerModel and stub.playerModel.shown, false)
Expect("...having called SetUnit only the original once",
    (stub.SetUnitCount and stub.SetUnitCount() or 0), giveUpSetUnitBefore + 1)
local gaveUp = VoiceOver.Contribute:Capture()
Expect("a guid that gave up is omitted, not sent as 0", gaveUp:match("\nmodel=") == nil, true)
-- One load given up is not the answer yet: the next refresh loads it once more, and only that
-- one giving up as well caches the miss.
Expect("the next refresh is still a gap", VoiceOver.Contribute:HasGap(), true)
Expect("...and loads it a second time",
    (stub.SetUnitCount and stub.SetUnitCount() or 0), giveUpSetUnitBefore + 2)
VoiceOver.Contribute:HasGap()
VoiceOver.Contribute:HasGap()
Expect("given up twice, the probe is put away",
    stub.playerModel and stub.playerModel.shown, false)

stub.modelCallbackDisabled = false

-- The model frame is built at most once, and never merely because the button refreshed --
-- and once a guid has resolved (as this one now has, with a cached miss), asking again must
-- not even touch the probe.
local framesBefore = stub.FrameCount and stub.FrameCount() or 0
local setUnitCallsBefore = stub.SetUnitCount and stub.SetUnitCount() or 0
VoiceOver.Contribute:HasGap()
Expect("asking again for an already-resolved NPC builds no model frame",
    (stub.FrameCount and stub.FrameCount() or 0), framesBefore)
Expect("...and calls SetUnit no further times",
    (stub.SetUnitCount and stub.SetUnitCount() or 0), setUnitCallsBefore)

---------------------------------------------------------- a language no client runs in
-- Listening in Italian, every line its pack has not voiced yet would read as missing text,
-- and the English on screen is text the corpus already has. Nothing is offered.
Expect("the same line is a gap in the client's language", VoiceOver.Contribute:HasGap(), true)
VoiceOver.Addon.db.profile.Audio.VoiceLanguage = "itIT"
Expect("listening in Italian, no line is a gap", VoiceOver.Contribute:HasGap(), false)
VoiceOver.Addon.db.profile.Audio.VoiceLanguage = nil
Expect("...and back on auto it is again", VoiceOver.Contribute:HasGap(), true)

---------------------------------------------------------- closing a dialog mid-load
-- The exposure this fix closes: no click and no retarget, just the player closing the dialog
-- (or a pack picking up the line) while the probe is still mid-load. Before this fix nothing
-- hid the probe in that case -- HasGap only ever primed on an actual gap -- and a PlayerModel
-- left shown keeps driving a 3D draw for as long as the addon runs, on a client that has hung
-- its GPU on model rendering before.
stub.ShowPanel("QuestFrameDetailPanel")
world.npcGUID = "Creature-0-0-0-0-90005-0"
world.npcName = "Closed Before Loading"
world.modelFileID = nil
world.modelStillLoading = true
local closeSetUnitBefore = stub.SetUnitCount and stub.SetUnitCount() or 0
Expect("priming this NPC is a gap", VoiceOver.Contribute:HasGap(), true)
Expect("priming calls SetUnit once",
    (stub.SetUnitCount and stub.SetUnitCount() or 0), closeSetUnitBefore + 1)
Expect("the probe is shown while the load is pending",
    stub.playerModel and stub.playerModel.shown, true)

stub.HidePanels()
Expect("closing with nothing left to send is not a gap", VoiceOver.Contribute:HasGap(), false)
Expect("...and the probe is put away even though nothing ever resolved it",
    stub.playerModel and stub.playerModel.shown, false)
Expect("...without spending a SetUnit to do it",
    (stub.SetUnitCount and stub.SetUnitCount() or 0), closeSetUnitBefore + 1)

-- Abandoned, not resolved: only running out of load attempts caches a miss, so coming back to the same NPC primes it again -- one extra SetUnit -- rather
-- than reading a cached "no model" that this guid was never actually given the chance to earn.
stub.ShowPanel("QuestFrameDetailPanel")
world.modelStillLoading = false
world.modelFileID = 334455
Expect("returning to the abandoned NPC is a gap again, not a cached miss",
    VoiceOver.Contribute:HasGap(), true)
Expect("...costing exactly one more SetUnit, the price this fix accepts",
    (stub.SetUnitCount and stub.SetUnitCount() or 0), closeSetUnitBefore + 2)
local reopened = VoiceOver.Contribute:Capture()
Expect("the model resolves normally once given the chance to actually load",
    reopened:match("\nmodel=334455\n") ~= nil, true)

-- With nothing on screen at all and nothing loading, HasGap must not reach the model probe
-- even to look.
stub.HidePanels()
local idleSetUnitBefore = stub.SetUnitCount and stub.SetUnitCount() or 0
VoiceOver.Contribute:HasGap()
Expect("asking whether there is a gap with nothing on screen never touches the model probe",
    (stub.SetUnitCount and stub.SetUnitCount() or 0), idleSetUnitBefore)

---------------------------------------------------------------- which appearances it can wear
-- SetCreature rolls one of a creature's appearances per call, so a few dozen rolls tell the site
-- which appearances exist; the model above says which body the player is looking at.
SpokenEnv.Addon.db.profile.Contribute.HideButtons = false
stub.HidePanels()
world.questID = 9402
world.title = "Guarded Words"
world.questText = "Nothing on file for this one."
world.npcName = "Bluffwatcher"
world.npcGUID = "Creature-0-0-0-0-3084-0"
world.modelFileID = 122055
world.creatureDisplays[3084] = { 9392, 2141, 9391, 8572 }
world.displaysUncached = true
stub.ShowPanel("QuestFrameDetailPanel")

local rollsBefore = stub.SetCreatureCount()
local early = VoiceOver.Contribute:Capture()
Expect("a creature not cached yet sends no appearances", early:match("\ndisplays=") == nil, true)
Expect("...after thirty-two rolls", stub.SetCreatureCount() - rollsBefore, 32)

world.displaysUncached = false
local rolled = VoiceOver.Contribute:Capture()
Expect("the appearances are sent once they answer, sorted and once each",
    rolled:match("\ndisplays=2141,8572,9391,9392\n") ~= nil, true)

local rolledOnce = stub.SetCreatureCount()
VoiceOver.Contribute:Capture()
Expect("an NPC whose appearances are known is not rolled again", stub.SetCreatureCount(), rolledOnce)

stub.HidePanels()
world.npcGUID = "GameObject-0-0-0-0-3085-0"
world.creatureDisplays[3085] = { 1 }
stub.ShowPanel("QuestFrameDetailPanel")
local objectRolls = stub.SetCreatureCount()
local object = VoiceOver.Contribute:Capture()
Expect("a gameobject is never rolled", stub.SetCreatureCount(), objectRolls)
Expect("...and sends no appearances", object:match("\ndisplays=") == nil, true)

-- An item's GUID names a spawn, not the item, so the bags say which item starts the quest.
stub.HidePanels()
world.questID = 96391
world.npcGUID, world.npcName = "Item-4372-0-400000033D4D1C15", nil
local bags = { [0] = { [3] = { questID = 4242, link = "|cffffffff|Hitem:7000::::::::|h[Other Note]|h|r" },
                       [5] = { questID = 96391, link = "|cffffffff|Hitem:211315::::::::|h[Underground Map]|h|r" } } }
_G.C_Container = {
    GetContainerNumSlots = function(bag) return bags[bag] and 16 or 0 end,
    GetContainerItemInfo = function(bag, slot)
        local item = bags[bag] and bags[bag][slot]
        return item and { iconFileID = 1, hyperlink = item.link } or nil
    end,
    GetContainerItemQuestInfo = function(bag, slot)
        local item = bags[bag] and bags[bag][slot]
        return { questID = item and item.questID }
    end,
}
stub.ShowPanel("QuestFrameDetailPanel")
local item = VoiceOver.Contribute:Capture()
H.WriteCapturedFixture(here, "quests-item", item)
Expect("an item that starts the quest is reported as an item", item:match("\nkind=item\n") ~= nil, true)
Expect("...named by the bag item whose quest is on screen",
    item:match("\nnpc=211315 Underground Map\n") ~= nil, true)

world.npcGUID = "Creature-0-0-0-0-12345-0"
local giver = VoiceOver.Contribute:Capture()
Expect("a creature offering a quest a carried item also starts stays the creature",
    giver:match("\nkind=creature\n") ~= nil and giver:match("\nnpc=12345") ~= nil, true)

world.npcGUID, world.questID = "Item-4372-0-400000033D4D1C15", 9123
local unknown = VoiceOver.Contribute:Capture()
Expect("an item no bag slot starts the quest of names no npc and no kind",
    unknown:match("\nnpc=%d") == nil and unknown:match("\nkind=") == nil, true)
_G.C_Container = nil

------------------------------------------------------------------ a closed window keeps no button
-- Walking away from an NPC closes the gossip window with none of the refresh events, and the
-- client goes on answering GetGossipText with the last words. The button used to stay up,
-- anchored to the hidden frame, floating mid-screen.
SpokenEnv.Addon.db.profile.Contribute.HideButtons = false
stub.HidePanels()
world.npcName, world.npcGUID = "Deathguard Linnea", "Creature-0-0-0-0-12345-0"
stub.ShowGossip("Words nobody has voiced.")
stub.FireEvent("GOSSIP_SHOW")
local lingering = VoiceOver.ContributeButton.button
Expect("the button is up while the gossip window is", lingering:IsShown(), true)

world.panels.GossipFrame = nil -- closed; GetGossipText still answers with the old words
for _, hook in ipairs(_G.GossipFrame.hooks.OnHide or {}) do hook(_G.GossipFrame) end
Expect("closing the window with no event takes the button with it", lingering:IsShown(), false)
stub.FireEvent("QUEST_FINISHED")
Expect("...and no later event brings it back while nothing is open", lingering:IsShown(), false)

---------------------------------------------------------- a body its voice is not
-- A Reveler voiced as a dwarf and drawn as a gnome: its line plays, so nothing is missing, but
-- only its model shows it is a body the site has no voice for. The model is read on the dialog
-- opening, and the button comes up once it is in.
local pack = VoiceOver.DataModules:GetModule("TestPack")
Expect("a pack's version is its .toc Version", VoiceOver.DataModules:GetPackVersion("enUS"), "1.2.1")
Expect("...and a language no pack speaks is \"none\"", VoiceOver.DataModules:GetPackVersion("deDE"), "none")
local HASH = string.rep("b", 32)
pack.SoundLengthLookupByFileName[HASH] = 2
pack.GossipLookupByNPCID = { [15906] = { ["Prosit!"] = HASH } }
pack.NPCBodiesByNPCID = { [15906] = { ["dwarf-male"] = true } }
pack.BodyByModelFileID = { [119159] = "gnome-male", [118355] = "dwarf-male" }
stub.HidePanels()
world.npcName, world.npcGUID = "Ironforge Reveler", "Creature-0-0-0-0-15906-0"
world.modelFileID, world.modelStillLoading, world.unitSex = 119159, true, 2
local bodySetUnits = stub.SetUnitCount()
stub.ShowGossip("Prosit!")
stub.FireEvent("GOSSIP_SHOW")
local bodyButton = VoiceOver.ContributeButton.button
Expect("a voiced line whose model is not in yet offers nothing", bodyButton:IsShown(), false)
Expect("...but its model is asked for, though nothing is missing", stub.SetUnitCount(), bodySetUnits + 1)
Expect("...and kept loading", VoiceOver.NPCModel:IsLoading(), true)
world.modelStillLoading = false
stub.FinishModelLoad()
Expect("drawn as a gnome, the button comes up once the model is in", bodyButton:IsShown(), true)
stub.FireEvent("GOSSIP_SHOW")
Expect("...without loading it again", stub.SetUnitCount(), bodySetUnits + 1)

stub.HidePanels()
world.npcGUID = "Creature-0-0-0-0-15906-1"
world.modelFileID = 118355
stub.ShowGossip("Prosit!")
stub.FireEvent("GOSSIP_SHOW")
stub.FinishModelLoad()
Expect("drawn as a dwarf, the body its voice is, nothing is offered", bodyButton:IsShown(), false)

-- With the buttons hidden and nothing gathered, a creature's body is only worth its model where
-- the model picks the file it plays: a split creature.
SpokenEnv.Addon.db.profile.Contribute.HideButtons = true
stub.HidePanels()
world.npcGUID = "Creature-0-0-0-0-15906-2"
stub.ShowGossip("Prosit!")
local hiddenSetUnits = stub.SetUnitCount()
VoiceOver.Contribute:HasGap()
Expect("buttons hidden, an unsplit creature's model is not read", stub.SetUnitCount(), hiddenSetUnits)
pack.GossipFileLookupByNPCBody = { [15906] = { ["dwarf-male"] = { [HASH] = HASH } } }
VoiceOver.Contribute:HasGap()
Expect("...but a split creature's is", stub.SetUnitCount(), hiddenSetUnits + 1)
stub.FinishModelLoad()
pack.GossipFileLookupByNPCBody = nil
SpokenEnv.Addon.db.profile.Contribute.HideButtons = false
stub.HidePanels()
stub.FireEvent("GOSSIP_CLOSED")

-- A creature whose bodies are listed keeps its load through its dialog closing, so a client
-- that never says the model is in still has the probe put away, within two seconds.
stub.ResetTimers()
local closedGUID = "Creature-0-0-0-0-15906-3"
world.npcGUID = closedGUID
world.modelFileID, world.modelStillLoading = 119159, true
stub.ShowGossip("Prosit!")
stub.FireEvent("GOSSIP_SHOW")
Expect("a listed-body creature's dialog loads its model", VoiceOver.NPCModel:IsLoading(closedGUID), true)
stub.HidePanels()
stub.FireEvent("GOSSIP_CLOSED")
stub.Advance(2.1)
Expect("closed before its model is in, two seconds on nothing is loading",
    VoiceOver.NPCModel:IsLoading(), false)
Expect("...and the probe is put away", stub.playerModel.shown, false)
world.modelStillLoading = false
world.modelFileID = nil

SpokenEnv.Spoken.Gather:SetEnabled(true)

os.exit(Failures() == 0 and 0 or 1)
