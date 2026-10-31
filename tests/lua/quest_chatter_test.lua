-- What NPCs say out loud in the world: matched by speaker and exact text, played as low priority by
-- the World Chatter part, not repeated for two minutes. Run with `make test-player`.
--
-- The failure this guards against is the busy world: guards and townsfolk talk all the time, so a
-- matcher that was loose, or played over what is being read, or repeated a line, would be the
-- addon talking constantly.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

local SPEAKER = 600
local SPEAKER_GUID = "Creature-0-0-0-0-600-0"
local LONE = 601
local LONE_GUID = "Creature-0-0-0-0-601-0"
local SCRIPTED = 602
local TWIN_A, TWIN_B = 603, 604
local SCRIPTED_GUID = "Creature-0-0-0-0-602-0"
local FOLLOWUP_DIR = [[generated\sounds\followup\]]

-- The shape ChatterLines.lua is generated in; a fixture rather than the real export.
local FIXTURE = {
    [SPEAKER] = {
        name = "Madame Test",
        { id = 101, text = "I sense evil brewing. . . ." },
        { id = 102, text = "Welcome, $n!" },
        { id = 103, text = "Nobody recorded this one." },
    },
    [LONE] = {
        name = "Lone Test",
        { id = 110, text = "Only line." },
    },
    [TWIN_A] = { name = "Twin Guard", { id = 130, text = "Halt!" } },
    [TWIN_B] = { name = "Twin Guard", { id = 131, text = "Halt!" } },
    [SCRIPTED] = {
        name = "Scripted Test",
        { id = 120, text = "Here goes nothing..." },
    },
}

local PACK = {
    folder = "TestPack",
    module = {
        FollowupLookup = { [SPEAKER] = { [101] = "chat-101", [102] = "chat-102" }, [LONE] = { [110] = "chat-110" },
            [SCRIPTED] = { [120] = "chat-120" }, [TWIN_B] = { [131] = "chat-131" } },
        SoundLengthLookupByFileName = { ["chat-101"] = 2, ["chat-102"] = 2, ["chat-110"] = 2, ["chat-120"] = 2,
            ["chat-131"] = 2 },
        GetSoundPath = function(_, fileName)
            return FOLLOWUP_DIR .. fileName .. ".ogg"
        end,
    },
}

local queued = {}
local VO, Spoken
local function Boot(locale)
    stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()
    stub.ldbObjects = {}; stub.dbIcons = {}
    world.questID = 0; stub.ShowPanel(nil); world.gossipText = nil; world.greetingText = nil
    world.playerName = "Tester"; world.unitSex = 2
    world.playerRace = "Dwarf"; world.playerClass = "Paladin"
    stub.SetLocale(locale or "enUS")
    stub.SetAddOns({ { folder = PACK.folder, meta = { ["X-VoiceOver-DataModule-Version"] = "1", Version = "1.2.1", Title = PACK.folder } } })
    _G.SpokenQuestsSettings = nil
    local vo = stub.LoadQuests(QUESTS, SPOKEN)
    vo.FollowupLines = { ["end"] = { [114] = { { id = 120, step = 1, speaker = SCRIPTED, delay = 2, chat = "say",
        male = "Here goes nothing..." } } }, start = {} }
    vo.ChatterLines = FIXTURE
    dofile(QUESTS .. "Followup.lua")
    dofile(QUESTS .. "Chatter.lua")
    vo.Addon:OnInitialize()
    vo.DataModules:Register(PACK.folder, PACK.module)
    stub.Advance(2)
    _G.Spoken:RegisterCallback("CLIP_QUEUED", function(clip)
        if clip.source == vo.Player.chatterSource then table.insert(queued, clip) end
    end)
    return vo, _G.Spoken
end

VO, Spoken = Boot()

local function Reset()
    for i = #queued, 1, -1 do queued[i] = nil end
    Spoken:StopAll()
    VO.Chatter.heard = {}
    stub.SetLocale("enUS")
    stub.Advance(1)
end

local function Say(text, guid, sender, event)
    stub.FireEvent(event or "CHAT_MSG_MONSTER_SAY", text, sender or "Madame Test", "", "", "", "", 0, 0, "", 0, 1, guid)
end

local function Keys()
    local keys = {}
    for _, clip in ipairs(queued) do table.insert(keys, clip.key) end
    return table.concat(keys, ", ")
end

---------------------------------------------------------------- the part
local chatter = Spoken:GetSource("chatter")
Expect("NPC chat is a part of Spoken's own", chatter ~= nil and chatter == VO.Player.chatterSource, true)
Expect("...switched on by default", VO.Addon:IsPartOn("chatter"), true)
Expect("...with its own icon on Spoken's page", chatter and chatter.icon, [[Interface\Icons\Spell_Shadow_PsychicHorrors]])
Expect("...whose words the narrator never shows, the game's chat bubble does", Spoken:ShowsNarratorFor("chatter"), false)
Expect("...while the words of Quests are shown", Spoken:ShowsNarratorFor("quests"), true)

