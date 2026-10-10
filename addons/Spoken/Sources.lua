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
--- client's addon list, which only changes at the next reload: this one needs none. `part` is a source or its key: the settings ask about a
--- part by key whether or not it is installed.
function Sources:IsTurnedOff(part)
    local key = type(part) == "table" and part.key or part
    local parts = Addon.db and Addon.db.profile.Parts
    return parts ~= nil and key ~= nil and parts[key] == false
end

function Sources:SetTurnedOff(key, off)
    -- Not `off and false or nil`, which is nil either way.
    if off then Addon.db.profile.Parts[key] = false else Addon.db.profile.Parts[key] = nil end
    self:Apply(key)
end

--- Put a part's switch into effect, after it was flipped or a profile brought another one.
function Sources:Apply(key)
    local off = self:IsTurnedOff(key)
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

--- The channel a clip from this source plays on: its own if it names one, else Master. There is
--- no setting for it: on Dialog, Silence NPC Voices would silence Spoken's voices with the NPCs',
--- and Game Greeting First could not tell them from an NPC's. A string, as PlaySoundFile takes.
function SourceMethods:GetChannel()
    if self.channel then
        return self.channel()
    end
    return "Master"
end

-- A line the queue would not take, in the debug log: the refusals that fire no CLIP_DROPPED
-- (a duplicate, a file the probe did not find, a muted channel, a part turned off) are otherwise
-- seen nowhere.
local function Noted(clip, how, result, why)
    if not result and why and Developer then
        Developer:Log("player", "%s refused %s: %s", how, Developer.Describe(clip), tostring(why))
    end
    return result, why
end

function SourceMethods:Enqueue(clip)
    return Noted(clip, "queue", SoundQueue:Add(clip, self, false))
end

function SourceMethods:PlayNow(clip)
    return Noted(clip, "play now", SoundQueue:PlayNow(clip, self))
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

--- Gates are asked before a clip starts. Call this when one of this source's may have
--- closed on its clip already speaking -- a cinematic starting -- and it is stopped and
--- kept, to replay from the start once the gate opens. Returns whether it was cut off.
function SourceMethods:RecheckGates()
    return SoundQueue:RecheckGates(self)
end

--- One of this source's gates has opened: start what it held now, rather than at the next
--- retry, up to a second later.
function SourceMethods:Retry()
    SoundQueue:Advance()
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
