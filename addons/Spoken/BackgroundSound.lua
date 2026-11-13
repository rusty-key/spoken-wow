setfenv(1, SpokenEnv)

-- Keeps a line audible while the game window is in the background. The client mutes itself
-- there unless its Sound in Background setting is on, so Spoken turns that on while a line
-- speaks and puts it back once the queue is empty.
--
-- The setting is a client CVar, saved with the game's settings, so it is handled as OtherSounds
-- handles the volumes: only a value Spoken changed is put back, never one the player changed
-- since, and the player's value is written down first, so a session that ends without a logout
-- has it put back at the next login.
BackgroundSound = {}

local CVAR = "Sound_EnableSoundWhenGameIsInBG"

local function Read()
    return GetCVar(CVAR)
end

local function On(value) return tonumber(value) == 1 end

-- AceDB strips the settings still at their defaults at logout, the Audio table with them.
local function Wanted()
    local audio = Addon.db and Addon.db.profile.Audio
    return audio and audio.KeepTalkingInBackground
end

--- Only where the client has the setting.
function BackgroundSound:IsAvailable()
    return Wanted() ~= nil and Read() ~= nil
end

-- The player's value from before Spoken turned the setting on, or nil while Spoken has not.
BackgroundSound.original = nil

local function Persist()
    Addon.db.global.BackgroundSound = BackgroundSound.original
end

-- Our own writes, told apart from the player's in CVAR_UPDATE.
local function Write(value)
    BackgroundSound.writing = true
    SetCVar(CVAR, value)
    BackgroundSound.writing = false
end

function BackgroundSound:TurnOn()
    if self.original then return end
    local value = Read()
    if value == nil or On(value) then return end
    self.original = value
    Persist()
    Write("1")
end

--- The player's value back, unless the player has changed the setting since.
function BackgroundSound:PutBack()
    if not self.original then return end
    if On(Read()) then Write(self.original) end
    self.original = nil
    Persist()
end

--- On while a line speaks, and back once the queue is empty. Called on every queue change.
function BackgroundSound:Sync()
    if not self:IsAvailable() then return end
    local head = SoundQueue:GetCurrentSound()
    if Wanted() and head and SoundQueue:IsPlaying() then
        self:TurnOn()
    elseif not Wanted() or not head then
        self:PutBack()
    end
end

-- What CVAR_UPDATE names the setting by: the CVar, or on older option panels its label's key.
local NAMES = { [string.lower(CVAR)] = true, enable_bgsound = true }

--- The player changing the setting in the game's options while Spoken holds it: theirs again.
function BackgroundSound:OnCVarUpdate(name)
    if self.writing or not self.original or type(name) ~= "string" or not NAMES[string.lower(name)] then return end
    self.original = nil
    Persist()
end

--- A value a previous session changed and never put back: it ended without a logout.
function BackgroundSound:RestoreLeftover()
    local leftover = Addon.db.global.BackgroundSound
    if leftover == nil or self.original then return end
    if On(Read()) then Write(leftover) end
    Addon.db.global.BackgroundSound = nil
end

Callbacks:Register("AUDIO_CHANGED", function() BackgroundSound:Sync() end)
Callbacks:Register("CLIP_STARTED", function() BackgroundSound:Sync() end)
Callbacks:Register("QUEUE_EMPTY", function() BackgroundSound:Sync() end)

-- PLAYER_LOGOUT fires on /reload too, and the client writes its CVars after it: putting the
-- value back here keeps a reload mid-line from saving it changed.
local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_LOGIN")
events:RegisterEvent("PLAYER_LOGOUT")
events:RegisterEvent("CVAR_UPDATE")
events:SetScript("OnEvent", function(_, event, name)
    if event == "PLAYER_LOGOUT" then
        if Addon.db then BackgroundSound:PutBack() end
    elseif event == "CVAR_UPDATE" then
        BackgroundSound:OnCVarUpdate(name)
    elseif Addon.db then
        BackgroundSound:RestoreLeftover()
    end
end)
