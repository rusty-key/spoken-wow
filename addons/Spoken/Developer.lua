setfenv(1, SpokenEnv)

-- What Spoken offers a developer module (Spoken_Developer, its own download): a place to
-- register itself, the settings sections feature addons hand in for its Developer page, and the
-- diagnostics feature addons add to Spoken's. Spoken keeps no log and draws no page itself:
-- without the module every call here is a no-op, and the module is what a player installs to
-- get the debug log, the Developer page and the Report button's right-click menu.
--
-- The module registers a provider, a table of plain functions (no self):
--   Log(category, text)       one line, already formatted
--   IsLogOn()                 whether lines are kept
--   SetLogOn(on), Lines(count), Clear(how), Show(count), AddSource(list, clear)
--   ShowMenu(anchor)          the menu a Report button's right-click opens
--   MenuHint()                the tooltip line saying so, or nil
--   SwitchLabel(), SwitchTip() the welcome window's switch
--   Command(rest)             `/spoken log <rest>`
--   Describe()                one line for `/spoken diagnostics`
--
-- Parsed by the 1.12 client too (addon.xml is shared), so Lua 5.0 syntax throughout.

Developer = { provider = nil, settings = {}, diagnostics = {} }

function Developer:Register(provider)
    self.provider = provider
    Callbacks:Fire("DEVELOPER_REGISTERED")
end

--- A provider function's answer, or nil without the module or the function.
function Developer:Call(name, a, b, c)
    local provider = self.provider
    local fn = provider and provider[name]
    if not fn then return nil end
    return fn(a, b, c)
end

function Developer:IsLogOn()
    return self:Call("IsLogOn") and true or false
end

--- One line in the module's log, while it is on. `message` is a format string when arguments
--- follow, four at most; one that does not format is kept as written.
function Developer:Log(category, message, a, b, c, d)
    if not self:IsLogOn() then return end
    local text = message
    if a ~= nil or b ~= nil or c ~= nil or d ~= nil then
        local ok, formatted = pcall(format, message, a, b, c, d)
        text = ok and formatted or message
    end
    self.provider.Log(tostring(category), tostring(text))
end

--- A clip as the log names it: its key and the source that queued it.
function Developer.Describe(clip)
    if type(clip) ~= "table" then return tostring(clip) end
    local source = clip.source and clip.source.key or "?"
    return tostring(clip.key) .. " [" .. tostring(source) .. "]"
end

function Developer:ShowMenu(anchor)
    return self:Call("ShowMenu", anchor)
end

--- The tooltip line for a Report button's right-click, or nil without the module.
function Developer:MenuHint()
    return self:Call("MenuHint")
end

--------------------------------------------------------------------------------
-- The Developer page's sections, handed in by feature addons
--------------------------------------------------------------------------------

--- build(layout) adds a section and its rows, and may return a function that puts them back to
--- their defaults. Kept here so a feature addon can hand it in whether the module is installed or
--- not, and before or after the module builds its page.
function Developer:AddSettings(build)
    table.insert(self.settings, build)
    Callbacks:Fire("DEVELOPER_SETTINGS_ADDED", build)
end

--------------------------------------------------------------------------------
-- Diagnostics, as lines
--------------------------------------------------------------------------------

--- fn(detailed) returns a list of lines: what the feature addon's own diagnostics say, and with
--- `detailed`, what an AI agent needs besides (the window open, the line found, ...).
function Developer:AddDiagnostics(name, fn)
    table.insert(self.diagnostics, { name = name, fn = fn })
end

local function Join(a, b, c, d)
    local parts = {}
    if a ~= nil then table.insert(parts, tostring(a)) end
    if b ~= nil then table.insert(parts, tostring(b)) end
    if c ~= nil then table.insert(parts, tostring(c)) end
    if d ~= nil then table.insert(parts, tostring(d)) end
    return table.concat(parts, " ")
end

--- What `/spoken diagnostics` prints, as lines rather than in chat: the command itself runs, with
--- `print` caught for the time it takes, so the two never say different things.
local function SpokenLines(lines)
    local command = SlashCmdList and SlashCmdList.SPOKEN
    if not command then
        table.insert(lines, "Spoken " .. tostring(AddonVersion) .. ": not enabled yet")
        return
    end
    local saved = rawget(SpokenEnv, "print")
    SpokenEnv.print = function(a, b, c, d) table.insert(lines, Join(a, b, c, d)) end
    local ok, err = pcall(command, "diagnostics")
    SpokenEnv.print = saved
    if not ok then table.insert(lines, "diagnostics error: " .. tostring(err)) end
end

--- The state an agent needs and the diagnostics leave out: the client, the narrator, the sound
--- settings and the queue entry by entry.
function Developer:Context()
    local lines = {}
    local version, build = GetBuildInfo()
    table.insert(lines, format("client %s build %s, locale %s", tostring(version), tostring(build),
        GetLocale and GetLocale() or "?"))
    local profile = Addon.db and Addon.db.profile
    local audio = profile and profile.Audio or {}
    table.insert(lines, format("narrator style %s, window %s", tostring(Addon:PlayerStyle()),
        PlayerFrame.frame and (PlayerFrame.frame:IsShown() and "shown" or "hidden") or "not built"))
    table.insert(lines, format("line gap %s s, master %s/%s, dialog %s/%s",
        tostring(audio.LineGap),
        tostring(GetCVar("Sound_EnableAllSound")), tostring(GetCVar("Sound_MasterVolume")),
        tostring(GetCVar("Sound_EnableDialog")), tostring(GetCVar("Sound_DialogVolume"))))
    for key, source in Sources:Iterate() do
        table.insert(lines, format("module %s (%s): %s", key, tostring(source.addon),
            Sources:IsTurnedOff(source) and "turned off" or "on"))
    end
    local queue = SoundQueue.sounds or {}
    if table.getn(queue) == 0 then
        table.insert(lines, "queue empty")
    end
    for i, clip in ipairs(queue) do
        local held = SoundQueue:GetHeldReason(clip)
        table.insert(lines, format("queue %d: %s, length %s%s%s%s", i, Developer.Describe(clip),
            tostring(clip.length), i == 1 and (SoundQueue:IsPaused() and ", stopped" or ", head") or "",
            held and (", held: " .. tostring(held)) or "",
            (clip.title and (", " .. tostring(clip.title)) or "")
                .. (clip.origin and (", from " .. tostring(clip.origin)) or "")))
    end
    return lines
end

--- Spoken's diagnostics and every feature addon's, as lines. With `detailed`, the context too.
function Developer:Diagnostics(detailed)
    local lines = {}
    SpokenLines(lines)
    if detailed then
        table.insert(lines, "context:")
        for _, line in ipairs(self:Context()) do table.insert(lines, "  " .. line) end
    end
    for _, entry in ipairs(self.diagnostics) do
        local ok, more = pcall(entry.fn, detailed)
        table.insert(lines, tostring(entry.name) .. ":")
        if ok and type(more) == "table" then
            for _, line in ipairs(more) do table.insert(lines, "  " .. tostring(line)) end
        elseif not ok then
            table.insert(lines, "  diagnostics error: " .. tostring(more))
        end
    end
    return lines
end
