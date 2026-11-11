setfenv(1, SpokenEnv)

-- The one queue every source speaks through. What is specific to a domain (quests, places) lives
-- in its source, never here.
--
-- The policy, in one place:
--
--  * ONE FIFO, IN ADMISSION ORDER, ACROSS EVERY SOURCE. A new clip is appended. Nothing
--    interrupts, displaces or reorders a clip that is already speaking, except a gate
--    closing on it (below). There is no cross-source priority.
--  * A LOW-PRIORITY CLIP YIELDS AT THE DOOR, both ways: refused if a normal clip is
--    queued or speaking, and a waiting low clip is dropped when a normal one arrives.
--    Never the one speaking -- that would be an interruption. So gossip never plays while a
--    quest line is queued, whichever arrived first.
--  * GATES HOLD, THEY DO NOT DROP. A gate is a reason the head may not start yet --
--    combat, a cinematic. Held clips are retried once a second. Gates are asked before a
--    clip starts; a source that knows one of its own has just closed calls RecheckGates,
--    and its clip speaking is stopped and kept, to replay from the start once it opens.
--  * A HELD HEAD IS SKIPPED, NOT BLOCKING. The first clip no gate holds moves to the
--    front and plays; the held one plays when its gate clears. Without this a zone
--    narration held for combat would keep a quest line waiting behind it.
--  * A SOURCE'S QUEUE LIMIT TRIMS ITS OWN WAITING CLIPS, oldest first, never the head
--    and never another source's. Narration that has fallen minutes behind is describing
--    somewhere the player already left; a quest line behind it is not.
--
-- Gap between clips is per source: one whose recorded durations run slightly short needs a longer
-- gap than one whose are exact.

---@class SpokenClip
---@field key string          Caller-unique. The dedup key.
---@field path string         Full path handed to PlaySoundFile.
---@field length number       Seconds. The client cannot report this; the caller must know.
---@field priority? string    "normal" (default) or "low".
---@field group? string       Clips of one item, e.g. a book's pages. No pause or cue between them.
---@field continues? boolean  Its next part is put in as it ends (source:Continue). No pause or cue after it.
---@field span? table         { before, total }: seconds of its item before it, and in all (SoundQueue:Share).
---@field present table       See API.lua.
---@field pieces? string|number[] Seconds of each sentence piece, "3.44 2.6 5.1", where the pack keeps the line as pieces.
---@field addedCallback? fun(clip)
---@field startCallback? fun(clip)
---@field stopCallback? fun(clip, finishedPlaying)
--- Set by the player, never by the caller:
---@field id number
---@field handle number|nil
---@field source table
---@field nextSoundTimer any  Set ONLY while actually speaking. The liveness test.
---@field piece? number       The piece speaking, or the one a stopped line plays on from.

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
    return #self.sounds
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
    return (head and (not clip or head == clip) and head.nextSoundTimer) and true or false
end

function SoundQueue:IsPaused()
    return Addon.db and Addon.db.char.IsPaused or false
end

-- How the head was halted: "pause" plays on from its sentence, "stop" from its start. Kept off
-- the saved flag, since a reload never starts the queue halted.
local haltedBy = nil

function SoundQueue:SetPaused(value)
    if Addon.db then
        Addon.db.char.IsPaused = value
    end
    if not value then
        haltedBy = nil
    end
end

--- "pause" or "stop" while the queue is halted, nil while it is not. A line kept whole cannot
--- resume part-way, so its halt is always a stop: until a pack has pieces, Spoken is as it was.
function SoundQueue:HaltedBy()
    if not self:IsPaused() then return nil end
    if not self:Resumes(self:GetCurrentSound()) then return "stop" end
    return haltedBy or "pause"
end

function SoundQueue:CanBePaused()
    local current = self:GetCurrentSound()
    return not self:IsPlaying() or current.handle ~= nil or current.textOnly == true
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
-- Pieces
--------------------------------------------------------------------------------

-- A pack can keep a line as sentence pieces (a folder of 01.ogg, 02.ogg, ...; their lengths in
-- clip.pieces), played back to back as one clip. The client cannot start a sound part-way, so a
-- stopped line plays on from the start of the piece it was in.

