-- The shared queue: one FIFO across every source, nothing interrupts, gossip yields at the
-- door, a held head is skipped rather than blocking. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

local env, quests, places, Q, rec
local function Fresh()
    env, quests, places = H.Fresh(stub, SPOKEN)
    Q = env.SoundQueue
    rec = H.Recorder(env)
end

---------------------------------------------------------------- plays, then FIFO
Fresh()
local a = H.Clip()
Expect("an empty queue plays at once", quests:Enqueue(a) ~= nil, true)
Expect("...and says so", rec:Has("CLIP_STARTED k" .. a.key:sub(2)), true)
Expect("...IsPlaying", Q:IsPlaying(), true)
local b = H.Clip()
places:Enqueue(b)
Expect("a second clip waits", world.played[2], nil)
Expect("...counted as waiting", Q:GetWaitingCount(), 1)
stub.Advance(1.55)
Expect("after length + gap the next starts, whichever source", world.played[2], b.path)
Expect("...on the channel every source shares", world.playedChannels[2], "Master")

---------------------------------------------------------------- strict admission order
Fresh()
local c1, c2, c3 = H.Clip(), H.Clip(), H.Clip()
quests:Enqueue(c1); places:Enqueue(c2); quests:Enqueue(c3)
stub.Advance(1.55); stub.Advance(1.25)
Expect("FIFO across sources: 1st", world.played[1], c1.path)
Expect("FIFO across sources: 2nd", world.played[2], c2.path)
Expect("FIFO across sources: 3rd", world.played[3], c3.path)

---------------------------------------------------------------- dedup on key
Fresh()
local d = H.Clip({ key = "same" })
quests:Enqueue(d)
local ok, why = quests:Enqueue(H.Clip({ key = "same" }))
Expect("a duplicate key is refused", ok, nil)
Expect("...with the reason", why, "duplicate")
Expect("...and the queue is unchanged", Q:GetQueueSize(), 1)

---------------------------------------------------------------- low priority yields at the door
Fresh()
quests:Enqueue(H.Clip())
local g = H.Clip({ priority = "low" })
ok, why = quests:Enqueue(g)
Expect("low priority is refused while a normal clip is playing", ok, nil)
Expect("...with the reason", why, "outranked")
Expect("...and reported", rec:Has("CLIP_DROPPED " .. g.key .. " outranked"), true)

Fresh()
local g1 = H.Clip({ priority = "low" })
local g2 = H.Clip({ priority = "low" })
quests:Enqueue(g1); quests:Enqueue(g2)
Expect("low clips alone play", world.played[1], g1.path)
local n1 = H.Clip()
quests:Enqueue(n1)
Expect("a normal arrival drops the WAITING low clip", rec:Has("CLIP_DROPPED " .. g2.key .. " outranked"), true)
Expect("...but never the one speaking", Q:GetCurrentSound(), g1)
Expect("...so the normal clip follows it", Q:GetQueue()[2], n1)
Expect("...and the queue holds exactly those two", Q:GetQueueSize(), 2)

---------------------------------------------------------------- gates hold, retry, release
Fresh()
local hold = "in combat"
places:AddGate(function(clip) return hold end)
local z = H.Clip()
places:Enqueue(z)
Expect("a held head does not start", world.played[1], nil)
Expect("...GetCurrent still names it", Q:GetCurrentSound(), z)
Expect("...GetNowPlaying does not", Q:GetNowPlaying(), nil)
Expect("...and the reason is available", Q:GetHeldReason(z), "in combat")
stub.Advance(1)
Expect("the retry tick does not start it while held", world.played[1], nil)
hold = nil
stub.Advance(1)
Expect("released, the next tick starts it", world.played[1], z.path)

