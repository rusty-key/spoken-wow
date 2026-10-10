-- The quests addon speaking through the player, beside the gossip module as a player has them:
-- what a quest or gossip line becomes, the gossip rule expressed as priority across the two, the dialog-channel toggle on the source hooks, the
-- disengage and abandon removals, the easter egg, and the quest-log overlay's play/stop.
-- Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

-- The dialogue core's, shared with the gossip module (Present.lua).
local BOOK = [[Interface\AddOns\Spoken\Textures\Book]]

local lookup = {}
for _, q in ipairs({ 101, 102, 103 }) do
    lookup[q .. "-accept"] = 2; lookup[q .. "-progress"] = 2; lookup[q .. "-complete"] = 2
end
-- A gossip line is content-addressed: md5(text + race + gender). The stub's pack answers
-- one fixed hash for the test NPC's greeting.
local GREETING_HASH = "9fdeb82237b72e8801030487901e690f"
lookup[GREETING_HASH] = 3

-- The gossip module of the boot in hand: what NPCs say is its to read.
local G
local GOSSIP = here .. "/../../addons/Spoken_Gossip/"

local function Boot()
    stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers()
    stub.ldbObjects = {}; stub.dbIcons = {}
    -- The client state the previous scenario left: a quest ID and a visible panel would
    -- have the new addon's 10 Hz watcher queue a line before the scenario starts.
    world.questID = 0; stub.ShowPanel(nil); world.gossipText = nil; world.greetingText = nil
    local VO, env = stub.LoadQuests(QUESTS, SPOKEN)
    VO.Addon:OnInitialize()
    G = stub.LoadGossip(GOSSIP, SPOKEN, true)
    G.Addon:OnInitialize()
    VO.DataModules:Register("TestPack", {
        SoundLengthLookupByFileName = lookup,
        GetSoundPath = function(_, fileName) return fileName .. ".ogg" end,
        GossipLookupByNPCID = { [1234] = { ["Greetings, traveller."] = GREETING_HASH } },
    })
    stub.Advance(2)   -- the deferred pack load
    world.title = "Test Quest"; world.questText = "Go."; world.progressText = "Done?"; world.rewardText = "Done."
    world.npcName = "Innkeeper Test"; world.npcGUID = "Creature-0-0-0-0-1234-0"
    return VO, env, _G.Spoken
end

---------------------------------------------------------------- registration and the clip
local VO, env, Spoken = Boot()
local source = Spoken:GetSource("quests")
Expect("the quests addon registers a source", source ~= nil and source == VO.Player.source, true)
Expect("...probing files before queueing, as it always did", source.testBeforeQueue, true)
Expect("...on the configured channel, as a string", source:GetChannel(), "Master")

world.questID = 101
stub.ShowPanel("QuestFrameDetailPanel")
VO.Addon:QUEST_DETAIL()
local clip = Spoken:GetCurrent()
Expect("QUEST_DETAIL queues the accept line", clip and clip.fileName, "101-accept")
Expect("...keyed on the file name, the old dedup key", clip.key, "101-accept")
Expect("...as a normal-priority clip", clip.priority, "normal")
Expect("...header is the NPC", clip.present.header, "Innkeeper Test")
Expect("...label is the quest title", clip.present.label, "Test Quest")
Expect("...bullet is the accept bullet", clip.present.bullet, "quest-accept")
Expect("...portrait is the NPC's model", clip.present.portrait.kind .. ":" .. tostring(clip.present.portrait.creatureID), "model:1234")
Expect("...with the book as fallback", clip.present.portrait.fallback.texture, BOOK)
Expect("...and the Report action", clip.present.actions[1].id, "report")
Expect("...the original fields survive for the dispatcher", clip.questID .. "/" .. clip.event, "101/1")
Expect("the watcher's stage is recorded", VO.Debug.runtime.stage, "playing")
Expect("the player shows it", env.PlayerFrame.frame.container.name:GetText(), "Innkeeper Test")

---------------------------------------------------------------- a quest from an object or an item
-- A wanted poster's line shows a posted notice, never a captured face (the game paints an object
-- black). A quest from an item shows the item's icon.
VO, env, Spoken = Boot()
local unitExists = _G.UnitExists
_G.UnitExists = function(unit) return unit ~= "npc" and unit ~= "questnpc" end
world.npcGUID = "GameObject-0-0-0-0-5555-0"; world.playerMapID = 1429
world.questID = 102
stub.ShowPanel("QuestFrameDetailPanel")
VO.Addon:QUEST_DETAIL()
local poster = Spoken:GetCurrent()
Expect("a quest from an object shows a posted notice", poster and poster.present.portrait.kind .. ":"
    .. tostring(poster.present.portrait.texture), "texture:" .. [[Interface\Icons\INV_Misc_Note_01]])
