setfenv(1, SpokenEnv)

-- The player's settings: player-wide things only. Each feature addon keeps its own panel
-- and, where the Settings API exists, nests it under this one.
--
-- Settings.RegisterCanvasLayoutCategory is the modern path and exists on every current
-- client. The three legacy clients have no Settings API at all; there the same
-- panel is a movable window opened with /spoken options. One builder, two hosts.
Options = {}

-- The game's settings list sets its rows 25 in from the canvas's left.
local INDENT = 25
local TOP = 16    -- where the page's title starts
local BOTTOM = 16 -- the margin under the last row
local panel
local scroller
local pendingLinks = {}

-- Rows, headings and the spacing between them come from UI/Layout.lua, the file every
-- Spoken addon carries a copy of, so the three panels read alike.
local Layout = SpokenLayout

-- The ways of showing a line, by the name Addon:PlayerStyle gives each.
local STYLE_LABELS = {
    minimal = L.OPT_STYLE_MINIMAL,
    classic = L.OPT_STYLE_CLASSIC,
    dialogueui = L.OPT_STYLE_DIALOGUEUI,
    subtitle = L.OPT_STYLE_SUBTITLE,
    none = L.OPT_STYLE_NONE,
}

-- The game's key bindings list these under a Spoken heading (Bindings.xml). Set here, after
-- the locale files, so the names are in the player's language.
_G.BINDING_HEADER_SPOKEN = "Spoken"
_G.BINDING_NAME_SPOKEN_PLAYPAUSE = L.BIND_PLAYPAUSE
_G.BINDING_NAME_SPOKEN_SKIP = L.BIND_SKIP
_G.BINDING_NAME_SPOKEN_STOP = L.BIND_STOP
local BINDINGS = {
    { "SPOKEN_PLAYPAUSE", L.BIND_PLAYPAUSE },
    { "SPOKEN_SKIP", L.BIND_SKIP },
    { "SPOKEN_STOP", L.BIND_STOP },
}
-- The parts of Spoken by source key, named as their pages are, each with the game's own icon
-- for what it reads and the order its page is listed in under Spoken.
local PARTS = {
    { key = "quests", label = L.OPT_PART_QUESTS, text = L.OPT_PART_QUESTS_TEXT, tip = L.OPT_PART_QUESTS_TIP,
        icon = [[Interface\Icons\INV_Scroll_03]], order = 1 },
    { key = "gossip", label = L.OPT_PART_GOSSIP, text = L.OPT_PART_GOSSIP_TEXT, tip = L.OPT_PART_GOSSIP_TIP,
        icon = [[Interface\Icons\UI_Chat]], order = 2 },
    { key = "books", label = L.OPT_PART_BOOKS, text = L.OPT_PART_BOOKS_TEXT, tip = L.OPT_PART_BOOKS_TIP,
        icon = [[Interface\Icons\INV_Misc_Book_09]], order = 3 },
    { key = "zones", label = L.OPT_PART_ZONES, text = L.OPT_PART_ZONES_TEXT, tip = L.OPT_PART_ZONES_TIP,
        icon = [[Interface\Icons\INV_Misc_Map02]], order = 4 },
}