-- Stopped this close to a piece's end, the sentence was heard: play on from the next one.
local PIECE_HEARD_MARGIN = 0.35

--- The clip's piece lengths, or nil where it plays as one file.
local function PieceLengths(clip)
    local pieces = clip.pieces
    if type(pieces) == "string" then
        local list = {}
        for length in pieces:gmatch("%S+") do
            local seconds = tonumber(length)
            -- A malformed row plays as no row: the line is lost rather than half-played.
            if not seconds or seconds <= 0 then
                list = nil
                break
            end
            list[#list + 1] = seconds
        end
        pieces = list
        clip.pieces = list
    end
    if type(pieces) ~= "table" or #pieces < 2 then
        return nil
    end
    return pieces
end

local function PiecePath(clip, index)
    local base, extension = clip.path:match("^(.*)%.(%w+)$")
    return format("%s\\%02d.%s", base or clip.path, index, extension or "ogg")
end

local function PieceStart(pieces, index)
    local start = 0
    for i = 1, (index or 1) - 1 do
        start = start + pieces[i]
    end
    return start
end

--- Where in its line `clip` speaks from: the start of its piece, or 0 for a line of one file.
function SoundQueue:PieceOffset(clip)
    local pieces = clip and PieceLengths(clip)
    return pieces and PieceStart(pieces, clip.piece) or 0
end

--- Whether a stopped `clip` plays on from its sentence rather than from its start.
function SoundQueue:Resumes(clip)
    -- A line of words alone restarts from 0 whatever its data says.
    return clip ~= nil and not clip.textOnly and PieceLengths(clip) ~= nil
end

local function KeepPlace(clip)
    local pieces = PieceLengths(clip)
    if pieces and clip.piece and clip.pieceEndsAt and clip.piece < #pieces
        and clip.pieceEndsAt - GetTime() < PIECE_HEARD_MARGIN then
        clip.piece = clip.piece + 1
    end
end

-- Stop backs up further than Pause: to the start of the text on screen, a "section", which the
-- captions know and the queue does not. Each finder is fn(clip, elapsed) and returns the seconds
-- into the line where the section on screen at `elapsed` begins, or nil where it shows none.
local sectionFinders = {}

--- The first finder to answer wins.
function SoundQueue:AddSectionFinder(fn)
    table.insert(sectionFinders, fn)
end

-- A section's start is estimated from the text where the line has no word times, so it may fall
-- a little after the sentence it begins with: this much slack still counts that sentence in.
local SECTION_SLACK = 0.3

-- The piece the section on screen at `elapsed` begins in, never later than the one speaking.
-- With no section on screen, the sentence: Stop then backs up as far as Pause.
local function SectionPiece(clip, elapsed)
    local pieces = PieceLengths(clip)
    local current = clip.piece or 1
    local at
    for _, finder in ipairs(sectionFinders) do
        local ok, seconds = pcall(finder, clip, elapsed)
        if ok and type(seconds) == "number" then
            at = seconds
            break
        end
    end
    if not at then return current end
    local index = 1
    for i = 2, current do
        if PieceStart(pieces, i) <= at + SECTION_SLACK then index = i end
    end
    return index
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

-- A gate is any source's own callback, and nothing tells the queue when one opens, so this is a poll.
local function StartRetryTicker()
    if retryTicker then
        return
    end
    retryTicker = Addon:ScheduleRepeatingTimer(function()
        SoundQueue:Advance()
    end, RETRY_INTERVAL)
end

local function CancelSpeakTimer(clip)
    if clip.nextSoundTimer then
        Addon:CancelTimer(clip.nextSoundTimer)
        clip.nextSoundTimer = nil
    end
end

-- Silence the head but keep its place: it replays from the start when Advance next
-- reaches it, since the client has no seek, or from its sentence where it is kept as pieces.
-- Shared by the two things allowed to cut a clip off without ending it -- a human pressing
-- Play, and a gate closing on it.
local function StopKeeping(head)
    KeepPlace(head)
    SoundUtils:StopSound(head)
    CancelSpeakTimer(head)
    if head.stopCallback then
        head.stopCallback(head, false)
    end
    Callbacks:Fire("CLIP_STOPPED", head, false)
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
        -- Nothing is left to hold: a queue left stopped would hold the next line it is given,
        -- silent, under a Stop the player can no longer see.
        if SoundQueue:IsPaused() then
            SoundQueue:SetPaused(false)
            Callbacks:Fire("AUDIO_CHANGED")
        end
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

-- The last line, skipped or taken away mid-word, fades out as Stop does rather than cutting
-- off. One with a line after it is cut: the next starts at once, and would talk over the fade.
local REMOVE_FADE_MS = 400

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
            SoundUtils:StopSound(clip, not self.sounds[1] and REMOVE_FADE_MS or nil)
        else
            clip.handle = nil
        end
        CancelSpeakTimer(clip)
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

--- End the head and let the backlog run. A stopped queue plays again: skipping is asking for
--- the next line. With no line, or one that cannot be stopped, nothing changes.
function SoundQueue:Skip()
    local head = self:GetCurrentSound()
    if not head or not self:CanBePaused() then return false end
    self:SetPaused(false)
    return self:RemoveSoundFromQueue(head)
end

--------------------------------------------------------------------------------
-- Playing
--------------------------------------------------------------------------------

--- Silence the client's own NPC dialogue while we speak, and let it back when the queue
--- drains. `speakingOn` is the channel being spoken on, or nil when nothing is.
---
--- Never the channel we are speaking on: muting that would mute the line.
---@param speakingOn string|nil
---@param cut boolean? switch it off at once rather than fade it out
function SoundQueue:MuteGameDialogue(speakingOn, cut)
    if not Addon.db.profile.Audio.AutoToggleDialog then
        return
    end
    -- Faded, so the NPC is not cut off mid-word; cut where it should not be heard at all.
    SoundUtils:MuteChannel("Dialog", speakingOn ~= nil and speakingOn ~= "Dialog", not cut)
end

-- How long a mute taken ahead of a line holds with nothing queued. Quest lines are read
-- once the dialog's globals have held still for 0.4s, gossip 0.1s after its event; past
-- this nothing is coming, and the next NPC's greeting should be heard.
local MUTE_AHEAD_SECONDS = 1.5
local muteAheadTimer

local function LiftMuteAhead()
    muteAheadTimer = nil
    -- A line speaking lifts the mute itself when the queue drains. One merely queued --
    -- held by a gate, or paused since -- may not speak for a long while, and must not
    -- keep the game's dialogue silent until it does. A line of words alone never holds the mute.
    local head = SoundQueue:GetCurrentSound()
    if not (head and head.nextSoundTimer and not head.textOnly) then
        SoundQueue:MuteGameDialogue(nil)
    end
end

--- Mute the game's dialogue now, for a line that will be queued shortly. The client
--- starts an NPC's greeting as the dialog opens, and a line needs a moment to be read off
--- the dialog after that: muting only once the line starts cut the greeting off mid-word.
--- Muted in the same frame the dialog opened, the greeting is never heard at all.
---@param speakingOn string The channel the coming line will play on.
---@return boolean? muted false when nothing was muted: paused, or the game's dialogue left alone
function SoundQueue:MuteGameDialogueAhead(speakingOn)
    -- Paused, the line will only queue: nothing of ours is going to speak over the greeting.
    -- With the game's dialogue left alone there is nothing to mute either.
    if self:IsPaused() or not Addon.db.profile.Audio.AutoToggleDialog then
        return false
    end
    -- Cut, not faded: in the frame the window opens the greeting has barely started, and a fade
    -- lets its first half-second through.
    self:MuteGameDialogue(speakingOn, true)
    if muteAheadTimer then
        Addon:CancelTimer(muteAheadTimer)
    end
    muteAheadTimer = Addon:ScheduleTimer(LiftMuteAhead, MUTE_AHEAD_SECONDS)
    return true
end

--- Whether a mute taken ahead still waits for its line, short of its deadline.
---@return boolean
function SoundQueue:IsMutingGameDialogueAhead()
    return muteAheadTimer ~= nil
end

--- The read a mute ahead was taken for found no line: give the game's dialogue back now rather
--- than at the deadline.
function SoundQueue:EndMuteGameDialogueAhead()
    if muteAheadTimer then
        Addon:CancelTimer(muteAheadTimer)
        LiftMuteAhead()
    end
end

-- The channel a clip speaks on, ready for it. Whatever we muted, we cannot speak on, so it
-- is lifted first: a clip on the very channel the last line silenced is heard.
local function SpeakingChannel(clip)
    local channel = clip.source:GetChannel()
    if SoundUtils:IsMutedByPlayer(channel) then
        SoundUtils:MuteChannel(channel, false)
    end
    return channel
end

-- Clips of one item, a book's pages, read on as one: no LineGap between them, and no cue.
local function SameItem(clip, nextClip)
    return clip.group ~= nil and clip.group == nextClip.group
end

-- The first clip from `from` on that no gate holds.
local function FirstPlayable(from)
    for index = from, #SoundQueue.sounds do
        if not SoundQueue:GetHeldReason(SoundQueue.sounds[index]) then
            return index, SoundQueue.sounds[index]
        end
    end
end

local function MoveToFront(index)
    local clip = table.remove(SoundQueue.sounds, index)
    table.insert(SoundQueue.sounds, 1, clip)
end

-- `clip`'s voice has ended. The pause after it, and the cue halfway through that pause, only
-- separate it from a line that will play next: the last line ends with its voice, and one a
-- gate holds waits out the gate, which separates it well enough. A clip that continues is
-- followed by its own next part, which is not in the queue yet, so what waits now is not next.
local function AfterSpoken(clip)
    local function Finish()
        SoundQueue:RemoveSoundFromQueue(clip, true)
    end
    local _, nextClip = FirstPlayable(2)
    if not nextClip and not clip.continues then
        Finish()
        return
    end
    local audio = Addon.db.profile.Audio
    local sameItem = clip.continues or SameItem(clip, nextClip)
    local gap = (clip.source.interClipGap or 0) + (sameItem and 0 or audio.LineGap or 0)
    if gap <= 0 then
        Finish()
    elseif sameItem or not audio.CueBetweenLines then
        clip.nextSoundTimer = Addon:ScheduleTimer(Finish, gap)
    else
        clip.nextSoundTimer = Addon:ScheduleTimer(function()
            -- For whichever line waits now: the one that did may have gone since the voice ended.
            local _, waiting = FirstPlayable(2)
            if waiting and not SameItem(clip, waiting) then
                -- On the next line's channel, so it follows the voice's volume, not the effects'.
                SoundUtils:PlayCue(SpeakingChannel(waiting))
            end
            clip.nextSoundTimer = Addon:ScheduleTimer(Finish, gap / 2)
        end, gap / 2)
    end
end

-- The client can stop our voice unannounced (alt-tab without Sound in Background, a cinematic),
-- leaving the timer and bar to run on in silence, so a voice gone early is stopped as Stop does.
-- The margin keeps a voice slightly shorter than its recorded length from reading as a cut.
local CUT_POLL, CUT_MARGIN = 0.5, 0.5

local function StopWatching(clip)
    if clip.cutWatch then
        Addon:CancelTimer(clip.cutWatch)
        clip.cutWatch = nil
    end
end

local function WatchForCut(clip)
    StopWatching(clip)
    if not (C_Sound and C_Sound.IsPlaying) or type(clip.handle) ~= "number" then
        return
    end
    local handle = clip.handle
    clip.cutWatch = Addon:ScheduleRepeatingTimer(function()
        -- A piece ends before its line does, and the next one has a new handle and watch.
        if not SoundQueue:IsPlaying(clip) or GetTime() >= (clip.pieceEndsAt or clip.spokenAt) - CUT_MARGIN then
            StopWatching(clip)
            return
        end
        local ok, playing = pcall(C_Sound.IsPlaying, handle)
        if ok and playing == false then
            StopWatching(clip)
            Developer:Log("player", "voice cut by the client, line stopped")
            SoundQueue:PauseQueue()
        end
    end, CUT_POLL)
end

-- Starts piece `index` of `clip` and records its handle on the clip, so Stop and the cut watch
-- act on the piece speaking. One refused leaves the last piece's, so Stop and Skip still work.
local function PlayPiece(clip, index, channel)
    local pieces = PieceLengths(clip)
    local piece = { path = PiecePath(clip, index) }
    local willPlay = SoundUtils:PlaySound(piece, channel)
    if not willPlay then return willPlay end
    -- The piece before has played its length; whatever of it is left is the pause it ends in.
    SoundUtils:StopSound(clip)
    clip.handle, clip.piece = piece.handle, index
    clip.pieceEndsAt = GetTime() + pieces[index]
    return willPlay
end

-- Each piece is timed from when the line started, so a timer's own rounding is not added up over
-- a long line. A join a frame hitch made late pushes the rest back, so no piece talks over the last.
local function ScheduleNextPiece(clip, channel, lineStartedAt)
    local pieces = PieceLengths(clip)
    local index = clip.piece
    local nextAt = lineStartedAt + PieceStart(pieces, index + 1)
    clip.nextSoundTimer = Addon:ScheduleTimer(function()
        if index >= #pieces then
            AfterSpoken(clip)
            return
        end
        local late = math.max(0, GetTime() - nextAt)
        if late > 0 then
            lineStartedAt, clip.spokenAt = lineStartedAt + late, clip.spokenAt + late
            -- The words keep their own clock; they wait as long as the voice did.
            Callbacks:Fire("VOICE_DELAYED", clip, late)
        end
        if not PlayPiece(clip, index + 1, channel) then
            -- A piece missing from the folder ends the line where it is, as the end of it would.
            Developer:Log("player", format("piece %d of %s is missing", index + 1, tostring(clip.key)))
            clip.spokenAt = GetTime()
            AfterSpoken(clip)
            return
        end
        ScheduleNextPiece(clip, channel, lineStartedAt)
        WatchForCut(clip)
    end, math.max(0, nextAt - GetTime()))
end

---@param clip SpokenClip
function SoundQueue:PlaySound(clip)
    local channel = SpeakingChannel(clip)
    clip.haltedAt = nil
    local pieces = not clip.textOnly and PieceLengths(clip)
    -- A text-only line has nothing to play and leaves the game's dialogue alone.
    local willPlay = clip.textOnly or (pieces and PlayPiece(clip, clip.piece or 1, channel))
        or (not pieces and SoundUtils:PlaySound(clip, channel))
    if not willPlay then
        Discard(clip, "missing")
        self:Advance()
        return
    end

    -- A line read off an NPC's window cuts its voice; one starting elsewhere (a zone's story) fades it.
    -- One of words alone lifts a mute a line before it took.
    if clip.textOnly then
        self:MuteGameDialogue(nil)
    else
        self:MuteGameDialogue(channel, clip.cutsGameDialogue)
    end

    if clip.startCallback then
        clip.startCallback(clip)
    end
    Callbacks:Fire("CLIP_STARTED", clip)

    -- The client fires no event when a sound finishes, so the recorded duration is the
    -- only signal that the clip is over.
    if pieces then
        local lineStartedAt = GetTime() - PieceStart(pieces, clip.piece)
        clip.spokenAt = lineStartedAt + clip.length
        ScheduleNextPiece(clip, channel, lineStartedAt)
    else
        clip.spokenAt = GetTime() + clip.length
        clip.nextSoundTimer = Addon:ScheduleTimer(function()
            AfterSpoken(clip)
        end, clip.length)
    end
    WatchForCut(clip)
