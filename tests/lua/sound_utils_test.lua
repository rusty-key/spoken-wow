-- The bottom of the player's playback stack: whether sound can be heard, and starting and
-- stopping one file. Run with `make test-player`.
--
-- The audibility predicate is VoiceOverRedux's (it checks volumes, and Master bypasses the
-- per-channel toggles) with SpokenZones's player-facing reasons.
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

if failures > 0 then
    print(string.format("\n%d failure(s)", failures))
    os.exit(1)
end
print("\nAll sound utils tests passed")