---------------------------------------------------------------- match and play
Reset()
Say("Somebody else's words.", SPEAKER_GUID)
Expect("chat that is none of the speaker's lines plays nothing", Keys(), "")
Say("I sense evil brewing. . . .", "Creature-0-0-0-0-999-0")
Expect("...nor do the right words from an NPC with no lines", Keys(), "")
Say("I sense evil brewing. . . .", SPEAKER_GUID)
Expect("the speaker's line plays", Keys(), "chat-101")
local clip = queued[1]
Expect("...as NPC chat, not a quest or gossip line", clip and clip.event, VO.Enums.SoundEvent.NPCChatter)
Expect("...in the World Chatter part", clip and clip.source, chatter)
Expect("...at low priority, so it waits for what is being read", clip and clip.priority, "low")
Expect("...headed by the NPC who said it", clip and clip.present.header, "Madame Test")
Expect("...on the line's own recording", clip and clip.path, [[Interface\AddOns\TestPack\]] .. FOLLOWUP_DIR .. "chat-101.ogg")
Expect("...without cutting the NPC's own voice", clip and clip.cutsGameDialogue, false)

-- Whitespace collapsed, case ignored, tokens filled for this player.
Reset()
Say("i  sense   EVIL brewing. . . .", SPEAKER_GUID)
Expect("whitespace and letter case are not compared", Keys(), "chat-101")
Reset()
Say("Welcome, Tester!", SPEAKER_GUID)
Expect("a line naming the player matches when it names this player", Keys(), "chat-102")
Reset()
Say("Welcome, Someone!", SPEAKER_GUID)
Expect("...and not when it names another", Keys(), "")

-- Yell, whisper and the boss whisper arrive as their own events.
for _, event in ipairs({ "CHAT_MSG_MONSTER_YELL", "CHAT_MSG_MONSTER_WHISPER", "CHAT_MSG_RAID_BOSS_WHISPER" }) do
    Reset()
    Say("I sense evil brewing. . . .", SPEAKER_GUID, nil, event)
    Expect(event .. " is heard too", Keys(), "chat-101")
end

-- Two entries can share a name and a line: only one of them may have a recording.
Reset()
Say("Halt!", nil, "Twin Guard")
Expect("of two NPCs of one name saying the same words, the one with a recording is told", Keys(), "chat-131")

-- A line a quest's script makes the NPC say belongs to Followup.lua, which plays it for the player's
-- own quest: said after somebody else's turn-in, it is not this player's to hear.
Reset()
Say("Here goes nothing...", SCRIPTED_GUID)
Expect("a line a quest script makes an NPC say is not played by World Chatter", Keys(), "")
Say("Here goes nothing...", nil, "Scripted Test")
Expect("...whether or not the event names the speaker", Keys(), "")
Reset()
stub.SetLocale("deDE")
Say("Hier geht's los...", SCRIPTED_GUID)
Expect("...nor on a client in another language", Keys(), "")

---------------------------------------------------------------- not repeated
Reset()
Say("I sense evil brewing. . . .", SPEAKER_GUID)
Spoken:StopAll(); for i = #queued, 1, -1 do queued[i] = nil end
stub.Advance(60)
Say("I sense evil brewing. . . .", SPEAKER_GUID)
Expect("the same line again within two minutes does not replay", Keys(), "")
stub.Advance(61)
Say("I sense evil brewing. . . .", SPEAKER_GUID)
Expect("...and does after them", Keys(), "chat-101")

-- Heard when it starts to play, not when it is queued: a line dropped before it was read was never heard.
Reset()
Say("I sense evil brewing. . . .", SPEAKER_GUID)
Say("Welcome, Tester!", SPEAKER_GUID)
Expect("a line queued behind the one speaking is not held against the next time", VO.Chatter.heard[SPEAKER .. ":102"], nil)
Spoken:GetSource("quests"):Enqueue({ key = "reading", path = [[Interface\AddOns\TestPack\reading.ogg]], length = 8, priority = "normal" })
Spoken:StopAll()
Say("Welcome, Tester!", SPEAKER_GUID)
Expect("...so when a quest line has dropped it, it plays when said again", Keys(), "chat-101, chat-102, chat-102")

-- A busy hub talks all the time: the lines waiting behind the one speaking are few.
Reset()
for i = 1, 8 do
    chatter:Enqueue({ key = "crowd-" .. i, path = [[Interface\AddOns\TestPack\crowd.ogg]], length = 8, priority = "low" })
end
Expect("lines pile up behind the one speaking only to a limit", Spoken:GetQueueSize(), 4)