-- Sketches of the ways of showing a line, in flat colour, for their tiles: a portrait in
-- gold, words as pale bars, a window as a darker box. Sized for four tiles to a row, and
-- narrow enough for a fifth.
local SKETCHES = {
    minimal = function(art)
        local R, w = Layout.Rect, art.width
        local x = (w - 78) / 2
        R(art, x, 16, 78, 26, 0.2, 0.18, 0.15, 1)
        R(art, x + 3, 19, 20, 20, 0.75, 0.6, 0.3, 1)
        R(art, x + 27, 22, 44, 3, 1, 0.82, 0, 0.9)
        R(art, x + 27, 30, 40, 2, 0.9, 0.9, 0.9, 0.7)
        R(art, x + 27, 35, 32, 2, 0.9, 0.9, 0.9, 0.7)
    end,
    classic = function(art)
        local R, w = Layout.Rect, art.width
        local x = (w - 96) / 2
        R(art, x, 7, 96, 44, 0.2, 0.18, 0.15, 1)
        R(art, x + 4, 11, 32, 32, 0.75, 0.6, 0.3, 1)
        R(art, x + 41, 13, 46, 3, 1, 0.82, 0, 0.9)
        R(art, x + 41, 21, 50, 2, 0.9, 0.9, 0.9, 0.7)
        R(art, x + 41, 27, 42, 2, 0.9, 0.9, 0.9, 0.7)
        R(art, x + 41, 36, 40, 2, 0.48, 0.58, 0.65, 0.8)
        R(art, x + 41, 42, 34, 2, 0.48, 0.58, 0.65, 0.6)
    end,
    -- Parchment, a header strip with the face at its left and the title past it, the words
    -- in dark ink, a slim scrollbar beside them.
    dialogueui = function(art)
        local R, w = Layout.Rect, art.width
        local x = (w - 60) / 2
        R(art, x, 6, 60, 48, 0.78, 0.68, 0.5, 1)
        R(art, x + 3, 9, 54, 12, 0.45, 0.36, 0.24, 1)
        R(art, x + 5, 10, 10, 10, 0.75, 0.6, 0.3, 1)
        R(art, x + 18, 14, 26, 3, 0.95, 0.88, 0.7, 0.9)
        R(art, x + 6, 26, 44, 2, 0.19, 0.17, 0.13, 0.85)
        R(art, x + 6, 32, 40, 2, 0.19, 0.17, 0.13, 0.85)
        R(art, x + 6, 38, 30, 2, 0.19, 0.17, 0.13, 0.85)
        R(art, x + 53, 26, 2, 14, 0.5, 0.36, 0.24, 0.8)
        R(art, x + 6, 47, 48, 1, 0.5, 0.36, 0.24, 0.8)
    end,
    subtitle = function(art)
        local R, w = Layout.Rect, art.width
        R(art, (w - 32) / 2, 30, 32, 3, 1, 0.82, 0, 0.9)
        R(art, (w - 84) / 2, 38, 84, 2, 0.95, 0.95, 0.95, 0.85)
        R(art, (w - 64) / 2, 44, 64, 2, 0.95, 0.95, 0.95, 0.85)
    end,
    -- Nothing on screen: the bars of a sound rising and falling, in the middle of the box.
    none = function(art)
        local R, w = Layout.Rect, art.width
        local heights = { 8, 16, 26, 16, 8 }
        local x = (w - 5 * 6) / 2
        for index, height in ipairs(heights) do
            R(art, x + (index - 1) * 6, 29 - height / 2, 3, height, 1, 0.82, 0, 0.75)
        end
    end,
}
local STYLE_TEXTS = {
    minimal = L.OPT_STYLE_MINIMAL_TEXT,
    classic = L.OPT_STYLE_CLASSIC_TEXT,
    dialogueui = L.OPT_STYLE_DIALOGUEUI_TEXT,
    subtitle = L.OPT_STYLE_SUBTITLE_TEXT,
    none = L.OPT_STYLE_NONE_TEXT,
}
local STYLE_TIPS = {
    minimal = L.WELCOME_STYLE_MINIMAL_TIP,
    classic = L.WELCOME_STYLE_CLASSIC_TIP,
    dialogueui = L.WELCOME_STYLE_DIALOGUEUI_TIP,
    subtitle = L.WELCOME_STYLE_SUBTITLE_TIP,
    none = L.WELCOME_STYLE_NONE_TIP,
}
-- The languages a voice pack can speak: the same list, in the same order, as each module's
-- (SpokenQuests' Language.LOCALES, SpokenBooks.LOCALES).
LANGUAGES = {
    { code = "enUS", native = "English" },
    { code = "deDE", native = "Deutsch" },
    { code = "esES", native = "Español (España)" },
    { code = "esMX", native = "Español (América Latina)" },
    { code = "frFR", native = "Français" },
    -- No client runs in Italian, so "Auto" never lands on it; a player picks it by hand.
    { code = "itIT", native = "Italiano" },
    { code = "ptBR", native = "Português" },
    { code = "ruRU", native = "Русский" },
    { code = "koKR", native = "한국어" },
    { code = "zhCN", native = "简体中文" },
    { code = "zhTW", native = "繁體中文" },
}

--- Show `style` on screen with a sample line, or nil to stop.
function Options:Preview(style)
    Addon.previewStyle = style
    PlayerFrame:RefreshConfig()
    Transcript:RefreshConfig()
    if Subtitle then Subtitle:ShowSample(style == "subtitle") end
    PlayerFrame:ShowSample(style == "minimal" or style == "classic" or style == "dialogueui")
end

-- Where Spoken lives outside the game: a row each, its icon and its address to copy, the game being
-- unable to open a web page.
local LINKS = {
    { name = "GitHub", icon = [[Interface\AddOns\Spoken\Textures\LinkGitHub]],
        url = "https://github.com/rusty-key/spoken-wow", tip = "LINK_GITHUB_TIP" },
    { name = "Discord", icon = [[Interface\AddOns\Spoken\Textures\LinkDiscord]],
        url = "https://discord.gg/HEGUgn6Yf", tip = "LINK_DISCORD_TIP" },
    { name = "CurseForge", icon = [[Interface\AddOns\Spoken\Textures\LinkCurseForge]],
        url = "https://www.curseforge.com/wow/addons/spoken-player", tip = "LINK_CURSEFORGE_TIP" },
    { name = "Wago", icon = [[Interface\AddOns\Spoken\Textures\LinkWago]],
        url = "https://addons.wago.io/addons/spoken-player", tip = "LINK_WAGO_TIP" },
    { name = "Buy Me a Coffee", icon = [[Interface\AddOns\Spoken\Textures\LinkBuyMeACoffee]],
        url = "https://buymeacoffee.com/rustykey", tip = "LINK_COFFEE_TIP" },
}
Options.LINKS = LINKS

function Options:AddLinks(layout)
    layout:Section(L.OPT_LINKS_TITLE)
    local frames = {}
    for _, link in ipairs(LINKS) do
        table.insert(frames, layout:Link({ icon = link.icon, title = link.name, url = link.url,
            tooltip = L[link.tip] .. "|n|n" .. L.OPT_LINKS_TIP }))
    end
    return frames
end

--- Preview mode: on, the chosen style is on screen with a sample line, and choosing another swaps
--- to it (StyleChosen); off, or when the page that turned it on closes, it all goes.
function Options:SetPreviewing(on)
    self.previewing = on and true or false
    self:Preview(on and Addon:PlayerStyle() or nil)
end

--- A style was chosen: in preview mode, it is the one shown now.
function Options:StyleChosen()
    if self.previewing then self:Preview(Addon:PlayerStyle()) end
end

--- The one Preview button over the narrator styles, on Spoken's page and in the welcome window,
--- turning preview mode on and off. Voice Only has nothing to show: with it chosen and the mode
--- off, the button stands greyed out.
function Options:PreviewButton(layout)
    local button = layout:HeadingButton(L.STYLE_PREVIEW, function()
        Options:SetPreviewing(not Options.previewing)
        layout:Refresh()
    end, L.STYLE_PREVIEW_TIP)
    layout:OnRefresh(function()
        button:SetText(Options.previewing and L.STYLE_PREVIEW_HIDE or L.STYLE_PREVIEW)
        Layout.FitButton(button)
        if Addon:PlayerStyle() == "none" and not Options.previewing then button:Disable() else button:Enable() end
    end)
    return button
end

-- Feature addons' pages asked for before this panel was registered; see Options:AddPage.
local pendingPages = {}

-- The same parts and ways of showing lines, drawn the same way, in the welcome window.
Options.PARTS, Options.SKETCHES = PARTS, SKETCHES
Options.STYLE_LABELS, Options.STYLE_TEXTS, Options.STYLE_TIPS = STYLE_LABELS, STYLE_TEXTS, STYLE_TIPS

--- The ways of showing lines this client can offer, in the order they are listed: the narrator
--- cards, and the legacy window's list. Subtitles Only first, the default; Voice Only last, its
--- card a sound's bars rising and falling, since there is nothing on screen to picture.
function Options:Styles()
    local styles = {}
    if not Transcript.unavailable then table.insert(styles, "subtitle") end
    if not Version.IsAnyLegacy then table.insert(styles, "minimal") end
    table.insert(styles, "classic")
    if DialogueUITheme and DialogueUITheme:Available() then table.insert(styles, "dialogueui") end
    table.insert(styles, "none")
    return styles
end

local function Build(canvas)
    panel = CreateFrame("Frame", "SpokenOptionsPanel", UIParent)
    -- The family's one entry in the game's settings. This page is its Home; each feature
    -- addon's page is nested under it (Options:AddPage).
    panel.name = "Spoken"
    -- On the settings canvas the rows are laid out in a scroller, as the books and zones
    -- panels are: the canvas neither scrolls nor clips, and the contributions rows pushed
    -- this panel past its bottom edge, drawing the minimap section over the game world. The
    -- legacy window grows to fit its rows instead (FitWindow), so it keeps laying out on
    -- the panel itself and never meets a ScrollFrame on a client that has not been tried.
    local host = panel
    if canvas then
        scroller = Layout.Scroll(panel)
        host = scroller.child
        panel.content = host
    end
    local cfg = function() return Addon.db.profile.Frame end
    local audio = function() return Addon.db.profile.Audio end
    local transcript = function() return Addon.db.profile.Transcript end
    local mm = function() return Addon.db.profile.Minimap.LibDBIcon end
    local function Style() return Addon:PlayerStyle() end
    local function InWindow()
        local style = Style()
        return style == "minimal" or style == "classic" or style == "dialogueui"
    end
    local function Small() return Style() == "minimal" end
    local function Subtitles() return Style() == "subtitle" end
    local function Words() return transcript().Enabled end
    local refresh = function() PlayerFrame:RefreshConfig(); Options:UpdateRows() end
    local refreshTranscript = function() Transcript:RefreshConfig(); Options:UpdateRows() end

    local layout = Layout.New(host, INDENT, -TOP)
    panel.layout = layout
    layout:Header(L.OPT_HOME_TITLE, L.OPT_HOME_NOTE, nil, [[Interface\AddOns\Spoken\icon.tga]])
    -- On the canvas the page is headed as the game's pages are: its name and its Defaults, and
    -- no paragraph under them, as the game's own pages have none.
    if canvas then
        layout:HideHeader()
        layout:Intro([[Interface\AddOns\Spoken\icon.tga]], L.OPT_HOME_TITLE)
    end
    -- Two kinds of row that does nothing right now. One that belongs to another way of
    -- showing lines is hidden, and the page closes up round it: a player who chose subtitles
    -- has no use for the window's size. One waiting on a switch beside it is greyed out
    -- instead, saying which switch -- seeing it there is how a player learns it exists.
    local function Requires(row, applies, reason) return layout:Requires(row, applies, reason) end
    local function Only(row, applies) return layout:ShowWhen(row, applies) end
    local function Shown() return Style() ~= "none" end

    -- Every Spoken page is searchable from here; the game's own settings search cannot see
    -- inside an addon's canvas.
    if canvas and Search then
        layout:Custom(Search:Build(host), Search.height, function(width) Search:Fit(width) end)
    end

    -- What Spoken reads, first: it decides which of the pages under this one matter. On the
    -- settings canvas, a list with a row each, saying what is installed; the legacy window
    -- keeps a plain switch per row. No box round the list: it is a box itself.
    layout:Section(L.OPT_PARTS_TITLE, canvas)
    panel.parts = {}
    local known = {}
    local modules = {}
    for _, part in ipairs(PARTS) do
        known[part.key] = true
        local key, order = part.key, part.order
        local function On() return Spoken:IsPartOn(key) end
        local function Write(v) Sources:SetTurnedOff(key, not v) end
        local function Missing() if not Sources:Get(key) then return L.REASON_NOT_INSTALLED end end
        if canvas then
            -- Beside its words, how many of its voice packs it has, then a button to its page,
            -- whenever the module is installed: switched off, its page is still there, with its
            -- own Enable switch for exactly that. Whether it is on, its checkbox and its row say.
            table.insert(modules, { icon = part.icon, title = part.label, text = part.text, tooltip = part.tip,
                read = On, write = Write, apply = function() Options:UpdateRows() end, disabled = Missing,
                status = function() return Options:PartVoice(key) end,
                hint = function(on) return on and L.OPT_PART_CLICK_OFF or L.OPT_PART_CLICK_ON end,
                button = L.OPT_PART_SETTINGS, onButton = function() Options:OpenPage(order) end,
                buttonEnabled = function() return Sources:Get(key) ~= nil end })
        else
            local row = layout:Checkbox(part.label, part.tip, On, Write, function() Options:UpdateRows() end)
            row.partKey, row.partLabel = key, part.label
            table.insert(panel.parts, row)
            Requires(row, function() return Sources:Get(key) ~= nil end, L.REASON_NOT_INSTALLED)
        end
    end
    if canvas then layout:List(modules) end
    -- An addon outside the three that speaks through the player still gets its switch.
    for key, source in Sources:Iterate() do
        if not known[key] then
            layout:Checkbox(source.title, L.OPT_PART_OTHER_TIP,
                function() return not Sources:IsTurnedOff(source) end,
                function(v) Sources:SetTurnedOff(key, not v) end)
        end
    end

    -- The choice every other display row depends on, then the two that apply whichever way
    -- lines are shown. On the canvas the choice is a list with a picture each, a section of its own.
    local styles = Options:Styles()
    -- Pictures on the canvas, where the three look different enough that a sketch says more
    -- than a name; a dropdown in the legacy window, which has room for neither.
    if canvas then
        layout:Section(L.OPT_PLAYER_STYLE, true)
        local tiles = {}
        for _, style in ipairs(styles) do
            table.insert(tiles, { value = style, title = STYLE_LABELS[style], text = STYLE_TEXTS[style],
                tooltip = STYLE_TIPS[style], art = SKETCHES[style] })
        end
        Options:PreviewButton(layout)
        layout:Choices(tiles, Style, function(v) Addon:SetPlayerStyle(v) end,
            function()
                PlayerFrame:RefreshConfig(); refreshTranscript()
                Options:StyleChosen()
            end,
            { choose = L.STYLE_CHOOSE })
        layout:Group(L.OPT_NARRATOR_SETTINGS)
        layout:Section(L.OPT_SHOW_TITLE)
    else
        layout:Group(L.OPT_NARRATOR_SETTINGS)
        layout:Section(L.OPT_SHOW_TITLE)
        layout:Dropdown(L.OPT_PLAYER_STYLE, L.OPT_PLAYER_STYLE_TIP, styles, Style,
            function(v) Addon:SetPlayerStyle(v) end,
            function() PlayerFrame:RefreshConfig(); refreshTranscript() end,
            function(v) return STYLE_LABELS[v] or v end)
    end
    -- No captions on 1.12: its Transcript is a stub (see 1.12\Transcript.lua).
    if not Transcript.unavailable then
        Only(layout:Checkbox(L.TRANSCRIPT_SHOW, L.TRANSCRIPT_SHOW_TIP,
            function() return transcript().Enabled end,
            function(v) Transcript:SetEnabled(v) end, function() Options:UpdateRows() end), Shown)
        -- The word being read lit: the windows only. The subtitles type their words at their
        -- own pace, where an estimated word timing would show every miss. With DialogueUI
        -- installed, also for the quest text Spoken Quests marks there, under any style.
        local highlight = layout:Checkbox(L.TRANSCRIPT_HIGHLIGHT, L.TRANSCRIPT_HIGHLIGHT_TIP,
            function() return transcript().HighlightWord end,
            function(v) transcript().HighlightWord = v end, refreshTranscript)
        Only(highlight, function() return InWindow() or DialogueUITheme:Available() end)
        Requires(highlight, Words, L.REASON_WORDS)
        local typewriter = layout:Checkbox(L.TRANSCRIPT_TYPEWRITER, L.TRANSCRIPT_TYPEWRITER_TIP,
            function() return transcript().Typewriter end,
            function(v) transcript().Typewriter = v end, refreshTranscript)
        Only(typewriter, Shown)
        Requires(typewriter, Words, L.REASON_WORDS)
        -- How the subtitles type, under it: letter by letter, or whole words.
        layout:Indent()
        local by = layout:Dropdown(L.TRANSCRIPT_TYPEWRITER_BY, L.TRANSCRIPT_TYPEWRITER_BY_TIP, { "word", "letter" },
            function() return transcript().TypewriterBy or "letter" end,
            function(v) transcript().TypewriterBy = v end, refreshTranscript,
            function(v) return v == "letter" and L.TRANSCRIPT_BY_LETTER or L.TRANSCRIPT_BY_WORD end)
        layout:Outdent()
        Only(by, Subtitles)
        Requires(by, function() return Words() and transcript().Typewriter end, L.REASON_TYPEWRITER)
    end
    Only(layout:Checkbox(L.OPT_LOCK_FRAME, L.OPT_LOCK_FRAME_TIP,
        function() return cfg().LockFrame end, function(v) cfg().LockFrame = v end, refresh), Shown)
    Only(layout:Button(L.OPT_RESET, 160, function()
        PlayerFrame:Reset()
        if Subtitle then Subtitle:Reset() end
    end, L.OPT_RESET_TIP), Shown)

    layout:Section(L.OPT_WINDOW_TITLE)
    Only(layout:Slider(L.OPT_SCALE, 0.5, 2, 0.05,
        function() return cfg().FrameScale end, function(v) cfg().FrameScale = v end, refresh,
        nil, L.OPT_SCALE_TIP), InWindow)
    -- The DialogueUI window's own settings, its theme first, live on the DialogueUI page.
    if canvas then
        Only(layout:Button(L.OPT_DUI_OPEN_PAGE, 200, function() DialogueUIOptions:Open() end),
            function() return Style() == "dialogueui" end)
    end
    Only(layout:Checkbox(L.OPT_HIDE_PORTRAIT, L.OPT_HIDE_PORTRAIT_TIP,
        function() return cfg().HidePortrait end, function(v) cfg().HidePortrait = v end, refresh),
        InWindow)
    -- The small window's metal and every round button's ring: offered whatever the style.
    if Version.IsCamelot then
        layout:Checkbox(L.OPT_BRONZE_TINT, L.OPT_BRONZE_TINT_TIP,
            function() return cfg().BronzeTint end, function(v) cfg().BronzeTint = v end, refresh)
    end
    -- One row per action an addon declared optional, named by that addon. The player is
    -- not told what any of them do. The subtitle shows the corner icon too, so the row is
    -- there with subtitles as well as with a window. Report is not the window's alone (the
    -- quest log, DialogueUI's window and the lore pages show it), so its row is a general one.
    local function HideActionRow(id, label, tip, changed)
        return layout:Checkbox(label, tip,
            function() return cfg().HiddenActions[id] end,
            function(v) cfg().HiddenActions[id] = v or nil end, function()
                refresh()
                if Subtitle then Subtitle:Update() end
                if changed then changed() end
            end)
    end
    for _, optional in ipairs(Actions.optional) do
        if optional.id ~= "report" then
            Only(HideActionRow(optional.id, format(L.OPT_HIDE_ACTION, optional.label), L.OPT_HIDE_ACTION_TIP),
                function() return InWindow() or Subtitles() end)
        end
    end
    -- The report action's own key, which the windows already follow: a hidden Report stays hidden.
    local function ReportRow(tip)
        return HideActionRow("report", L.OPT_HIDE_REPORT, tip,
            function() Callbacks:Fire("REPORT_SETTINGS_CHANGED") end)
    end
    -- Legacy clients have no Contribute section, and Report only on a window or subtitles. Its tip
    -- names only what they have: no Small Window, and no subtitles on 1.12.
    if not Spoken.Contribute then
        Only(ReportRow(Version.IsLegacyVanilla and L.OPT_HIDE_REPORT_TIP_VANILLA
            or L.OPT_HIDE_REPORT_TIP_LEGACY), function() return InWindow() or Subtitles() end)
    end
    -- No "hide the window" switch: nothing on screen at all is Voice Only, a way of showing
    -- lines like the others, chosen with them above.

    if not Transcript.unavailable then
        layout:Section(L.OPT_TEXT_TITLE)
        local function InWindowText(row)
            Only(row, InWindow)
            Requires(row, Words, L.REASON_WORDS)
        end
        InWindowText(layout:Slider(L.TRANSCRIPT_SIZE, 12, 26, 1,
            function() return transcript().FontSize end,
            function(v) transcript().FontSize = v end, refreshTranscript, Layout.Number, L.TRANSCRIPT_SIZE_TIP))
        InWindowText(layout:Slider(L.TRANSCRIPT_LINES, 1, 2, 1,
            function() return transcript().Lines end,
            function(v) transcript().Lines = v end, refreshTranscript, Layout.Number, L.TRANSCRIPT_LINES_TIP))
        local SCROLL_LABELS = { line = L.TRANSCRIPT_SCROLL_LINE, page = L.TRANSCRIPT_SCROLL_PAGE,
            off = L.TRANSCRIPT_SCROLL_OFF }
        InWindowText(layout:Dropdown(L.TRANSCRIPT_SCROLL, L.TRANSCRIPT_SCROLL_TIP, { "line", "page", "off" },
            function() return Transcript:ScrollMode() end,
            function(v) transcript().ScrollMode = v; Transcript.manualScroll = false end, refreshTranscript,
            function(v) return SCROLL_LABELS[v] or v end))

        layout:Section(L.OPT_SUBTITLE_TITLE)
        local function ForSubtitles(row)
            Only(row, Subtitles)
            Requires(row, Words, L.REASON_WORDS)
        end
        -- These two are the subtitle's alone: redrawing it is enough, on every step of a drag,
        -- without the captions' full refresh and every row's.
        local refreshSubtitle = function() Subtitle:Update() end
        ForSubtitles(layout:Slider(L.OPT_SUBTITLE_SIZE, 0.6, 1.6, 0.05,
            function() return transcript().SubtitleScale end,
            function(v) transcript().SubtitleScale = v end, refreshSubtitle, nil, L.OPT_SUBTITLE_SIZE_TIP))
        ForSubtitles(layout:Slider(L.OPT_SUBTITLE_SENTENCES, 1, 4, 1,
            function() return transcript().SubtitleSentences or 3 end,
            function(v) transcript().SubtitleSentences = v end, refreshSubtitle, Layout.Number, L.OPT_SUBTITLE_SENTENCES_TIP))
        ForSubtitles(layout:Slider(L.TRANSCRIPT_SHADOW, 0, 1, 0.05,
            function() return transcript().SubtitleShadow end,
            function(v) transcript().SubtitleShadow = v end, refreshSubtitle, nil, L.TRANSCRIPT_SHADOW_TIP))
        ForSubtitles(layout:Checkbox(L.OPT_SUBTITLE_PROGRESS, L.OPT_SUBTITLE_PROGRESS_TIP,
            function() return transcript().SubtitleProgress ~= false end,
            function(v) transcript().SubtitleProgress = v end, refreshSubtitle))
        panel.sampleButton = Only(layout:Button(L.SUBTITLE_SAMPLE_SHOW, 200, function()
            Subtitle:ShowSample(not Subtitle:IsShowingSample())
            Options:UpdateRows()
        end, L.SUBTITLE_SAMPLE_TIP), Subtitles)
    end

    -- The narrator style's settings end here; what follows is Spoken's whatever the style.
    layout:EndGroup()

    -- Azeroth's Compendium, after the narrator style's settings: the window Zones and Books each
    -- add a tab to, opened here and from the minimap menu, with each tab's Unlock switch. The tabs
    -- register once the world is up, after this page is built, so the rows ask for them each time
    -- they are drawn; with neither part installed the section has nothing showing and hides.
    local function Compendium() return _G.SpokenCompendium end
    local function Tab(key)
        local compendium = Compendium()
        return compendium and compendium.Tab and compendium:Tab(key)
    end
    layout:Section(L.OPT_COMPENDIUM_TITLE)
    local open = layout:Button(L.OPT_COMPENDIUM_OPEN, 200, function()
        local compendium = Compendium()
        if compendium and compendium.Toggle then compendium:Toggle() end
    end, L.OPT_COMPENDIUM_OPEN_TIP)
    Only(open, function() local compendium = Compendium(); return compendium ~= nil and compendium.Toggle ~= nil end)
    Requires(open, function()
        local compendium = Compendium()
        return compendium ~= nil and compendium.Available ~= nil and compendium:Available()
    end, L.REASON_COMPENDIUM_OFF)
    for _, unlock in ipairs({
        { tab = "places", part = "zones", label = L.OPT_UNLOCK_PLACES, tip = L.OPT_UNLOCK_PLACES_TIP, module = L.OPT_PART_ZONES },
        { tab = "readables", part = "books", label = L.OPT_UNLOCK_WRITINGS, tip = L.OPT_UNLOCK_WRITINGS_TIP, module = L.OPT_PART_BOOKS },
    }) do
        local row = layout:Checkbox(unlock.label, unlock.tip,
            function() local tab = Tab(unlock.tab); return tab ~= nil and tab.unlock ~= nil and tab.unlock.get() end,
            function(v) local tab = Tab(unlock.tab); if tab and tab.unlock then tab.unlock.set(v) end end)
        Only(row, function() local tab = Tab(unlock.tab); return tab ~= nil and tab.unlock ~= nil end)
        Requires(row, function() return Spoken:IsPartOn(unlock.part) end, format(L.REASON_MODULE_OFF_FMT, unlock.module))
    end

    -- Everything about how a line is played, whichever addon queued it: the two feature
    -- addons each used to carry their own channel control, and a player with both
    -- installed had two settings for one thing.
    -- The voice language, once for every module: they share the same list of languages, and a
    -- player who picks Portuguese means it for quests and books alike.
    layout:Section(L.OPT_LANGUAGE_TITLE)
    local language = function() return Addon.db.profile.Language end
    local voices, fallbacks = { "auto" }, { "none" }
    for _, locale in ipairs(LANGUAGES) do
        table.insert(voices, locale.code)
        table.insert(fallbacks, locale.code)
    end
    local function Native(code)
        for _, locale in ipairs(LANGUAGES) do
            if locale.code == code then return locale.native end
        end
        return code
    end
    local function ClientLanguage()
        local locale = GetLocale and GetLocale()
        if locale == "enGB" then return "enUS" end
        for _, each in ipairs(LANGUAGES) do
            if each.code == locale then return locale end
        end
        return "enUS"
    end
    layout:Dropdown(L.OPT_VOICE_LANGUAGE, L.OPT_VOICE_LANGUAGE_TIP, voices,
        function() return language().Voice or "auto" end,
        function(code) language().Voice = code end, nil,
        function(code)
            if code == "auto" then return format(L.OPT_LANG_AUTO_FMT, Native(ClientLanguage())) end
            return Native(code)
        end)
    layout:Dropdown(L.OPT_FALLBACK_LANGUAGE, L.OPT_FALLBACK_LANGUAGE_TIP, fallbacks,
        function() return language().Fallback or "enUS" end,
        function(code) language().Fallback = code end, nil,
        function(code) return code == "none" and L.OPT_FALLBACK_NONE or Native(code) end)

    layout:Section(L.OPT_AUDIO_TITLE)
    if audio().AutoToggleDialog ~= nil then
        layout:Checkbox(L.OPT_MUTE_DIALOGUE,
            Version.IsLegacyVanilla and L.OPT_MUTE_DIALOGUE_TIP_VANILLA or L.OPT_MUTE_DIALOGUE_TIP,
            function() return audio().AutoToggleDialog end,
            function(v)
                audio().AutoToggleDialog = v
                -- Turning it off while it holds the channel down would leave it muted.
                if not v then
                    SoundUtils:MuteChannel("Dialog", false)
                end
            end, function() Options:UpdateRows() end)
    end
    layout:Checkbox(L.OPT_GREETING_FIRST, L.OPT_GREETING_FIRST_TIP,
        function() return audio().GreetingFirst end,
        function(v)
            audio().GreetingFirst = v
            if v then GreetingFirst:SetDialogApart() end
        end)
    layout:Slider(L.OPT_LINE_GAP, 0, 5, 0.25,
        function() return audio().LineGap or 0 end, function(v) audio().LineGap = v end,
        nil, Layout.Seconds, L.OPT_LINE_GAP_TIP)
    layout:Checkbox(L.OPT_CUE_BETWEEN, L.OPT_CUE_BETWEEN_TIP,
        function() return audio().CueBetweenLines end,
        function(v) audio().CueBetweenLines = v end)
    if OtherSounds:IsAvailable() then
        local lower = function() return audio().LowerOthers end
        local apply = function() OtherSounds:RefreshConfig(); Options:UpdateRows() end
        -- A section of its own rather than indented under its switch: an indented slider
        -- starts its bar out of line with every other control on the panel.
        layout:Section(L.OPT_LOWER_TITLE)
        layout:Checkbox(L.OPT_LOWER_OTHERS, L.OPT_LOWER_OTHERS_TIP,
            function() return lower().Enabled end, function(v) lower().Enabled = v end, apply)
        for _, row in ipairs({ { "Music", L.OPT_LOWER_MUSIC, L.OPT_LOWER_MUSIC_TIP },
            { "Ambience", L.OPT_LOWER_AMBIENCE, L.OPT_LOWER_AMBIENCE_TIP },
            { "SFX", L.OPT_LOWER_SFX, L.OPT_LOWER_SFX_TIP },
            { "Dialog", L.OPT_LOWER_DIALOG, L.OPT_LOWER_DIALOG_TIP } }) do
            local channel = row[1]
            local slider = layout:Slider(row[2], 0, 1, 0.05,
                function() return lower()[channel] end, function(v) lower()[channel] = v end, apply,
                nil, row[3])
            Requires(slider, function() return lower().Enabled end, L.REASON_LOWER)
            if channel == "Dialog" then
                -- With the game's dialogue silenced outright, there is no level to set.
                Requires(slider, function() return not audio().AutoToggleDialog end, L.REASON_DIALOG_MUTED)
            end
        end
    end

    -- 2.4.3 and 3.3.5 only, and absent from the saved variables anywhere else. These had
    -- no rows at all until recently: the settings existed and could only be reached by
    -- editing the saved variables by hand.
    local music = audio().LegacyMusicChannel
    if music then
        layout:Checkbox(L.OPT_MUSIC_CHANNEL, L.OPT_MUSIC_CHANNEL_TIP,
            function() return music.Enabled end,
            function(v) music.Enabled = v end)
        layout:Slider(L.OPT_MUSIC_VOLUME, 0, 1, 0.05,
            function() return music.Volume end,
            function(v) music.Volume = v end)
        layout:Slider(L.OPT_MUSIC_FADE, 0, 2, 0.1,
            function() return music.FadeOutMusic end,
            function(v) music.FadeOutMusic = v end, nil, Layout.Seconds)
    end
    if audio().LegacyHDModels ~= nil then
        layout:Checkbox(L.OPT_HD_MODELS, L.OPT_HD_MODELS_TIP,
            function() return audio().LegacyHDModels end,
            function(v) audio().LegacyHDModels = v end)
    end

    -- The buttons live on Blizzard's quest, book and map frames, not on the player, but
    -- they all open the player's box, so the one switch for them is here. Absent where
    -- Contribute.xml is not loaded (the legacy clients): nothing there to hide.
    if Spoken.Contribute then
        layout:Section(L.OPT_CONTRIBUTE_TITLE)
        -- How much there is to send, first, so a player knows when it is worth sending.
        if Gather then
            layout:Badge(L.OPT_GATHER_ROW, function()
                if not Gather:IsEnabled() then return "off", L.GATHER_OFF end
                local count = Gather:Count()
                if count == 0 then return "off", L.GATHER_NONE end
                return "ok", format(L.GATHER_BADGE_FMT, count)
            end, L.OPT_GATHER_TIP, true)
        end
        layout:Checkbox(L.OPT_HIDE_CONTRIBUTE, L.OPT_HIDE_CONTRIBUTE_TIP,
            function() return Addon.db.profile.Contribute.HideButtons end,
            function(v) Addon.db.profile.Contribute.HideButtons = v end,
            function() Callbacks:Fire("CONTRIBUTE_SETTINGS_CHANGED") end)
        ReportRow(L.OPT_HIDE_REPORT_TIP)
        -- The opt-out the first Contribute click promises. Independent of hiding the buttons:
        -- a player who gathers has no use for them, and hiding them must not stop it.
        if Gather then
            layout:Checkbox(L.OPT_GATHER, L.OPT_GATHER_TIP,
                function() return Gather:IsEnabled() end,
                function(v)
                    -- Choosing here is an answer to the first-click question too.
                    Gather:SetIntroduced()
                    Gather:SetEnabled(v)
                end, function() Options:UpdateRows() end)
            layout:Columns(2)
            layout:Button(L.OPT_GATHER_SHARE, 200, function() Spoken:ShowGatherInstructions() end,
                L.OPT_GATHER_SHARE_TIP)
            layout:Button(L.OPT_GATHER_CLEAR, 200, function() Gather:Clear(); Options:UpdateRows() end,
                L.OPT_GATHER_CLEAR_TIP)
        end
    end

    layout:Section(L.OPT_MINIMAP_TITLE)
    layout:Checkbox(L.OPT_MINIMAP_SHOW, L.OPT_MINIMAP_SHOW_TIP,
        function() return not mm().hide end,
        function(v) mm().hide = not v end, function() Minimap:Refresh() end)
    layout:Checkbox(L.OPT_MINIMAP_LOCK, L.OPT_MINIMAP_LOCK_TIP,
        function() return mm().lock end,
        function(v) mm().lock = v end, function() Minimap:Refresh() end)
    -- Blizzard's addon compartment exists on the modern clients only; the player's
    -- button shows there too, opening the same menu, and this row switches it.
    if AddonCompartmentFrame then
        layout:Checkbox(L.OPT_MINIMAP_COMPARTMENT, L.OPT_MINIMAP_COMPARTMENT_TIP,
            function() return mm().showInCompartment end,
            function(v) Minimap:ToggleCompartment(v) end)
    end

    -- Keys for the queue, said here as well as in the game's key bindings: with subtitles only
    -- or voice only there is no window to click, and a player needs to know these exist.
    layout:Section(L.OPT_KEYS_TITLE)
    -- Each action by its name, with its key beside it where a setting's control would be: read
    -- at a glance down the box, the way the game's own bindings list reads, and set right there.
    -- The legacy clients name a key only when told where its name lives ("KEY_SPACE").
    local function KeyText(key)
        if not GetBindingText then return key end
        if Version.IsAnyLegacy then return GetBindingText(key, "KEY_") or key end
        return GetBindingText(key) or key
    end
    local function Bind(name, key)
        if InCombatLockdown and InCombatLockdown() then
            if UIErrorsFrame then UIErrorsFrame:AddMessage(L.OPT_KEY_COMBAT, 1, 0.1, 0.1) end
            return
        end
        if not (SetBinding and GetBindingKey) then return end
        -- The action's old keys go, so it has the one it was given.
        local old = { GetBindingKey(name) }
        for _, previous in ipairs(old) do SetBinding(previous, nil) end
        if key then SetBinding(key, name) end
        if SaveBindings then SaveBindings(GetCurrentBindingSet and GetCurrentBindingSet() or 1) end
        layout:Refresh()
    end
    for _, binding in ipairs(BINDINGS) do
        local name, label = binding[1], binding[2]
        layout:Key(label, function()
            local key = GetBindingKey and GetBindingKey(name)
            if not key then return "off", L.OPT_KEY_NONE end
            return "key", KeyText(key)
        end, function(key)
            -- A key the game or another addon uses already is asked about, not taken.
            local taken = key and GetBindingAction and GetBindingAction(key)
            if taken and taken ~= "" and taken ~= name then
                Layout.Confirm(format(L.OPT_KEY_TAKEN_FMT, KeyText(key), _G["BINDING_NAME_" .. taken] or taken, label),
                    L.OPT_KEY_REPLACE, L.CANCEL, function() Bind(name, key) end)
                return
            end
            Bind(name, key)
        end, L.OPT_KEY_SET_TIP, { press = L.OPT_KEY_PRESS })
    end
    if canvas and Settings and Settings.KEYBINDINGS_CATEGORY_ID then
        layout:Button(L.OPT_KEYS_SET, 160, function()
            pcall(Settings.OpenToCategory, Settings.KEYBINDINGS_CATEGORY_ID)
        end, L.OPT_KEYS_SET_TIP)
    end

    -- Profiles, for all of Spoken at once: the player's own settings and every part that keeps
    -- its settings in profiles switch, copy and delete together.
    Options:AddProfiles(layout)

    -- Spoken outside the game: its code, its Discord and its download page.
    if canvas then Options.links = Options:AddLinks(layout) end

    -- Last, as Blizzard's own pages end on their defaults button: the two ways to start over.
    if Welcome and canvas then
        layout:Section(L.OPT_START_OVER_TITLE)
        layout:Button(L.OPT_WELCOME_AGAIN, 200, function() Welcome:Show() end, L.OPT_WELCOME_AGAIN_TIP)
    end
    -- Every setting back, from the header's Defaults as the game's pages have it.
    layout:StartOver(L.OPT_START_OVER_TITLE, L.OPT_RESET_ALL, function()
        Layout.Confirm(L.OPT_RESET_ALL_CONFIRM, L.OPT_RESET_AND_RELOAD, L.CANCEL, function()
            -- The Unlock switches are on this page but kept with each part's settings, which
            -- ResetProfile does not reach, and each part's own Reset skips them.
            for _, key in ipairs({ "places", "readables" }) do
                local tab = Tab(key)
                if tab and tab.unlock then tab.unlock.set(false) end
            end
            Addon.db:ResetProfile()
            Addon.db.global.Layout = nil
            ReloadUI()
        end)
    end, L.OPT_RESET_ALL_TIP)

    -- Feature addons register a button here to reach their own settings. The section is
    -- created with the first of them: with no feature addon installed there is nothing
    -- to head.
    panel.links = {}
    for _, link in ipairs(pendingLinks) do
        Options:AddLink(link.text, link.onClick)
    end
    pendingLinks = {}
    -- The modules register on entering the world, after this page is built: drawn again for each,
    -- or their rows in the module list say "Not installed" until something else redraws them.
    Callbacks:Register("SOURCE_REGISTERED", function() Options:UpdateRows() end)
    if panel.HookScript then
        panel:HookScript("OnShow", function() Options:UpdateRows() end)
        -- The sample is for placing the subtitle while the settings are open, not after.
        panel:HookScript("OnHide", function()
            if Subtitle and Subtitle:IsShowingSample() then Subtitle:ShowSample(false) end
            if Options.previewing or Addon.previewStyle then Options:SetPreviewing(false) end
        end)
    end
    return panel
end

--- Grey out what the current choices leave doing nothing, saying why, and name the sample
--- button for what a click on it will do.
function Options:UpdateRows()
    if not panel then return end
    panel.layout:Refresh()
    for _, row in ipairs(panel.parts or {}) do
        local installed = Sources:Get(row.partKey) ~= nil
        row.text:SetText(installed and row.partLabel or format(L.OPT_PART_MISSING, row.partLabel))
    end
    local sample = panel.sampleButton
    if sample then
        sample:SetText(Subtitle:IsShowingSample() and L.SUBTITLE_SAMPLE_HIDE or L.SUBTITLE_SAMPLE_SHOW)
    end
end

--- How a part stands, for its card and the top of its page: not installed, switched off, or
--- on with however many voice packs it found. The words are the player's, so every part
--- says it the same way.
function Options:PartStatus(key)
    local source = Sources:Get(key)
    if not source then return "off", L.PART_NOT_INSTALLED end
    if Sources:IsTurnedOff(source) then return "off", L.PART_OFF end
    local count = self:PackCount(source)
    if not count then return nil end
    if count == 0 then return "warn", L.PART_NO_PACK end
    if count == 1 then return "ok", L.PART_ONE_PACK end
    return "ok", format(L.PART_PACKS_FMT, count)
end

-- How many voice packs a part's addon found, or nil where it does not say.
function Options:PackCount(source)
    if not (source and source.packs) then return nil end
    local ok, packs = pcall(source.packs)
    if not ok or type(packs) ~= "table" then return nil end
    return getn(packs)
end

--- Whether a module has its voices, apart from whether it is enabled: "Voice Packs" and how many
--- of its packs are installed, in any language. Not out of how many there are: a player needs
--- their own language's, not all of them. Nothing for a module that is not installed.
function Options:PartVoice(key)
    local source = Sources:Get(key)
    if not source then return nil end
    local have = self:PackCount(source)
    if not have then return nil end
    return have == 0 and "muted" or "neutral", L.PART_VOICE, tostring(have)
end

--- Every AceDB object a profile choice applies to: the player's, then each installed part's
--- that keeps its settings in profiles (a source's `profiles`).
function Options:ProfileDBs()
    local dbs = {}
    if Addon.db and Addon.db.GetProfiles then table.insert(dbs, Addon.db) end
    for _, source in Sources:Iterate() do
        if type(source.profiles) == "function" then
            local ok, db = pcall(source.profiles)
            if ok and type(db) == "table" and db.GetProfiles then table.insert(dbs, db) end
        end
    end
    return dbs
end

local function Has(db, name)
    for _, other in ipairs(db:GetProfiles()) do
        if other == name then return true end
    end
    return false
end

--- Every profile any of them has, sorted, each once.
function Options:ProfileNames()
    local seen, names = {}, {}
    for _, db in ipairs(self:ProfileDBs()) do
        for _, name in ipairs(db:GetProfiles()) do
            if not seen[name] then
                seen[name] = true
                table.insert(names, name)
            end
        end
    end
    table.sort(names)
    return names
end

function Options:CurrentProfile()
    local db = self:ProfileDBs()[1]
    return db and db:GetCurrentProfile()
end

--- Switch every one to `name`, which AceDB makes where it is new.
function Options:SetProfile(name)
    for _, db in ipairs(self:ProfileDBs()) do db:SetProfile(name) end
end

--- Copy `name` into the profile in use, in every one that has it.
function Options:CopyProfile(name)
    for _, db in ipairs(self:ProfileDBs()) do
        if db.CopyProfile and Has(db, name) and db:GetCurrentProfile() ~= name then db:CopyProfile(name) end
    end
end

function Options:DeleteProfile(name)
    for _, db in ipairs(self:ProfileDBs()) do
        if db.DeleteProfile and Has(db, name) and db:GetCurrentProfile() ~= name then db:DeleteProfile(name) end
    end
end

function Options:AddProfiles(layout)
    if not self:ProfileDBs()[1] then return end
    self.profileLayout = layout
    local function Others()
        local others, current = {}, self:CurrentProfile()
        for _, name in ipairs(self:ProfileNames()) do
            if name ~= current then table.insert(others, name) end
        end
        return others
    end
    local function Pick(name) return name or L.OPT_PROFILE_PICK end
    layout:Section(L.OPT_SECTION_PROFILES)
    layout:Dropdown(L.OPT_PROFILE, L.OPT_PROFILE_TIP, function() return self:ProfileNames() end,
        function() return self:CurrentProfile() end,
        function(name) self:SetProfile(name); layout:Refresh() end)
    layout:Dropdown(L.OPT_COPY_PROFILE, L.OPT_COPY_PROFILE_TIP, Others, function() return nil end,
        function(name) self:CopyProfile(name); layout:Refresh() end, nil, Pick)
    layout:Dropdown(L.OPT_DELETE_PROFILE, L.OPT_DELETE_PROFILE_TIP, Others, function() return nil end,
        function(name) self:DeleteProfile(name); layout:Refresh() end, nil, Pick)
    if StaticPopupDialogs and StaticPopup_Show then
        StaticPopupDialogs.SPOKEN_NEW_PROFILE = StaticPopupDialogs.SPOKEN_NEW_PROFILE or {
            text = L.OPT_PROFILE_NEW_PROMPT, button1 = _G.ACCEPT or "Accept", button2 = L.CANCEL,
            hasEditBox = true, timeout = 0, whileDead = true, hideOnEscape = true,
            -- 1.12 and 2.4.3 hand these nothing: the dialog, or its edit box, is in `this`.
            OnAccept = function(popup)
                popup = popup or this
                local box = popup and (popup.editBox or popup.EditBox)
                if not box and StaticPopup_Visible then
                    local which = StaticPopup_Visible("SPOKEN_NEW_PROFILE")
                    box = which and _G[which .. "EditBox"]
                end
                local name = box and box:GetText()
                if name and name ~= "" then
                    Options:SetProfile(name)
                    if Options.profileLayout then Options.profileLayout:Refresh() end
                end
            end,
            EditBoxOnEnterPressed = function(box)
                box = box or this
                local popup = box and box:GetParent()
                if popup and popup.button1 then popup.button1:Click() end
            end,
        }
        layout:Button(L.OPT_PROFILE_NEW, 200, function() StaticPopup_Show("SPOKEN_NEW_PROFILE") end,
            L.OPT_PROFILE_NEW_TIP)
    end
end

--- Open Spoken's page on a tab: Home's is 0, a feature addon's the order it was listed in.
function Options:OpenPage(order)
    if self.category then
        -- Each page its own entry: open that one.
        local category = self.category
        for _, page in ipairs(self.pages or {}) do
            if page.order == order then category = page.category end
        end
        if not category then return false end
        Layout.OpenCategory(category, L.OPT_OPEN_COMBAT)
        return true
    end
    return false
end

--- Every page search can reach: this one, then the feature addons' in their order.
function Options:Pages()
    local pages = {}
    if panel and self.category then
        table.insert(pages, { name = L.OPT_HOME_TITLE, category = self.category, layout = panel.layout,
            scroller = scroller, order = 0 })
    end
    for _, page in ipairs(self.pages or {}) do
        if page.category and page.layout then table.insert(pages, page) end
    end
    return pages
end

--- Open a page, and once the settings window has drawn it, scroll to `row` and light it up.
--- `page` is one of Pages(), each of which OpenPage finds by its order.
function Options:ShowRow(page, row)
    self:OpenPage(page.order)
    local function Land()
        if page.scroller then
            page.scroller:Recalculate()
            page.scroller:ScrollTo(-(row.layoutY or 0) - 60)
        end
        page.layout:Highlight(row)
    end
    -- The canvas has no size until the window lays it out, so the scroll waits a moment.
    if C_Timer and C_Timer.After then C_Timer.After(0.05, Land) else Land() end
end

-- The legacy window's height: never shorter than it always was, and tall enough for every
-- row, including a link a feature addon added after the window was built. On the canvas,
-- the scroller's content height instead, for the same late links.
local function FitWindow()
    if scroller and panel then
        scroller:SetContentHeight(TOP + panel.layout:Height() + BOTTOM)
        return
    end
    if not (panel and panel.isWindow) then return end
    local needed = TOP + panel.layout:Height() + BOTTOM
    if needed > (panel:GetHeight() or 0) then
        panel:SetHeight(needed)
    end
end

function Options:Setup()
    if panel then return end
    local canvas = Settings and Settings.RegisterCanvasLayoutCategory and Settings.RegisterAddOnCategory
    Build(canvas)
    -- Rows come and go with the way lines are shown; the window or scroller follows what is left.
    panel.layout.onResize = function() FitWindow() end
    self:UpdateRows()
    -- Built with this page; registered last, after every part's.
    if canvas and DialogueUIOptions then DialogueUIOptions:Setup() end
    if canvas then
        -- Spoken's entry in the game's settings, and each feature addon's page an entry nested
        -- under it (Options:RegisterPage).
        FitWindow()
        self.category = Settings.RegisterCanvasLayoutCategory(panel, "Spoken")
        Settings.RegisterAddOnCategory(self.category)
        table.sort(pendingPages, function(a, b) return a.order < b.order end)
        for _, page in ipairs(pendingPages) do self:RegisterPage(page) end
        pendingPages = {}
    else
        -- No Settings API: a window of our own, opened by /spoken options. Sized to its
        -- rows, which vary by client, rather than a fixed height the rows can outgrow.
        panel.isWindow = true
        panel:SetSize(420, 360)
        FitWindow()
        panel:SetPoint("CENTER")
        panel:SetMovable(true)
        panel:EnableMouse(true)
        panel:SetFrameStrata("DIALOG")
        panel:Hide()
        local close = CreateFrame("Button", nil, panel, "UIPanelCloseButton")
        close:SetPoint("TOPRIGHT", -4, -4)
        close:SetScript("OnClick", function() panel:Hide() end)
    end
end

--- A feature addon's page, as a tab on Spoken's. A feature addon may build its panel before
--- this one exists, at its own load, so the page waits until it does. `page.Open` opens Spoken
--- on its tab, and `page.category` is Spoken's own entry once registered. Nil where the client
--- has no settings canvas, and the feature addon registers a page of its own.
function Options:AddPage(frame, name, order, layout, pageScroller)
    if not (Settings and Settings.RegisterCanvasLayoutCategory) then return nil end
    -- The layout and its scroller come along so the search on Home can reach this page's rows.
    local page = { frame = frame, name = name, order = order or 100, layout = layout, scroller = pageScroller }
    page.Open = function() return Options:OpenPage(page.order) end
    self.pages = self.pages or {}
    table.insert(self.pages, page)
    table.sort(self.pages, function(a, b) return a.order < b.order end)
    if self.category then
        self:RegisterPage(page)
    else
        table.insert(pendingPages, page)
    end
    return page
end

function Options:RegisterPage(page)
    page.category = Settings.RegisterCanvasLayoutSubcategory(self.category, page.frame, page.name)
end

--- A button on the player's panel that opens a feature addon's own settings. The
--- quests addon uses this because AceConfigDialog owns its frame lifecycle and nesting
--- it as a canvas subcategory is fragile across six clients.
function Options:AddLink(text, onClick)
    -- Where the feature addons' pages nest under this one, the settings list already leads
    -- to each of them, and a button to the same place is a second way to say one thing.
    if Settings and Settings.RegisterCanvasLayoutSubcategory then return end
    -- Feature addons call this from ADDON_LOADED; the panel is built at PLAYER_LOGIN.
    if not panel then
        table.insert(pendingLinks, { text = text, onClick = onClick })
        return
    end
    if not panel.linksSection then
        panel.linksSection = true
        panel.layout:Section(L.OPT_ADDONS_TITLE)
    end
    table.insert(panel.links, panel.layout:Button(text, 200, onClick))
    FitWindow()
end

function Options:Open()
    if self.category and Settings and Settings.OpenToCategory then
        Layout.OpenCategory(self.category, L.OPT_OPEN_COMBAT)
    elseif panel then
        panel:SetShown(not panel:IsShown())
    else
        print("Spoken: " .. L.OPT_NO_SETTINGS_API)
    end
end
