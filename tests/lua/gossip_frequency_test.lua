-- The gossip module reads what an NPC says when its window opens, as NPC Greetings decides:
-- whatever the quests module's autoplay is set to. At Never nothing reads itself, and the Listen
-- button on the window is how the player starts it. Run with `make test-player`.
--
-- Both clients, as the quests module's autoplay test: a Blizzard client and the legacy one,
-- which delivers the windows through different events.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local GOSSIP = here .. "/../../addons/Spoken_Gossip/"
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)
local world = stub.world

local function Boot(client)
    stub.SetClient(client); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
    world.questID = 0
    stub.ShowPanel(nil)
    _G.SpokenQuestsSettings, _G.SpokenGossipSettings = nil, nil
    -- Both modules, as a player has them: the quests one's autoplay must not reach gossip.
    local VO = stub.LoadQuests(QUESTS, SPOKEN)
    VO.Addon:OnInitialize()
    local G = stub.LoadGossip(GOSSIP, SPOKEN, true)
    G.Addon:OnInitialize()
    -- By id and by name: the 1.12 client has no GUID for the lookup to key on.
    local lines = { ["We stand ready."] = "gossip-hash", ["Welcome, traveller."] = "greeting-hash" }
    G.DataModules:Register("TestPack", {
        SoundLengthLookupByFileName = { ["gossip-hash"] = 1, ["greeting-hash"] = 1,
            -- Thrall's line, the page's Play a Test Line.
            ["9fdeb82237b72e8801030487901e690f"] = 1 },
        GossipLookupByNPCID = { [12345] = lines },
        GossipLookupByNPCName = { Guard = lines },
        GetSoundPath = function(_, fileName) return fileName .. ".ogg" end,
    })
    world.npcName = "Guard"
    world.npcGUID = "Creature-0-0-0-0-12345-0"
    world.greetingText = "Welcome, traveller."
    -- Wait out the deferred data module load.
    stub.Advance(2)

    local played = {}
    _G.Spoken:RegisterCallback("CLIP_STARTED", function(clip)
        table.insert(played, clip.fileName)
    end)
    return VO, G, played
end

local function Played(played)
    local text = table.concat(played, ", ")
    for i = #played, 1, -1 do played[i] = nil end
    return text ~= "" and text or "(nothing)"
end

local function OpenGossip(text)
    stub.ShowGossip(text)
    stub.FireEvent("GOSSIP_SHOW")
    stub.Advance(1)
end

local function CloseGossip()
    stub.HidePanels()
    stub.FireEvent("GOSSIP_CLOSED")
    stub.Advance(10)
    _G.Spoken:StopAll()
end

local function OpenGreeting()
    world.questID = 0
    stub.ShowPanel("QuestFrameGreetingPanel")
    stub.FireEvent("QUEST_GREETING")
    stub.Advance(1)
end

local function CloseGreeting()
    stub.ShowPanel(nil)
    stub.FireEvent("QUEST_FINISHED")
    stub.Advance(10)
    _G.Spoken:StopAll()
end

