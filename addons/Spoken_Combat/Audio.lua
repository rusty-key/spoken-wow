local _, Combat = ...

function Combat:Voice(id)
    for _, voice in ipairs(self.voices) do
        if voice.id == id then return voice end
    end
end

function Combat:GetCharacterVoice()
    if not (UnitRace and UnitSex) then return end
    local _, race = UnitRace("player")
    local sex = UnitSex("player")
    for _, voice in ipairs(self.voices) do
        if voice.race == race and voice.sex == sex then return voice end
    end
end

local function Valid(pack)
    if type(pack) ~= "table" or pack.version ~= 1 or pack.language ~= "enUS"
        or not Combat:Voice(pack.voice) or type(pack.addon) ~= "string"
        or not string.find(pack.addon, "^[%w_%-]+$")
        or type(pack.clips) ~= "table" or table.getn(pack.clips) ~= table.getn(Combat.clipKeys) then return false end
    local seen = {}
    for _, clip in ipairs(pack.clips) do
        if type(clip) ~= "table" then return false end
        local known = false
        for _, key in ipairs(Combat.clipKeys) do
            if clip.key == key then known = true end
        end
        if not known or seen[clip.key] or (clip.format ~= "mp3" and clip.format ~= "ogg" and clip.format ~= "wav")
            or type(clip.length) ~= "number" or not (clip.length > 0 and clip.length <= 6) then return false end
        seen[clip.key] = true
    end
    return true
end

function Combat:GetAudioPacks()
    local packs = {}
    for _, pack in pairs(_G.SpokenCombatAudioPacks or {}) do
        if Valid(pack) then table.insert(packs, pack) end
    end
    table.sort(packs, function(a, b)
        if a.addon ~= b.addon then return a.addon < b.addon end
        return a.voice < b.voice
    end)
    return packs
end

function Combat:GetMatchingPacks()
    local matches = {}
    local voice = self:GetCharacterVoice()
    if not voice then return matches end
    for _, pack in ipairs(self:GetAudioPacks()) do
        if pack.voice == voice.id then table.insert(matches, pack) end
    end
    return matches
end

function Combat:GetVoicePack()
    return self:GetMatchingPacks()[1]
end

function Combat:PackStatus()
    local matches = self:GetMatchingPacks()
    if not matches[1] then return "" end
    local selected = "Audio addon: " .. matches[1].addon .. "."
    if table.getn(matches) > 1 then
        return selected .. " Multiple matching audio packs are installed. The first addon folder alphabetically is used. Disable extra packs to choose which voice plays."
    end
    return selected
end

function Combat:IsReady()
    local pack = self:GetVoicePack()
    if not pack then return false end
    for _, clip in ipairs(pack.clips) do
        if not self:IsClipFailed(pack, clip) then return true end
    end
    return false
end

function Combat:IsClipFailed(pack, clip)
    return self.failedClips and self.failedClips[pack] and self.failedClips[pack][clip.key] == true
end

function Combat:MarkClipFailed(pack, clip)
    self.failedClips = self.failedClips or {}
    self.failedClips[pack] = self.failedClips[pack] or {}
    self.failedClips[pack][clip.key] = true
    if self.optionsLayout then self.optionsLayout:Refresh() end
end

function Combat:VoiceStatus()
    local voice = self:GetCharacterVoice()
    if not voice then return "No Combat voice is defined for this character's race and sex." end
    local pack = self:GetVoicePack()
    if pack then
        local failed = 0
        for _, clip in ipairs(pack.clips) do
            if self:IsClipFailed(pack, clip) then failed = failed + 1 end
        end
        if failed == table.getn(pack.clips) then
            return "No playable recordings for " .. voice.label .. ". All files failed playback. Reinstall the audio pack and restart WoW."
        elseif failed > 0 then
            return voice.label .. ": " .. failed .. " recording(s) failed playback and are skipped. Other clips can play. Reinstall the audio pack and restart WoW."
        end
        return "Combat voice: " .. voice.label .. ". Audio files are checked during playback."
    end
    return "No recordings installed for " .. voice.label .. ". Install and enable a matching Spoken Combat Audio pack, then restart WoW."
end

function Combat:ClipPath(pack, clip)
    return string.format([[Interface\AddOns\%s\Sounds\Combat\%s-%s.%s]],
        pack.addon, pack.voice, clip.key, clip.format)
end
