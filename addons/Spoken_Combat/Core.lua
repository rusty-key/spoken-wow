local _, CombatVoice = ...
_G.SpokenCombat = CombatVoice
CombatVoice.bag = {}
CombatVoice.L = {
    COMBAT_VOICE_TITLE = "Combat Voice",
    COMBAT_VOICE_PARTY = "Speak in Parties",
    COMBAT_VOICE_PARTY_TIP = "Allow combat speech in ordinary parties outside dungeons. Saved for this character.",
    COMBAT_VOICE_DUNGEON = "Speak in Dungeons",
    COMBAT_VOICE_DUNGEON_TIP = "Allow combat speech inside dungeons, including when solo. Raid groups use Speak in Raids instead. Saved for this character.",
    COMBAT_VOICE_RAID = "Speak in Raids",
    COMBAT_VOICE_RAID_TIP = "Allow combat speech in raid groups or raid instances. Saved for this character.",
    COMBAT_VOICE_PREVIEW = "Preview Combat Voice",
    COMBAT_VOICE_PREVIEW_TIP = "Plays a random line regardless of party, dungeon or raid settings, without waiting for the combat cooldown. Requires the module to be enabled.",
    COMBAT_VOICE_MISSING = "Install and enable Spoken Combat Audio, then restart WoW. Download it from spoken.rusty.one/enUS/combat.",
    COMBAT_VOICE_UNSUPPORTED = "Combat Voice needs a current WoW client; legacy 1.12, 2.4.3 and 3.3.5 clients are not supported.",
    COMBAT_VOICE_BUSY = "Another Spoken voice is already playing.",
    COMBAT_VOICE_DEAD = "Combat Voice cannot play while dead.",
    COMBAT_VOICE_ON = "Combat module enabled for this Spoken profile.",
    COMBAT_VOICE_OFF = "Combat module disabled for this Spoken profile.",
}
local L = CombatVoice.L

function CombatVoice:IsEnabled()
    return Spoken:IsPartOn("combat")
end

function CombatVoice:SetEnabled(enabled)
    Spoken:SetPartOn("combat", enabled and true or false)
end

function CombatVoice:IsContextAllowed()
    if not (IsInInstance and IsInGroup and IsInRaid) then return false end
    local _, instanceType = IsInInstance()
    if instanceType == "raid" or IsInRaid() then return self.settings.AllowInRaid == true end
    if instanceType == "party" then return self.settings.AllowInDungeon == true end
    if IsInGroup() then return self.settings.AllowInParty == true end
    return true
end

function CombatVoice:SetContextEnabled(key, enabled)
    self.settings[key] = enabled and true or false
    if not self:IsContextAllowed() then self:Stop() end
end

function CombatVoice:Stop()
    Spoken:StopReaction(self.source)
end

function CombatVoice:Next()
    local pack = self:GetVoicePack()
    if self.pack ~= pack then self.bag, self.pack, self.lastKey = {}, pack, nil end
    if not pack then return end
    if not self.bag[1] then
        for _, clip in ipairs(pack.clips) do
            if not self:IsClipFailed(pack, clip) then table.insert(self.bag, clip) end
        end
        for index = table.getn(self.bag), 2, -1 do
            local other = math.random(index)
            self.bag[index], self.bag[other] = self.bag[other], self.bag[index]
        end
        -- The first draw after a reshuffle must not repeat the last voice heard.
        local last = table.getn(self.bag)
        if last > 1 and self.bag[last].key == self.lastKey then
            self.bag[1], self.bag[last] = self.bag[last], self.bag[1]
        end
    end
    return self.bag[table.getn(self.bag)]
end

function CombatVoice:Play(preview)
    if not Spoken:IsPartOn("combat") then return false end
    if not preview and not self:IsContextAllowed() then return false end
    if not self:IsReady() then return false, self:VoiceStatus() end
    if Spoken:IsReactionPlaying() or Spoken:IsPlaying() then return false, L.COMBAT_VOICE_BUSY end
    if UnitIsDeadOrGhost and UnitIsDeadOrGhost("player") then return false, L.COMBAT_VOICE_DEAD end
    if not preview and self.lastPlayed and GetTime() - self.lastPlayed < 45 then return false end
    local skipped = false
    for attempt = 1, table.getn(self.clipKeys) do
        local line = self:Next()
        if not line then break end
        local clip = { path = self:ClipPath(self.pack, line), length = line.length }
        local played, why = Spoken:PlayReaction(self.source, clip)
        if played then
            table.remove(self.bag)
            self.lastKey = line.key
            if not preview then self.lastPlayed = GetTime() end
            return true, skipped and self:VoiceStatus() or nil
        end
        if why ~= "missing" then
            local reasons = { busy = L.COMBAT_VOICE_BUSY, unsupported = L.COMBAT_VOICE_UNSUPPORTED }
            return false, reasons[why] or why
        end
        -- A rejected file must not block the healthy clips behind it on every combat entry.
        table.remove(self.bag)
        self:MarkClipFailed(self.pack, line)
        skipped = true
    end
    return false, self:VoiceStatus()
end

function CombatVoice:Preview()
    local played, why = self:Play(true)
    if why then print("Spoken: " .. why) end
    return played
end

function CombatVoice:Command(input)
    if input == "on" then self:SetEnabled(true)
    elseif input == "off" then self:SetEnabled(false)
    elseif input == "test" or input == "preview" then self:Preview(); return
    else print("Spoken: /spoken combat on | off | test"); return end
    print("Spoken: " .. (self:IsEnabled() and L.COMBAT_VOICE_ON or L.COMBAT_VOICE_OFF))
    if self:IsEnabled() and not self:IsReady() then print("Spoken: " .. self:VoiceStatus()) end
    if self.optionsLayout then self.optionsLayout:Refresh() end
end

function CombatVoice:Setup()
    if self.frame then return end
    if not (Spoken and Spoken.PlayReaction) then return end
    SpokenCombatCharacter = SpokenCombatCharacter or {}
    self.settings = SpokenCombatCharacter
    self.settings.SpeakOnEnteringCombat = nil
    self.settings.ContextDefaultsApplied = nil
    local defaults = { AllowInParty = true, AllowInDungeon = true, AllowInRaid = false }
    for key, value in pairs(defaults) do
        if self.settings[key] == nil then self.settings[key] = value end
    end
    self.source = Spoken:RegisterSource("combat", {
        title = "Combat", addon = "Spoken_Combat", order = 4,
        icon = [[Interface\Icons\Ability_DualWield]],
        packs = function() return self:GetAudioPacks() end,
    })
    Spoken:RegisterCommand("combat", function(input) self:Command(input) end)
    local frame = CreateFrame("Frame")
    self.frame = frame
    frame:RegisterEvent("PLAYER_REGEN_DISABLED")
    frame:RegisterEvent("PLAYER_REGEN_ENABLED")
    frame:RegisterEvent("PLAYER_DEAD")
    frame:RegisterEvent("PLAYER_LOGOUT")
    frame:SetScript("OnEvent", function(_, event)
        if event == "PLAYER_REGEN_DISABLED" then
            if not self.inCombat then self.inCombat = true; self:Play(false) end
        elseif event == "PLAYER_REGEN_ENABLED" then self.inCombat = false
        else self:Stop() end
    end)
end
