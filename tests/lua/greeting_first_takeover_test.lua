-- Game Greeting First moved from the quests module's settings to Spoken's own with the dialogue
-- core (Spoken/Core.lua, TakeGreetingFirstFromQuests): a player who had it on keeps it on.
-- Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

local CHAR = "Tester - Realm"

--- A login with the quests module's saved settings as given; `keep` keeps Spoken's own from the
--- last login.
local function Login(quests, keep)
    stub.SetClient("11509"); stub.ResetSound(); stub.ResetTimers(); stub.ResetFrames()
    if not keep then _G.SpokenSettings = nil end
    _G.SpokenQuestsSettings = quests
    local env = stub.LoadSpoken(SPOKEN)
    stub.FireEvent("PLAYER_LOGIN")
    return env.Addon.db.profile.Audio
end

local function Quests(profile, greetingFirst, onProfile)
    return {
        profiles = { [profile] = { Audio = { GreetingFirst = greetingFirst } } },
        profileKeys = onProfile and { [CHAR] = onProfile } or nil,
    }
end

Expect("with no quests settings it stays off", Login(nil).GreetingFirst, false)
Expect("on in the character's own quests profile, it comes over on",
    Login(Quests(CHAR, true)).GreetingFirst, true)
Expect("...and from the shared profile the character chose there", Login(Quests("Shared", true, "Shared")).GreetingFirst, true)
Expect("...but not from a profile the character is not on", Login(Quests("Shared", true)).GreetingFirst, false)
Expect("off there, it stays off", Login(Quests(CHAR, false)).GreetingFirst, false)

-- Once per character: a player who turns it off in Spoken afterwards keeps it off.
local audio = Login(Quests(CHAR, true))
audio.GreetingFirst = false
Expect("taken over once: the next login keeps what the player set here",
    Login(_G.SpokenQuestsSettings, true).GreetingFirst, false)

os.exit(Failures() == 0 and 0 or 1)
