-- How often gossip plays (the Greetings setting): Once per Greeting holds back each of an NPC's
-- greetings after the first time, and nothing past it. A guard's directions are a page the player
-- picked an option to reach, and they went quiet along with the greeting (issue #166).
-- Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local print = stub.print
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local SPOKEN = here .. "/../../addons/Spoken/"

local world = stub.world
local Expect, Failures = require("queue_helpers").Expecter(print)

local GREETING = "Well met. How can I help?"
local BANK = "Where is the bank?"
local DIRECTIONS = "The bank is past the fountain."
local OTHER = "Keep your blade sharp, friend."
-- The option picked to reach the page of the clip that started last.
local lastTitle

local function Boot(client)
    stub.SetClient(client); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
    world.questID = 0
    stub.HidePanels()
    _G.SpokenQuestsSettings = nil
    local VO = stub.LoadQuests(QUESTS, SPOKEN)
    dofile(QUESTS .. "UI/DialogPlayButton.lua")
    VO.Addon:OnInitialize()
    local gossip = { [GREETING] = "greeting-hash", [DIRECTIONS] = "directions-hash", [OTHER] = "other-hash" }
    VO.DataModules:Register("TestPack", {
        SoundLengthLookupByFileName = { ["greeting-hash"] = 1, ["directions-hash"] = 1, ["other-hash"] = 1,
            ["101-accept"] = 1 },
        GossipLookupByNPCID = { [12345] = gossip },
        GossipLookupByNPCName = { Guard = gossip },
        GetSoundPath = function(_, fileName) return fileName .. ".ogg" end,
    })
    world.npcName = "Guard"
    world.npcGUID = "Creature-0-0-0-0-12345-0"
    stub.Advance(2)   -- the deferred pack load

    local played = {}
    _G.Spoken:RegisterCallback("CLIP_STARTED", function(clip)
        table.insert(played, clip.fileName)
        lastTitle = clip.title
    end)
    return VO, played
end

local function Played(played)
    local text = table.concat(played, ", ")
    for i = #played, 1, -1 do played[i] = nil end
    return text ~= "" and text or "(nothing)"
end

local function Talk(text)
    stub.ShowGossip(text or GREETING, { BANK })
    stub.FireEvent("GOSSIP_SHOW")
    stub.Advance(1)
end

local function AskForTheBank(byIndex)
    -- The greeting is cut short, the way a player clicking through it leaves it.
    _G.Spoken:StopAll()
    stub.PickGossipOption(BANK, DIRECTIONS, byIndex)
    stub.Advance(1)
end

local function Leave()
    stub.HidePanels()
    stub.FireEvent("GOSSIP_CLOSED")
    stub.Advance(10)
    _G.Spoken:StopAll()
end

for _, client in ipairs({ "11509", "16001" }) do
    local VO, played = Boot(client)
    local Frequency = VO.Enums.GossipFrequency

    Expect(client .. ": Once for Quest Givers is the default", VO.Addon.db.profile.Audio.GossipFrequency,
        Frequency.OncePerQuestNPC)
    VO.Addon.db.profile.Audio.GossipFrequency = Frequency.OncePerNPC

    -- An NPC marked heard before greetings were told apart counts as never heard.
    VO.Addon.db.char.hasSeenGossipForNPC[world.npcGUID] = true

    Talk()
    Expect(client .. ": the first greeting plays", Played(played), "greeting-hash")
    AskForTheBank()
    Expect(client .. ": ...and so do the directions after it", Played(played), "directions-hash")
    Leave()

    Talk()
    Expect(client .. ": the greeting does not play a second time", Played(played), "(nothing)")
    AskForTheBank()
    Expect(client .. ": ...but the directions asked for still do", Played(played), "directions-hash")
    Leave()

    -- Reopening the dialog is not picking an option: the greeting stays held back.
    Talk()
    Expect(client .. ": a pick on the last visit does not carry over", Played(played), "(nothing)")
    Leave()

    -- The same NPC greeting with another of its lines reads that one, once.
    Talk(OTHER)
    Expect(client .. ": another greeting from the same NPC plays", Played(played), "other-hash")
    Leave()
    Talk(OTHER)
    Expect(client .. ": ...but only the first time", Played(played), "(nothing)")
    Leave()
    Talk()
    Expect(client .. ": ...and the first greeting is still held back", Played(played), "(nothing)")
    Leave()

    -- DialogueUI picks an option by its index, not its id.
    if _G.C_GossipInfo then
        Talk()
        AskForTheBank(true)
        Expect(client .. ": an option picked by index leads to its directions too", Played(played), "directions-hash")
        Expect(client .. ": ...labelled with the option", lastTitle, '"' .. BANK .. '"')
        Leave()
    end

    VO.Addon.db.profile.Audio.GossipFrequency = Frequency.Never
    Talk()
    AskForTheBank()
    Expect(client .. ": Never keeps the directions quiet too", Played(played), "(nothing)")
    Leave()

    -- At Never nothing reads itself and the NPC windows offer Listen instead.
    local button = VO.DialogPlayButton.button
    VO.Addon.db.profile.Audio.GossipFrequency = Frequency.Never
    Talk()
    Expect(client .. ": at Never, gossip reads nothing", Played(played), "(nothing)")
    Expect(client .. ": ...and the gossip window shows Listen", button:IsShown(), true)
    button:Click()
    stub.Advance(0.2)
    Expect(client .. ": Listen reads it", Played(played), "greeting-hash")
    Leave()
    Expect(client .. ": closing the window hides the button", button:IsShown(), false)
    -- Quest windows are not held back by Read Greetings.
    world.questID = 101
    stub.ShowPanel("QuestFrameDetailPanel")
    stub.FireEvent("QUEST_DETAIL")
    stub.Advance(0.3)
    Expect(client .. ": ...and a quest window shows no Listen at Never", button:IsShown(), false)
    stub.HidePanels()
    stub.FireEvent("QUEST_FINISHED")
    stub.Advance(10)
    Played(played)
    -- Picking a quest from the page moves to the quest's window, and Listen does not stay on it.
    Talk()
    Expect(client .. ": a gossip window at Never shows Listen again", button:IsShown(), true)
    stub.HidePanels()
    world.questID = 101
    stub.ShowPanel("QuestFrameDetailPanel")
    stub.FireEvent("QUEST_DETAIL")
    stub.Advance(0.3)
    Expect(client .. ": ...but not once a quest is picked from it", button:IsShown(), false)
    stub.HidePanels()
    stub.FireEvent("QUEST_FINISHED")
    stub.Advance(10)
    world.questID = 0
    Played(played)
    -- With the part off there is no button either.
    _G.Spoken:SetPartOn("gossip", false)
    Talk()
    Expect(client .. ": with Gossip off, no Listen at Never", button:IsShown(), false)
    Leave()
    _G.Spoken:SetPartOn("gossip", true)

    -- Stop When Window Closes stops a quest giver's greeting too, as its quest frame closes.
    VO.Addon.db.profile.Audio.GossipFrequency = Frequency.Always
    VO.Addon.db.profile.Audio.StopAudioOnDisengage = true
    world.questID = 0
    world.greetingText = GREETING
    stub.ShowPanel("QuestFrameGreetingPanel")
    stub.FireEvent("QUEST_GREETING")
    stub.Advance(0.3)
    Expect(client .. ": a greeting reads itself at Always", _G.Spoken:GetCurrent() ~= nil, true)
    stub.ShowPanel(nil)
    stub.FireEvent("QUEST_FINISHED")
    stub.Advance(0.1)
    Expect(client .. ": ...and stops as its window closes, under Stop When Window Closes",
        _G.Spoken:GetCurrent(), nil)
    stub.Advance(10)
    Played(played)
    VO.Addon.db.profile.Audio.StopAudioOnDisengage = false
end

if Failures() > 0 then
    print(string.format("\n%d scenario(s) failed", Failures()))
    os.exit(1)
end
print("\nall scenarios passed")
