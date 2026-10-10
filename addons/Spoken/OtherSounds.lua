setfenv(1, SpokenEnv)

-- Turns the game's other sounds down while a line is spoken, and back up once the queue
-- falls quiet. Ported from LoreTeller Forever's ducking, with three things it lacked: each
-- channel has a level of its own, the channel the voice plays on is never lowered, and a
-- volume the player changes in the game's options mid-line is kept rather than overwritten
-- when the line ends.
--
-- The volumes are client CVars, saved with the game's settings, so every value this file
-- lowers is written down first: at logout it is put back directly, and if the session ended
-- without a logout (a crash, a killed client) the next login puts it back from the copy.
OtherSounds = {}

local CHANNELS = { "Music", "Ambience", "SFX", "Dialog" }
local FADE_SECONDS, STEP = .8, .05
-- How long the queue may sit silent before the volumes come back. Longer than the gap between
-- two queued lines, which would otherwise pump the music down and up again between them.
local SETTLE_SECONDS = 1.2
-- Below this a difference is the CVar's own rounding, not the player moving a slider.
local EPSILON = .005

local function Config()
    return Addon.db and Addon.db.profile.Audio.LowerOthers
end
local function CVar(channel) return "Sound_" .. channel .. "Volume" end
local function Read(channel) return tonumber(GetCVar(CVar(channel))) or 1 end

--- Not on the legacy clients: 2.4.3 and 3.3.5 speak through the music channel itself, and
--- 1.12 names its volumes differently.
function OtherSounds:IsAvailable()
    return not Version.IsAnyLegacy and Config() ~= nil
end

-- What each lowered channel goes back to, and what this file last set it to. A channel whose
-- volume no longer matches what was set has been moved by the player, and is theirs again.
OtherSounds.original, OtherSounds.applied = {}, {}

local function Persist()
    local copy
    for channel, value in pairs(OtherSounds.original) do
        copy = copy or {}
        copy[channel] = value
    end
    Addon.db.global.LoweredVolumes = copy
end

-- Forget any channel the player has moved since it was last set.
local function Release()
    local released = false
    for channel, value in pairs(OtherSounds.applied) do
        if math.abs(Read(channel) - value) > EPSILON then
            OtherSounds.original[channel], OtherSounds.applied[channel] = nil, nil
            released = true
        end
    end
    if released then Persist() end
end

local function Set(channel, value)
    SetCVar(CVar(channel), value)
    OtherSounds.applied[channel] = Read(channel)
end

function OtherSounds:StopFade()
    if self.fadeTimer then
        Addon:CancelTimer(self.fadeTimer)
        self.fadeTimer = nil
    end
end

--- Slide every channel that has an original towards `targets`, then call `done`.
function OtherSounds:FadeTo(targets, done)
    self:StopFade()
    Release()
    local from, progress = {}, 0
    for channel in pairs(self.original) do
        local start = Read(channel)
        -- A channel already where it is going -- the voice's own, or one left at 100% -- is not
        -- rewritten every step. It is still marked as set at this level, so the player moving it
        -- mid-line makes it theirs (Release) just as it would one that is fading.
        if targets[channel] ~= nil and targets[channel] ~= start then
            from[channel] = start
        else
            self.applied[channel] = start
        end
    end
    local function Step()
        progress = math.min(1, progress + STEP / FADE_SECONDS)
        Release()
        for channel, start in pairs(from) do
            if self.original[channel] then
                Set(channel, start + (targets[channel] - start) * progress)
            end
        end
        if progress >= 1 then
            self:StopFade()
            if done then done() end
        end
    end
    self.fadeTimer = Addon:ScheduleRepeatingTimer(Step, STEP)
    Step()
end

--- The level each channel goes to while `voice` speaks: its original times its setting, and
--- the voice's own channel left alone. Master carries the voice itself, so it never moves.
function OtherSounds:Targets(voice)
    local cfg, targets = Config(), {}
    for channel, value in pairs(self.original) do
        targets[channel] = channel == voice and value or value * (cfg[channel] or 1)
    end
    return targets
end

function OtherSounds:Lower(voice)
    if not self.lowered then
        self.lowered = true
        self.original, self.applied = {}, {}
        for _, channel in ipairs(CHANNELS) do self.original[channel] = Read(channel) end
        Persist()
    end
    self.voice, self.restoring = voice, false
    self:FadeTo(self:Targets(voice))
end

function OtherSounds:Restore(immediately)
    if not self.lowered then return end
    if self.settleTimer then
        Addon:CancelTimer(self.settleTimer)
        self.settleTimer = nil
    end
    self.restoring = true
    local function Finished()
        self.lowered, self.voice, self.restoring = false, nil, false
        self.original, self.applied = {}, {}
        Persist()
    end
    if immediately then
        self:StopFade()
        Release()
        for channel, value in pairs(self.original) do Set(channel, value) end
        Finished()
        return
    end
    self:FadeTo(self.original, Finished)
end

--- Lowered while something is actually speaking, so a pause or a line held for combat lets
--- the game be heard again. Called on every queue change.
function OtherSounds:Sync()
    local cfg = Config()
    if not cfg then return end
    local head = SoundQueue:GetCurrentSound()
    if cfg.Enabled and head and SoundQueue:IsPlaying() then
        if self.settleTimer then
            Addon:CancelTimer(self.settleTimer)
            self.settleTimer = nil
        end
        local voice = head.source and head.source:GetChannel() or "Master"
        -- Also when the volumes are on their way back up: a line that starts then turns
        -- them down again from wherever the fade had reached.
        if not self.lowered or self.restoring or voice ~= self.voice then self:Lower(voice) end
    elseif self.lowered and not self.restoring and not self.settleTimer then
        -- Switched off mid-line: back at once, rather than after the line that is ending.
        if not cfg.Enabled then self:Restore(); return end
        self.settleTimer = Addon:ScheduleTimer(function()
            self.settleTimer = nil
            self:Restore()
        end, SETTLE_SECONDS)
    end
end

--- A level moved in the settings while a line speaks applies at once.
function OtherSounds:RefreshConfig()
    if self.lowered and Config().Enabled then
        self:FadeTo(self:Targets(self.voice))
    else
        self:Sync()
    end
end

--- Volumes a previous session lowered and never put back: it ended without a logout.
function OtherSounds:RestoreLeftovers()
    local leftover = Addon.db.global.LoweredVolumes
    if type(leftover) ~= "table" or self.lowered then return end
    for channel, value in pairs(leftover) do
        if tonumber(value) then SetCVar(CVar(channel), value) end
    end
    Addon.db.global.LoweredVolumes = nil
end

Callbacks:Register("AUDIO_CHANGED", function() OtherSounds:Sync() end)
Callbacks:Register("CLIP_STARTED", function() OtherSounds:Sync() end)
Callbacks:Register("QUEUE_EMPTY", function() OtherSounds:Sync() end)

-- PLAYER_LOGOUT fires on /reload too, and the client writes its CVars after it: putting the
-- volumes back here is what keeps a reload mid-line from saving them lowered. Gated on what was
-- lowered, never on the settings: AceDB's own handler runs first and strips every setting still
-- at its default, so a player who never moved these levels has none left by now.
local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_LOGIN")
events:RegisterEvent("PLAYER_LOGOUT")
events:SetScript("OnEvent", function(_, event)
    event = event or _G.event
    if event == "PLAYER_LOGOUT" then
        OtherSounds:Restore(true)
    elseif Addon.db and OtherSounds:IsAvailable() then
        OtherSounds:RestoreLeftovers()
    end
end)
