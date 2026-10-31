-- Lines with no recording: a source registered with textOnly shows each line in the narrator for its
-- length, plays no file, leaves the game's dialogue alone and can be stopped and replayed.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local world = stub.world
local SPOKEN = here .. "/../../addons/Spoken/"
local Expect, Failures = H.Expecter(print)

local env, quests = H.Fresh(stub, SPOKEN)
local Q = env.SoundQueue
local rec = H.Recorder(env)
local stories = env.Sources:Register("bosses", { title = "Bosses", addon = "Spoken_Bosses", order = 5, textOnly = true })

local function Story(fields)
    local clip = H.Clip(fields)
    clip.path, clip.textOnly, clip.length = nil, true, 3
    return clip
end

---------------------------------------------------------------- shown for its length, nothing played
local a = Story()
local cvarsBefore = #world.cvarLog
Expect("a text-only line is taken", stories:Enqueue(a) ~= nil, true)
Expect("...and starts", rec:Has("CLIP_STARTED " .. a.key), true)
Expect("...with no file played", #world.played, 0)
Expect("...and the game's dialogue, music and other sounds left alone", #world.cvarLog, cvarsBefore)
Expect("...and can be stopped", Q:CanBePaused(), true)
local b = H.Clip()
quests:Enqueue(b)
stub.Advance(2)
Expect("a line behind it waits while it shows", #world.played, 0)
stub.Advance(1.6)
Expect("...and plays once its length and the gap are over", world.played[1], b.path)

---------------------------------------------------------------- stop and replay
env, quests = H.Fresh(stub, SPOKEN)
Q = env.SoundQueue
rec = H.Recorder(env)
stories = env.Sources:Register("bosses", { title = "Bosses", addon = "Spoken_Bosses", order = 5, textOnly = true })
local c = Story()
stories:Enqueue(c)
Q:PauseQueue()
Expect("Stop holds the text-only line", Q:IsPaused() and Q:GetCurrentSound() == c, true)
stub.Advance(5)
Expect("...which does not end on its own while stopped", Q:GetCurrentSound(), c)
Q:ResumeQueue()
Expect("Replay shows it again", rec:Count("CLIP_STARTED " .. c.key), 2)
Q:RemoveSoundFromQueue(c)
Expect("it can be taken out of the queue while it shows", Q:IsEmpty(), true)

---------------------------------------------------------------- sound off
env, quests = H.Fresh(stub, SPOKEN)
stories = env.Sources:Register("bosses", { title = "Bosses", addon = "Spoken_Bosses", order = 5, textOnly = true })
world.cvars.Sound_EnableAllSound = "0"
local ok, why = quests:Enqueue(H.Clip())
Expect("with all sound off a voiced line is refused", ok == nil and why ~= nil, true)
Expect("...and a text-only line is still shown", stories:Enqueue(Story()) ~= nil, true)
world.cvars.Sound_EnableAllSound = nil

---------------------------------------------------------------- after a voiced line
env, quests = H.Fresh(stub, SPOKEN)
stories = env.Sources:Register("bosses", { title = "Bosses", addon = "Spoken_Bosses", order = 5, textOnly = true })
env.Addon.db.profile.Audio.AutoToggleDialog = true
local voiced = H.Clip()
voiced.cutsGameDialogue = true
quests:Enqueue(voiced)
Expect("a voiced line mutes the game's dialogue", tostring(GetCVar("Sound_EnableDialog")), "0")
stories:Enqueue(Story())
stub.Advance(voiced.length + 1)
Expect("...and a text-only line after it lets the dialogue be heard again", tostring(GetCVar("Sound_EnableDialog")), "1")
env.Addon.db.profile.Audio.AutoToggleDialog = false

---------------------------------------------------------------- whether the narrator would show it
env = H.Fresh(stub, SPOKEN)
env.Sources:Register("bosses", { title = "Bosses", addon = "Spoken_Bosses", order = 5, textOnly = true })
local words = env.Addon.db.profile.Transcript
Expect("the narrator shows a source's lines by default", _G.Spoken:ShowsNarratorFor("bosses"), true)
words.WordsOff.bosses = true
Expect("...not with the source's own Show Narrator off", _G.Spoken:ShowsNarratorFor("bosses"), false)
words.WordsOff.bosses = nil
words.Enabled = false
Expect("...nor with Show Narrator off", _G.Spoken:ShowsNarratorFor("bosses"), false)
words.Enabled = true
env.Addon.db.profile.Frame.Style = "none"
Expect("...nor with Voice Only", _G.Spoken:ShowsNarratorFor("bosses"), false)

os.exit(Failures() == 0 and 0 or 1)