Expect("...not a face captured from the object", env.StaticPortrait:Capture(poster), nil)
-- 2.4.3 and 3.3.5 give hex GUIDs: a creature's still has its face, an object's still has none.
do
    local unitGUID, portrait, shown = _G.UnitGUID, _G.SetPortraitTexture, nil
    _G.SetPortraitTexture = function() end
    _G.UnitGUID = function(unit) return unit == "npc" and shown or nil end
    local function Model(guid) return { present = { portrait = { kind = "model", unitGUID = guid } } } end
    shown = "0xF130000B8A000123"
    Expect("a creature's hex GUID still captures its face", env.StaticPortrait:Capture(Model(shown)) ~= nil, true)
    shown = "0xF110000B8A000123"
    Expect("...an object's hex GUID does not", env.StaticPortrait:Capture(Model(shown)), nil)
    -- The subtitle and the Small Window share one texture per face; each takes it back in turn.
    shown = "0xF130000B8A000123"
    local subtitle, small = _G.CreateFrame("Frame"), _G.CreateFrame("Frame")
    env.StaticPortrait:Configure(subtitle, Model(shown))
    env.StaticPortrait:Configure(small, Model(shown))
    env.StaticPortrait:Configure(subtitle, Model(shown))
    Expect("a face shown in the Small Window comes back to the subtitle", subtitle.activeFrame
        and subtitle.activeFrame:GetParent() == subtitle, true)
    _G.UnitGUID, _G.SetPortraitTexture = unitGUID, portrait
end
_G.C_Container = {
    GetContainerNumSlots = function(bag) return bag == 1 and 3 or 0 end,
    GetContainerItemInfo = function(bag, slot) return slot == 2 and { iconFileID = 134939, hyperlink = "|cffffffff|Hitem:1307::|h[Gold Pickup Schedule]|h|r" } or nil end,
    GetContainerItemQuestInfo = function(bag, slot) return { isQuestItem = slot == 2, questID = slot == 2 and 103 or nil } end,
}
world.questID = 103
VO.Addon:QUEST_DETAIL()
local fromItem
for _, queued in ipairs(env.SoundQueue.sounds) do if queued.questID == 103 then fromItem = queued end end
Expect("a quest from an item shows the item's icon", fromItem and fromItem.present.portrait.texture, 134939)
Expect("...the icon found by name too, for a book read from the bags", Spoken:BagItemIcon("Gold Pickup Schedule"), 134939)
_G.C_Container = nil
Expect("a city takes its zone's icon, as an area does", Spoken:ZoneIcon(1455), [[Interface\AddOns\Spoken\Textures\Zones\DunMorogh]])
Expect("...Azeroth the world map's globe", Spoken:ZoneIcon(947), [[Interface\AddOns\Spoken\Textures\Zones\Azeroth]])
Expect("...a Forever zone the icon drawn for it", Spoken:ZoneIcon(2524), [[Interface\AddOns\Spoken\Textures\Zones\DarkspearIslands]])
Expect("...and a map with none, itself or above it, none", Spoken:ZoneIcon(9999), nil)
_G.UnitExists = unitExists
world.npcGUID = "Creature-0-0-0-0-1234-0"; world.playerMapID = nil

---------------------------------------------------------------- gossip yields at the door
VO, env, Spoken = Boot()
world.gossipText = "Greetings, traveller."
G.Addon:GOSSIP_SHOW()
local gossip = Spoken:GetCurrent()
Expect("GOSSIP_SHOW queues the greeting", gossip and gossip.fileName, GREETING_HASH)
Expect("...as low priority", gossip.priority, "low")
Expect("...with the gossip bullet", gossip.present.bullet, "gossip")
world.questID = 102
VO.Addon:QUEST_DETAIL()
Expect("a quest arriving keeps the speaking gossip", Spoken:GetCurrent(), gossip)
Expect("...and queues behind it", Spoken:GetQueue()[2].fileName, "102-accept")
Spoken:StopAll()
world.questID = 103
VO.Addon:QUEST_DETAIL()
G.Addon.db.char.hasSeenGossipForNPC = {}
G.Addon:GOSSIP_SHOW()
Expect("gossip is refused while a quest line is queued", Spoken:GetQueueSize(), 1)
Expect("...and the stage says so", VO.Debug.runtime.stage, "queue-outranked")

---------------------------------------------------------------- the dialog channel
VO, env, Spoken = Boot()
VO.Addon.db.profile.Audio.AutoToggleDialog = true
world.questID = 101
VO.Addon:QUEST_DETAIL()
-- Cut, not faded: the line is read off the NPC's open window, and none of its greeting is heard.
Expect("the first quest clip cuts the NPC's voice as it starts", world.cvars.Sound_EnableDialog, "0")
stub.Advance(0.6)
Expect("...and keeps the dialog channel muted", world.cvars.Sound_EnableDialog, "0")
Spoken:StopAll()
Expect("...and the last leaving restores it", world.cvars.Sound_EnableDialog, "1")

