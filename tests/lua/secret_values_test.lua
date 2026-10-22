-- The game's secret values (#357): in an instance or in combat the Forever client hands addons some
-- values their code cannot index, compare or join. Every place Spoken reads one from the game asks
-- Spoken.NotSecret first, and a secret is skipped as a missing value is: no error, no line. Each
-- scenario hands the same read a secret, then the plain value, so the second half shows the first
-- was skipped and not merely broken. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local SPOKEN = here .. "/../../addons/Spoken/"
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local ZONES = here .. "/../../addons/Spoken_Places/"
local BOOKS = here .. "/../../addons/Spoken_Readables/"
local Expect, Failures = H.Expecter(print)

--- Runs fn, and answers true or the error it raised.
local function Quietly(fn, ...)
    local ok, err = pcall(fn, ...)
    return ok or tostring(err)
end

---------------------------------------------------------------- the helper
stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
local env = stub.LoadSpoken(SPOKEN)
local NotSecret = _G.Spoken.NotSecret
Expect("without issecretvalue, a value is itself", NotSecret("Guard"), "Guard")
stub.Secrets("Guard")
Expect("a secret reads as nil", NotSecret("Guard"), nil)
Expect("...and any other value as itself", NotSecret("Thrall"), "Thrall")
Expect("...nil included", NotSecret(nil), nil)
Expect("indexing a secret here throws, as the client's does", pcall(string.len, "x") and not pcall(function()
    return ("Guard"):len()
end), true)
stub.Secrets()
Expect("Spoken's own environment has the same helper", rawget(env, "NotSecret"), NotSecret)
local quests = stub.LoadQuests(QUESTS, SPOKEN)
Expect("so does the Quests addon's", rawget(quests, "NotSecret"), _G.Spoken.NotSecret)

---------------------------------------------------------------- quests and gossip
local QUEST_TEXT, TITLE = "Go and do the thing.", "Test Quest"
local GUARD, GUARD_GUID = "Guard", "Creature-0-0-0-0-12345-0"
local GOSSIP_TEXT, GREETING = "We stand ready.", "Welcome, traveller."

local function Boot()
    stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
    world.questID = 0
    stub.ShowPanel(nil)
    _G.SpokenQuestsSettings = nil
    local VO = stub.LoadQuests(QUESTS, SPOKEN)
    VO.FollowupLines = { ["end"] = { [300] = {
        { id = 1, step = 1, speaker = 12345, delay = 2, chat = "say", male = "Thanks!", female = "Thanks!" },
    } } }
    dofile(QUESTS .. "Followup.lua")
    VO.Addon:OnInitialize()
    local lines = { [GOSSIP_TEXT] = "gossip-hash", [GREETING] = "greeting-hash" }
    VO.DataModules:Register("TestPack", {
        SoundLengthLookupByFileName = { ["101-accept"] = 1, ["gossip-hash"] = 1, ["greeting-hash"] = 1 },
        GossipLookupByNPCID = { [12345] = lines },
        GossipLookupByNPCName = { [GUARD] = lines },
        GetSoundPath = function(_, fileName) return fileName .. ".ogg" end,
    })
    world.title, world.questText = TITLE, QUEST_TEXT
    world.npcName, world.npcGUID = GUARD, GUARD_GUID
    world.greetingText = GREETING
    stub.Advance(2)
    local played, stages = {}, {}
    _G.Spoken:RegisterCallback("CLIP_STARTED", function(clip) table.insert(played, clip) end)
    local record = VO.Debug.Record
    VO.Debug.Record = function(self, stage, message)
        table.insert(stages, stage)
        return record(self, stage, message)
    end
    return VO, played, stages
end

local function Played(played)
    local names = {}
    for _, clip in ipairs(played) do table.insert(names, clip.fileName) end
    for i = #played, 1, -1 do played[i] = nil end
    return #names > 0 and table.concat(names, ", ") or "(nothing)"
end

local function Errors(stages)
    local found = {}
    for _, stage in ipairs(stages) do
        if stage:find("error", 1, true) then table.insert(found, stage) end
    end
    for i = #stages, 1, -1 do stages[i] = nil end
    return #found > 0 and table.concat(found, ", ") or "none"
end

