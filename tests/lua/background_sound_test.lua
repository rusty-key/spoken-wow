-- The game's Sound in Background turned on while a line speaks, and put back after
-- (BackgroundSound.lua). Run with `make test-player`.
--
-- It is a client CVar the game saves with its own settings, so the failures that matter are the
-- ones that leave it changed: a reload or a crash mid-line, or a value the player set meanwhile
-- being overwritten when the queue empties.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local Expect, Failures = H.Expecter(stub.print)
local world = stub.world
local SPOKEN = here .. "/../../addons/Spoken/"
local CVAR = "Sound_EnableSoundWhenGameIsInBG"

local function Value() return world.cvars[CVAR] end
local function Writes()
    local count = 0
    for _, entry in ipairs(world.cvarLog) do
        if entry[1] == CVAR then count = count + 1 end
    end
    return count
end

local env, quests = H.Fresh(stub, SPOKEN)
local B, Q = env.BackgroundSound, env.SoundQueue
local audio = env.Addon.db.profile.Audio
world.cvars[CVAR] = "0"

---------------------------------------------------------------- off by default
Expect("available on a current client", B:IsAvailable(), true)
Expect("off from the first install", audio.KeepTalkingInBackground, false)
quests:Enqueue(H.Clip({ length = 5 }))
stub.Advance(1)
Expect("off, a line leaves the game's setting alone", Writes(), 0)
Q:RemoveAllSoundsFromQueue(); stub.Advance(1)

---------------------------------------------------------------- on while speaking
audio.KeepTalkingInBackground = true
quests:Enqueue(H.Clip({ length = 2 }))
quests:Enqueue(H.Clip({ length = 2 }))
stub.Advance(0.5)
Expect("on, a line turns the game's sound in the background on", Value(), "1")
Expect("...and the player's value is saved in case the session ends", env.Addon.db.global.BackgroundSound, "0")
stub.Advance(2.2)
Expect("between two queued lines it stays on", Value(), "1")
stub.Advance(5)
Expect("once the queue is empty the player's value is back", Value(), "0")
Expect("...and nothing is left to put back", env.Addon.db.global.BackgroundSound, nil)

---------------------------------------------------------------- already on
world.cvars[CVAR] = "1"
local before = Writes()
quests:Enqueue(H.Clip({ length = 1 }))
stub.Advance(4)
Expect("a player who has it on already is never written to", Writes(), before)
Expect("...and keeps it on", Value(), "1")
world.cvars[CVAR] = "0"

---------------------------------------------------------------- the player changes it meanwhile
quests:Enqueue(H.Clip({ length = 3 }))
stub.Advance(0.5)
world.cvars[CVAR] = "0"
stub.Advance(5)
Expect("turned off by the player mid-line, it stays off", Value(), "0")

before = Writes()
quests:Enqueue(H.Clip({ length = 3 }))
stub.Advance(0.5)
-- Off and on again in the game's options: the same value, so only the event tells.
stub.FireEvent("CVAR_UPDATE", CVAR, "1")
stub.Advance(5)
Expect("set on by the player mid-line, it is theirs and stays on", Value(), "1")
Expect("...with only Spoken's one write before it", Writes(), before + 1)
world.cvars[CVAR] = "0"

---------------------------------------------------------------- switched off mid-line
quests:Enqueue(H.Clip({ length = 5 }))
stub.Advance(0.5)
audio.KeepTalkingInBackground = false
B:Sync()
Expect("switched off mid-line, the player's value is back at once", Value(), "0")
Q:RemoveAllSoundsFromQueue(); stub.Advance(1)
audio.KeepTalkingInBackground = true

---------------------------------------------------------------- reload and crash
quests:Enqueue(H.Clip({ length = 5 }))
stub.Advance(0.5)
stub.FireEvent("PLAYER_LOGOUT")
Expect("a reload mid-line puts the value back before the client saves it", Value(), "0")
Q:RemoveAllSoundsFromQueue(); stub.Advance(1)

-- A crash: the copy is saved, the value is still Spoken's, and the session never logs out.
B.original = nil
env.Addon.db.global.BackgroundSound = "0"
world.cvars[CVAR] = "1"
stub.FireEvent("PLAYER_LOGIN")
Expect("the next login puts back what a crashed session left changed", Value(), "0")
Expect("...and forgets it", env.Addon.db.global.BackgroundSound, nil)

---------------------------------------------------------------- the settings page
local row
for _, entry in ipairs(_G.SpokenOptionsPanel and _G.SpokenOptionsPanel.layout.entries or {}) do
    if entry.label == env.L.OPT_BACKGROUND_SOUND then row = entry.frame end
end
Expect("Keep Talking in Background is on Spoken's page", row ~= nil, true)
Expect("...after the other sound settings' Sound Between Lines", (function()
    local cue, background
    for index, entry in ipairs(_G.SpokenOptionsPanel.layout.entries) do
        if entry.label == env.L.OPT_CUE_BETWEEN then cue = index end
        if entry.label == env.L.OPT_BACKGROUND_SOUND then background = index end
    end
    return cue ~= nil and background == cue + 1
end)(), true)

Expect("nothing went wrong in a callback", #env.Callbacks.errors, 0)

os.exit(Failures() == 0 and 0 or 1)
