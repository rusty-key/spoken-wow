-- The lines an NPC says in chat after a quest: armed by this player's own accept or turn-in,
-- matched exactly, played once. Run with `make test-player`.
--
-- The failure this guards against is the busy zone: the NPC's line reaches everybody standing
-- near it, so a matcher that listened without being armed, or matched loosely, would read
-- every other player's turn-in aloud.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

local SPEAKER = 500
local SPEAKER_GUID = "Creature-0-0-0-0-500-0"
local GOSSIP_HASH = "0123456789abcdef0123456789abcdef"
-- Where a pack built since follow-up lines were recorded ships them: what its GetSoundPath
-- answers for the QuestFollowup event.
local FOLLOWUP_DIR = [[generated\sounds\followup\]]

-- The shape FollowupLines.lua is generated in; a fixture rather than the real export, so a
-- regenerated export cannot change what these scenarios mean.
local FIXTURE = {
    ["end"] = {
        [300] = {
            { id = 1, step = 1, speaker = SPEAKER, delay = 2, chat = "say", male = "Thanks, $n!", female = "Thanks, $n!" },
            { id = 2, step = 2, speaker = SPEAKER, delay = 6, chat = "say",
                male = "Well done.  $GHe : She; is a fine $r $c.", female = "Well done.  $GHe : She; is a fine $r $c." },
        },
        -- A script step picking one of several texts at random: siblings of one step.
        [302] = {
            { id = 10, step = 1, speaker = SPEAKER, delay = 2, chat = "say", male = "Onward!", female = "Onward!" },
            { id = 11, step = 1, speaker = SPEAKER, delay = 2, chat = "say", male = "Forward!", female = "Forward!" },
            { id = 12, step = 2, speaker = SPEAKER, delay = 5, chat = "yell", male = "Victory!", female = "Victory!" },
        },
        -- Scarlet Subterfuge's shape: one creature entry, several of its spawns each saying
        -- their own line in the same second. Separate steps, so every one of them plays.
        [305] = {
            { id = 50, step = 1, speaker = SPEAKER, delay = 0, chat = "say", male = "Sir?", female = "Sir?" },
            { id = 51, step = 2, speaker = SPEAKER, delay = 0, chat = "say", male = "What the...", female = "What the..." },
            { id = 52, step = 3, speaker = SPEAKER, delay = 6, chat = "say", male = "Do something!", female = "Do something!" },
        },
        -- An export from before steps: random siblings are told by speaker and delay alone.
        [306] = {
            { id = 60, speaker = SPEAKER, delay = 2, chat = "say", male = "Onward!", female = "Onward!" },
            { id = 61, speaker = SPEAKER, delay = 2, chat = "say", male = "Forward!", female = "Forward!" },
            { id = 62, speaker = SPEAKER, delay = 5, chat = "yell", male = "Victory!", female = "Victory!" },
        },
        -- Mok'Morokk's shape: a creature's $r, which the server writes with a capital.
        [308] = {
            { id = 80, step = 1, speaker = SPEAKER, delay = 0, chat = "say",
                male = "Puny $r wanna fight Overlord Mok'Morokk?", female = "Puny $r wanna fight Overlord Mok'Morokk?" },
        },
        -- Another speaker, whose line queues behind the turn-in's own voiceover.
        [303] = {
            { id = 20, step = 1, speaker = 777, delay = 0, chat = "say", male = "Done.", female = "Done." },
        },
    },
    ["start"] = {
        [301] = {
            { id = 30, step = 1, speaker = SPEAKER, delay = 1, chat = "say", male = "Go, $n.", female = "Go, $n." },
        },
        -- Lucius's shape: the giver whispers the player a reminder.
        [307] = {
            { id = 70, step = 1, speaker = SPEAKER, delay = 1, chat = "whisper",
                male = "Take the tools, $n.", female = "Take the tools, $n." },
        },
    },
}

local lookup = { [GOSSIP_HASH] = 2 }
for _, q in ipairs({ 300, 301, 302, 303, 305, 306, 307, 308 }) do
    lookup[q .. "-accept"] = 2; lookup[q .. "-complete"] = 2
