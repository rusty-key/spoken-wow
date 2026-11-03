-- The bottom of the player's playback stack: whether sound can be heard, and starting and
-- stopping one file. Run with `make test-player`.
--
-- The audibility predicate is VoiceOverRedux's (it checks volumes, and Master bypasses the
-- per-channel toggles) with SpokenPlaces' player-facing reasons.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local print = stub.print
local world = stub.world
local SPOKEN = here .. "/../../addons/Spoken/"

local failures = 0
local function Expect(scenario, actual, expected)
    if actual == expected then
        print(string.format("ok   %s", scenario))
    else
        failures = failures + 1
        print(string.format("FAIL %s\n     expected: %s\n     actual:   %s", scenario,
            tostring(expected), tostring(actual)))
    end
end

---------------------------------------------------------------- a current client
stub.SetClient("16001")
stub.ResetSound()
local env = stub.LoadSpoken(SPOKEN)
local SU = env.SoundUtils

world.cvars.Sound_EnableAllSound = "0"
Expect("all sound off is the first reason", SU:WhyInaudible("Dialog"), "all sound is disabled")
stub.ResetSound()

world.cvars.Sound_MasterVolume = "0"
Expect("master volume at zero is a reason", SU:WhyInaudible("Master"), "the master volume is 0")
stub.ResetSound()

world.cvars.Sound_EnableSFX = "0"
Expect("Master bypasses the per-channel toggles", SU:WhyInaudible("Master"), nil)
Expect("...but a channel honours its own", SU:WhyInaudible("SFX"), "the SFX sound channel is disabled")
stub.ResetSound()

world.cvars.Sound_DialogVolume = "0"
Expect("a channel at zero volume is a reason", SU:WhyInaudible("Dialog"), "the Dialog sound channel volume is 0")
stub.ResetSound()

Expect("everything on is audible", SU:WhyInaudible("Dialog"), nil)

local clip = { path = "a.ogg" }
Expect("PlaySound reports the client accepted the file", SU:PlaySound(clip, "Dialog"), true)
Expect("...on the channel it was given", world.playedChannels[1], "Dialog")
Expect("...and records the handle on the clip", clip.handle, 1)

SU:StopSound(clip)
Expect("StopSound stops that handle", world.stopped[1], 1)
Expect("...and clears it", clip.handle, nil)
SU:StopSound(clip)
Expect("StopSound on a clip with no handle is a no-op", #world.stopped, 1)

world.missing["gone.ogg"] = true
local gone = { path = "gone.ogg" }
Expect("a missing file is refused", SU:PlaySound(gone, "Master"), false)
Expect("...and leaves no handle", gone.handle, nil)

stub.ResetSound()
local probe = { path = "b.ogg" }
Expect("TestSound answers whether the file exists", SU:TestSound(probe, "Master"), true)
Expect("...by playing it", world.played[1], "b.ogg")
Expect("...on the channel it was given, not the client's SFX default", world.playedChannels[1], "Master")
Expect("...and stopping it at once", world.stopped[1], 1)
Expect("...without leaving a handle behind", probe.handle, nil)
world.missing["gone.ogg"] = true
Expect("TestSound says no for a missing file", SU:TestSound({ path = "gone.ogg" }, "Master"), false)

-- The speed pack is optional and mirrors both English and translated pack paths.
stub.SetAddOns({ { folder = "SpokenSpeed125_SpokenQuestsAudioAlliance" },
    { folder = "SpokenSpeed15_SpokenQuestsAudioAlliance" },
    { folder = "SpokenSpeed20_SpokenQuestsAudio_esES" },
    { folder = "SpokenSpeed15_SpokenZonesAudio_esES" } })
local english = { path = [[Interface\AddOns\SpokenQuestsAudioAlliance\generated\sounds\quests\a.ogg]], length = 6,
    text = "First second third", present = { timings = "0 1.5 3" } }
env.Spoken:SetPlaybackSpeed(1.25)
stub.ResetSound()
Expect("1.25x speed copy plays", SU:PlaySound(english, "Master"), true)
Expect("1.25x path mirrors the source", world.played[1],
    [[Interface\AddOns\SpokenSpeed125_SpokenQuestsAudioAlliance\generated\sounds\quests\a.ogg]])
Expect("1.25x duration follows the copy", english.length, 4.8)
env.Transcript:SetClip(english)
Expect("1.25x word timing follows the copy", env.Transcript.words[2].start, 1.2)
env.Spoken:SetPlaybackSpeed(1.5)
stub.ResetSound()
Expect("English speed copy plays", SU:PlaySound(english, "Master"), true)
Expect("English speed path mirrors the source", world.played[1],
    [[Interface\AddOns\SpokenSpeed15_SpokenQuestsAudioAlliance\generated\sounds\quests\a.ogg]])
Expect("duration follows the faster copy", english.length, 4)
env.Transcript:SetClip(english)
Expect("word timing follows the faster copy", env.Transcript.words[2].start, 1)

local spanish = { path = [[Interface\AddOns\SpokenQuestsAudio_esES\generated\sounds\quests\b.ogg]], length = 6 }
env.Spoken:SetPlaybackSpeed(2)
stub.ResetSound()
Expect("Spanish speed copy plays", SU:PlaySound(spanish, "Master"), true)
Expect("Spanish speed path mirrors the source", world.played[1],
    [[Interface\AddOns\SpokenSpeed20_SpokenQuestsAudio_esES\generated\sounds\quests\b.ogg]])
Expect("Spanish duration is halved", spanish.length, 3)

world.missing[SU:SpeedPath(spanish.path, 2)] = true
Expect("missing optional copy falls back to original", SU:PlaySound(spanish, "Master"), true)
Expect("fallback plays at normal speed", spanish.playbackSpeed, 1)
Expect("fallback restores the original duration", spanish.length, 6)
Expect("fallback uses the source path", spanish.playedPath, spanish.path)

local zone = { path = [[Interface\AddOns\SpokenZonesAudio_esES\Sounds\1411\bladefist-bay.mp3]], length = 12 }
env.Spoken:SetPlaybackSpeed(1.5)
stub.ResetSound()
Expect("Spanish MP3 speed copy plays", SU:PlaySound(zone, "Master"), true)
Expect("Spanish MP3 path mirrors the source", world.played[1],
    [[Interface\AddOns\SpokenSpeed15_SpokenZonesAudio_esES\Sounds\1411\bladefist-bay.mp3]])
Expect("Spanish MP3 duration follows the copy", zone.length, 8)

if failures > 0 then
    print(string.format("\n%d failure(s)", failures))
    os.exit(1)
end
print("\nAll sound utils tests passed")
