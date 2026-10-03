setfenv(1, SpokenEnv)

-- The one queue every source speaks through. Ported from ZoneLore's SoundQueue.lua,
-- itself a port of AI_VoiceOver's, and generalised: what was zone-shaped there is a
-- source here, and what was quest-shaped upstream lives in the quests addon's source.
--
-- The policy, in one place:
--
--  * ONE FIFO, IN ADMISSION ORDER, ACROSS EVERY SOURCE. A new clip is appended. Nothing
--    interrupts, displaces or reorders a clip that is already speaking. There is no
--    cross-source priority.
--  * A LOW-PRIORITY CLIP YIELDS AT THE DOOR, both ways: refused if a normal clip is
--    queued or speaking, and a waiting low clip is dropped when a normal one arrives.
--    Never the one speaking -- that would be an interruption. This generalises
--    VoiceOverRedux's "no gossip while a quest line is queued" and closes its hole,
--    where a quest arriving after gossip did nothing.
--  * GATES HOLD, THEY DO NOT DROP. A gate is a reason the head may not start yet --
--    combat, a cinematic. Held clips are retried once a second.
--  * A HELD HEAD IS SKIPPED, NOT BLOCKING. The first clip no gate holds moves to the
--    front and plays; the held one plays when its gate clears. Without this a zone
--    narration held for combat would keep a quest line waiting behind it.
--  * A SOURCE'S QUEUE LIMIT TRIMS ITS OWN WAITING CLIPS, oldest first, never the head
--    and never another source's. Narration that has fallen minutes behind is describing
--    somewhere the player already left; a quest line behind it is not.
--
-- Gap between clips is per source. Upstream's 0.55 s absorbs durations that are slightly
-- short; ZoneLore's are exact and it uses 0.25. Not worth unifying; the knob is one field.

---@class SpokenClip
---@field key string          Caller-unique. The dedup key.
---@field path string         Full path handed to PlaySoundFile.
---@field length number       Seconds. The client cannot report this; the caller must know.
---@field delay? number       Silence before the clip. Only the 2.4.3/3.3.5 path sets it.
---@field priority? string    "normal" (default) or "low".
---@field present table       See API.lua.
---@field addedCallback? fun(clip)
---@field startCallback? fun(clip)
---@field stopCallback? fun(clip, finishedPlaying)
--- Set by the player, never by the caller:
---@field id number
---@field handle number|nil
---@field source table
---@field nextSoundTimer any  Set ONLY while actually speaking. The liveness test.

SoundQueue = {
    soundIdCounter = 0,
    ---@type SpokenClip[]
    sounds = {},
}

local RETRY_INTERVAL = 1
local gates = {}
local retryTicker = nil

--------------------------------------------------------------------------------
-- Reading
--------------------------------------------------------------------------------

function SoundQueue:GetQueueSize()
    return getn(self.sounds)
end

function SoundQueue:IsEmpty()
    return self:GetQueueSize() == 0
end

--- The head: speaking, paused, or held. Queue rows read this.
function SoundQueue:GetCurrentSound()
    return self.sounds[1]
end

--- The head only if it is actually speaking or paused mid-clip. Controls read this: a
--- clip held by a gate sits at the head making no sound, and offering Pause over
--- silence lies.
function SoundQueue:GetNowPlaying()
    local head = self.sounds[1]
    if head and (head.nextSoundTimer or self:IsPaused()) then
        return head
    end
    return nil
end

--- A shallow copy. Mutate the queue through its methods.
function SoundQueue:GetQueue()
    local copy = {}
    for i, clip in ipairs(self.sounds) do
        copy[i] = clip
    end
    return copy
end

--- How many are waiting behind whatever is speaking.
function SoundQueue:GetWaitingCount()
    return self:GetQueueSize() - (self:IsPlaying() and 1 or 0)
end

function SoundQueue:IsPlaying(clip)
    local head = self.sounds[1]
    if clip then
        return (head == clip and head.nextSoundTimer) and true or false
    end
    return (head and head.nextSoundTimer) and true or false
end

