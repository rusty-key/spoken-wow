-- Game Greeting First: the NPC's own greeting is not cut as its window opens, and what Spoken
-- reads off that window waits until the greeting has been spoken. The greeting is found among the
-- game's sounds by its volume (Master x Dialog); where it cannot be, the line waits 1.5 seconds.
-- A setting of Spoken's (GreetingFirst.lua), for every source that reads NPCs; quests here.
-- Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local QUESTS = here .. "/../../addons/Spoken_Quests/"
local SPOKEN = here .. "/../../addons/Spoken/"
local world = stub.world

-- The game's sounds: each handle plays until a time, at a volume of its own or, an NPC's voice,
-- at Master x Dialog as the sliders are now.
local sounds, nextHandle = {}, 1000
local function Sound(volume, seconds)
    nextHandle = nextHandle + 1
    sounds[nextHandle] = { volume = volume, ends = world.time + seconds }
    return nextHandle
end
local function Voice(seconds)
    return Sound("dialog", seconds)
end
_G.C_Sound = {
    PlaySoundWithOptions = function(options) return true, Sound(options.volumeOverride or 1, 0.5) end,
    IsPlaying = function(handle) return sounds[handle] ~= nil and world.time < sounds[handle].ends end,
    GetSoundScaledVolume = function(handle)
        local sound = sounds[handle]
        if sound and sound.volume == "dialog" then
            return tonumber(world.cvars.Sound_MasterVolume) * tonumber(world.cvars.Sound_DialogVolume)
        end
        return sound and sound.volume
    end,
}
local stopSound = _G.StopSound
_G.StopSound = function(handle, ...)
    if sounds[handle] then sounds[handle].ends = world.time end
    return stopSound(handle, ...)
end

stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
_G.SpokenQuestsSettings = nil
local VO = stub.LoadQuests(QUESTS, SPOKEN)
VO.Addon:OnInitialize()
VO.DataModules:Register("TestPack", {
    SoundLengthLookupByFileName = { ["101-accept"] = 3, ["102-accept"] = 3, ["103-accept"] = 3,
        ["104-accept"] = 3, ["105-accept"] = 3, ["106-accept"] = 3 },
    GetSoundPath = function(_, fileName) return fileName .. ".ogg" end,
})
stub.Advance(2)
local Spoken = _G.Spoken
_G.SpokenEnv.Addon.db.profile.Audio.AutoToggleDialog = true
-- The other sliders stay where they are set: lowered under a line, they would not be the levels
-- Dialog is compared with.
_G.SpokenEnv.Addon.db.profile.Audio.LowerOthers.Enabled = false
_G.SpokenEnv.Addon.db.profile.Audio.GreetingFirst = true
world.npcName, world.npcGUID = "Skorn Whitecloud", "Creature-0-0-0-0-3052-0"
world.title, world.questText = "Test Quest", "Go."
for cvar, value in pairs({ Sound_MasterVolume = "1", Sound_DialogVolume = "0.8", Sound_SFXVolume = "1",
    Sound_MusicVolume = "0.5", Sound_AmbienceVolume = "0.6" }) do
    world.cvars[cvar] = value
end

-- Each window a quest of its own: a quest already read is not read again.
local quest = 100
-- Speaking, not just queued: a queued line is also played and stopped at once, as a probe.
local function Played()
    local current = Spoken:GetCurrent()
    return Spoken:IsPlaying() and current ~= nil and current.fileName == quest .. "-accept"
end
-- The NPC greets as its quest window opens.
local function OpenQuest(greeting)
    if greeting then Voice(greeting) end
    quest = quest + 1
    world.questID = quest
    stub.ShowPanel("QuestFrameDetailPanel")
    stub.FireEvent("QUEST_DETAIL")
end
local function Close()
    stub.HidePanels()
    stub.FireEvent("QUEST_FINISHED")
    stub.Advance(1)
    Spoken:StopAll()
end

OpenQuest(1.2)
Expect("the NPC's greeting is not cut as its window opens", GetCVar("Sound_EnableDialog"), "1")
stub.Advance(0.8)
local clip = Spoken:GetCurrent()
Expect("the quest's line is queued", clip and clip.fileName, "101-accept")
Expect("...and waits while the NPC speaks", Played(), false)
Expect("...saying why", clip and Spoken:GetHeldReason(clip), _G.SpokenEnv.L.QUEUE_HELD_GREETING)
stub.Advance(0.5)
Expect("it starts once the greeting is over", Played(), true)
Expect("...and fades the NPC out rather than cutting it", GetCVar("Sound_EnableDialog"), "1")
stub.Advance(0.6)
Expect("...silent once the fade is over", GetCVar("Sound_EnableDialog"), "0")
Close()

-- Gossip, then a quest picked from it: the NPC greeted once, as the gossip opened.
Voice(0.3)
stub.ShowGossip("Well met.")
stub.FireEvent("GOSSIP_SHOW")
stub.Advance(1)
stub.HidePanels()
stub.FireEvent("GOSSIP_CLOSED")
OpenQuest(nil)
stub.Advance(0.6)
Expect("a quest picked from the gossip does not wait again", Played(), true)
Close()

-- An NPC that says nothing: a short look for a voice, then the fixed wait.
OpenQuest(nil)
stub.Advance(1.2)
Expect("with no greeting heard the line waits 1.5 seconds", Played(), false)
stub.Advance(0.5)
Expect("...and then starts", Played(), true)
Close()

-- The Dialog slider at the same level as another: Spoken moves it 1% so the voice can be told apart.
world.cvars.Sound_DialogVolume = "1"
OpenQuest(2.5)
Expect("with Dialog at SFX's level Spoken moves it 1% apart", world.cvars.Sound_DialogVolume, "0.99")
stub.Advance(2.3)
Expect("...and waits for a long greeting to the end", Played(), false)
stub.Advance(0.5)
Expect("...then starts", Played(), true)
Close()
world.cvars.Sound_DialogVolume = "1"
_G.SpokenEnv.GreetingFirst:SetDialogApart()
Expect("...and does so as the setting is turned on too", world.cvars.Sound_DialogVolume, "0.99")
-- 100% is Master's own level: a sound on the Master channel plays at Master x 1, as the voice would.
world.cvars.Sound_DialogVolume, world.cvars.Sound_SFXVolume = "1", "0.7"
_G.SpokenEnv.GreetingFirst:SetDialogApart()
Expect("Dialog at 100% is moved to 99% though no other slider is there", world.cvars.Sound_DialogVolume, "0.99")
world.cvars.Sound_DialogVolume = "0.8"
_G.SpokenEnv.GreetingFirst:SetDialogApart()
Expect("...and at 80%, apart from them all, it is left alone", world.cvars.Sound_DialogVolume, "0.8")
world.cvars.Sound_SFXVolume = "1"
world.cvars.Sound_DialogVolume = "0.8"

-- The game's dialogue switched off: there is nothing to wait for.
world.cvars.Sound_EnableDialog = "0"
OpenQuest(nil)
stub.Advance(0.6)
Expect("with the game's dialogue off the line does not wait", Played(), true)
Close()
world.cvars.Sound_EnableDialog = "1"

-- Off, the quest window silences the NPC as it opens, and the line cuts the NPC.
_G.SpokenEnv.Addon.db.profile.Audio.GreetingFirst = false
OpenQuest(1.2)
Expect("turned off, the quest window silences the NPC as it opens", GetCVar("Sound_EnableDialog"), "0")
Close()

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll Game Greeting First tests passed")
