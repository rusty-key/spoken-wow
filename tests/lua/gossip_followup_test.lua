-- How often gossip plays (the Greetings setting): Once per NPC holds back an NPC's greeting
-- after the first time, and nothing past it. A guard's directions are a page the player
-- picked an option to reach, and they went quiet along with the greeting. On the gossip
-- module. Run with `make test-player`.
--
-- Both gossip APIs are covered, because picking an option is noticed through a hook on each:
-- C_GossipInfo.SelectOption on Blizzard's clients and SelectGossipOption on the 1.12 one.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local print = stub.print
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local GOSSIP = here .. "/../../addons/Spoken_Gossip/"
local SPOKEN = here .. "/../../addons/Spoken/"

local world = stub.world
local Expect, Failures = require("queue_helpers").Expecter(print)

local GREETING = "Well met. How can I help?"
local BANK = "Where is the bank?"
local DIRECTIONS = "The bank is past the fountain."

local function Boot(client)
    stub.SetClient(client); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
    world.questID = 0
    stub.HidePanels()
    _G.SpokenQuestsSettings, _G.SpokenGossipSettings = nil, nil
    -- Both modules, as a player has them; gossip is the gossip module's.
    local VO = stub.LoadQuests(QUESTS, SPOKEN)
    VO.Addon:OnInitialize()
    local G = stub.LoadGossip(GOSSIP, SPOKEN, true)
    G.Addon:OnInitialize()
    -- By id and by name: the 1.12 client has no GUID for the lookup to key on.
    local gossip = { [GREETING] = "greeting-hash", [DIRECTIONS] = "directions-hash" }
    G.DataModules:Register("TestPack", {
        SoundLengthLookupByFileName = { ["greeting-hash"] = 1, ["directions-hash"] = 1 },
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
    end)
    return G, played
end

local function Played(played)
    local text = table.concat(played, ", ")
    for i = #played, 1, -1 do played[i] = nil end
    return text ~= "" and text or "(nothing)"
end

local function Talk()
    stub.ShowGossip(GREETING, { BANK })
    stub.FireEvent("GOSSIP_SHOW")
    stub.Advance(1)
end

local function AskForTheBank()
    -- The greeting is cut short, the way a player clicking through it leaves it.
    _G.Spoken:StopAll()
    stub.PickGossipOption(BANK, DIRECTIONS)
    stub.Advance(1)
end

local function Leave()
    stub.HidePanels()
    stub.FireEvent("GOSSIP_CLOSED")
    stub.Advance(10)
    _G.Spoken:StopAll()
end

for _, client in ipairs({ "11509", "1.12" }) do
    local G, played = Boot(client)
    local Frequency = G.Enums.GossipFrequency

    Expect(client .. ": Once per NPC is the default", G.Addon.db.profile.Audio.GossipFrequency,
        Frequency.OncePerNPC)

    Talk()
    Expect(client .. ": the first greeting plays", Played(played), "greeting-hash")
    AskForTheBank()
    Expect(client .. ": ...and so do the directions after it", Played(played), "directions-hash")
    Leave()

    Talk()
    Expect(client .. ": the greeting does not play a second time", Played(played), "(nothing)")
    AskForTheBank()
    Expect(client .. ": ...but the directions asked for still do", Played(played), "directions-hash")
    -- DialogueUI asks after the page is noted as often as before it.
    Expect(client .. ": ...and stay asked for until the window closes",
        G.Addon:ExpectedLine("GOSSIP_SHOW"), DIRECTIONS)
    Leave()

    -- Reopening the dialog is not picking an option: the greeting stays held back.
    Talk()
    Expect(client .. ": a pick on the last visit does not carry over", Played(played), "(nothing)")
    Leave()

    G.Addon.db.profile.Audio.GossipFrequency = Frequency.Never
    Talk()
    AskForTheBank()
    Expect(client .. ": Never keeps the directions quiet too", Played(played), "(nothing)")
    Leave()
end

if Failures() > 0 then
    print(string.format("\n%d scenario(s) failed", Failures()))
    os.exit(1)
end
print("\nall scenarios passed")
