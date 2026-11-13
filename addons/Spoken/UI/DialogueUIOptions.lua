setfenv(1, SpokenEnv)

-- The DialogueUI settings on Spoken's page: the window's own rows, shown only with the
-- DialogueUI style, then, after the Words section, the rows feature addons add through
-- Spoken:AddDialogueUISettings, shown under any style.

DialogueUIOptions = { builders = {}, resets = {} }

local Page = DialogueUIOptions

local function Panel() return Addon.db.profile.Frame.DialogueUI end

function Page:Add(build)
    table.insert(self.builders, build)
    if self.keep then
        self:Run(build)
        Options:UpdateRows()
    end
end

function Page:Run(build)
    local layout = self.layout
    local ok, reset = pcall(layout.Fill, layout, self.keep, build)
    if ok and type(reset) == "function" then
        table.insert(self.resets, reset)
    elseif not ok then
        table.insert(Callbacks.errors, "DialogueUI settings: " .. tostring(reset))
    end
end

local function Window(layout, only, row)
    only(row)
    layout:Requires(row, function() return DialogueUITheme:Available() end, L.OPT_STYLE_DUI_UNKNOWN)
    return row
end

--- The window's Theme: the same as DialogueUI's, changing when it does, or Parchment or Dark
--- whatever DialogueUI is set to. One row for what is kept as two settings, FollowTheme and Theme.
function Page:ThemeRow(layout, only, refresh)
    return Window(layout, only, layout:Dropdown(L.OPT_DUI_THEME, nil, { "follow", 1, 2 },
        function() return Panel().FollowTheme and "follow" or Panel().Theme end,
        function(v)
            Panel().FollowTheme = v == "follow"
            if v ~= "follow" then Panel().Theme = v end
        end, refresh,
        function(v)
            if v == "follow" then return L.OPT_DUI_THEME_FOLLOW end
            return v == 2 and L.OPT_DUI_THEME_DARK or L.OPT_DUI_THEME_PARCHMENT
        end))
end

function Page:FitRow(layout, only, refresh)
    return Window(layout, only, layout:Checkbox(L.OPT_DUI_FIT_TEXT, nil,
        function() return Panel().FitText ~= false end, function(v) Panel().FitText = v end, refresh))
end

--- Where the feature addons' rows go, after the Words section, now or whenever they arrive. They show under any style, since they change DialogueUI's own quest window.
function Page:Place(layout)
    if not DialogueUITheme:Installed() then return end
    self.layout = layout
    self.keep = layout:Keep()
    for _, build in ipairs(self.builders) do self:Run(build) end
end

--- Whether Show Words, Highlight Words and Type Words Out are offered under narrator style `style`:
--- under every style that shows words, and under Voice Only too while DialogueUI is installed, as
--- they mark DialogueUI's own quest, gossip and book text (Spoken:GetCaption).
function Page:WordRowsShown(style)
    return style ~= "none" or DialogueUITheme:Installed() and true or false
end

--- Spoken's Defaults, before its reload: the window's settings back, and every feature
--- addon's, which Spoken's profile does not hold.
function Page:Reset()
    local cfg = Panel()
    for key, value in pairs(Defaults.profile.Frame.DialogueUI) do cfg[key] = value end
    for _, reset in ipairs(self.resets) do pcall(reset) end
end
