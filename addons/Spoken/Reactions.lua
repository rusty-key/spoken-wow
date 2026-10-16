setfenv(1, SpokenEnv)

Reactions = {}

function Reactions:Stop(source)
    if source and self.source ~= source then return end
    if self.timer then Addon:CancelTimer(self.timer); self.timer = nil end
    if self.clip then SoundUtils:StopSound(self.clip); self.clip = nil end
    self.source = nil
end

function Reactions:Play(source, clip)
    if Version.IsAnyLegacy then return false, "unsupported" end
    if Sources:Get(source.key) ~= source or Sources:IsTurnedOff(source) then return false, "off" end
    if self.clip or SoundQueue:IsPlaying() then return false, "busy" end
    local channel = Sources:PlayerChannel()
    local why = SoundUtils:WhyInaudible(channel)
    if why then return false, why end
    if not SoundUtils:PlaySound(clip, channel) then return false, "missing" end
    self.clip, self.source = clip, source
    self.timer = Addon:ScheduleTimer(function()
        self.timer, self.clip, self.source = nil, nil, nil
    end, clip.length)
    return true
end

-- Narration takes precedence even when it starts after a reaction.
Callbacks:Register("CLIP_STARTED", function() Reactions:Stop() end)
Callbacks:Register("PART_SWITCHED", function(key, on)
    if not on and Reactions.source and Reactions.source.key == key then Reactions:Stop() end
end)