end

--- How far through `clip` is, 0 to 1, `elapsed` seconds into its voice: through the whole item
--- where the clip is one part of it (clip.span, a book read as one line), else through itself.
function SoundQueue:Share(clip, elapsed)
    local length = tonumber(clip and clip.length) or 0
    if length <= 0 then return 0 end
    elapsed = math.max(0, math.min(length, elapsed or 0))
    local span = clip.span
    local share = span and span.total and span.total > 0 and (span.before + elapsed) / span.total
        or elapsed / length
    return math.max(0, math.min(1, share))
end

--- Seconds of `clip`'s voice heard so far: 0 before it starts, its length once it has ended.
function SoundQueue:VoiceElapsed(clip)
    local length = tonumber(clip.length) or 0
    return math.max(0, math.min(length, length - (clip.spokenAt - GetTime())))
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
    local playable = FirstPlayable(1)
    if not playable then
        StartRetryTicker()
        return
    end
    if playable > 1 then
        MoveToFront(playable)
    end

    StopRetryTicker()
    self:PlaySound(self.sounds[1])
    Callbacks:Fire("AUDIO_CHANGED")
end

--- Ask the gates again about the clip that is speaking, if it is `source`'s. They are
--- otherwise asked only before a clip starts, so a cinematic that begins a second after a
--- greeting did is talked over to its end. A clip a gate now holds is stopped and kept at
--- the head; whatever no gate holds plays meanwhile, and it replays once its gate opens.
---
--- Scoped to the caller's own clip: a source knows its own gate just closed, not why
--- another source's clip is still speaking -- one that kept going into a pull, say.
---@return boolean stopped  whether a speaking clip was cut off
function SoundQueue:RecheckGates(source)
    local head = self.sounds[1]
    if not head or head.source ~= source or not head.nextSoundTimer or not self:GetHeldReason(head) then
        return false
    end
    StopKeeping(head)
    -- Nothing of ours is speaking now. Advance mutes again if something else starts.
    self:MuteGameDialogue(nil)
    self:Advance()
    -- Advance announces a clip it starts; silence is this call's to announce.
    if not self:IsPlaying() then
        Callbacks:Fire("AUDIO_CHANGED")
    end
    return true
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