-- The CVar outlives the session and the record of muting it does not: a logout or /reload
-- mid-line has to lift the mute itself, or the next session starts with dialog off.
VO, env, Spoken = Boot()
VO.Addon.db.profile.Audio.AutoToggleDialog = true
world.questID = 101
VO.Addon:QUEST_DETAIL()
stub.Advance(0.6)
Expect("a quest line speaking mutes dialog before the logout", world.cvars.Sound_EnableDialog, "0")
stub.Logout()
Expect("...and logging out mid-line restores it", world.cvars.Sound_EnableDialog, "1")

-- Another addon's clip on the Dialog channel, queued behind a quest line, must be heard:
-- the mute covers a quest line speaking, not the quests source having a backlog.
VO, env, Spoken = Boot()
VO.Addon.db.profile.Audio.AutoToggleDialog = true
local zones = Spoken:RegisterSource("zones", { title = "Zones", addon = "Spoken_Zones", channel = function() return "Dialog" end })
world.questID = 101
VO.Addon:QUEST_DETAIL()
stub.Advance(0.6)
Expect("a quest line speaking mutes dialog", world.cvars.Sound_EnableDialog, "0")
local z = H.Clip()
Expect("a Dialog-channel clip is still admitted behind it", zones:Enqueue(z), z)
world.questID = 102
VO.Addon:QUEST_DETAIL()
Spoken:Skip()
Expect("the zones clip behind it speaks with dialog restored", world.cvars.Sound_EnableDialog, "1")
Spoken:Skip()
stub.Advance(0.6)
Expect("the next quest line mutes it again", world.cvars.Sound_EnableDialog, "0")
Spoken:Skip()
Expect("...and the empty queue restores it", world.cvars.Sound_EnableDialog, "1")

---------------------------------------------------------------- muting the greeting ahead
-- The NPC's greeting starts as its dialog opens; the line is read off the dialog 0.1s (gossip)
-- or 0.4s (quests) later. Muting only when the line started cut the greeting off mid-word, so
-- the mute is taken in the frame the dialog opens.
-- The dialog opening as the client delivers it: to this boot's event frames only, since
-- every earlier boot's frames are still registered with the stub.
-- `module` is the addon whose window it is: quests, or gossip (G).
local function Open(module, event)
    for _, frame in ipairs({ module.Addon.questEventRecorderFrame or false, module.Addon.directEventFrame }) do
        if frame and frame.events[event] then
            frame.scripts.OnEvent(frame, event)
        end
    end
end
local function MuteBoot(autoToggle)
    local VO, env, Spoken = Boot()
    -- The player's setting: the player is what mutes.
    env.Addon.db.profile.Audio.AutoToggleDialog = autoToggle ~= false
    world.cvars.Sound_EnableDialog = "1"
    return VO, env, Spoken
end
VO, env, Spoken = MuteBoot()
stub.ShowGossip("Greetings, traveller.")
Open(G, "GOSSIP_SHOW")
Expect("a voiced NPC's gossip opening mutes it before its line is queued", Spoken:GetQueueSize() == 0 and world.cvars.Sound_EnableDialog, "0")
stub.Advance(0.2)
Expect("...the line is then read", Spoken:GetCurrent() and Spoken:GetCurrent().fileName, GREETING_HASH)
stub.Advance(0.4)
Expect("...under the NPC's voice, still muted", world.cvars.Sound_EnableDialog, "0")
stub.Advance(2)
Expect("...past the mute's own deadline too", world.cvars.Sound_EnableDialog, "0")
Spoken:StopAll()
Expect("...and the empty queue restores it", world.cvars.Sound_EnableDialog, "1")

VO, env, Spoken = MuteBoot()
world.npcGUID = "Creature-0-0-0-0-9999-0"
stub.ShowGossip("Well met.")
Open(G, "GOSSIP_SHOW")
Expect("an NPC no pack voices keeps its greeting", world.cvars.Sound_EnableDialog, "1")

VO, env, Spoken = MuteBoot()
G.Addon.db.char.hasSeenGossipForNPC[world.npcGUID] = true
stub.ShowGossip("Greetings, traveller.")
Open(G, "GOSSIP_SHOW")
Expect("gossip the frequency rule will skip keeps its greeting", world.cvars.Sound_EnableDialog, "1")
-- A page the player picked an option to reach is read whatever the frequency, so the mute is
-- taken for it as for any line that is going to be read.
stub.ShowGossip("Greetings, traveller.", { "Where is the inn?" })
stub.SelectGossipOption("Where is the inn?")
stub.ShowGossip("You are standing in it.")
Open(G, "GOSSIP_SHOW")
Expect("a page reached by an option mutes dialog, greeting heard or not", world.cvars.Sound_EnableDialog, "0")
stub.Advance(3)
Spoken:StopAll()
G.Addon.db.char.hasSeenGossipForNPC = {}   -- saved too

