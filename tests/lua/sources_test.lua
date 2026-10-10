-- Sources: how a feature addon registers with the player, and the per-source hooks the
-- domain-specific rules live behind. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

local env, quests, zones = H.Fresh(stub, SPOKEN)
local rec = H.Recorder(env)

---------------------------------------------------------------- registration
Expect("a registered source is retrievable", env.Sources:Get("quests"), quests)
Expect("an unknown key is nil", env.Sources:Get("books"), nil)
local ok = pcall(function() env.Sources:Register("quests", { title = "Again" }) end)
Expect("registering a key twice is an error", ok, false)
local order = {}
for key in env.Sources:Iterate() do table.insert(order, key) end
Expect("Iterate follows `order`", table.concat(order, ","), "quests,zones")

---------------------------------------------------------------- admit
local vetoed = nil
local books = env.Sources:Register("books", { title = "Books", addon = "Spoken_Books", order = 3,
    admit = function(clip, queue) if vetoed then return false, vetoed end return true end })
vetoed = "no page open"
local bc = H.Clip()
local res, why = books:Enqueue(bc)
Expect("admit can veto", res, nil)
Expect("...with its own reason", why, "no page open")
Expect("...reported as dropped", rec:Has("CLIP_DROPPED " .. bc.key .. " no page open"), true)
vetoed = nil
Expect("...and lets clips through otherwise", books:Enqueue(H.Clip()) ~= nil, true)
env.SoundQueue:RemoveAllSoundsFromQueue()

---------------------------------------------------------------- enter / empty hooks
local enters, empties = 0, 0
local hooked = env.Sources:Register("hooked", { title = "Hooked", addon = "X", order = 4,
    onQueueEnter = function() enters = enters + 1 end,
    onQueueEmpty = function() empties = empties + 1 end })
local h1, h2 = H.Clip(), H.Clip()
hooked:Enqueue(h1); hooked:Enqueue(h2)
Expect("onQueueEnter fires once for the first clip", enters, 1)
Expect("...not again for the second", enters, 1)
Expect("onQueueEmpty has not fired yet", empties, 0)
stub.Advance(1.55)
Expect("...nor when one clip remains", empties, 0)
stub.Advance(1.55)
Expect("onQueueEmpty fires once the last leaves", empties, 1)
Expect("...exactly once", empties, 1)

---------------------------------------------------------------- testBeforeQueue
local probing = env.Sources:Register("probing", { title = "P", addon = "X", order = 5, testBeforeQueue = true })
world.missing["absent.ogg"] = true
res, why = probing:Enqueue(H.Clip({ path = "absent.ogg" }))
Expect("testBeforeQueue refuses a missing file at the door", res, nil)
Expect("...as missing", why, "missing")
Expect("...without queueing it", env.SoundQueue:GetQueueSize(), 0)

---------------------------------------------------------------- channel
stub.ResetSound()
quests:Enqueue(H.Clip())
Expect("no source channel: the player's setting", world.playedChannels[1], "Master")
env.SoundQueue:RemoveAllSoundsFromQueue()
-- The field is still in the API for an addon that needs its own, though neither shipped
-- addon sets one: the channel is a single setting on the player.
local own = env.Sources:Register("own", { title = "Own", addon = "X", channel = function() return "Dialog" end })
own:Enqueue(H.Clip())
Expect("a source may still declare its own", world.playedChannels[2], "Dialog")
env.SoundQueue:RemoveAllSoundsFromQueue()

world.cvars.Sound_EnableDialog = "0"
res, why = own:Enqueue(H.Clip())
Expect("an inaudible channel refuses at the door", res, nil)
Expect("...with the audibility reason", why, "the Dialog sound channel is disabled")
Expect("CanPlay says the same", select(2, own:CanPlay()), "the Dialog sound channel is disabled")
stub.ResetSound()

---------------------------------------------------------------- SOURCE_REGISTERED
local seen
env.Callbacks:Register("SOURCE_REGISTERED", function(source) seen = source end)
local late = env.Sources:Register("late", { title = "Late", addon = "X", order = 9 })
Expect("SOURCE_REGISTERED carries the source", seen, late)

---------------------------------------------------------------- a channel the player muted itself is not inaudible
-- The player mutes Dialog while a line speaks. A clip on Dialog arriving then must still
-- be admitted, and the mute lifted before it plays.
env, quests, zones = H.Fresh(stub, SPOKEN)
local onDialog = env.Sources:Register("onDialog", { title = "D", addon = "X", channel = function() return "Dialog" end })
_G.Spoken:MuteChannel("Dialog", true)
Expect("muting sets the channel's CVar", world.cvars.Sound_EnableDialog, "0")
Expect("...and the player knows it did", env.SoundUtils:IsMutedByPlayer("Dialog"), true)
local z = H.Clip()
Expect("a clip on the muted channel is still admitted", onDialog:Enqueue(z), z)
Expect("...and the mute is lifted for it to play", world.cvars.Sound_EnableDialog, "1")
Expect("...so the player no longer holds it", env.SoundUtils:IsMutedByPlayer("Dialog"), false)
world.cvars.Sound_EnableDialog = "0"
Expect("a channel the user disabled is still inaudible", (onDialog:Enqueue(H.Clip())), nil)

---------------------------------------------------------------- one sound channel, the player's
-- Every addon speaks on the channel chosen once, in the player's settings. A source may
-- still declare its own -- the API keeps the field -- but none of the shipped modules does,
-- so there is one control rather than one per module.
env, quests, zones = H.Fresh(stub, SPOKEN)
env.Addon.db.profile.Audio.SoundChannel = "Dialog"
Expect("the quests source reads the player's channel", quests:GetChannel(), "Dialog")
Expect("...and so does the zones source", zones:GetChannel(), "Dialog")
env.Addon.db.profile.Audio.SoundChannel = "Master"
Expect("changing it moves every source at once", zones:GetChannel(), "Master")

