setfenv(1, SpokenEnv)

-- The DialogueUI settings, on Spoken's page, among the narrator style's: the window's own rows in
-- the narrator style's parts, shown with the DialogueUI style chosen (Page:WheelNote,
-- Page:ThemeRows, Page:FitRow), and after them what each feature addon adds through
-- Spoken:AddDialogueUISettings (Page:Place), shown under any style.
--
-- Parsed by the 1.12 client too (addon.xml is shared), so Lua 5.0 syntax throughout; that
-- client has no DialogueUI and returns below.

DialogueUIOptions = { builders = {}, resets = {} }

if Version.IsAnyLegacy then
    function DialogueUIOptions:Add() end
    function DialogueUIOptions:WheelNote() end
    function DialogueUIOptions:ThemeRows() end
    function DialogueUIOptions:FitRow() end
    function DialogueUIOptions:Place() end
    function DialogueUIOptions:Reset() end
    return
end

local Page = DialogueUIOptions

local function Panel() return Addon.db.profile.Frame.DialogueUI end

--- Add a feature addon's rows. build(layout) adds a section and its rows to Spoken's page, last
--- among the narrator style's settings, and may return a function that puts them back to their
--- defaults, which Spoken's Start Over runs. Before the page is built they wait for it; after,
--- they go in at once.
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

-- `only(row)` shows a row only with the DialogueUI window chosen; it also needs DialogueUI to know.
local function Window(layout, only, row)
    only(row)
    layout:Requires(row, function() return DialogueUITheme:Available() end, L.OPT_STYLE_DUI_UNKNOWN)
    return row
end

--- Under Size and Position: nothing on the window shows its wheel shortcuts.
function Page:WheelNote(layout, only)
    only(layout:Note(L.DUI_WHEEL_HINT, nil, 40))
end

--- Under Look: the window's theme, DialogueUI's or one chosen.
function Page:ThemeRows(layout, only, refresh)
    Window(layout, only, layout:Checkbox(L.OPT_DUI_FOLLOW_THEME, L.OPT_DUI_FOLLOW_THEME_TIP,
        function() return Panel().FollowTheme end, function(v) Panel().FollowTheme = v end, refresh))
    layout:Indent()
    layout:Requires(Window(layout, only, layout:Dropdown(L.OPT_DUI_THEME, L.OPT_DUI_THEME_TIP, { 1, 2 },
        function() return Panel().Theme end, function(v) Panel().Theme = v end, refresh,
        function(v) return v == 2 and L.OPT_DUI_THEME_DARK or L.OPT_DUI_THEME_PARCHMENT end)),
        function() return not Panel().FollowTheme end, L.REASON_DUI_FOLLOW)
    layout:Outdent()
end

--- Under Words: the window as tall as its words.
function Page:FitRow(layout, only, refresh)
    return Window(layout, only, layout:Checkbox(L.OPT_DUI_FIT_TEXT, L.OPT_DUI_FIT_TEXT_TIP,
        function() return Panel().FitText ~= false end, function(v) Panel().FitText = v end, refresh))
end

--- The place, last among the narrator style's settings, kept for the feature addons' rows
--- whenever they arrive. Only with DialogueUI installed; its rows show under any style, since
--- they change DialogueUI's own quest window.
function Page:Place(layout)
    if not DialogueUITheme:Installed() then return end
    self.layout = layout
    self.keep = layout:Keep()
    for _, build in ipairs(self.builders) do self:Run(build) end
end

--- Spoken's Start Over, before its reload: the window's settings back, and every feature
--- addon's, which Spoken's profile does not hold.
function Page:Reset()
    local cfg = Panel()
    for key, value in pairs(Defaults.profile.Frame.DialogueUI) do cfg[key] = value end
    for _, reset in ipairs(self.resets) do pcall(reset) end
end