local function OpenQuest()
    world.questID = 101
    stub.ShowPanel("QuestFrameDetailPanel")
    _G.QuestFrameDetailPanel:Show()
    stub.FireEvent("QUEST_DETAIL")
    stub.Advance(3)
end

local function CloseQuest()
    world.questID = 0
    stub.ShowPanel(nil)
    stub.FireEvent("QUEST_FINISHED")
    stub.Advance(3)
    _G.Spoken:StopAll()
end

local function OpenGossip(text, options)
    stub.ShowGossip(text, options)
    stub.FireEvent("GOSSIP_SHOW")
    stub.Advance(1)
end

local function CloseGossip()
    stub.HidePanels()
    stub.FireEvent("GOSSIP_CLOSED")
    stub.Advance(3)
    _G.Spoken:StopAll()
end

local VO, played, stages = Boot()

-- A quest window whose every value is secret: its id, title, words and who offers it.
stub.Secrets(101, TITLE, QUEST_TEXT, GUARD, GUARD_GUID)
Expect("a quest window of secrets raises no error", Quietly(OpenQuest), true)
Expect("...reads nothing", Played(played), "(nothing)")
Expect("...and records no error", Errors(stages), "none")
Expect("...through the window's own Contribute either", Quietly(function()
    Expect("...which has nothing to send", VO.Contribute:Capture(), nil)
end), true)
Expect("...nor through its Report button", Quietly(function()
    Expect("...which names no quest", VO.ReportButton:CurrentTarget(), nil)
end), true)
Quietly(CloseQuest)
stub.Secrets()
OpenQuest()
Expect("the same window, not secret, is read", Played(played), "101-accept")
Expect("...and has something to send", VO.Contribute:Capture() ~= nil, true)
CloseQuest()

-- The NPC the window belongs to.
stub.Secrets(GUARD, GUARD_GUID)
Expect("a secret NPC name is no name", VO.Utils:GetNPCName(), nil)
Expect("...a secret GUID no GUID", VO.Utils:GetNPCGUID(), nil)
Expect("...and no unit shows the sex of a GUID that is secret", VO.Utils:GetSexForGUID(GUARD_GUID), nil)
stub.Secrets()
Expect("not secret, the name is read", VO.Utils:GetNPCName(), GUARD)
Expect("...and the sex", VO.Utils:GetSexForGUID(GUARD_GUID), world.unitSex)

local getGUIDType, parsedGUIDs = VO.Utils.GetGUIDType, 0
VO.Utils.GetGUIDType = function(self, guid)
    parsedGUIDs = parsedGUIDs + 1
    return getGUIDType(self, guid)
end
stub.Secrets(GUARD_GUID)
Expect("a secret GUID has no creature id", VO.Utils:GetCreatureIDFromGUID(GUARD_GUID), nil)
Expect("...and never reaches the GUID parser", parsedGUIDs, 0)
Expect("targeting a unit with a secret GUID raises no error", Quietly(stub.FireEvent, "PLAYER_TARGET_CHANGED"), true)
Expect("pointing at a unit with a secret GUID raises no error", Quietly(stub.FireEvent, "UPDATE_MOUSEOVER_UNIT"), true)
Expect("...neither event parses the secret GUID", parsedGUIDs, 0)
stub.Secrets()
VO.Utils.GetGUIDType = getGUIDType
Expect("the same GUID, not secret, still names its creature", VO.Utils:GetCreatureIDFromGUID(GUARD_GUID), 12345)
Expect("an empty GUID still names no creature", VO.Utils:GetCreatureIDFromGUID(""), nil)
Expect("a missing GUID still names no creature", VO.Utils:GetCreatureIDFromGUID(nil), nil)

-- Gossip and greeting text.
stub.Secrets(GOSSIP_TEXT)
Expect("secret gossip text raises no error", Quietly(OpenGossip, GOSSIP_TEXT), true)
Expect("...reads nothing", Played(played), "(nothing)")
Expect("...and records no error", Errors(stages), "none")
Quietly(CloseGossip)
stub.Secrets(GUARD, GUARD_GUID)
Expect("gossip from an NPC whose name and GUID are secret raises no error", Quietly(OpenGossip, GOSSIP_TEXT), true)
Expect("...reads nothing", Played(played), "(nothing)")
Quietly(CloseGossip)
stub.Secrets()
OpenGossip(GOSSIP_TEXT)
Expect("the same gossip, not secret, is read", Played(played), "gossip-hash")
CloseGossip()

