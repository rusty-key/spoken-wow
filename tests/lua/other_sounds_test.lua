-- The game's other sounds turned down while a line is spoken, and back up after
-- (OtherSounds.lua). Run with `make test-player`.
--
-- The volumes are client CVars the game saves with its own settings, so the failures that
-- matter are the ones that leave them changed: a fade that never finishes, a reload or a crash
-- mid-line, or a slider the player moved meanwhile being overwritten when the line ends.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local world = stub.world
local SPOKEN = here .. "/../../addons/Spoken/"

local function Volume(channel) return tonumber(world.cvars["Sound_" .. channel .. "Volume"] or "1") end
local function Near(a, b) return math.abs(a - b) < 0.001 end
local function SetVolumes()
    world.cvars.Sound_MusicVolume, world.cvars.Sound_AmbienceVolume = "0.8", "0.5"
    world.cvars.Sound_SFXVolume, world.cvars.Sound_DialogVolume = "1", "0.6"
end

local env, quests = H.Fresh(stub, SPOKEN)
local O, Q = env.OtherSounds, env.SoundQueue
local audio = env.Addon.db.profile.Audio
local lower = audio.LowerOthers
SetVolumes()

---------------------------------------------------------------- on by default
Expect("available on a current client", O:IsAvailable(), true)
Expect("on from the first install", lower.Enabled, true)
lower.Enabled = false
quests:Enqueue(H.Clip({ length = 5 }))
stub.Advance(2)
Expect("switched off, a line leaves the music alone", Volume("Music"), 0.8)
Q:RemoveAllSoundsFromQueue(); stub.Advance(3)

---------------------------------------------------------------- lowered while speaking
lower.Enabled = true
lower.Music, lower.Ambience, lower.SFX, lower.Dialog = 0.25, 0.5, 1, 0
quests:Enqueue(H.Clip({ length = 5 }))
stub.Advance(0.3)
Expect("the music fades down rather than jumping", Volume("Music") < 0.8 and Volume("Music") > 0.2, true)
stub.Advance(1)
Expect("music settles at its share of the player's own volume", Near(Volume("Music"), 0.2), true)
Expect("...and ambience at its share", Near(Volume("Ambience"), 0.25), true)
Expect("a channel left at 100% is untouched", Near(Volume("SFX"), 1), true)
Expect("one at 0% is silenced", Near(Volume("Dialog"), 0), true)
Expect("the volumes to put back are saved in case the session ends",
    env.Addon.db.global.LoweredVolumes and env.Addon.db.global.LoweredVolumes.Music, 0.8)

-- The gap between two lines is shorter than the wait before the volumes come back, so the
-- music does not pump up and down between them.
quests:Enqueue(H.Clip({ length = 2 }))
Q:Skip()
stub.Advance(0.5)
Expect("the next line keeps the music down", Near(Volume("Music"), 0.2), true)
stub.Advance(6)
Expect("once the queue falls quiet the music comes back", Near(Volume("Music"), 0.8), true)
Expect("...and every other channel with it", Near(Volume("Ambience"), 0.5) and Near(Volume("Dialog"), 0.6), true)
Expect("...and nothing is left to put back", env.Addon.db.global.LoweredVolumes, nil)

---------------------------------------------------------------- pause
quests:Enqueue(H.Clip({ length = 20 }))
stub.Advance(1.5)
Q:PauseQueue()
stub.Advance(2.5)
Expect("pausing lets the game be heard again", Near(Volume("Music"), 0.8), true)
Q:ResumeQueue()
stub.Advance(1.5)
Expect("playing again turns it back down", Near(Volume("Music"), 0.2), true)

---------------------------------------------------------------- changed mid-line
lower.Music = 0.5
O:RefreshConfig()
stub.Advance(1)
Expect("a level moved in the settings applies to the line already speaking", Near(Volume("Music"), 0.4), true)
world.cvars.Sound_MusicVolume = "0.6"
Q:RemoveAllSoundsFromQueue()
stub.Advance(3)
Expect("a volume the player moved in the game's settings is kept", Near(Volume("Music"), 0.6), true)
Expect("...while the others are put back", Near(Volume("Ambience"), 0.5), true)
SetVolumes()

quests:Enqueue(H.Clip({ length = 20 }))
stub.Advance(1.5)
lower.Enabled = false
O:RefreshConfig()
stub.Advance(1)
Expect("switching it off mid-line brings the sound back at once", Near(Volume("Music"), 0.8), true)
Q:RemoveAllSoundsFromQueue(); stub.Advance(3)
lower.Enabled = true

---------------------------------------------------------------- the session ending mid-line
env.Addon.db.global.LoweredVolumes = { Music = 0.9 }
world.cvars.Sound_MusicVolume = "0.2"
stub.FireEvent("PLAYER_LOGIN")
Expect("a session that ended without logging out is put right at the next login", Near(Volume("Music"), 0.9), true)
Expect("...once", env.Addon.db.global.LoweredVolumes, nil)
Expect("nothing went wrong in a callback", #env.Callbacks.errors, 0)
SetVolumes()

quests:Enqueue(H.Clip({ length = 20 }))
stub.Advance(1.5)
stub.Logout()
Expect("a logout or reload mid-line puts the volumes straight back", Near(Volume("Music"), 0.8), true)
Expect("...and forgets the saved copy", env.Addon.db.global.LoweredVolumes, nil)
Q:RemoveAllSoundsFromQueue(); stub.Advance(3)
SetVolumes()

-- AceDB strips every setting still at its default before the addons hear PLAYER_LOGOUT. A
-- player who never touched these levels had nothing left to restore by, and kept them lowered.
_G.SpokenSettings = nil
env, quests = H.Fresh(stub, SPOKEN)
O, Q = env.OtherSounds, env.SoundQueue
-- Back to its default, so nothing in Audio differs from the defaults when AceDB strips them.
env.Addon.db.profile.Audio.LineGap = nil
SetVolumes()
quests:Enqueue(H.Clip({ length = 20 }))
stub.Advance(1.5)
Expect("on its default levels the music is lowered", Near(Volume("Music"), 0.24), true)
stub.Logout()
Expect("...and a logout mid-line still puts it back", Near(Volume("Music"), 0.8), true)
Expect("...with every other channel", Near(Volume("Ambience"), 0.5) and Near(Volume("SFX"), 1), true)
Expect("...though the settings were stripped to nothing", env.Addon.db.profile.Audio, nil)
Expect("...and nothing went wrong in a callback", #env.Callbacks.errors, 0)

---------------------------------------------------------------- the legacy clients
-- 2.4.3 and 3.3.5 speak through the music channel itself.
stub.SetClient("3.3.5")
stub.ResetSound(); stub.ResetTimers()
_G.SpokenSettings = nil
env = stub.LoadSpoken(SPOKEN)
Expect("not offered where speech goes out on the music channel", env.OtherSounds:IsAvailable(), false)

os.exit(Failures() == 0 and 0 or 1)
