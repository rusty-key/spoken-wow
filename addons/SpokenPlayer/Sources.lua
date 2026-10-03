setfenv(1, SpokenEnv)

-- A source is a feature addon's registration with the player: what it is called, how its
-- clips are admitted, and the hooks its domain-specific rules hang off. Everything a
-- single domain cares about -- gossip yielding to quest dialogue, narration held through
-- combat, a cap on how far behind narration may fall -- is expressed through one of
-- these, so the queue itself never learns what a quest or a zone is.
Sources = { byKey = {}, ordered = {} }

local SourceMethods = {}
SourceMethods.__index = SourceMethods

---@class SpokenSourceInfo
---@field title string
---@field addon string
---@field icon? string
---@field order? number       -- minimap menu order only; never queue order
---@field queueLimit? number  -- clips of this source allowed behind the head; nil = unlimited
---@field interClipGap? number
---@field channel? fun():string
---@field admit? fun(clip, queue):boolean, string?
---@field testBeforeQueue? boolean
---@field onQueueEnter? fun()
---@field onQueueEmpty? fun()
---@field packs? fun():string[] -- the voice packs this source found installed, by name

---@param key string
---@param info SpokenSourceInfo
function Sources:Register(key, info)
    assert(not self.byKey[key], format("Spoken: a source named %q is already registered", key))
    local source = setmetatable({
        key = key,
        title = info.title or key,
        addon = info.addon,
        icon = info.icon,
        order = info.order or 100,
        queueLimit = info.queueLimit,
        -- 0.55 is upstream's figure; it absorbs a duration that is slightly short.
        interClipGap = info.interClipGap or 0.55,
        channel = info.channel,
        admit = info.admit,
        testBeforeQueue = info.testBeforeQueue,
        onQueueEnter = info.onQueueEnter,
        onQueueEmpty = info.onQueueEmpty,
        packs = info.packs,
        -- A part whose voices come in parts counts and names them itself (Options:PartVoice).
        packCount = info.packCount,
        packNames = info.packNames,
        -- A part's settings kept in AceDB profiles: a function returning its AceDB object, so
        -- Spoken's own Profiles section switches it with the player's (Options:ProfileDBs).
        profiles = info.profiles,
        gates = {},
    }, SourceMethods)
    self.byKey[key] = source
    table.insert(self.ordered, source)
    table.sort(self.ordered, function(a, b)
        if a.order ~= b.order then
            return a.order < b.order
        end
        return a.key < b.key
    end)
    Callbacks:Fire("SOURCE_REGISTERED", source)
    return source
end

function Sources:Get(key)
    return self.byKey[key]
end

--- Whether the player has switched this part of Spoken off in the settings. Off, the addon
--- stays installed and loaded and nothing it sends is played. The player's own switch, not the
--- client's addon list: current clients keep enabling and disabling an addon for their own UI
--- and refuse it to addons (see the pcall around DisableAddOn in SpokenQuests' VoiceOver.lua),
--- and this one needs no reload either.
function Sources:IsTurnedOff(source)
    local parts = Addon.db and Addon.db.profile.Parts
    return parts ~= nil and source ~= nil and parts[source.key] == false
end

function Sources:SetTurnedOff(key, off)
    -- Not `off and false or nil`, which is nil either way.
    if off then Addon.db.profile.Parts[key] = false else Addon.db.profile.Parts[key] = nil end
    local source = self.byKey[key]
    -- What it already queued goes too: switching a part off mid-line should silence it.
    if off and source then SoundQueue:RemoveSource(source) end
    -- And the part takes its own buttons off the game's frames, or puts them back.
    Callbacks:Fire("PART_SWITCHED", key, not off)
end

--- Iterates `key, source` in `order`.
function Sources:Iterate()
    local i = 0
    return function()
        i = i + 1
        local source = self.ordered[i]
        if source then
            return source.key, source
        end
    end
end

--- The channel a clip from this source plays on: its own if it names one, else the
--- player's setting. Strings throughout, because that is what PlaySoundFile takes.
function SourceMethods:GetChannel()
    if self.channel then
        return self.channel()
    end
    return Addon.db.profile.Audio.SoundChannel
end

function SourceMethods:Enqueue(clip)
    return SoundQueue:Add(clip, self, false)
end

function SourceMethods:PlayNow(clip)
    return SoundQueue:PlayNow(clip, self)
end

function SourceMethods:Remove(clip)
    return SoundQueue:RemoveSoundFromQueue(clip)
end

function SourceMethods:StopAll()
    SoundQueue:RemoveSource(self)
end

--- A predicate returning a reason to hold one of this source's clips, or nil.
function SourceMethods:AddGate(fn)
    table.insert(self.gates, fn)
end

---@return boolean audible
---@return string|nil reason
function SourceMethods:CanPlay()
    local reason = SoundUtils:WhyInaudible(self:GetChannel())
    return reason == nil, reason
end

function SourceMethods:SetQueueLimit(n)
    self.queueLimit = n
end

function SourceMethods:SetInterClipGap(seconds)
    self.interClipGap = seconds
end
