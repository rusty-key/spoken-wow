setfenv(1, SpokenEnv)

-- The player's event fanout. A plain pcall-per-subscriber loop rather than
-- CallbackHandler-1.0, on purpose: a library at the API boundary would force every
-- consumer through LibStub before it could subscribe, and this is twelve lines. Every button, the frame and the
-- queue display subscribe to AUDIO_CHANGED, so the queue never calls into its display.
Callbacks = { handlers = {}, nextId = 0, errors = {}, watchers = {} }

-- Both build a new list rather than change it in place, so a Fire walking the old one neither
-- skips the subscriber after one that unregistered itself nor calls one registered during it.

---@param event string
---@param fn function
---@return table handle
function Callbacks:Register(event, fn)
    self.nextId = self.nextId + 1
    local handle = { event = event, id = self.nextId, fn = fn }
    local list = self.handlers[event] or {}
    local grown = {}
    for i, other in ipairs(list) do grown[i] = other end
    table.insert(grown, handle)
    self.handlers[event] = grown
    if getn(list) == 0 and self.watchers[event] then self.watchers[event](true) end
    return handle
end

--- One unregistered before its turn in a Fire is skipped.
function Callbacks:Unregister(handle)
    local list = handle and self.handlers[handle.event]
    if not list then
        return
    end
    local kept = {}
    for _, other in ipairs(list) do
        if other.id == handle.id then
            other.gone = true
        else
            table.insert(kept, other)
        end
    end
    self.handlers[handle.event] = kept
    if getn(kept) == 0 and getn(list) > 0 and self.watchers[handle.event] then self.watchers[handle.event](false) end
end

--- `fn(true)` when `event` gains its first subscriber and `fn(false)` when it loses its last, for
--- work done only so the event can fire.
function Callbacks:WatchListeners(event, fn)
    self.watchers[event] = fn
end

--- Whether anything listens for `event`, so work done only to fire it can be skipped.
function Callbacks:Has(event)
    local list = self.handlers[event]
    return list ~= nil and getn(list) > 0
end

-- A subscriber that throws must not take the queue down with it, nor silence the
-- subscribers after it. The error is kept where `/spoken diagnostics` can show it.
function Callbacks:Fire(event, a, b, c)
    local list = self.handlers[event]
    if not list then
        return
    end
    for _, handle in ipairs(list) do
        if not handle.gone then
            local ok, err = pcall(handle.fn, a, b, c)
            if not ok then
                table.insert(self.errors, event .. ": " .. tostring(err))
            end
        end
    end
end