function SoundQueue:IsPaused()
    return Addon.db and Addon.db.char.IsPaused or false
end

function SoundQueue:SetPaused(value)
    if Addon.db then
        Addon.db.char.IsPaused = value
    end
end

function SoundQueue:CanBePaused()
    return not self:IsPlaying() or self:GetCurrentSound().handle ~= nil
end

local function CountFor(source)
    local n = 0
    for _, clip in ipairs(SoundQueue.sounds) do
        if clip.source == source then
            n = n + 1
        end
    end
    return n
end

local function IsLow(clip)
    return clip.priority == "low"
end

--------------------------------------------------------------------------------
-- Gates
--------------------------------------------------------------------------------

--- Player-wide: applies to every source.
function SoundQueue:AddGate(fn)
    table.insert(gates, fn)
end

--- Why the clip is not playing, or nil. Player gates first, then its source's.
function SoundQueue:GetHeldReason(clip)
    for _, gate in ipairs(gates) do
        local reason = gate(clip)
        if reason then
            return reason
        end
    end
    if clip.source then
        for _, gate in ipairs(clip.source.gates) do
            local reason = gate(clip)
            if reason then
                return reason
            end
        end
    end
    return nil
end

local function StopRetryTicker()
    if retryTicker then
        Addon:CancelTimer(retryTicker)
        retryTicker = nil
    end
end

-- Leaving combat fires no event worth binding a handler to, so this is a poll. AceTimer
-- rather than C_Timer, which 1.12 does not have.
local function StartRetryTicker()
    if retryTicker then
        return
    end
    retryTicker = Addon:ScheduleRepeatingTimer(function()
        SoundQueue:Advance()
    end, RETRY_INTERVAL)
end

--------------------------------------------------------------------------------
-- Leaving the queue
--------------------------------------------------------------------------------

-- Notify a source when its first clip enters and its last leaves. The quests addon
-- hangs the Sound_EnableDialog toggle off these.
local function EnteredFor(source)
    if source.onQueueEnter and CountFor(source) == 1 then
        source.onQueueEnter()
    end
end

local function LeftFor(source)
    if source.onQueueEmpty and CountFor(source) == 0 then
        source.onQueueEmpty()
    end
end

local function AfterRemoval()
    if SoundQueue:IsEmpty() then
        StopRetryTicker()
        SoundQueue:MuteGameDialogue(nil)
        Callbacks:Fire("QUEUE_EMPTY")
    end
end

-- A clip that never reached the speaker: trimmed, outranked, or refused by the client.
-- It is not stopped -- there was nothing to stop -- and its stopCallback still fires so a
-- caller that set one up on admission gets to tear it down.
local function Discard(clip, reason)
    for index, queued in ipairs(SoundQueue.sounds) do
        if queued == clip then
            table.remove(SoundQueue.sounds, index)
            break
        end
    end
    if clip.stopCallback then
        clip.stopCallback(clip, false)
    end
    Callbacks:Fire("CLIP_DROPPED", clip, reason)
    if clip.source then
        LeftFor(clip.source)
    end
    AfterRemoval()
end

---@param clip SpokenClip
---@param finishedPlaying? boolean
function SoundQueue:RemoveSoundFromQueue(clip, finishedPlaying)
    if not clip then
        return false
    end

    local removedIndex = nil
    for index, queued in ipairs(self.sounds) do
        if queued.id == clip.id then
            if index == 1 and not self:CanBePaused() and not finishedPlaying then
                return false
            end
            removedIndex = index
            table.remove(self.sounds, index)
            break
        end
    end
    if not removedIndex then
        return false
    end

    local wasSpeaking = clip.nextSoundTimer ~= nil
    if removedIndex == 1 then
        if not finishedPlaying then
            SoundUtils:StopSound(clip)
        else
            clip.handle = nil
        end
        if clip.nextSoundTimer then
            Addon:CancelTimer(clip.nextSoundTimer)
            clip.nextSoundTimer = nil
        end
    end

    if clip.stopCallback then
        clip.stopCallback(clip, finishedPlaying and true or false)
    end
    Callbacks:Fire("CLIP_STOPPED", clip, finishedPlaying and true or false)
    if clip.source then
        LeftFor(clip.source)
    end

    if removedIndex == 1 or wasSpeaking then
        self:Advance()
    end
    AfterRemoval()
    Callbacks:Fire("AUDIO_CHANGED")
    return true
