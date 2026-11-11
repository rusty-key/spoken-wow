setfenv(1, SpokenEnv)

-- WoW Forever can use Discord as its active voice provider. Keep this separate from the
-- client's Discord-account setting: being linked is not the same thing as being in a voice
-- channel, and only the latter should silence Spoken.
DiscordVoice = {
    active = false,
}

local EVENTS = {
    "PLAYER_LOGIN",
    "PLAYER_ENTERING_WORLD",
    "VOICE_CHAT_ACTIVE_VOICE_PROVIDER_CHANGED",
    "VOICE_CHAT_VOICE_PROVIDER_CHANGED",
    "VOICE_CHAT_CONNECTION_SUCCESS",
    "VOICE_CHAT_LOGIN",
    "VOICE_CHAT_LOGOUT",
    "VOICE_CHAT_CHANNEL_JOINED",
    "VOICE_CHAT_CHANNEL_ACTIVATED",
    "VOICE_CHAT_CHANNEL_DEACTIVATED",
    "VOICE_CHAT_VOICE_PROVIDERS_AVAILABLE_CHANGED",
    "VOICE_CHAT_DISCORD_SETTINGS_UPDATED",
}

local function ProviderID()
    local providers = Enum and Enum.VoiceProviderID
    return providers and (providers.Discord or providers.DISCORD)
end

function DiscordVoice:IsAvailable()
    return Version.Variant == "forever"
        and type(C_VoiceChat) == "table"
        and type(C_VoiceChat.GetActiveVoiceProviderID) == "function"
        and ProviderID() ~= nil
end

-- This is deliberately stricter than checking the selected provider. A linked Discord account
-- or a provider selected in settings is not an active voice session until the client reports a
-- connected active channel.
function DiscordVoice:IsActive()
    if not self:IsAvailable() then
        return false
    end

    local ok, provider = pcall(C_VoiceChat.GetActiveVoiceProviderID)
    if not ok or provider ~= ProviderID() then
        return false
    end

    local connected = C_VoiceChat.IsVoiceChatConnected
    if type(connected) == "function" then
        ok, connected = pcall(connected)
        if not ok or not connected then
            return false
        end
    end

    local channel = C_VoiceChat.GetActiveChannelID
    if type(channel) == "function" then
        ok, channel = pcall(channel)
        if not ok or channel == nil then
            return false
        end
    elseif type(C_VoiceChat.IsVoiceChatConnected) ~= "function" then
        -- Without either signal there is no safe way to distinguish a configured provider
        -- from a live voice session.
        return false
    end

    return true
end

function DiscordVoice:IsEnabled()
    local db = Addon.db
    local audio = db and db.profile and db.profile.Audio
    return audio and audio.MuteWhileDiscordVoice ~= false or false
end

function DiscordVoice:HeldReason()
    if self.active and self:IsEnabled() then
        return L.QUEUE_HELD_DISCORD
    end
end

function DiscordVoice:Refresh()
    local active = self:IsEnabled() and self:IsActive()
    if active == self.active then
        return
    end
    self.active = active
    if active then
        -- If a line is already speaking, stop and keep it at the head so it starts over later.
        SoundQueue:RecheckGates()
    else
        SoundQueue:Advance()
    end
    Callbacks:Fire("AUDIO_CHANGED")
end

SoundQueue:AddGate(function()
    return DiscordVoice:HeldReason()
end)

local frame = CreateFrame("Frame")
for _, event in ipairs(EVENTS) do
    -- Some clients do not know the Forever-only event names.
    pcall(frame.RegisterEvent, frame, event)
end
frame:SetScript("OnEvent", function()
    DiscordVoice:Refresh()
end)

