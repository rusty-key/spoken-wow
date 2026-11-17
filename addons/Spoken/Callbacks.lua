setfenv(1, SpokenEnv)

-- The player's event fanout. A plain pcall-per-subscriber loop rather than
-- CallbackHandler-1.0, on purpose: a library at the API boundary would force every
-- consumer through LibStub before it could subscribe, and this is twelve lines. Every button, the frame and the
-- queue display subscribe to AUDIO_CHANGED, so the queue never calls into its display.
Callbacks = { handlers = {}, nextId = 0, errors = {} }

---@param event string
---@param fn function
---@return table handle
function Callbacks:Register(event, fn)
    self.nextId = self.nextId + 1
    local handle = { event = event, id = self.nextId, fn = fn }
    self.handlers[event] = self.handlers[event] or {}
    table.insert(self.handlers[event], handle)
    return handle
end

-- A new list rather than a removal in place: a Fire walking the old one would skip the
-- subscriber after one that unregistered itself. One unregistered before its turn is skipped.
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