---------------------------------------------------------------- a held head is skipped
Fresh()
hold = "in combat"
places:AddGate(function(clip) return hold end)
local held = H.Clip()
local free = H.Clip()
places:Enqueue(held)
quests:Enqueue(free)
Expect("a clip behind a held head plays instead of waiting on it", world.played[1], free.path)
Expect("...the held one is still queued", Q:GetQueueSize(), 2)
hold = nil
stub.Advance(1.55)
Expect("...and plays once released and the other has finished", world.played[2], held.path)

---------------------------------------------------------------- a gate closing on a clip already speaking
-- Gates are asked before a clip starts. A cinematic that begins a second after a greeting
-- started would otherwise be talked over to its end.
Fresh()
hold = nil
places:AddGate(function(clip) return hold end)
local talking = H.Clip()
places:Enqueue(talking)
Expect("RecheckGates leaves a clip no gate holds speaking", places:RecheckGates(), false)
Expect("...still speaking", Q:IsPlaying(talking), true)
hold = "cinematic"
Expect("another source's recheck leaves it alone", quests:RecheckGates(), false)
Expect("...still speaking", Q:IsPlaying(talking), true)
Expect("RecheckGates stops its source's speaking clip a gate now holds", places:RecheckGates(), true)
Expect("...the sound is stopped", #world.stopped, 1)
Expect("...reported stopped, not finished", rec:Has("CLIP_STOPPED " .. talking.key .. " false"), true)
Expect("...kept at the head", Q:GetCurrentSound(), talking)
Expect("...making no sound", Q:GetNowPlaying(), nil)
stub.Advance(2)
Expect("...its finish timer is cancelled, so it is still queued", Q:GetCurrentSound(), talking)
Expect("...and not restarted while held", world.played[2], nil)
hold = nil
stub.Advance(1)
Expect("released, it replays from the start", world.played[2], talking.path)

Fresh()
hold = nil
places:AddGate(function(clip) return hold end)
local interrupted = H.Clip()
local other = H.Clip()
places:Enqueue(interrupted)
quests:Enqueue(other)
hold = "cinematic"
local changes = rec:Count("AUDIO_CHANGED")
places:RecheckGates()
Expect("a clip waiting behind an interrupted one plays in its place", world.played[2], other.path)
Expect("...announced once", rec:Count("AUDIO_CHANGED") - changes, 1)
Expect("...the interrupted one still queued", Q:GetQueueSize(), 2)

Fresh()
quests:Enqueue(H.Clip())
Q:PauseQueue()
Expect("RecheckGates on a paused player stops nothing", quests:RecheckGates(), false)

---------------------------------------------------------------- per-source queue limit
Fresh()
local head = H.Clip()
places:Enqueue(head)
local zs = {}
for i = 1, 5 do zs[i] = H.Clip(); places:Enqueue(zs[i]) end
local qx = H.Clip()
quests:Enqueue(qx)
Expect("the head is never trimmed", Q:GetCurrentSound(), head)
Expect("a source's waiting clips are capped at its limit", Q:GetWaitingCount(), 4)
Expect("...oldest first", rec:Has("CLIP_DROPPED " .. zs[1].key .. " queue-limit"), true)
Expect("...and the second oldest", rec:Has("CLIP_DROPPED " .. zs[2].key .. " queue-limit"), true)
Expect("...other sources are not counted", rec:Count("CLIP_DROPPED " .. qx.key), 0)

---------------------------------------------------------------- per-source gap
Fresh()
places:Enqueue(H.Clip()); local after1 = H.Clip(); quests:Enqueue(after1)
stub.Advance(1.2)
Expect("places' 0.25 gap: not yet at 1.2s", world.played[2], nil)
stub.Advance(0.1)
Expect("...next at 1.25s", world.played[2], after1.path)
Fresh()
quests:Enqueue(H.Clip()); local after2 = H.Clip(); places:Enqueue(after2)
stub.Advance(1.5)
Expect("quests' 0.55 gap: not yet at 1.5s", world.played[2], nil)
stub.Advance(0.1)
Expect("...next at 1.55s", world.played[2], after2.path)

---------------------------------------------------------------- PlayNow: a line asked for by hand
-- Something speaking: the clicked line waits its turn behind it, rather than cutting it off.
Fresh()
local speaking = H.Clip()
quests:Enqueue(speaking)
local clicked = H.Clip()
Expect("PlayNow while a line speaks queues the new one", places:PlayNow(clicked), true)
Expect("...behind the line speaking, which goes on", Q:GetCurrentSound() == speaking and Q:GetQueue()[2] == clicked, true)
Expect("...nothing was stopped", rec:Has("CLIP_STOPPED " .. speaking.key .. " false"), false)
Expect("...and one already waiting is not queued twice", places:PlayNow(H.Clip({ key = clicked.key })) and Q:GetQueueSize(), 2)
-- Stopped: the clicked line plays at once, and the stopped one waits behind it.
Q:PauseQueue()
local now = H.Clip()
places:PlayNow(now)
Expect("PlayNow on a stopped queue plays it at once", Q:GetCurrentSound() == now and not Q:IsPaused(), true)
Expect("...the stopped line kept after it", Q:GetQueue()[2], speaking)
-- Skipping a stopped line plays the next.
Fresh()
local first, second = H.Clip(), H.Clip()
quests:Enqueue(first); quests:Enqueue(second)
Q:PauseQueue()
Q:Skip()
Expect("Skip on a stopped queue plays the next line", Q:IsPaused() == false and world.played[2], second.path)
-- The last line skipped mid-word fades out, as Stop does, rather than cutting off.
Fresh()
quests:Enqueue(H.Clip({ length = 5 }))
world.lastStopFade = nil
Q:Skip()
Expect("Skip fades the last line out", world.lastStopFade, 400)
-- With a line after it, the skipped one is cut: a fade would talk over the next.
Fresh()
quests:Enqueue(H.Clip({ length = 5 })); quests:Enqueue(H.Clip())
world.lastStopFade = 0
Q:Skip()
Expect("Skip cuts a line another follows", world.lastStopFade, nil)
-- A line that cannot be stopped is not skipped, and the queue stays as stopped as it was.
Fresh()
local stuck = H.Clip({ length = 5 })
quests:Enqueue(stuck); quests:Enqueue(H.Clip())
stuck.handle = nil
Q:SetPaused(true)
Expect("Skip leaves a line that cannot be stopped, and the Stopped flag, alone",
    tostring(Q:Skip()) .. " " .. tostring(Q:GetCurrentSound() == stuck) .. " " .. tostring(Q:IsPaused()), "false true true")
Q:SetPaused(false)
Fresh()
Q:SetPaused(true)
Expect("...as with no line at all", tostring(Q:Skip()) .. " " .. tostring(Q:IsPaused()), "false true")
Q:SetPaused(false)

---------------------------------------------------------------- the pause between lines
Fresh()
env.Addon.db.profile.Audio.LineGap = 1
local a, b = H.Clip(), H.Clip()
quests:Enqueue(a); quests:Enqueue(b)
stub.Advance(1.5)
Expect("the pause between lines holds the next back: not yet at 1.5s", world.played[2], nil)
stub.Advance(1.1)
Expect("...next after length, gap and the pause (2.55s)", world.played[2], b.path)

-- Stop in the pause holds the next line; it does not stop, and replay, the one already heard.
Fresh()
env.Addon.db.profile.Audio.LineGap = 1
a, b = H.Clip(), H.Clip()
quests:Enqueue(a); quests:Enqueue(b)
stub.Advance(1.5)
Q:PauseQueue()
Expect("Stop in the pause ends the line that has spoken", Q:IsPaused() and Q:GetCurrentSound() == b, true)
Q:ResumeQueue()
Expect("...and Replay plays the next one", Q:IsPlaying(b) and #world.played, 2)
-- Only a line waiting gets the pause: the last one ends with its voice.
Fresh()
env.Addon.db.profile.Audio.LineGap = 1
quests:Enqueue(H.Clip())
stub.Advance(1)
Expect("no pause after the last line", Q:IsEmpty() and rec:Has("QUEUE_EMPTY"), true)
local late = H.Clip()
quests:Enqueue(late)
Expect("...so a line arriving then plays at once", world.played[2], late.path)
-- Decided as the voice ends: a line queued during it still gets its pause.
Fresh()
env.Addon.db.profile.Audio.LineGap = 1
quests:Enqueue(H.Clip())
stub.Advance(0.5)
quests:Enqueue(H.Clip())
stub.Advance(1.5)
Expect("a line queued while the last speaks waits out the pause", #world.played, 1)
stub.Advance(0.6)
Expect("...then plays", #world.played, 2)
Fresh()
env.Addon.db.profile.Audio.LineGap = 1
quests:Enqueue(H.Clip({ group = "book:1" })); quests:Enqueue(H.Clip({ group = "book:1" }))
quests:Enqueue(H.Clip({ group = "book:2" }))
stub.Advance(1.6)
Expect("pages of one book read on without the pause", #world.played, 2)
stub.Advance(1.6)
Expect("...another book's page waits for it", #world.played, 2)
stub.Advance(1)
Expect("...then plays", #world.played, 3)
env.Addon.db.profile.Audio.LineGap = 0

---------------------------------------------------------------- PlayNow past the backlog cap
Fresh()
local z1, z2, z3 = H.Clip(), H.Clip(), H.Clip()
places:SetQueueLimit(2)
places:Enqueue(z1); places:Enqueue(z2); places:Enqueue(z3)   -- z1 speaks, two wait: at the cap
local capped = H.Clip()
Expect("PlayNow past the cap queues the clicked clip", places:PlayNow(capped), true)
Expect("...behind the line speaking", Q:GetCurrentSound(), z1)
Expect("...never dropping the clicked one", rec:Has("CLIP_DROPPED " .. capped.key .. " queue-limit"), false)

---------------------------------------------------------------- StopAll per source, and for the player
Fresh()
local q1, z1, q2 = H.Clip(), H.Clip(), H.Clip()
quests:Enqueue(q1); places:Enqueue(z1); quests:Enqueue(q2)
quests:StopAll()
Expect("a source's StopAll removes only its clips", Q:GetQueueSize(), 1)
Expect("...the other source's clip now plays", world.played[2], z1.path)
Q:PauseQueue()
env.SoundQueue:RemoveAllSoundsFromQueue()
Expect("the player's StopAll empties the queue", Q:GetQueueSize(), 0)
Expect("...and clears the paused flag", Q:IsPaused(), false)
Expect("...and reports the queue empty", rec:Has("QUEUE_EMPTY"), true)

---------------------------------------------------------------- pause, resume, skip
Fresh()
local p1, p2 = H.Clip(), H.Clip()
quests:Enqueue(p1); quests:Enqueue(p2)
Q:PauseQueue()
Expect("pause stops the head", world.stopped[1], 1)
Expect("...IsPaused", Q:IsPaused(), true)
Expect("...GetNowPlaying still names the paused head", Q:GetNowPlaying(), p1)
stub.Advance(5)
Expect("nothing advances while paused", world.played[2], nil)
Q:ResumeQueue()
Expect("resume replays the head from the start", world.played[2], p1.path)
Q:Skip()
Expect("skip ends the head", Q:GetCurrentSound(), p2)
Expect("...and starts the next", world.played[3], p2.path)

---------------------------------------------------------------- a missing file
Fresh()
world.missing["gone.ogg"] = true
local gone = H.Clip({ path = "gone.ogg" })
local next_ = H.Clip()
quests:Enqueue(gone); quests:Enqueue(next_)
Expect("a file the client refuses is dropped", rec:Has("CLIP_DROPPED " .. gone.key .. " missing"), true)
Expect("...and the queue moves on", world.played[1], next_.path)

---------------------------------------------------------------- the existence probe
-- SpokenQuests probes each file before admitting it. The probe must go out on the
-- source's channel: without one the client uses SFX, and with effects switched off
-- every file would be reported missing though Master plays it fine.
Fresh()
local probed = env.Sources:Register("probed", { title = "Probed", addon = "Spoken_Quests", order = 3,
    testBeforeQueue = true })
local p = H.Clip()
Expect("a probed source admits a file that exists", probed:Enqueue(p) ~= nil, true)
Expect("...probing it on the source's channel", world.playedChannels[1], "Master")

---------------------------------------------------------------- the cue between lines (#142)
local function Cues()
    local n = 0
    for _, s in ipairs(world.kitSounds) do
        if s.kit == _G.SOUNDKIT.IG_QUEST_LOG_CLOSE then n = n + 1 end
    end
    return n
end

local function FreshCued()
    Fresh()
    env.Addon.db.profile.Audio.CueBetweenLines = true
end

-- A clip speaks for 1s; the quests gap after it is 0.55s, so the cue falls at 1.275s.
Fresh()
quests:Enqueue(H.Clip()); quests:Enqueue(H.Clip())
stub.Advance(1.55)
Expect("off by default: no cue", Cues(), 0)
Expect("...and the next line starts straight after the gap", #world.played, 2)

FreshCued()
local first, second = H.Clip(), H.Clip()
quests:Enqueue(first); quests:Enqueue(second)
Expect("no cue before the first line", Cues(), 0)
stub.Advance(1.2)
Expect("no cue as the voice ends", Cues(), 0)
stub.Advance(0.1)
Expect("a cue halfway through the pause before a waiting line", Cues(), 1)
Expect("...on the channel the next line speaks on", (world.kitSounds[1] or {}).channel, "Master")
Expect("...and the next line waits for the pause to end", #world.played, 1)
stub.Advance(0.3)
Expect("...which it takes no longer for the cue", world.played[2], second.path)
stub.Advance(1.55)
Expect("no cue after the last line", Cues(), 1)

FreshCued()
env.Addon.db.profile.Audio.LineGap = 1
quests:Enqueue(H.Clip()); quests:Enqueue(H.Clip())
stub.Advance(1.7)
Expect("Pause Between Lines moves the cue to the middle of the longer pause", Cues(), 0)
stub.Advance(0.1)
Expect("...at 1.775s", Cues(), 1)
env.Addon.db.profile.Audio.LineGap = 0

FreshCued()
quests:Enqueue(H.Clip())
stub.Advance(1.55)
stub.Advance(5)
quests:Enqueue(H.Clip())
Expect("a line after the queue drained gets no cue", Cues(), 0)
Expect("...and plays at once", #world.played, 2)

FreshCued()
quests:Enqueue(H.Clip({ group = "book:1" })); quests:Enqueue(H.Clip({ group = "book:1" }))
quests:Enqueue(H.Clip({ group = "book:2" }))
stub.Advance(1.55)
Expect("pages of one book: no cue", Cues(), 0)
Expect("...the next page follows after the gap", #world.played, 2)
stub.Advance(1.55)
Expect("a different book gets the cue", Cues(), 1)

FreshCued()
quests:Enqueue(H.Clip()); quests:Enqueue(H.Clip())
Q:Skip()
stub.Advance(0.5)
Expect("skipping moves on without a cue", Cues(), 0)
Expect("...straight to the next line", #world.played, 2)

FreshCued()
quests:Enqueue(H.Clip()); quests:Enqueue(H.Clip())
stub.Advance(1.1)
Q:PauseQueue()
stub.Advance(2)
Expect("stopping in the pause cancels the cue", Cues(), 0)
Expect("...and holds the next line", #world.played, 1)
Q:ResumeQueue()
Expect("...which Replay starts without one", #world.played == 2 and Cues() == 0, true)

FreshCued()
local waiting = H.Clip()
quests:Enqueue(H.Clip()); quests:Enqueue(waiting)
stub.Advance(1.1)
Q:RemoveSoundFromQueue(waiting)
stub.Advance(0.5)
Expect("no cue once the waiting line is taken away", Cues(), 0)
Expect("...and the queue ends", Q:IsEmpty(), true)

FreshCued()
local gateHeld = true
places:AddGate(function() return gateHeld and "in combat" or nil end)
quests:Enqueue(H.Clip()); places:Enqueue(H.Clip())
stub.Advance(1.55)
Expect("no pause or cue before a line a gate holds", Cues() == 0 and Q:GetCurrentSound().source == places, true)
gateHeld = false
stub.Advance(1)
Expect("...it plays once released, with no cue", Cues() == 0 and #world.played == 2, true)

---------------------------------------------------------------- the client cuts the voice
-- With Sound in Background off, the client stops every sound when the game loses focus and
-- never starts it again. Measured in-game: C_Sound.IsPlaying turns false at the alt-tab and stays so.
local cut = {}
_G.C_Sound = { IsPlaying = function(handle) return not cut[handle] end }

Fresh()
local long, after = H.Clip({ length = 10 }), H.Clip()
quests:Enqueue(long); quests:Enqueue(after)
stub.Advance(2)
cut[long.handle] = true
stub.Advance(2)
Expect("a voice the client cut stops the line", Q:IsPaused(), true)
Expect("...keeping it at the head", Q:GetCurrentSound(), long)
Expect("...and not speaking, so the bar stops", Q:IsPlaying(), false)
stub.Advance(10)
Expect("...the next line waits", #world.played, 1)
Q:ResumeQueue()
Expect("Replay plays it from the start", world.played[2], long.path)
stub.Advance(4)
Expect("...and the replay is not taken for a cut", Q:IsPaused(), false)

Fresh()
cut = {}
-- Ends 0.4s before its recorded length, between two polls: only the margin tells it from a cut.
local whole = H.Clip({ length = 3.2 })
quests:Enqueue(whole)
stub.Advance(2.8)
cut[whole.handle] = true
stub.Advance(0.6)
Expect("a voice a little shorter than its length is not a cut", Q:IsPaused(), false)

_G.C_Sound = nil

---------------------------------------------------------------- an empty queue is not left stopped
Fresh()
local stopped = H.Clip({ length = 5 })
quests:Enqueue(stopped)
stub.Advance(1)
Q:PauseQueue()
local stoppedWhenTold
env.Callbacks:Register("AUDIO_CHANGED", function() stoppedWhenTold = Q:IsPaused() end)
quests:Remove(stopped)
Expect("a stopped line taken out of the queue leaves it empty and not stopped", Q:IsEmpty() and Q:IsPaused(), false)
Expect("...and says so", stoppedWhenTold, false)
local next = H.Clip()
quests:Enqueue(next)
Expect("...so the next line queued plays", Q:IsPlaying(next), true)

Fresh()
local first, waiting = H.Clip({ length = 5 }), H.Clip()
quests:Enqueue(first); quests:Enqueue(waiting)
stub.Advance(1)
Q:PauseQueue()
quests:Remove(first)
Expect("a stopped line taken out with another waiting leaves the queue stopped", Q:IsPaused(), true)
Expect("...the waiting line held, not played", Q:IsPlaying(), false)

---------------------------------------------------------------- Play on a line waiting behind a stopped one
Fresh()
local held, behind = H.Clip({ length = 5 }), H.Clip({ length = 5 })
local behindStopped = 0
behind.stopCallback = function() behindStopped = behindStopped + 1 end
quests:Enqueue(held); quests:Enqueue(behind)
stub.Advance(1)
Q:PauseQueue()
quests:PlayNow(behind)
Expect("Play on a line waiting behind a stopped one plays it", Q:IsPlaying(behind), true)
Expect("...the stop taken off", Q:IsPaused(), false)
Expect("...moved to the front as it is, never stopped on the way", behindStopped, 0)
Expect("...the stopped line kept behind it", Q:GetQueue()[2], held)

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll queue tests passed")