end

--- Everything, every source, and the paused flag with it: Stop means silence, not
--- "carry on once the pull ends".
function SoundQueue:RemoveAllSoundsFromQueue()
    for i = self:GetQueueSize(), 1, -1 do
        local clip = self.sounds[i]
        if clip then
            if i == 1 and not self:CanBePaused() then
                break
            end
            self:RemoveSoundFromQueue(clip)
        end
    end
    StopRetryTicker()
    self:SetPaused(false)
end

--- Only this source's clips; the others keep their place.
function SoundQueue:RemoveSource(source)
    for i = self:GetQueueSize(), 1, -1 do
        local clip = self.sounds[i]
        if clip and clip.source == source then
            self:RemoveSoundFromQueue(clip)
        end
    end
end

--- End the head and let the backlog run.
function SoundQueue:Skip()
    return self:RemoveSoundFromQueue(self:GetCurrentSound())
end

--------------------------------------------------------------------------------
-- Playing
--------------------------------------------------------------------------------

--- Silence the client's own NPC dialogue while we speak, and let it back when the queue
--- drains. `speakingOn` is the channel being spoken on, or nil when nothing is.
---
--- Never the channel we are speaking on: muting that would mute the line. On 1.12 there is
--- no Dialog channel to mute, and what the client can do is cut a bark already playing, so
--- the effects channel is toggled off and straight back on as the line starts.
---@param speakingOn string|nil
function SoundQueue:MuteGameDialogue(speakingOn)
    if not Addon.db.profile.Audio.AutoToggleDialog then
        return
    end
    if Version.IsLegacyVanilla then
        if speakingOn then
            SetCVar("MasterSoundEffects", 0)
            SetCVar("MasterSoundEffects", 1)
        end
        return
    end
    SoundUtils:MuteChannel("Dialog", speakingOn ~= nil and speakingOn ~= "Dialog")
end

-- How long a mute taken ahead of a line holds with nothing queued. Quest lines are read
-- once the dialog's globals have held still for 0.4s, gossip 0.1s after its event; past
-- this nothing is coming, and the next NPC's greeting should be heard.
local MUTE_AHEAD_SECONDS = 1.5
local muteAheadTimer

--- Mute the game's dialogue now, for a line that will be queued shortly. The client
--- starts an NPC's greeting as the dialog opens, and a line needs a moment to be read off
--- the dialog after that: muting only once the line starts cut the greeting off mid-word.
--- Muted in the same frame the dialog opened, the greeting is never heard at all.
---@param speakingOn string The channel the coming line will play on.
function SoundQueue:MuteGameDialogueAhead(speakingOn)
    -- Paused, the line will only queue: nothing of ours is going to speak over the greeting.
    if self:IsPaused() then
        return
    end
    -- On 1.12 muting is cutting every sound, which would cut a line already speaking.
    if Version.IsLegacyVanilla and not self:IsEmpty() then
        return
    end
    self:MuteGameDialogue(speakingOn)
    if muteAheadTimer then
        Addon:CancelTimer(muteAheadTimer)
    end
    muteAheadTimer = Addon:ScheduleTimer(function()
        muteAheadTimer = nil
        -- A line speaking lifts the mute itself when the queue drains. One merely queued --
        -- held by a gate, or paused since -- may not speak for a long while, and must not
        -- keep the game's dialogue silent until it does.
        local head = self:GetCurrentSound()
        if not (head and head.nextSoundTimer) then
            self:MuteGameDialogue(nil)
        end
    end, MUTE_AHEAD_SECONDS)
end