local function OpenGreeting()
    stub.ShowPanel("QuestFrameGreetingPanel")
    _G.QuestFrameGreetingPanel:Show()
    stub.FireEvent("QUEST_GREETING")
    stub.Advance(1)
end
VO, played, stages = Boot()
stub.Secrets(GREETING)
Expect("a secret greeting raises no error", Quietly(OpenGreeting), true)
Expect("...reads nothing", Played(played), "(nothing)")
Quietly(CloseQuest)
stub.Secrets()
OpenGreeting()
Expect("the same greeting, not secret, is read", Played(played), "greeting-hash")
CloseQuest()

-- The option picked to reach a page, which labels its line.
VO, played, stages = Boot()
OpenGossip("Hail.", { "Tell me more" })
local optionID = 1001
stub.Secrets(optionID)
Expect("a secret gossip option raises no error", Quietly(_G.C_GossipInfo.SelectOption, optionID), true)
stub.Secrets()
OpenGossip(GOSSIP_TEXT)
local clip = played[#played]
Expect("...the page it led to is read", clip and clip.fileName, "gossip-hash")
Expect("...without a label it cannot know", clip and clip.title, nil)
Played(played)
CloseGossip()
OpenGossip("Hail.", { "Tell me more" })
_G.C_GossipInfo.SelectOption(optionID)
OpenGossip(GOSSIP_TEXT)
clip = played[#played]
Expect("not secret, the option labels the page's line", clip and clip.title, '"Tell me more"')
CloseGossip()

-- The NPC's chat after a turn-in, which the server sends as secrets in a dungeon.
VO, played, stages = Boot()
local function Say(text, guid)
    stub.FireEvent("CHAT_MSG_MONSTER_SAY", text, GUARD, "", "", "", "", 0, 0, "", 0, 0, guid)
end
stub.Secrets(300)
Expect("a secret quest id from a turn-in raises no error", Quietly(stub.FireEvent, "QUEST_TURNED_IN", 300, 0, 0), true)
Expect("...and arms nothing", #VO.Followup.armed, 0)
stub.Secrets()
stub.FireEvent("QUEST_TURNED_IN", 300, 0, 0)
Expect("not secret, the turn-in arms its line", #VO.Followup.armed, 1)
stub.Secrets("Thanks!")
Expect("a secret chat line raises no error", Quietly(Say, "Thanks!", GUARD_GUID), true)
Expect("...and is not taken for the armed line", #VO.Followup.armed, 1)
stub.Secrets(GUARD_GUID, GUARD)
Expect("a line whose sender and GUID are secret raises no error", Quietly(Say, "Thanks!", GUARD_GUID), true)
Expect("...and is matched on its words alone", #VO.Followup.armed, 0)
stub.Secrets()
Expect("...with no error recorded", Errors(stages), "none")

-- A portrait refreshed for a unit whose GUID is secret, with a line from that NPC queued.
OpenGossip(GOSSIP_TEXT)
stub.Secrets(GUARD_GUID, "target")
Expect("a portrait update for a secret unit raises no error",
    Quietly(stub.FireEvent, "UNIT_PORTRAIT_UPDATE", "target"), true)
stub.Secrets()
CloseGossip()
Expect("nothing went wrong in a callback", #_G.SpokenEnv.Callbacks.errors, 0)

---------------------------------------------------------------- zones
local function BootZones()
    stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
    world.inCombat = false
    world.playerLevel = 1
    _G.SpokenZonesSettings = nil
    _G.SpokenZonesCharacter = {}
    _G.SpokenZonesAudioPacks = {
        SpokenZonesAudio = { version = 1, addon = "SpokenZonesAudio", language = "enUS",
            zones = { [1411] = { file = "1411\\zone", len = 80 } },
            subzones = { [1411] = { ["valley of trials"] = { file = "1411\\valley", len = 35 } } } },
    }
    local zenv = stub.LoadSpoken(SPOKEN)
    zenv.Addon:Enable()
    local Z = H.LoadZones(ZONES)
    assert(loadfile(ZONES .. "Locale/enUS.lua"))("Spoken_Places", Z)
    assert(loadfile(ZONES .. "Autoplay.lua"))("Spoken_Places", Z)
    Z.Zones[1411] = { name = "Durotar", full = "Durotar lore." }
    Z.Subzones[1411] = { ["valley of trials"] = { name = "Valley of Trials", full = "Valley lore." } }
    stub.SetZone({ map = 1411, zone = "Durotar", subzone = "Valley of Trials" })
    stub.FireEvent("ADDON_LOADED", "Spoken_Places")
    Z:SetupAudio()
    return Z
end

local Z = BootZones()
stub.Secrets(1411)
Expect("a secret map is no map", Z:GetPlayerMapID(), nil)
stub.Secrets()
Expect("...and a plain one is the map", Z:GetPlayerMapID(), 1411)

-- The login greeting reads the subzone, which a secret leaves unknown: it waits, and says nothing.
Z:Set("debug", true)
stub.Secrets("Valley of Trials")
Expect("a secret subzone raises no error in the login greeting", Quietly(function()
    Z:SetupAutoplay()
    stub.Advance(3)
end), true)
Expect("...which reads nothing", _G.Spoken:GetQueueSize(), 0)
Expect("...and does not count as greeted", _G.SpokenZonesCharacter.greeted, nil)
stub.Secrets()
stub.Advance(3)
Expect("the subzone no longer secret, the greeting reads it", _G.Spoken:GetQueueSize(), 1)

-- The discovery message, as #357 reported it from Shadowfang Keep.
Z = BootZones()
_G.SpokenZonesCharacter.greeted = true
assert(loadfile(ZONES .. "Autoplay.lua"))("Spoken_Places", Z)
Z:SetupAutoplay()
stub.Secrets("Discovered Durotar.")
Expect("a secret discovery message raises no error",
    Quietly(stub.FireEvent, "CHAT_MSG_SYSTEM", "Discovered Durotar.", "", "Common", ""), true)
Expect("...and discovers nothing", _G.Spoken:GetQueueSize(), 0)
stub.Secrets()
stub.FireEvent("CHAT_MSG_SYSTEM", "Discovered Durotar.")
Expect("not secret, it discovers the zone", _G.Spoken:GetQueueSize(), 1)

---------------------------------------------------------------- writings
stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
_G.SpokenBooksSettings = nil
stub.LoadSpoken(SPOKEN).Addon:Enable()
local B = {}
for _, file in ipairs({ "Locale/enUS", "Checksum", "Core", "Language", "Reader", "Audio", "Contribute" }) do
    assert(loadfile(BOOKS .. file .. ".lua"))("Spoken_Readables", B)
end
B:InitDB()
B:SetupSource()
dofile(BOOKS .. "Data/Books.lua")
local REGISTRY_1 = "Hillsbrad Town Registry\n\nWe the people of Hillsbrad do solemny swear our faith and devotion to the Alliance maintained by the great monarchs, King Magni Bronzebeard of Ironforge and King Anduin Wrynn of Stormwind.\n\nHerein lies the town registry for purposes of governing this fair city in the foothills of the great Alterac Mountains as well as serving as a record of those who have paid their taxes to their Kings and to the great almighty Alliance."
stub.ShowPage({ title = "Hillsbrad Town Registry", number = 1, text = REGISTRY_1 })
stub.Secrets(REGISTRY_1, "Hillsbrad Town Registry")
Expect("a secret page raises no error", Quietly(function()
    Expect("...is no page Spoken knows", B:PageOnScreen(), nil)
    Expect("...has nothing to send", B:CaptureContribution(), nil)
    Expect("...and its material is still asked", B:PageMaterial(nil) ~= false, true)
end), true)
stub.Secrets()
Expect("the same page, not secret, is found", B:PageOnScreen(), 261)
stub.ShowPage({ title = "A letter", number = 1, text = REGISTRY_1, creator = "Somebody" })
stub.Secrets("Somebody")
Expect("a letter whose writer is secret raises no error", Quietly(B.IsMail, B), true)
stub.Secrets()
Expect("...and not secret, it is mail", B:IsMail(), true)
stub.ClosePage()

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll secret value tests passed")