-- Why `clip` from `source` cannot be queued now, or nil: the part is switched off, or the channel
-- is silent and not by our own mute, which is lifted before the line plays. A line of words alone
-- needs no channel, whether its source has no recordings or only this line lacks one.
local function WhyRefused(source, clip)
    if Sources:IsTurnedOff(source) then
        return L.PART_TURNED_OFF
    end
    if source.textOnly or clip.textOnly then
        return nil
    end
    local channel = source:GetChannel()
    local inaudible = SoundUtils:WhyInaudible(channel)
    if inaudible and not SoundUtils:IsMutedByPlayer(channel) then
        return inaudible
    end
end

local function IsQueued(key)
    for _, queued in ipairs(SoundQueue.sounds) do
        if queued.key == key then
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
    local refused = WhyRefused(source, clip)
    if refused then
        return nil, refused
    end

    if source.admit then
        local ok, reason = source.admit(clip, self)
        if not ok then
            reason = reason or "refused"
            Callbacks:Fire("CLIP_DROPPED", clip, reason)
            return nil, reason
        end
    end

    -- A line kept as pieces has no file of its own: its first piece stands for it.
    local pieces = not (clip.textOnly or source.textOnly) and PieceLengths(clip)
    if source.testBeforeQueue
        and not SoundUtils:TestSound(pieces and { path = PiecePath(clip, 1) } or clip, source:GetChannel()) then
        return nil, "missing"
    end
    if pieces then
        -- The pieces' own sum, so the last one ends where the line's timer says it does.
        clip.length = PieceStart(pieces, #pieces + 1)
    end

    if IsQueued(clip.key) then
        return nil, "duplicate"
    end

    if IsLow(clip) then
        if AnyNormalQueued() then
            Callbacks:Fire("CLIP_DROPPED", clip, "outranked")
            return nil, "outranked"
        end
    else
        DropOutrankedWaiting()
    end

    -- Only once admitted: a refused add of a line already queued must not lose its place.
    clip.piece, clip.pieceEndsAt = nil, nil
    self.soundIdCounter = self.soundIdCounter + 1
    clip.id = self.soundIdCounter
    clip.source = source
    -- A source of words alone makes every line of it one.
    clip.textOnly = clip.textOnly or source.textOnly
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
    local refused = WhyRefused(source, clip)
    if refused then
        return false, refused
    end

    -- A line speaking or held by a gate goes on, and this one queues behind it. Only an idle or
    -- stopped queue plays it at once, which also ends the stop.
    local current = self:GetCurrentSound()
    if current and not self:IsPaused() then
        if IsQueued(clip.key) then return true end
        local queued, why = self:Add(clip, source)
        return queued and true or false, why
    end

    -- Clicking Play on something already waiting should play it, not be swallowed by
    -- the dedup. Another clip of its key gives way to it.
    for index = self:GetQueueSize(), 1, -1 do
        local queued = self.sounds[index]
        if queued ~= clip and queued.key == clip.key then
            self:RemoveSoundFromQueue(queued)
        end
    end

    local head = self:GetCurrentSound()
    if head and head.nextSoundTimer then
        StopKeeping(head)
    end

    self:SetPaused(false)
    -- The very clip waiting moves to the front as it is, never taken out and put back: taken out,
    -- its stopCallback ends what it carries on with, such as a book's pages still to come.
    for index, queued in ipairs(self.sounds) do
        if queued == clip then
            if index > 1 then
                MoveToFront(index)
            end
            self:Advance()
            Callbacks:Fire("AUDIO_CHANGED")
            return self:IsPlaying()
        end
    end
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

-- There is no pause: the client cannot seek or report how far a sound has played. Stop ends the
-- voice and keeps the line at the head; Replay plays it from the start, or from its sentence
-- where the line is kept as pieces. The functions keep their old names, which the public API
-- carries.
local PAUSE_FADE_MS = 400

function SoundQueue:PauseQueue()
    if self:IsPaused() then
        return false
    end
    self:SetPaused(true)
    haltedBy = "pause"

    local head = self:GetCurrentSound()
    -- Stopped in the pause after a line has spoken to its end: that line is over, and it is the
    -- next one Stop holds. Replay then plays the next line rather than the one already heard.
    if head and head.nextSoundTimer and head.spokenAt and GetTime() >= head.spokenAt then
        self:RemoveSoundFromQueue(head, true)
        -- It was the last: there is nothing left to hold, and the removal took the stop off.
        if self:IsEmpty() then
            return true
        end
        head = self:GetCurrentSound()
    end
    if head and self:CanBePaused() then
        if head.nextSoundTimer then
            -- Where the voice was, for a Stop that follows: once stopped, VoiceElapsed runs on.
            head.haltedAt = self:VoiceElapsed(head)
            KeepPlace(head)
        end
        -- Faded out, not cut: a pause is the player stepping away, not an interruption.
        SoundUtils:StopSound(head, PAUSE_FADE_MS)
        CancelSpeakTimer(head)
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

--- Stop: a longer halt than Pause. Play then goes back to the start of the section on screen, and
--- Replay to the start of the line.
function SoundQueue:StopQueue()
    if self:HaltedBy() == "stop" then
        return false
    end
    local before = self:GetCurrentSound()
    local wasPaused = self:IsPaused()
    if not wasPaused and not self:PauseQueue() then
        return false
    end
    -- A line that had spoken to its end is gone, and the queue with it when it was the last.
    if not self:IsPaused() then
        return true
    end
    local head = self:GetCurrentSound()
    if head then
        -- The line stopped is the one shown; one that took its place after the last ended starts over.
        local elapsed = head == before and head.haltedAt or nil
        head.piece = PieceLengths(head) and elapsed and SectionPiece(head, elapsed) or nil
        head.pieceEndsAt = nil
    end
    haltedBy = "stop"
    Callbacks:Fire("AUDIO_CHANGED")
    return true
end

--- Replay: the line at the head from its very start, whatever halted it.
function SoundQueue:ReplayQueue()
    local head = self:GetCurrentSound()
    if head then
        head.piece, head.pieceEndsAt = nil, nil
    end
    if self:IsPaused() then
        return self:ResumeQueue()
    end
    return false
end

--- Stop, or Replay a stopped line from its start. A paused line is stopped rather than played.
function SoundQueue:ToggleStopQueue()
    if self:HaltedBy() == "stop" then
        return self:ReplayQueue()
    end
    return self:StopQueue()
end