-- Stopped, a chat line waits like any other, but says nothing about the narrator it never had.
Reset()
stub.FireEvent("PLAYER_LOGIN")
local said = {}
local realPrint = _G.print
_G.print = function(text) table.insert(said, text) end
Spoken:Pause()
Say("I sense evil brewing. . . .", SPEAKER_GUID)
_G.print = realPrint
Spoken:Resume()
Expect("a chat line queued behind Stop is held", Keys(), "chat-101")
Expect("...without the reminder about a narrator that is not there to show it", #said, 0)

---------------------------------------------------------------- waits for what is being read
Reset()
Spoken:GetSource("quests"):Enqueue({ key = "reading", path = [[Interface\AddOns\TestPack\reading.ogg]], length = 8, priority = "normal" })
Say("I sense evil brewing. . . .", SPEAKER_GUID)
Expect("chat does not play over a line being read", Keys(), "")
Expect("...and is not held against the next time", VO.Chatter.heard[SPEAKER .. ":101"], nil)

---------------------------------------------------------------- no recording
Reset()
Say("Nobody recorded this one.", SPEAKER_GUID)
Expect("a line with no recording is silent", Keys(), "")
Expect("...and says which line had no recording", VO.Debug.runtime.stage, "chatter-no-recording")
Expect("...naming it", VO.Debug.runtime.message:find("line 103 ", 1, true) ~= nil, true)

---------------------------------------------------------------- off, and secret values
Reset()
VO.Addon.db.profile.Audio.Autoplay = false
Say("I sense evil brewing. . . .", SPEAKER_GUID)
VO.Addon.db.profile.Audio.Autoplay = true
Expect("Read Automatically is the quest window's: chat plays with it off", Keys(), "chat-101")
Reset()
Spoken:SetPartOn("chatter", false)
Say("I sense evil brewing. . . .", SPEAKER_GUID)
Expect("with World Chatter off, nothing plays", Keys(), "")
Spoken:SetPartOn("chatter", true)
stub.Secrets("I sense evil brewing. . . .")
Say("I sense evil brewing. . . .", SPEAKER_GUID)
stub.Secrets()
Expect("a message the client hides is not matched", Keys(), "")
stub.Secrets(SPEAKER_GUID)
Say("I sense evil brewing. . . .", SPEAKER_GUID)
stub.Secrets()
Expect("...but a speaker's GUID it hides leaves the name to go by", Keys(), "chat-101")
Reset()
Say("I sense evil brewing. . . .", nil)
Expect("with no GUID the speaker is found by the name in the event", Keys(), "chat-101")
Reset()
Say("I sense evil brewing. . . .", nil, "Somebody Else")
Expect("...and a line from a speaker of another name is nobody's", Keys(), "")
Reset()
Say("Somebody else's words.", nil)
Expect("...and the right name with other words is not matched", Keys(), "")
Reset()
stub.SetLocale("deDE")
Say("Ich spuere, dass etwas Boeses braut.", nil)
Expect("...nor on a client in another language, where the name is translated", Keys(), "")
Reset()
stub.SetLocale("deDE")
Say("Eine ganz andere Zeile.", nil, "Lone Test")
Expect("...even for an NPC with a single line, whose name might be the same in both", Keys(), "")

---------------------------------------------------------------- another language
Reset()
stub.SetLocale("deDE")
Say("Eine ganz andere Zeile.", LONE_GUID)
Expect("on a client in another language not even an NPC with a single line is told: it says more than it", Keys(), "")

---------------------------------------------------------------- /spq chatter
Reset()
local printed = {}
local addMessage = _G.DEFAULT_CHAT_FRAME.AddMessage
_G.DEFAULT_CHAT_FRAME.AddMessage = function(_, text) table.insert(printed, text) end
local unitExists = _G.UnitExists
_G.UnitExists = function() return false end
VO.Chatter:Simulate("")
_G.UnitExists = unitExists
Expect("/spq chatter with no NPC and no target says how to use it", printed[1] and printed[1]:find("usage", 1, true) ~= nil, true)
printed = {}
VO.Chatter:Simulate("12345")
Expect("...and an NPC with no lines says so", printed[1] and printed[1]:find("has no lines", 1, true) ~= nil, true)
printed = {}
VO.Chatter:Simulate(tostring(SPEAKER))
Expect("an NPC's lines are listed", #printed, 3)
Expect("...marking the one with no recording", printed[3] and printed[3]:find("no recording yet", 1, true) ~= nil, true)
Expect("...and not the ones with one", printed[1] and printed[1]:find("no recording yet", 1, true) == nil, true)
stub.Advance(1)
Expect("the first line is replayed through the real path at once", Keys(), "chat-101")
stub.Advance(3)
Expect("...and the next three seconds on", Keys(), "chat-101, chat-102")
_G.DEFAULT_CHAT_FRAME.AddMessage = addMessage

if Failures() > 0 then os.exit(1) end