---------------------------------------------------------------- muting the game's own dialogue
-- The client speaks its own NPC barks on the Dialog channel, over the top of a line being
-- read. The player mutes that while it speaks and restores it when the queue drains. It
-- belongs here rather than in one addon: any addon's clip is talked over.
env, quests, zones = H.Fresh(stub, SPOKEN)
env.Addon.db.profile.Audio.AutoToggleDialog = true
env.Addon.db.profile.Audio.SoundChannel = "Master"
quests:Enqueue(H.Clip())
stub.Advance(0.6)
Expect("a line speaking mutes the game's dialogue, once faded", GetCVar("Sound_EnableDialog"), "0")
_G.Spoken:StopAll()
Expect("...and the empty queue restores it", GetCVar("Sound_EnableDialog"), "1")

-- Speaking on Dialog ourselves: muting it would mute the line.
env, quests, zones = H.Fresh(stub, SPOKEN)
env.Addon.db.profile.Audio.AutoToggleDialog = true
env.Addon.db.profile.Audio.SoundChannel = "Dialog"
quests:Enqueue(H.Clip())
stub.Advance(0.6)
Expect("speaking on Dialog does not mute Dialog", GetCVar("Sound_EnableDialog"), "1")

env, quests, zones = H.Fresh(stub, SPOKEN)
env.Addon.db.profile.Audio.AutoToggleDialog = false
quests:Enqueue(H.Clip())
Expect("turned off, nothing is muted", GetCVar("Sound_EnableDialog"), "1")

---------------------------------------------------------------- muting ahead of a line
-- A source about to queue a line mutes the game's dialogue first, so a greeting that starts
-- with the dialog is never heard rather than cut short when the line starts.
env, quests, zones = H.Fresh(stub, SPOKEN)
env.Addon.db.profile.Audio.AutoToggleDialog = true
env.Addon.db.profile.Audio.SoundChannel = "Master"
_G.Spoken:MuteGameDialogueAhead(quests)
Expect("muting ahead cuts the dialog at once, as the window opens", GetCVar("Sound_EnableDialog"), "0")
stub.Advance(1.6)
Expect("...and lifts itself when nothing is queued", GetCVar("Sound_EnableDialog"), "1")

_G.Spoken:MuteGameDialogueAhead(quests)
quests:Enqueue(H.Clip({ length = 5 }))
stub.Advance(1.6)
Expect("a line queued under it keeps dialog muted past the deadline", GetCVar("Sound_EnableDialog"), "0")
_G.Spoken:StopAll()
Expect("...until the queue drains", GetCVar("Sound_EnableDialog"), "1")

-- Paused, a line queues and does not speak: the greeting has nothing to make way for.
env, quests, zones = H.Fresh(stub, SPOKEN)
env.Addon.db.profile.Audio.AutoToggleDialog = true
env.Addon.db.profile.Audio.SoundChannel = "Master"
_G.Spoken:Pause()
_G.Spoken:MuteGameDialogueAhead(quests)
Expect("paused, muting ahead does nothing", GetCVar("Sound_EnableDialog"), "1")
_G.Spoken:Resume()

-- Pausing a line gives the game its dialogue back; resuming takes it again.
quests:Enqueue(H.Clip({ length = 5 }))
stub.Advance(0.6)
Expect("a speaking line mutes dialog", GetCVar("Sound_EnableDialog"), "0")
_G.Spoken:Pause()
Expect("...stopping it lifts the mute", GetCVar("Sound_EnableDialog"), "1")
_G.Spoken:Resume()
stub.Advance(0.6)
Expect("...replaying mutes again", GetCVar("Sound_EnableDialog"), "0")
-- Stopped before the fade ends, the volume goes straight back.
_G.Spoken:Pause(); _G.Spoken:Resume(); stub.Advance(0.2)
local fading = tonumber(GetCVar("Sound_DialogVolume") or 1)
_G.Spoken:Pause()
Expect("a fade cut short puts the NPC volume straight back", tonumber(GetCVar("Sound_DialogVolume") or 1) >= fading
    and GetCVar("Sound_EnableDialog") == "1", true)
_G.Spoken:Resume()
_G.Spoken:StopAll()

-- A line queued under the mute but held by a gate is not speaking; it must not keep the
-- game's dialogue silent for as long as it is held.
local holding = true
_G.Spoken:AddGate(function() if holding then return "held" end end)
_G.Spoken:MuteGameDialogueAhead(quests)
quests:Enqueue(H.Clip({ length = 5 }))
stub.Advance(1.6)
Expect("a held line does not keep the mute past the deadline", GetCVar("Sound_EnableDialog"), "1")
holding = false

env, quests, zones = H.Fresh(stub, SPOKEN)
env.Addon.db.profile.Audio.AutoToggleDialog = true
env.Addon.db.profile.Audio.SoundChannel = "Dialog"
_G.Spoken:MuteGameDialogueAhead(quests)
Expect("a line coming on Dialog does not mute Dialog", GetCVar("Sound_EnableDialog"), "1")

env, quests, zones = H.Fresh(stub, SPOKEN)
env.Addon.db.profile.Audio.AutoToggleDialog = false
_G.Spoken:MuteGameDialogueAhead(quests)
Expect("turned off, muting ahead does nothing", GetCVar("Sound_EnableDialog"), "1")

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll sources tests passed")