for _, client in ipairs({ "11509", "1.12" }) do
    local VO, G, played = Boot(client)
    local button = G.PlayButton.button
    local audio = G.Addon.db.profile.Audio

    Expect(client .. ": NPC Greetings starts at Once per NPC", audio.GossipFrequency, G.Enums.GossipFrequency.OncePerNPC)
    OpenGossip("We stand ready.")
    Expect(client .. ": gossip reads itself", Played(played), "gossip-hash")
    Expect(client .. ": ...with no Listen button on the window", button:IsShown(), false)
    CloseGossip()
    OpenGossip("We stand ready.")
    Expect(client .. ": once per NPC, a second visit reads nothing", Played(played), "(nothing)")
    CloseGossip()

    -- The quests module's autoplay is its own: off, quest windows wait, NPCs still talk.
    VO.Addon:SetAutoplay(false)
    audio.GossipFrequency = G.Enums.GossipFrequency.Always
    OpenGossip("We stand ready.")
    Expect(client .. ": with quests' autoplay off, gossip still reads itself", Played(played), "gossip-hash")
    CloseGossip()
    VO.Addon:SetAutoplay(true)

    -- At Never, nothing reads itself and the window offers Listen instead.
    audio.GossipFrequency = G.Enums.GossipFrequency.Never
    G.Addon:RefreshConfig()
    OpenGossip("We stand ready.")
    Expect(client .. ": at Never, gossip reads nothing", Played(played), "(nothing)")
    Expect(client .. ": ...and the gossip window shows Listen", button:IsShown(), true)
    Expect(client .. ": ...placed on the gossip frame", button.anchor and button.anchor.relativeTo, _G.GossipFrame)
    Expect(client .. ": ...labelled Listen", button:GetText(), _G.SpokenEnv.L.DIALOGUE_LISTEN)
    button:Click()
    stub.Advance(0.2)
    Expect(client .. ": Listen reads it", Played(played), "gossip-hash")
    Expect(client .. ": ...and the button becomes Stop", button:GetText(), _G.SpokenEnv.L.DIALOGUE_STOP)
    CloseGossip()
    Expect(client .. ": closing gossip hides the button", button:IsShown(), false)

    OpenGreeting()
    Expect(client .. ": at Never, a quest giver's greeting reads nothing", Played(played), "(nothing)")
    button:Click()
    stub.Advance(0.2)
    Expect(client .. ": Listen reads the greeting", Played(played), "greeting-hash")
    CloseGreeting()

    -- Picking a quest from the greeting puts its page in the same window, which stays open.
    OpenGreeting()
    Expect(client .. ": at Never, the greeting shows Listen", button:IsShown(), true)
    world.questID = 101
    stub.ShowPanel("QuestFrameDetailPanel")
    stub.FireEvent("QUEST_DETAIL")
    stub.Advance(1)
    Expect(client .. ": ...and picking a quest from it takes Listen off the quest's page", button:IsShown(), false)
    CloseGreeting()

    -- /spg read is the other way in.
    OpenGossip("We stand ready.")
    G.Addon:ReadVisible("/spg read")
    stub.Advance(0.2)
    Expect(client .. ": /spg read reads gossip at Never", Played(played), "gossip-hash")
    CloseGossip()

    -- Stop When Window Closes stops the greeting too, as its window closes.
    audio.GossipFrequency = G.Enums.GossipFrequency.Always
    audio.StopAudioOnDisengage = true
    G.Addon:RefreshConfig()
    OpenGreeting()
    Expect(client .. ": a greeting reads itself at Always", _G.Spoken:GetCurrent() ~= nil, true)
    stub.ShowPanel(nil)
    stub.FireEvent("QUEST_FINISHED")
    stub.Advance(0.1)
    Expect(client .. ": ...and stops as its window closes, under Stop When Window Closes",
        _G.Spoken:GetCurrent(), nil)
    stub.Advance(10)
    Played(played)
    audio.StopAudioOnDisengage = false

    -- Fix a Problem's test line plays through the player, as a real line does.
    Expect(client .. ": Play a Test Line plays Thrall's line", G.Addon:RunSelfTest(), true)
    stub.Advance(0.2)
    Expect(client .. ": ...which is heard", Played(played), "9fdeb82237b72e8801030487901e690f")
    _G.Spoken:StopAll()

    -- Switched off in Spoken's settings, it reads nothing and offers nothing.
    _G.Spoken:SetPartOn("gossip", false)
    OpenGossip("We stand ready.")
    Expect(client .. ": switched off, gossip reads nothing", Played(played), "(nothing)")
    Expect(client .. ": ...and the window has no Listen button", button:IsShown(), false)
    CloseGossip()
    _G.Spoken:SetPartOn("gossip", true)
end

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll gossip frequency tests passed")