VO, env, Spoken = MuteBoot()
G.Addon.db.profile.Audio.GossipFrequency = G.Enums.GossipFrequency.Never
stub.ShowGossip("Greetings, traveller.")
Open(G, "GOSSIP_SHOW")
Expect("with NPC Greetings at Never nothing is muted", world.cvars.Sound_EnableDialog, "1")
-- Saved with the profile, which the next boot reads.
G.Addon.db.profile.Audio.GossipFrequency = G.Enums.GossipFrequency.OncePerNPC

VO, env, Spoken = MuteBoot()
VO.Addon:SetAutoplay(false)
stub.ShowGossip("Greetings, traveller.")
Open(G, "GOSSIP_SHOW")
Expect("the quests module's autoplay off leaves gossip's mute alone", world.cvars.Sound_EnableDialog, "0")
VO.Addon:SetAutoplay(true)

VO, env, Spoken = MuteBoot(false)
stub.ShowGossip("Greetings, traveller.")
Open(G, "GOSSIP_SHOW")
Expect("with the mute setting off nothing is muted", world.cvars.Sound_EnableDialog, "1")

VO, env, Spoken = MuteBoot()
world.questID = 101
stub.ShowPanel("QuestFrameDetailPanel")
Open(VO, "QUEST_DETAIL")
-- Cut, not faded: a fade lets the first half-second of the greeting through.
Expect("a quest dialog opening cuts the NPC's voice at once", world.cvars.Sound_EnableDialog, "0")
stub.Advance(1.0)
Expect("...and its line is read under the mute", Spoken:GetCurrent() and Spoken:GetCurrent().fileName, "101-accept")
Expect("...still muted", world.cvars.Sound_EnableDialog, "0")

VO, env, Spoken = MuteBoot()
world.questID = 999
Open(VO, "QUEST_DETAIL")
Expect("a quest no pack holds keeps its greeting", world.cvars.Sound_EnableDialog, "1")

---------------------------------------------------------------- disengage and abandon
VO, env, Spoken = Boot()
VO.Addon.db.profile.Audio.StopAudioOnDisengage = true
world.questID = 101
VO.Addon:QUEST_DETAIL()
VO.Addon:QUEST_FINISHED()
Expect("closing the quest frame stops its line when asked to", Spoken:GetQueueSize(), 0)
VO.Addon.db.profile.Audio.StopAudioOnDisengage = false
VO.Addon:QUEST_DETAIL()
VO.Addon:QUEST_FINISHED()
Expect("...and leaves it otherwise", Spoken:GetQueueSize(), 1)

---------------------------------------------------------------- the easter egg
VO, env, Spoken = Boot()
G.Addon.db.profile.Audio.OGThrall = true
world.gossipText = "Greetings, traveller."
G.Addon:GOSSIP_SHOW()
Expect("the easter egg swaps the path before the player sees it", Spoken:GetCurrent().path,
    [[Interface\AddOns\Spoken_Gossip\Sounds\og-thrall.mp3]])
Expect("...and the length", Spoken:GetCurrent().length, 33.802375)

---------------------------------------------------------------- the quest-log overlay
VO, env, Spoken = Boot()
local overlayClip = { event = VO.Enums.SoundEvent.QuestAccept, questID = 101, name = "Giver", title = "Test Quest" }
Expect("Contains is false before", VO.Player:Contains(overlayClip), false)
Expect("Enqueue through the bridge", VO.Player:Enqueue(overlayClip), true)
Expect("Contains is true while queued", VO.Player:Contains(overlayClip), true)
Expect("Remove takes it out", VO.Player:Remove(overlayClip), true)
Expect("...Contains is false again", VO.Player:Contains(overlayClip), false)
Expect("a line no pack holds is refused", VO.Player:Enqueue({ event = VO.Enums.SoundEvent.QuestAccept, questID = 999, name = "x", title = "x" }), false)
Expect("...and the stage says so", VO.Debug.runtime.stage, "data-lookup-failed")

---------------------------------------------------------------- the minimap and settings
VO, env, Spoken = Boot()
local labels = {}
for _, entry in ipairs(env.Minimap:BuildMenu()) do table.insert(labels, entry.text) end
Expect("the quests and gossip addons add their entries to the one button", table.concat(labels, "|"),
    "Stop or Replay|Stop All|Settings|Quests Settings|Gossip Settings")
Expect("...and register no button of their own", stub.ldbObjects.SpokenQuests == nil and stub.ldbObjects.SpokenGossip == nil, true)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll quests source tests passed")