end

local VO, Spoken

--- A data module in the shape build.py writes. `lookup` is FollowupLookup, `files` the lengths
--- of what the pack actually holds: every pack carries the full lookup, not all the audio.
local function FollowupPack(lookup, files, gossip)
    return {
        FollowupLookup = lookup,
        SoundLengthLookupByFileName = files,
        GossipLookupByNPCID = gossip,
        GetSoundPath = function(_, fileName, event)
            if event == VO.Enums.SoundEvent.QuestFollowup then
                return FOLLOWUP_DIR .. fileName .. ".ogg"
            end
            return fileName .. ".ogg"
        end,
    }
end

-- The pack most scenarios run on: every fixture line recorded as "line-<id>", so the queue
-- key names which line played.
local ALL_LINES = { [SPEAKER] = {}, [777] = {} }
local allFiles = {}
for name, length in pairs(lookup) do allFiles[name] = length end
for _, byQuest in pairs(FIXTURE) do
    for _, lines in pairs(byQuest) do
        for _, line in ipairs(lines) do
            ALL_LINES[line.speaker][line.id] = "line-" .. line.id
            allFiles["line-" .. line.id] = 2
        end
    end
end
local RECORDED_PACK = { folder = "TestPack", module = FollowupPack(ALL_LINES, allFiles) }

-- A pack built before follow-up lines were recorded: no FollowupLookup, so no line has a
-- recording - though the speaker has gossip and the quest its own clips to borrow.
local OLD_PACK = {
    folder = "OldPack",
    module = {
        SoundLengthLookupByFileName = lookup,
        GetSoundPath = function(_, fileName) return fileName .. ".ogg" end,
        GossipLookupByNPCID = { [SPEAKER] = { ["Hail."] = GOSSIP_HASH } },
    },
}

local queued = {}
local booted
--- Load the addon with `packs` installed (default: RECORDED_PACK). Each entry is
--- { folder, language (nil = declares none), module = the data module it registers }.
local function Boot(packs, locale)
    -- The last boot's frames still hear every event this harness fires, and its Followup
    -- would match and play the same chat through its own packs.
    if booted and booted.Followup.frame then
        booted.Followup.frame:UnregisterAllEvents()
    end
    stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()
    stub.ldbObjects = {}; stub.dbIcons = {}
    world.questID = 0; stub.ShowPanel(nil); world.gossipText = nil; world.greetingText = nil
    world.playerName = "Tester"; world.unitSex = 2
    world.playerRace = "Dwarf"; world.playerClass = "Paladin"
    stub.SetLocale(locale or "enUS")
    packs = packs or { RECORDED_PACK }
    local addons = {}
    for _, pack in ipairs(packs) do
        local meta = { ["X-VoiceOver-DataModule-Version"] = "1", Version = "1.2.1", Title = pack.folder }
        if pack.language then meta["X-SpokenQuests-Language"] = pack.language end
        table.insert(addons, { folder = pack.folder, meta = meta })
    end
    stub.SetAddOns(addons)
    -- The saved variables outlive a reload in this harness, so a scenario that changed the
    -- fallback language would otherwise hand it to the next one.
    _G.SpokenQuestsSettings = nil
    local VO, env = stub.LoadQuests(QUESTS, SPOKEN)
    VO.FollowupLines = FIXTURE
    dofile(QUESTS .. "Followup.lua")
    VO.Addon:OnInitialize()
    for _, pack in ipairs(packs) do
        VO.DataModules:Register(pack.folder, pack.module)
    end
    stub.Advance(2)   -- the deferred pack load
    _G.Spoken:RegisterCallback("CLIP_QUEUED", function(clip)
        if clip.source == VO.Player.source then table.insert(queued, clip) end
    end)
    booted = VO
    return VO, _G.Spoken
end

VO, Spoken = Boot()

