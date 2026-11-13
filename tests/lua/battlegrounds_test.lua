-- Read in Battlegrounds: on by default; off, nothing a module queues is read in a battleground
-- or arena, what was queued before the loading screen goes, and a Play clicked by hand still
-- plays. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local world = stub.world
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(stub.print)

local instanceType = "none"
_G.IsInInstance = function() return instanceType ~= "none", instanceType end

local env, quests, places, Q
local function Fresh()
    instanceType = "none"
    -- Each load reads the same saved variables: a fresh one starts from the defaults.
    _G.SpokenSettings = nil
    env, quests, places = H.Fresh(stub, SPOKEN)
    Q = env.SoundQueue
end
local function Setting(on) env.Addon.db.profile.Audio.ReadInBattlegrounds = on end

---------------------------------------------------------------- on by default
Fresh()
Expect("Read in Battlegrounds is on by default", env.Addon.db.profile.Audio.ReadInBattlegrounds, true)
instanceType = "pvp"
Expect("on, a battleground's line is queued", quests:Enqueue(H.Clip()) ~= nil, true)
Expect("...and Spoken reads there", _G.Spoken:ReadsHere(), true)

---------------------------------------------------------------- off: battlegrounds and arenas are quiet
for _, kind in ipairs({ "pvp", "arena" }) do
    Fresh()
    Setting(false)
    instanceType = kind
    local added, why = places:Enqueue(H.Clip())
    Expect("off, a line in a " .. kind .. " instance is refused", added, nil)
    Expect("...with the reason for the debug log", why, "Read in Battlegrounds is off")
    Expect("...nothing is queued", Q:GetQueueSize(), 0)
    Expect("...nothing plays", world.played[1], nil)
    Expect("...and Spoken does not read there", _G.Spoken:ReadsHere(), false)
end

Fresh()
Setting(false)
instanceType = "party"
Expect("off, a dungeon still reads", quests:Enqueue(H.Clip()) ~= nil, true)
instanceType = "none"
Expect("...and so does the open world", quests:Enqueue(H.Clip()) ~= nil, true)

---------------------------------------------------------------- off: Play by hand still plays
Fresh()
Setting(false)
instanceType = "pvp"
local clicked = H.Clip()
Expect("a Play clicked by hand in a battleground plays", quests:PlayNow(clicked), true)
Expect("...the clip it was given", world.played[1], clicked.path)

---------------------------------------------------------------- off: arriving empties the queue
Fresh()
env.Addon:Enable()
Setting(false)
quests:Enqueue(H.Clip()); quests:Enqueue(H.Clip())
Expect("two lines queued outside", Q:GetQueueSize(), 2)
stub.FireEvent("PLAYER_ENTERING_WORLD")
Expect("entering the world outside a battleground keeps them", Q:GetQueueSize(), 2)
instanceType = "pvp"
stub.FireEvent("PLAYER_ENTERING_WORLD")
Expect("entering a battleground with the setting off empties the queue", Q:GetQueueSize(), 0)

Fresh()
env.Addon:Enable()
quests:Enqueue(H.Clip())
instanceType = "pvp"
stub.FireEvent("PLAYER_ENTERING_WORLD")
Expect("with the setting on, entering a battleground keeps the queue", Q:GetQueueSize(), 1)

---------------------------------------------------------------- the row on Spoken's page
local function Row(layout, label)
    for _, entry in ipairs(layout.entries) do
        if entry.label == label then return entry.frame end
    end
end
local row = Row(_G.SpokenOptionsPanel.layout, env.L.OPT_READ_IN_BATTLEGROUNDS)
Expect("Spoken's page has a Read in Battlegrounds row", row ~= nil, true)
Expect("...labelled as the setting is named", env.L.OPT_READ_IN_BATTLEGROUNDS, "Read in Battlegrounds")
if row then
    quests:Enqueue(H.Clip())
    row:SetChecked(false)
    row.scripts.OnClick(row)
    Expect("unticking it turns the setting off", env.Addon.db.profile.Audio.ReadInBattlegrounds, false)
    Expect("...and in a battleground stops what was queued", Q:GetQueueSize(), 0)
    row:SetChecked(true)
    row.scripts.OnClick(row)
    Expect("ticking it turns the setting back on", env.Addon.db.profile.Audio.ReadInBattlegrounds, true)
end

---------------------------------------------------------------- off: what the player asks for is read
-- Only what Spoken starts by itself is refused; a line the player asks for (a command, a
-- Compendium shift-click, a test line) is queued in a battleground too.
Fresh()
Setting(false)
instanceType = "pvp"
local asked = H.Clip()
Expect("off, a line the player asked for is queued in a battleground", quests:Enqueue(asked, true) ~= nil, true)
Expect("...and plays", world.played[1], asked.path)

local QUESTS = here .. "/../../addons/Spoken_Quests/"
local READABLES = here .. "/../../addons/Spoken_Readables/"