---@param clip SpokenClip
function SoundQueue:PlaySound(clip)
    local channel = clip.source:GetChannel()
    -- Whatever we muted, we cannot speak on. Lifted first, so a clip on the very channel
    -- the last line silenced is heard.
    if SoundUtils:IsMutedByPlayer(channel) then
        SoundUtils:MuteChannel(channel, false)
    end
    local willPlay = SoundUtils:PlaySound(clip, channel)
    if not willPlay then
        Discard(clip, "missing")
        self:Advance()
        return
    end

    self:MuteGameDialogue(channel)

    if clip.startCallback then
        clip.startCallback(clip)
    end
    Callbacks:Fire("CLIP_STARTED", clip)

    -- The client fires no event when a sound finishes, so the recorded duration is the
    -- only signal that the clip is over.
    clip.nextSoundTimer = Addon:ScheduleTimer(function()
        self:RemoveSoundFromQueue(clip, true)
    end, (clip.delay or 0) + clip.length + clip.source.interClipGap)
end

--- Start something if nothing is speaking and something may. Safe to call at any time;
--- the ticker and every queue mutation route through here.
function SoundQueue:Advance()
    local head = self.sounds[1]
    if not head or head.nextSoundTimer or self:IsPaused() then
        StopRetryTicker()
        return
    end

    -- The first clip no gate holds. A held head is skipped, not waited on.
    local playable = nil
    for index, clip in ipairs(self.sounds) do
        if not self:GetHeldReason(clip) then
            playable = index
            break
        end
    end
    if not playable then
        StartRetryTicker()
        return
    end
    if playable > 1 then
        local clip = table.remove(self.sounds, playable)
        table.insert(self.sounds, 1, clip)
    end

    StopRetryTicker()
    self:PlaySound(self.sounds[1])
    Callbacks:Fire("AUDIO_CHANGED")
end

--------------------------------------------------------------------------------
-- Admission
--------------------------------------------------------------------------------

-- Trim this source's backlog, oldest first, never the head and never the clip being
-- admitted: PlayNow front-inserts, so queue position is not age, and a clicked clip
-- that fell to the trim would be the one thing the player asked for.
local function TrimBacklog(source, admitted)
    if not source.queueLimit then
        return
    end
    while true do
        local waiting, oldest = 0, nil
        for index, clip in ipairs(SoundQueue.sounds) do
            local isHead = index == 1 and SoundQueue:IsPlaying()
            if clip.source == source and not isHead then
                waiting = waiting + 1
                if clip ~= admitted and (not oldest or clip.id < oldest.id) then
                    oldest = clip
                end
            end
        end
        if waiting <= source.queueLimit or not oldest then
            return
        end
        Discard(oldest, "queue-limit")
    end
end

-- A normal clip arriving drops every waiting low clip. Never the one speaking.
local function DropOutrankedWaiting()
    for i = SoundQueue:GetQueueSize(), 1, -1 do
        local clip = SoundQueue.sounds[i]
        if clip and IsLow(clip) and not (i == 1 and SoundQueue:IsPlaying()) then
            Discard(clip, "outranked")
        end
    end
end

local function AnyNormalQueued()
    for _, clip in ipairs(SoundQueue.sounds) do
        if not IsLow(clip) then
            return true
        end
    end
    return false
end

--- Admit a clip. Returns the clip, or nil and why not.
---@param clip SpokenClip
---@param source table
---@param front boolean
function SoundQueue:Add(clip, source, front)
    if not clip then
        return nil, "no clip"
    end
    if Sources:IsTurnedOff(source) then
        return nil, L.PART_TURNED_OFF
    end

    local inaudible = SoundUtils:WhyInaudible(source:GetChannel())
    if inaudible and not SoundUtils:IsMutedByPlayer(source:GetChannel()) then
        return nil, inaudible
    end

    if source.admit then
        local ok, reason = source.admit(clip, self)
        if not ok then
            reason = reason or "refused"
            Callbacks:Fire("CLIP_DROPPED", clip, reason)
            return nil, reason
        end
    end

    if source.testBeforeQueue and not SoundUtils:TestSound(clip, source:GetChannel()) then
        return nil, "missing"
    end

    for _, queued in ipairs(self.sounds) do
        if queued.key == clip.key then
            return nil, "duplicate"
        end
    end

    if IsLow(clip) then
        if AnyNormalQueued() then
            Callbacks:Fire("CLIP_DROPPED", clip, "outranked")
            return nil, "outranked"
        end
    else
        DropOutrankedWaiting()
    end

    self.soundIdCounter = self.soundIdCounter + 1
    clip.id = self.soundIdCounter
    clip.source = source
    if front then
        table.insert(self.sounds, 1, clip)
    else
        table.insert(self.sounds, clip)
    end
    EnteredFor(source)
    TrimBacklog(source, clip)

    if clip.addedCallback then
        clip.addedCallback(clip)
    end
    Callbacks:Fire("CLIP_QUEUED", clip)

    self:Advance()
    Callbacks:Fire("AUDIO_CHANGED")
    return clip