local function Reset()
    for i = #queued, 1, -1 do queued[i] = nil end
    Spoken:StopAll()
    VO.Followup.armed = {}
    stub.SetLocale("enUS")
    stub.Advance(1)
end

local function Say(text, guid, sender, event)
    stub.FireEvent(event or "CHAT_MSG_MONSTER_SAY", text, sender or "Marshal Test", "", "", "", "", 0, 0, "", 0, 1,
        guid)
end

local function Keys()
    local keys = {}
    for _, clip in ipairs(queued) do table.insert(keys, clip.key) end
    return table.concat(keys, ", ")
end

---------------------------------------------------------------- unarmed
Reset()
Say("Thanks, Tester!", SPEAKER_GUID)
Expect("a line nobody armed is ignored", Keys(), "")
Expect("...and arms nothing", #VO.Followup.armed, 0)

---------------------------------------------------------------- arm, match, consume
Reset()
stub.FireEvent("QUEST_TURNED_IN", 300, 0, 0)
Expect("the player's own turn-in arms the quest's lines", #VO.Followup.armed, 2)
stub.Advance(2)
Say("Thanks, Tester!", SPEAKER_GUID)
Expect("the matching line plays", Keys(), "line-1")
local clip = queued[1]
Expect("...as a follow-up, not a quest or gossip line", clip and clip.event, VO.Enums.SoundEvent.QuestFollowup)
Expect("...at normal priority, so the turn-in's own gossip rule does not drop it", clip and clip.priority, "normal")
Expect("...headed by the NPC who said it", clip and clip.present.header, "Marshal Test")
Expect("...carrying what was said", clip and clip.text, "Thanks, Tester!")
Expect("...on the line's own recording", clip and clip.path,
    [[Interface\AddOns\TestPack\]] .. FOLLOWUP_DIR .. "line-1.ogg")
Expect("...and is consumed", #VO.Followup.armed, 1)
Say("Thanks, Tester!", SPEAKER_GUID)
Expect("the same line said again does not replay", Keys(), "line-1")

-- Double spaces collapsed, gender and race/class tokens filled for this player: $r and $c in
-- lower case, as the client writes them.
Say("Well done. He is a fine dwarf paladin.", SPEAKER_GUID)
Expect("tokens and whitespace are normalised before comparing", Keys(), "line-1, line-2")
Expect("...and nothing is left armed", #VO.Followup.armed, 0)

-- The server writes a creature's $r with a capital; letter case is not compared.
Reset()
stub.FireEvent("QUEST_TURNED_IN", 308, 0, 0)
Say("Puny Dwarf wanna fight Overlord Mok'Morokk?", SPEAKER_GUID)
Expect("a line whose race arrives capitalised still matches", Keys(), "line-80")

---------------------------------------------------------------- another player's turn-in
Reset()
stub.FireEvent("QUEST_TURNED_IN", 300, 0, 0)
Say("Thanks, Someone!", SPEAKER_GUID)
Expect("a line naming another player does not match", Keys(), "")
Expect("...and does not use up ours", #VO.Followup.armed, 2)

---------------------------------------------------------------- the wrong speaker
Say("Thanks, Tester!", "Creature-0-0-0-0-999-0")
Expect("the right words from a different NPC do not match", Keys(), "")
Say("Thanks, Tester!", nil)
Expect("...but a client with no GUID falls back on the text", Keys(), "line-1")

---------------------------------------------------------------- expiry
Reset()
stub.FireEvent("QUEST_TURNED_IN", 300, 0, 0)
stub.Advance(6 + 10 + 1)   -- the last line's delay, the slack, and a second more
Say("Thanks, Tester!", SPEAKER_GUID)
Expect("an armed line expires after its script could have run", Keys(), "")
Expect("...and is dropped", #VO.Followup.armed, 0)

---------------------------------------------------------------- accept
Reset()
stub.FireEvent("QUEST_ACCEPTED", 4, 301)
Say("Go, Tester.", SPEAKER_GUID)
Expect("accepting a quest arms its start lines (Classic's index, questID)", Keys(), "line-30")
Reset()
stub.FireEvent("QUEST_ACCEPTED", 301)
Say("Go, Tester.", SPEAKER_GUID)
Expect("...and mainline's questID alone", Keys(), "line-30")

---------------------------------------------------------------- random-text siblings
Reset()
stub.FireEvent("QUEST_TURNED_IN", 302, 0, 0)
Say("Forward!", SPEAKER_GUID)
Expect("one of a step's random texts plays", Keys(), "line-11")
Expect("...and its siblings at that step are consumed with it", #VO.Followup.armed, 1)
Expect("...leaving the next step", VO.Followup.armed[1] and VO.Followup.armed[1].line.id, 12)

Reset()
stub.SetLocale("deDE")
stub.FireEvent("QUEST_TURNED_IN", 302, 0, 0)
Say("Vorwärts!", SPEAKER_GUID)
Expect("a translated client matches by speaker, earliest step first", Keys(), "line-10")
Say("Sieg!", SPEAKER_GUID, nil, "CHAT_MSG_MONSTER_YELL")
Expect("...and the next line is the next step, not the other random text", Keys(), "line-10, line-12")
Say("Sieg!", SPEAKER_GUID)
Expect("...with nothing after the last one", Keys(), "line-10, line-12")

Reset()
stub.SetLocale("deDE")
stub.FireEvent("QUEST_TURNED_IN", 302, 0, 0)
Say("Vorwärts!", nil)
Expect("a translated client with no speaker to go on plays nothing", Keys(), "")
Say("Vorwärts!", "Creature-0-0-0-0-999-0")
Expect("...nor from a different NPC", Keys(), "")

---------------------------------------------------------------- one speaker, several steps at once
Reset()
stub.FireEvent("QUEST_TURNED_IN", 305, 0, 0)
Say("What the...", SPEAKER_GUID)
Say("Sir?", SPEAKER_GUID)
Expect("two lines from one speaker at one delay are separate steps, and both play", Keys(),
    "line-51, line-50")
Expect("...leaving the step after them", VO.Followup.armed[1] and VO.Followup.armed[1].line.id, 52)

Reset()
stub.SetLocale("deDE")
stub.FireEvent("QUEST_TURNED_IN", 305, 0, 0)
Say("Herr?", SPEAKER_GUID)
Say("Was zum...", SPEAKER_GUID)
Say("Tut etwas!", SPEAKER_GUID)
Expect("a translated client takes them step by step, not one line per delay", Keys(),
    "line-50, line-51, line-52")

---------------------------------------------------------------- whispers
Reset()
stub.FireEvent("CHAT_MSG_MONSTER_WHISPER", "Take the tools, Tester.", "Marshal Test", "", "", "", "", 0, 0, "",
    0, 1, SPEAKER_GUID)
Expect("a whisper nobody armed is ignored, though it was addressed to us", Keys(), "")
stub.FireEvent("QUEST_ACCEPTED", 307)
Say("Take the tools, Tester.", SPEAKER_GUID, nil, "CHAT_MSG_MONSTER_WHISPER")
Expect("an armed whisper matches and plays", Keys(), "line-70")
Expect("...and is consumed", #VO.Followup.armed, 0)

Reset()
stub.FireEvent("QUEST_ACCEPTED", 307)
Say("Take the tools, Tester.", SPEAKER_GUID, nil, "CHAT_MSG_RAID_BOSS_WHISPER")
Expect("...and so does a boss whisper", Keys(), "line-70")

Reset()
VO.Followup:Simulate("307 start")
stub.Advance(1)
Expect("/spq followup replays a whisper as a whisper", Keys(), "line-70")

---------------------------------------------------------------- an export from before steps
Reset()
stub.FireEvent("QUEST_TURNED_IN", 306, 0, 0)
Say("Forward!", SPEAKER_GUID)
Expect("with no steps, one random text plays", Keys(), "line-61")
Expect("...and its siblings are told by speaker and delay", #VO.Followup.armed, 1)
Expect("...leaving the next line", VO.Followup.armed[1] and VO.Followup.armed[1].line.id, 62)

---------------------------------------------------------------- queueing
Reset()
world.questID = 303; world.title = "Test Quest"; world.rewardText = "Done."
stub.ShowPanel("QuestFrameRewardPanel")
VO.Addon:QUEST_COMPLETE()
world.questID = 0; stub.ShowPanel(nil)
stub.FireEvent("QUEST_TURNED_IN", 303, 0, 0)
Say("Done.", "Creature-0-0-0-0-777-0")
Expect("a follow-up queues behind the turn-in's voiceover", Keys(), "303-complete, line-20")

---------------------------------------------------------------- /spq followup
-- The in-game test: arms the quest and replays its chat through the real matcher, one
-- line per random-text group, on the script's own delays.
Reset()
VO.Followup:Simulate("302")
Expect("/spq followup arms the quest", #VO.Followup.armed, 3)
stub.Advance(6)
Expect("...and plays one line per step, not every random alternative", Keys(), "line-10, line-12")

Reset()
VO.Followup:Simulate("305")
stub.Advance(6)
Expect("...and every step of one speaker's at one delay", Keys(), "line-50, line-51, line-52")

---------------------------------------------------------------- switched off
Reset()
VO.Addon.db.profile.Audio.FollowupLines = false
stub.FireEvent("QUEST_TURNED_IN", 300, 0, 0)
Expect("the option off arms nothing", #VO.Followup.armed, 0)
VO.Addon.db.profile.Audio.FollowupLines = true
VO.Addon:SetAutoplay(false)
stub.FireEvent("QUEST_TURNED_IN", 300, 0, 0)
Expect("...nor does autoplay off", #VO.Followup.armed, 0)
VO.Addon:SetAutoplay(true)

---------------------------------------------------------------- no recording
-- A line with no recording is silent: a borrowed clip - the speaker's gossip, the quest's
-- own accept or complete - would say other words in the NPC's voice under this line's text.
for i = #queued, 1, -1 do queued[i] = nil end
VO, Spoken = Boot({ OLD_PACK })
Reset()
stub.FireEvent("QUEST_TURNED_IN", 300, 0, 0)
Say("Thanks, Tester!", SPEAKER_GUID)
Expect("a pack from before follow-up lines plays nothing, not the speaker's gossip", Keys(), "")
Expect("...and says which line had no recording", VO.Debug.runtime.stage, "followup-no-recording")
Expect("...naming it", VO.Debug.runtime.message:find("line 1 ", 1, true) ~= nil, true)
Expect("...and the line is still consumed", #VO.Followup.armed, 1)
Reset()
stub.FireEvent("QUEST_TURNED_IN", 303, 0, 0)
Say("Done.", "Creature-0-0-0-0-777-0")
Expect("...nor the quest's own complete clip", Keys(), "")

Reset()
local said = {}
local addMessage = _G.DEFAULT_CHAT_FRAME.AddMessage
_G.DEFAULT_CHAT_FRAME.AddMessage = function(_, message) table.insert(said, message) end
VO.Followup:Simulate("300")
_G.DEFAULT_CHAT_FRAME.AddMessage = addMessage
stub.Advance(6)
Expect("/spq followup plays nothing for a line with no recording", Keys(), "")
Expect("...and says so beside it", said[1] and said[1]:find("(no recording yet — silent)", 1, true) ~= nil, true)

---------------------------------------------------------------- the line's own recording
-- Each line's file is named by speaker and broadcast text id, and only the pack that holds
-- the audio answers for it.
local STEM = "1-dwarf-male-standard"
local LOOKUP = {
    [SPEAKER] = { [1] = STEM, [2] = "2-dwarf-male-standard", [10] = "10-dwarf-male-standard" },
    -- Line 40 has no speaker in the export; the chat GUID's NPC is the only key there is.
    [888] = { [40] = "40-human-male-standard" },
}
FIXTURE["end"][304] = { { id = 40, delay = 0, chat = "say", male = "Hm.", female = "Hm." } }

for i = #queued, 1, -1 do queued[i] = nil end
VO, Spoken = Boot({ { folder = "NewPack", module = FollowupPack(LOOKUP,
    { [STEM] = 3, ["10-dwarf-male-standard"] = 2, ["40-human-male-standard"] = 1, [GOSSIP_HASH] = 2 },
    { [SPEAKER] = { ["Hail."] = GOSSIP_HASH } }) } })
Reset()
stub.FireEvent("QUEST_TURNED_IN", 300, 0, 0)
Say("Thanks, Tester!", SPEAKER_GUID)
Expect("a pack's FollowupLookup plays the line's own recording", Keys(), STEM)
Expect("...from the pack's follow-up folder", queued[1] and queued[1].path,
    [[Interface\AddOns\NewPack\]] .. FOLLOWUP_DIR .. STEM .. ".ogg")
Expect("...with the pack's length for it", queued[1] and queued[1].length, 3)
Say("Well done. He is a fine dwarf paladin.", SPEAKER_GUID)
Expect("a line the lookup names but the pack has no audio for is silent", Keys(), STEM)
Expect("...and recorded as having no recording", VO.Debug.runtime.stage, "followup-no-recording")

Reset()
stub.FireEvent("QUEST_TURNED_IN", 304, 0, 0)
Say("Hm.", "Creature-0-0-0-0-888-0")
Expect("a line with no speaker in the export is looked up under the chat GUID's NPC", Keys(),
    "40-human-male-standard")

Reset()
VO.Followup:Simulate("302")
stub.Advance(6)
Expect("/spq followup plays the recording where a pack has one, and nothing where not",
    Keys(), "10-dwarf-male-standard")

---------------------------------------------------------------- the player's gender
-- The m-/f- variant is the same one quest lines use, and is preferred when the pack has it.
for i = #queued, 1, -1 do queued[i] = nil end
VO, Spoken = Boot({ { folder = "NewPack", module = FollowupPack(LOOKUP,
    { [STEM] = 3, ["m-" .. STEM] = 4 }) } })
Reset()
stub.FireEvent("QUEST_TURNED_IN", 300, 0, 0)
Say("Thanks, Tester!", SPEAKER_GUID)
Expect("a male player hears the m- variant of a line that has one", queued[1] and queued[1].path,
    [[Interface\AddOns\NewPack\]] .. FOLLOWUP_DIR .. "m-" .. STEM .. ".ogg")
Expect("...at its own length", queued[1] and queued[1].length, 4)
Reset()
world.unitSex = 3
stub.FireEvent("QUEST_TURNED_IN", 300, 0, 0)
Say("Thanks, Tester!", SPEAKER_GUID)
Expect("...and a female player, with no f- variant, the plain file", queued[1] and queued[1].path,
    [[Interface\AddOns\NewPack\]] .. FOLLOWUP_DIR .. STEM .. ".ogg")
world.unitSex = 2

---------------------------------------------------------------- the language order
-- Line 1 is recorded in German and English, line 2 in English alone. A German player hears
-- line 1 in German, and line 2 in English only while English is their fallback.
local LANGUAGE_PACKS = {
    { folder = "EnglishPack", module = FollowupPack(LOOKUP, { [STEM] = 3, ["2-dwarf-male-standard"] = 3 }) },
    { folder = "GermanPack", language = "deDE", module = FollowupPack(LOOKUP, { [STEM] = 5, [GOSSIP_HASH] = 2 },
        { [SPEAKER] = { ["Sei gegrüßt."] = GOSSIP_HASH } }) },
}
for i = #queued, 1, -1 do queued[i] = nil end
VO, Spoken = Boot(LANGUAGE_PACKS, "deDE")
stub.FireEvent("QUEST_TURNED_IN", 300, 0, 0)
Say("Danke, Tester!", SPEAKER_GUID)
Expect("the selected language's pack answers first", queued[1] and queued[1].path,
    [[Interface\AddOns\GermanPack\]] .. FOLLOWUP_DIR .. STEM .. ".ogg")
Say("Gut gemacht.", SPEAKER_GUID)
Expect("...and a line only the fallback language has falls back to it", queued[2] and queued[2].path,
    [[Interface\AddOns\EnglishPack\]] .. FOLLOWUP_DIR .. "2-dwarf-male-standard.ogg")
Expect("...recording the language it was answered in", queued[2] and queued[2].language, "enUS")

for i = #queued, 1, -1 do queued[i] = nil end
VO, Spoken = Boot(LANGUAGE_PACKS, "deDE")
VO.Addon.db.profile.Audio.FallbackLanguage = "none"
stub.FireEvent("QUEST_TURNED_IN", 300, 0, 0)
Say("Danke, Tester!", SPEAKER_GUID)
Say("Gut gemacht.", SPEAKER_GUID)
Expect("with no fallback, the English recording is not played, nor the German gossip in its place",
    Keys(), STEM)
Expect("...and the line is recorded as having no recording", VO.Debug.runtime.stage, "followup-no-recording")

---------------------------------------------------------------- an NPC split by sex
-- A guard drawn as a man or a woman: the woman's file plays while her sex can be read off a
-- unit the player has up, the man's when it cannot.
local SPLIT_PACK = { folder = "SplitPack", module = FollowupPack({ [SPEAKER] = { [1] = "line-1" } },
    { ["line-1"] = 2, ["line-1-f"] = 2 }) }
SPLIT_PACK.module.FollowupLookupByNPCSex = { [SPEAKER] = { [1] = { [2] = "line-1", [3] = "line-1-f" } } }
for i = #queued, 1, -1 do queued[i] = nil end
VO, Spoken = Boot({ SPLIT_PACK })
local npcGUID = world.npcGUID
world.npcGUID = SPEAKER_GUID; world.unitSex = 3
stub.FireEvent("QUEST_TURNED_IN", 300, 0, 0)
Say("Thanks, Tester!", SPEAKER_GUID)
Expect("a split NPC seen as a woman says her own follow-up", Keys(), "line-1-f")
Reset()
world.npcGUID = npcGUID
stub.FireEvent("QUEST_TURNED_IN", 300, 0, 0)
Say("Thanks, Tester!", SPEAKER_GUID)
Expect("...and the man's while no unit tells her sex", Keys(), "line-1")
world.unitSex = 2

---------------------------------------------------------------- an NPC split by body
-- A Reveler drawn as a dwarf or a gnome: the gnome's file plays once its model has loaded, the
-- sex's before.
local BODY_PACK = { folder = "BodyPack", module = FollowupPack({ [SPEAKER] = { [1] = "line-1" } },
    { ["line-1"] = 2, ["line-1-g"] = 2 }) }
BODY_PACK.module.FollowupLookupByNPCSex = { [SPEAKER] = { [1] = { [2] = "line-1" } } }
BODY_PACK.module.FollowupLookupByNPCBody = { [SPEAKER] = { [1] = { ["dwarf-male"] = "line-1", ["gnome-male"] = "line-1-g" } } }
BODY_PACK.module.BodyByModelFileID = { [119159] = "gnome-male" }
for i = #queued, 1, -1 do queued[i] = nil end
VO, Spoken = Boot({ BODY_PACK })
world.npcGUID = SPEAKER_GUID; world.unitSex = 2
stub.FireEvent("QUEST_TURNED_IN", 300, 0, 0)
Say("Thanks, Tester!", SPEAKER_GUID)
Expect("a split speaker whose model is not in says its sex's follow-up", Keys(), "line-1")
Reset()
world.modelFileID = 119159
VO.NPCModel:Prime(SPEAKER_GUID, "npc"); stub.FinishModelLoad()
stub.FireEvent("QUEST_TURNED_IN", 300, 0, 0)
Say("Thanks, Tester!", SPEAKER_GUID)
Expect("a gnome speaker's follow-up is the gnome's file", Keys(), "line-1-g")
world.npcGUID = npcGUID; world.modelFileID = nil

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll quest follow-up tests passed")
