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

function Callbacks:Unregister(handle)
    local list = handle and self.handlers[handle.event]
    if not list then
        return
    end
    for i = getn(list), 1, -1 do
        if list[i].id == handle.id then
            table.remove(list, i)
        end
    end
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