end

--- Put this at the front and start it now. The one deliberate interruption: the player
--- clicked Play, and appending would break that twice over -- behind a backlog it is a
--- wait, behind a held head it may never arrive. Whatever was speaking is stopped and
--- kept, so it resumes after. Producers append; only a human front-inserts.
---@return boolean playing
function SoundQueue:PlayNow(clip, source)
    if not clip then
        return false
    end
    -- A reason, so a Play button clicked by hand says why nothing happened.
    if Sources:IsTurnedOff(source) then
        return false, L.PART_TURNED_OFF
    end

    local inaudible = SoundUtils:WhyInaudible(source:GetChannel())
    if inaudible and not SoundUtils:IsMutedByPlayer(source:GetChannel()) then
        return false, inaudible
    end

    -- Clicking Play on something already waiting should play it, not be swallowed by
    -- the dedup.
    for index = self:GetQueueSize(), 1, -1 do
        if self.sounds[index].key == clip.key then
            self:RemoveSoundFromQueue(self.sounds[index])
        end
    end

    local head = self:GetCurrentSound()
    if head and head.nextSoundTimer then
        SoundUtils:StopSound(head)
        Addon:CancelTimer(head.nextSoundTimer)
        head.nextSoundTimer = nil
        if head.stopCallback then
            head.stopCallback(head, false)
        end
        Callbacks:Fire("CLIP_STOPPED", head, false)
    end

    -- Resuming is what a paused player expects from pressing Play on something new.
    self:SetPaused(false)
    local added, reason = self:Add(clip, source, true)
    if not added then
        self:Advance()
        return false, reason
    end
    return self:IsPlaying()
end

--------------------------------------------------------------------------------
-- Pause
--------------------------------------------------------------------------------

-- Pause is stop, and resume replays from the beginning. The client can start and stop
-- a sound and nothing in between: there is no seek, and no way to ask how far into a
-- clip playback has reached. The tooltip says so rather than letting the player find
-- out forty seconds in.
-- How long a paused voice takes to fade out.
local PAUSE_FADE_MS = 400

function SoundQueue:PauseQueue()
    if self:IsPaused() then
        return false
    end
    self:SetPaused(true)

    local head = self:GetCurrentSound()
    if head and self:CanBePaused() then
        -- Faded out, not cut: a pause is the player stepping away, not an interruption.
        SoundUtils:StopSound(head, PAUSE_FADE_MS)
        if head.nextSoundTimer then
            Addon:CancelTimer(head.nextSoundTimer)
            head.nextSoundTimer = nil
        end
    end
    -- Nothing of ours is speaking, so the game may. Resuming plays the line, which mutes again.
    self:MuteGameDialogue(nil)

    StopRetryTicker()
    Callbacks:Fire("AUDIO_CHANGED")
    return true
end

function SoundQueue:ResumeQueue()
    if not self:IsPaused() then
        return false
    end
    self:SetPaused(false)
    self:Advance()
    Callbacks:Fire("AUDIO_CHANGED")
    return true
end

function SoundQueue:TogglePauseQueue()
    if self:IsPaused() then
        return self:ResumeQueue()
    end
    return self:PauseQueue()
end
