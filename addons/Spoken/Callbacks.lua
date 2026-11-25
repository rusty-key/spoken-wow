setfenv(1, SpokenEnv)

-- The player's event fanout. A plain pcall-per-subscriber loop rather than
-- CallbackHandler-1.0, on purpose: a library at the API boundary would force every
-- consumer through LibStub before it could subscribe, and this is twelve lines. Every button, the frame and the
-- queue display subscribe to AUDIO_CHANGED, so the queue never calls into its display.
Callbacks = { handlers = {}, nextId = 0, errors = {} }

---@param event string
---@param fn function
---@return table handle
-- Register and Unregister swap in a new list rather than change the one a Fire may be walking,
-- where a handler unregistering itself would make the next one miss the event. Copying here,
-- not in Fire, keeps the events allocation-free.
function Callbacks:Register(event, fn)
    self.nextId = self.nextId + 1
    local handle = { event = event, id = self.nextId, fn = fn }
    local list = { unpack(self.handlers[event] or {}) }
    table.insert(list, handle)
    self.handlers[event] = list
    return handle
end

function Callbacks:Unregister(handle)
    local list = type(handle) == "table" and self.handlers[handle.event]
    if not list then
        return
    end
    local kept = {}
    for _, other in ipairs(list) do
        if other.id ~= handle.id then table.insert(kept, other) end
    end
    self.handlers[handle.event] = kept
end

-- A subscriber that throws must not take the queue down with it, nor silence the
-- subscribers after it. The error is kept where `/spoken diagnostics` can show it.
function Callbacks:Fire(event, a, b, c)
    local list = self.handlers[event]
    if not list then
        return
    end
    for _, handle in ipairs(list) do
        local ok, err = pcall(handle.fn, a, b, c)
        if not ok then
            table.insert(self.errors, event .. ": " .. tostring(err))
        end
    end
end
