-- Abandoning a quest takes its lines out of the queue, the one speaking fading out as Skip's
-- does. Run with `make test-player`.
local here = arg[0]:match("^(.*)/[^/]*$") or "."
package.path = here .. "/?.lua;" .. package.path
local stub = require("wow_client_stub")
local H = require("queue_helpers")
local print = stub.print
local Expect, Failures = H.Expecter(print)
local world = stub.world
stub.SetClient("16001"); stub.ResetSound(); stub.ResetTimers()

-- The client's abandon, which Spoken Quests hooks: the quest chosen to abandon, then the call.
local abandoning
_G.C_QuestLog = _G.C_QuestLog or {}
C_QuestLog.GetAbandonQuest = function() return abandoning end
C_QuestLog.AbandonQuest = function() end

local VO = stub.LoadQuests(here .. "/../../addons/Spoken_Quests/", here .. "/../../addons/Spoken/")
local Spoken = _G.Spoken
VO.Addon:OnInitialize()
local source = Spoken:GetSource("quests")
local Event = VO.Enums.SoundEvent
-- Every stop and how long it fades, and every line that starts.
local fades, started = {}, {}
local StopSound = _G.StopSound
_G.StopSound = function(handle, fadeMs) table.insert(fades, fadeMs or 0); return StopSound(handle, fadeMs) end
Spoken:RegisterCallback("CLIP_STARTED", function(clip) table.insert(started, clip.present.label) end)

local function Line(key, questID, event)
    return H.Clip({ key = key, length = 20, questID = questID, event = event,
        present = { header = "Grull", label = key, portrait = { kind = "none" } } })
end

---------------------------------------------------------------- the quest's lines, one speaking
source:Enqueue(Line("accept", 101, Event.QuestAccept))
source:Enqueue(Line("progress", 101, Event.QuestProgress))
stub.Advance(1)
Expect("the quest's first line is speaking, its next waiting", #Spoken:GetQueue(), 2)
fades, started = {}, {}
abandoning = 101
C_QuestLog.AbandonQuest()
Expect("abandoning the quest takes its lines out of the queue", #Spoken:GetQueue(), 0)
Expect("...the one speaking fading out, as Skip's does, not cut", table.concat(fades, ","), "400")
Expect("...and the quest's next line never starting on the way", #started, 0)

---------------------------------------------------------------- another quest's line goes on
source:Enqueue(Line("accept", 101, Event.QuestAccept))
source:Enqueue(Line("other", 202, Event.QuestAccept))
stub.Advance(1)
fades, started = {}, {}
abandoning = 101
C_QuestLog.AbandonQuest()
Expect("another quest's line stays, and plays next", #Spoken:GetQueue() == 1 and Spoken:GetQueue()[1].questID, 202)
Expect("...the abandoned line cut at once for it, not faded", table.concat(fades, ","), "0")
Expect("...and that line starting in its place", table.concat(started, ","), "other")
Spoken:StopAll()

if Failures() > 0 then print(string.format("\n%d failure(s)", Failures())); os.exit(1) end
print("\nAll quest abandon tests passed")