local function BootModules()
    stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
    instanceType = "none"
    world.questID = 0
    stub.ShowPanel(nil)
    _G.SpokenSettings, _G.SpokenQuestsSettings = nil, nil
    local VO = stub.LoadQuests(QUESTS, SPOKEN)
    VO.Addon:OnInitialize()
    local lines = { ["We stand ready."] = "gossip-hash" }
    VO.DataModules:Register("TestPack", {
        -- Long enough to be still in the queue when it is counted.
        SoundLengthLookupByFileName = { ["101-accept"] = 10, ["gossip-hash"] = 10 },
        GossipLookupByNPCID = { [12345] = lines },
        GetSoundPath = function(_, fileName) return fileName .. ".ogg" end,
    })
    world.title, world.questText = "Test Quest", "Go and do the thing."
    world.npcName, world.npcGUID = "Guard", "Creature-0-0-0-0-12345-0"
    stub.Advance(2)
    _G.SpokenEnv.Addon.db.profile.Audio.ReadInBattlegrounds = false
    instanceType = "pvp"
    return VO
end
local function Queued() return _G.Spoken:GetQueueSize() end
local function Clear() _G.Spoken:StopAll(); stub.Advance(1) end

local VO = BootModules()
_G.SpokenEnv.Addon.db.profile.Audio.AutoToggleDialog = true
world.cvars.Sound_EnableDialog = "1"
world.questID = 101
stub.ShowPanel("QuestFrameDetailPanel")
_G.QuestFrameDetailPanel:Show()
stub.FireEvent("QUEST_DETAIL")
Expect("off, a quest window in a battleground keeps the NPC's greeting", world.cvars.Sound_EnableDialog, "1")
Expect("...and expects no line to hold the words back for", VO.Addon:ExpectedLine("QUEST_DETAIL"), nil)
stub.Advance(3)
Expect("off, a quest window opened in a battleground reads nothing by itself", Queued(), 0)
VO.Addon:ReadVisibleQuest("/spq read")
Expect("...and /spq read reads it", Queued(), 1)
Clear()
local soundData = { event = VO.Enums.SoundEvent.QuestAccept, questID = 101, name = "Guard", title = "Test Quest" }
Expect("a quest line queued by hand from the Compendium is queued", VO.Player:Enqueue(soundData, true), true)
Clear()
world.questID = 0
stub.ShowPanel(nil)
stub.FireEvent("QUEST_FINISHED")
stub.Advance(3)

stub.ShowGossip("We stand ready.")
stub.FireEvent("GOSSIP_SHOW")
Expect("off, gossip in a battleground keeps the NPC's greeting", world.cvars.Sound_EnableDialog, "1")
Expect("...and expects no line to hold the words back for", VO.Addon:ExpectedLine("GOSSIP_SHOW"), nil)
stub.Advance(1)
Expect("off, gossip opened in a battleground reads nothing by itself", Queued(), 0)
VO.Addon:ReadVisibleQuest("/spq read")
Expect("...and /spq read reads it", Queued(), 1)
Clear()
stub.HidePanels()
stub.FireEvent("GOSSIP_CLOSED")

-- A book: opening one reads it by itself; /spw read is the player asking.
stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
instanceType = "none"
_G.SpokenSettings, _G.SpokenReadablesSettings = nil, nil
stub.LoadSpoken(SPOKEN).Addon:Enable()
local B = {}
for _, file in ipairs({ "Locale/enUS", "Checksum", "Core", "Language", "Reader", "Audio", "Playlist", "Events" }) do
    assert(loadfile(READABLES .. file .. ".lua"))("Spoken_Readables", B)
end
B:InitDB()
B:SetupSource()
dofile(READABLES .. "Data/Books.lua")
_G.SpokenReadablesAudioPacks = { SpokenReadablesAudio = { version = 1, addon = "SpokenReadablesAudio", language = "enUS",
    pages = { [261] = { file = "261", len = 30 } } } }
_G.SpokenEnv.Addon.db.profile.Audio.ReadInBattlegrounds = false
instanceType = "pvp"
stub.ShowPage({ title = "Hillsbrad Town Registry", number = 1, text = "Hillsbrad Town Registry\n\nWe the people of Hillsbrad do solemny swear our faith and devotion to the Alliance maintained by the great monarchs, King Magni Bronzebeard of Ironforge and King Anduin Wrynn of Stormwind.\n\nHerein lies the town registry for purposes of governing this fair city in the foothills of the great Alterac Mountains as well as serving as a record of those who have paid their taxes to their Kings and to the great almighty Alliance." })
Expect("off, a book opened in a battleground reads nothing by itself", B:OnTextReady(), 0)
Expect("...and /spw read reads it", B:ReadCurrent() > 0, true)
stub.ClosePage()

_G.IsInInstance = nil
local failures = Failures()
if failures > 0 then
    stub.print(string.format("\n%d failure(s)", failures))
    os.exit(1)
end
stub.print("\nall battlegrounds tests passed")
