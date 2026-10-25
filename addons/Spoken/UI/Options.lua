setfenv(1, SpokenEnv)

-- The player's settings: player-wide things only. Each feature addon keeps its own panel
-- and nests it under this one.
--
-- Registered with Settings.RegisterCanvasLayoutCategory, which every supported client has.
Options = {}

-- The game's settings list sets its rows 25 in from the canvas's left.
local INDENT = 25
local TOP = 16    -- where the page's title starts
local BOTTOM = 16 -- the margin under the last row
local panel
local scroller

-- Rows, headings and the spacing between them come from UI/Layout.lua, which every module's page
-- is built with too, so the pages read alike.
local Layout = SpokenLayout

local CHANNELS = { "Master", "SFX", "Music", "Ambience", "Dialog" }
-- Stored names stay English: playback passes them to the sound API.
local CHANNEL_LABELS = {
    Master = L.OPT_CHANNEL_MASTER,
    SFX = L.OPT_CHANNEL_SFX,
    Music = L.OPT_CHANNEL_MUSIC,
    Ambience = L.OPT_CHANNEL_AMBIENCE,
    Dialog = L.OPT_CHANNEL_DIALOG,
}

-- The ways of showing a line, by the name Addon:PlayerStyle gives each.
local STYLE_LABELS = {
    minimal = L.OPT_STYLE_MINIMAL,
    classic = L.OPT_STYLE_CLASSIC,
    dialogueui = L.OPT_STYLE_DIALOGUEUI,
    subtitle = L.OPT_STYLE_SUBTITLE,
    none = L.OPT_STYLE_NONE,
}

-- The game's key bindings list these in a Spoken category (Bindings.xml). The category is
-- the name of a string global the client shows as its title. Set here, after the locale
-- files, so the names are in the player's language.
_G.BINDING_HEADER_SPOKEN = "Spoken"
_G.BINDING_NAME_SPOKEN_PLAYPAUSE = L.BIND_PLAYPAUSE
_G.BINDING_NAME_SPOKEN_SKIP = L.BIND_SKIP
_G.BINDING_NAME_SPOKEN_STOP = L.BIND_STOP
_G.BINDING_NAME_SPOKEN_COMPENDIUM = L.BIND_COMPENDIUM
local BINDINGS = {
    { "SPOKEN_PLAYPAUSE", L.BIND_PLAYPAUSE },
    { "SPOKEN_SKIP", L.BIND_SKIP },
    { "SPOKEN_STOP", L.BIND_STOP },
    { "SPOKEN_COMPENDIUM", L.BIND_COMPENDIUM },
}
-- The parts of Spoken by source key, named as their pages are, each with the game's own icon
-- for what it reads and the order its page is listed in under Spoken.
local PARTS = {
    { key = "quests", label = L.OPT_PART_QUESTS, text = L.OPT_PART_QUESTS_TEXT,
        icon = [[Interface\Icons\INV_Scroll_03]], order = 1 },
    { key = "gossip", label = L.OPT_PART_GOSSIP, text = L.OPT_PART_GOSSIP_TEXT,
        icon = [[Interface\Icons\UI_Chat]], order = 2 },
    { key = "places", label = L.OPT_PART_PLACES, text = L.OPT_PART_PLACES_TEXT,
        icon = [[Interface\Icons\INV_Misc_Map02]], order = 3 },
    { key = "readables", label = L.OPT_PART_READABLES, text = L.OPT_PART_READABLES_TEXT,
        icon = [[Interface\Icons\INV_Misc_Book_09]], order = 4 },
}

--- The parts Spoken's page lists: the four it knows by name, then any other source that
--- registered, with the title, icon, `about` line and order it gave.
function Options:Parts()
    local parts, known = {}, {}
    for _, part in ipairs(PARTS) do
        table.insert(parts, part)
        known[part.key] = true
    end
    for key, source in Sources:Iterate() do
        if not known[key] then
            table.insert(parts, { key = key, label = source.title, text = source.about or "",
                icon = source.icon, order = source.order })
        end
    end
    table.sort(parts, function(a, b)
        if a.order ~= b.order then return a.order < b.order end
        return a.key < b.key
    end)
    return parts
end

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
    -- in dark ink, the progress line under them.
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
-- The languages a voice pack can speak: the same list, in the same order, as each module's
-- (SpokenQuests' Language.LOCALES, SpokenReadables.LOCALES).
LANGUAGES = {
    { code = "enUS", native = "English", english = "English" },
    { code = "deDE", native = "Deutsch", english = "German" },
    { code = "esES", native = "Español (España)", english = "Spanish (Spain)" },
    { code = "esMX", native = "Español (América Latina)", english = "Spanish (Latin America)" },
    { code = "frFR", native = "Français", english = "French" },
    -- No client runs in Italian, so "Auto" never lands on it; a player picks it by hand.
    { code = "itIT", native = "Italiano", english = "Italian" },
    { code = "ptBR", native = "Português", english = "Portuguese (Brazil)" },
    { code = "ruRU", native = "Русский", english = "Russian", script = "cyrillic" },
    { code = "koKR", native = "한국어", english = "Korean", script = "korean" },
    -- `sample`: characters only that Chinese has, which a font must draw beside the name. A Korean
    -- font with Hanja draws "繁體中文" and still lacks most of Traditional Chinese.
    { code = "zhCN", native = "简体中文", english = "Chinese (Simplified)", script = "han", sample = "们这简国" },
    { code = "zhTW", native = "繁體中文", english = "Chinese (Traditional)", script = "han", sample = "嗎妳麼為" },
    -- No client runs in it either, and its stacked accents are glyphs a Latin font can lack.
    -- `hidden` keeps it out of the menus until its pack is released: picked before then, every
    -- line would play in the fallback language.
    { code = "viVN", native = "Tiếng Việt", english = "Vietnamese", script = "vietnamese", hidden = true },
}

-- Whether a font draws `text`: the settings' font object, or the file `path`. A glyph the font
-- lacks draws as nothing or as a box, so the text is measured against as many U+0378, a code point
-- Unicode has never assigned and so no font has: the same width means none of it drew. Han and
-- Hangul, whose glyphs are all as wide as each other, are measured one character at a time and
-- every one has to draw: a font with a few Hanja draws part of a Chinese name. A file the client
-- cannot load draws nothing.
local BOX = "\205\184"
local probes = {}
local function Width(probe, text)
    probe:SetText(text)
    return probe:GetStringWidth() or 0
end
-- U+3400 to U+9FFF (Han) and U+AC00 to U+D7A3 (Hangul), from a three-byte character.
local function Square(char)
    local a, b, c = char:byte(1, 3)
    local code = (a - 224) * 4096 + (b - 128) * 64 + (c - 128)
    return (code >= 0x3400 and code <= 0x9FFF) or (code >= 0xAC00 and code <= 0xD7A3)
end
local function FontDraws(text, path)
    if not (UIParent and UIParent.CreateFontString) then return not path end
    local key = path or false
    local probe = probes[key]
    if probe == nil then
        probe = UIParent:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
        probe:Hide()
        if path and probe:SetFont(path, 12, "") == false then probe = false end
        probes[key] = probe
    end
    if not probe then return false end
    local width, count = Width(probe, text), 0
    for _ in string.gmatch(text, "[%z\1-\127\194-\244][\128-\191]*") do count = count + 1 end
    local drew = width > 0 and math.abs(width - Width(probe, string.rep(BOX, count))) > 0.5
    if drew then
        local box
        for char in string.gmatch(text, "[\227-\237][\128-\191][\128-\191]") do
            if Square(char) then
                box = box or Width(probe, BOX)
                if math.abs(Width(probe, char) - box) <= 0.5 then
                    drew = false
                    break
                end
            end
        end
    end
    probe:SetText("")
    return drew
end

local function Locale(code)
    for _, locale in ipairs(LANGUAGES) do
        if locale.code == code then return locale end
    end
end

-- Whether a font draws the language `code`: its own name, and the characters only it has.
function Options:LanguageDraws(code, path)
    local locale = Locale(code)
    return locale ~= nil and FontDraws(locale.native .. (locale.sample or ""), path)
end

--- A language's name in the lists, one for every module: its own, and in English where this
--- client's font cannot draw its script (Korean on a German client).
function Options:LanguageName(code)
    local locale = Locale(code)
    if not locale then return code end
    if not locale.script then return locale.native end
    return self:LanguageDraws(code) and locale.native or locale.english
end

--- The client's language, as "Auto" reads it: English where the client's is not one of ours.
function Options:ClientLanguage()
    local locale = GetLocale and GetLocale()
    if locale == "enGB" then return "enUS" end
    for _, each in ipairs(LANGUAGES) do
        if each.code == locale then return locale end
    end
    return "enUS"
end

--- Show `style` on screen with a sample line, or nil to stop.
function Options:Preview(style)
    Addon.previewStyle = style
    PlayerFrame:RefreshConfig()
    Transcript:RefreshConfig()
    Subtitle:ShowSample(style == "subtitle")
    PlayerFrame:ShowSample(style == "minimal" or style == "classic" or style == "dialogueui")
end

-- Where Spoken lives outside the game: a row each, its icon and its address to copy, the game being
-- unable to open a web page.
local LINKS = {
    { name = "GitHub", icon = [[Interface\AddOns\Spoken\Textures\LinkGitHub]],
        url = "https://github.com/rusty-key/spoken-wow" },
    { name = "Discord", icon = [[Interface\AddOns\Spoken\Textures\LinkDiscord]],
        url = "https://discord.gg/HEGUgn6Yf" },
    { name = "CurseForge", icon = [[Interface\AddOns\Spoken\Textures\LinkCurseForge]],
        url = "https://www.curseforge.com/wow/addons/spoken" },
    { name = "Wago", icon = [[Interface\AddOns\Spoken\Textures\LinkWago]],
        url = "https://addons.wago.io/addons/spoken" },
    { name = "Buy Me a Coffee", icon = [[Interface\AddOns\Spoken\Textures\LinkBuyMeACoffee]],
        url = "https://buymeacoffee.com/rustykey" },
}
Options.LINKS = LINKS

function Options:AddLinks(layout)
    layout:Section(L.OPT_LINKS_TITLE)
    local frames = {}
    for _, link in ipairs(LINKS) do
        table.insert(frames, layout:Link({ icon = link.icon, title = link.name, url = link.url,
            tooltip = L.OPT_LINKS_TIP }))
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
    end)
    layout:OnRefresh(function()
        button:SetText(Options.previewing and L.STYLE_PREVIEW_HIDE or L.STYLE_PREVIEW)
        Layout.FitButton(button)
        if Addon:PlayerStyle() == "none" and not Options.previewing then button:Disable() else button:Enable() end
    end)
    return button
end

-- Feature addons' pages asked for before they are registered; see Options:AddPage.
local pendingPages = {}
local pagesHeld = true

-- The same parts and ways of showing lines, drawn the same way, in the welcome window.
Options.SKETCHES = SKETCHES
Options.STYLE_LABELS, Options.STYLE_TEXTS = STYLE_LABELS, STYLE_TEXTS

--- Put the window and the subtitles back where they start.
function Options:ResetPositions()
    PlayerFrame:Reset()
    Subtitle:Reset()
end

--- Open Azeroth's Compendium, or close it.
function Options:ToggleCompendium()
    local compendium = _G.SpokenCompendium
    if compendium and compendium.Toggle then compendium:Toggle() end
end

--- Spoken's diagnostics in chat, then each module's: what to paste into a report.
function Options:ShowDiagnostics()
    Addon:PrintDiagnostics()
    for _, source in Sources:Iterate() do
        if type(source.diagnostics) == "function" then
            local ok, err = pcall(source.diagnostics)
            if not ok then print("Spoken: " .. tostring(source.key) .. " diagnostics failed: " .. tostring(err)) end
        end
    end
end

--- The ways of showing lines this client can offer, in the order the narrator cards list them.
--- Subtitles Only first, the default; Voice Only last, its card a sound's bars rising and
--- falling, since there is nothing on screen to picture.
function Options:Styles()
    local styles = { "subtitle", "minimal", "classic" }
    if DialogueUITheme and DialogueUITheme:Available() then table.insert(styles, "dialogueui") end
    table.insert(styles, "none")
    return styles
end

-- Contribute & Report's page: last, after the modules' (Quests 1, Gossip 2, Places 3, Readables 4,
-- Bosses 5) and Developer's (6).
local CONTRIBUTE_ORDER = 7
local contribute

--- Contribute & Report's own page under Spoken's, its rows added by `build(layout)`.
local function BuildContributePage(build)
    local frame = CreateFrame("Frame", "SpokenContributeOptionsPanel")
    frame.name = L.OPT_CONTRIBUTE_TITLE
    local pageScroller = Layout.Scroll(frame)
    local content = pageScroller.child
    local layout = Layout.New(content, INDENT, -TOP)
    frame.layout = layout
    layout:Intro(nil, L.OPT_CONTRIBUTE_TITLE)
    layout:Section(nil)
    build(layout)
    local function Fit() pageScroller:SetContentHeight(layout:Height() + 40) end
    layout.onResize = Fit
    content:SetScript("OnShow", function() layout:Refresh() end)
    layout:Refresh()
    Fit()
    contribute = Options:AddPage(frame, L.OPT_CONTRIBUTE_TITLE, CONTRIBUTE_ORDER, layout, pageScroller)
end

local function Build()
    panel = CreateFrame("Frame", "SpokenOptionsPanel", UIParent)
    -- The family's one entry in the game's settings. This page is its Home; each feature
    -- addon's page is nested under it (Options:AddPage).
    panel.name = "Spoken"
    -- The rows are laid out in a scroller, as the Readables and Places panels are: the canvas
    -- neither scrolls nor clips, and the contributions rows pushed this panel past its bottom
    -- edge, drawing the minimap section over the game world.
    scroller = Layout.Scroll(panel)
    local host = scroller.child
    panel.content = host
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
    local function DUI() return Style() == "dialogueui" end
    local function Narrator() return transcript().Enabled end
    local function Words() return not transcript().HideSubtitles end
    -- Highlight Words and Type Words Out mark DialogueUI's own quest text too, words or none.
    local function WordsOrMarks() return Words() or DialogueUITheme:Installed() end
    local refresh = function() PlayerFrame:RefreshConfig(); Options:UpdateRows() end
    local refreshTranscript = function() Transcript:RefreshConfig(); Options:UpdateRows() end
    -- The subtitle's own: redrawing it is enough, on every step of a drag, without the captions'
    -- full refresh and every row's.
    local refreshSubtitle = function() Subtitle:Update() end
    -- Text Size and Lines: the DialogueUI and minimal windows lay their words out in the window's own
    -- refresh, so the window is refreshed too, as the wheel's Text Size does.
    local refreshText = function() PlayerFrame:RefreshConfig(); refreshTranscript(); refreshSubtitle() end

    local layout = Layout.New(host, INDENT, -TOP)
    panel.layout = layout
    -- Headed as the game's pages are: its name and its Defaults, and no paragraph under them,
    -- as the game's own pages have none.
    layout:Intro([[Interface\AddOns\Spoken\icon.tga]], L.OPT_HOME_TITLE)
    -- Two kinds of row that does nothing right now. One that belongs to another way of
    -- showing lines is hidden, and the page closes up round it: a player who chose subtitles
    -- has no use for the window's size. One waiting on a switch beside it is greyed out
    -- instead, saying which switch -- seeing it there is how a player learns it exists.
    local function Requires(row, applies, reason) return layout:Requires(row, applies, reason) end
    local function Only(row, applies) return layout:ShowWhen(row, applies) end
    local function Shown() return Style() ~= "none" end
    -- DialogueUI's own quest text follows Show Narrator, Highlight Words and Type Words Out, so with
    -- DialogueUI installed they matter under Voice Only too.
    local function MarksWords() return DialogueUIOptions:WordRowsShown(Style()) end

    -- Every Spoken page is searchable from here; the game's own settings search cannot see
    -- inside an addon's canvas.
    layout:Custom(Search:Build(host), Search.height, function(width) Search:Fit(width) end)

    -- The page in two halves. First what most players change: what Spoken reads, how a line
    -- is shown, in which language, how loud, the keys, the Compendium, and where to go when
    -- something is wrong. Then the finer settings, each section named for what it holds.

    -- What Spoken reads, first: it decides which of the pages under this one matter. A list
    -- with a row each, saying what is installed. No box round the list: it is a box itself.
    layout:Section(L.OPT_PARTS_TITLE, true)
    layout:HeadingButton(L.OPT_WELCOME_AGAIN, function() Welcome:Show() end)
    local modules = {}
    for _, part in ipairs(Options:Parts()) do
        local key, order = part.key, part.order
        local function On() return Spoken:IsPartOn(key) end
        local function Write(v) Sources:SetTurnedOff(key, not v) end
        local function Missing() if not Sources:Get(key) then return L.REASON_NOT_INSTALLED end end
        -- Beside its words, how many of its voice packs it has, then a button to its page,
        -- whenever the module is installed: switched off, its page is still there, with its
        -- own Enable switch for exactly that. Whether it is on, its checkbox and its row say.
        table.insert(modules, { icon = part.icon, title = part.label, text = part.text,
            read = On, write = Write, apply = function() Options:UpdateRows() end, disabled = Missing,
            status = function() return Options:PartVoice(key) end,
            hint = function(on) return on and L.OPT_PART_CLICK_OFF or L.OPT_PART_CLICK_ON end,
            button = L.OPT_PART_SETTINGS, onButton = function() Options:OpenPage(order) end,
            buttonEnabled = function() return Sources:Get(key) ~= nil and Options:HasPage(order) end })
    end
    layout:List(modules)

    -- How a line is shown: a list with a picture each, then the few rows most players change
    -- straight under it, with no title of their own.
    layout:Section(L.OPT_PLAYER_STYLE, true)
    local tiles = {}
    for _, style in ipairs(Options:Styles()) do
        table.insert(tiles, { value = style, title = STYLE_LABELS[style], text = STYLE_TEXTS[style],
            art = SKETCHES[style] })
    end
    Options:PreviewButton(layout)
    layout:Choices(tiles, Style, function(v) Addon:SetPlayerStyle(v) end,
        function()
            PlayerFrame:RefreshConfig(); refreshTranscript()
            Options:StyleChosen()
        end,
        { choose = L.STYLE_CHOOSE })
    layout:Section(nil)
    -- Search names these rows' section as the tiles' own.
    layout.section = L.OPT_PLAYER_STYLE
    Only(layout:Slider(L.OPT_SCALE, SIZES.FrameScale[1], SIZES.FrameScale[2], SIZES.FrameScale[3],
        function() return cfg().FrameScale end, function(v) cfg().FrameScale = v end, refresh), InWindow)
    -- With Show Narrator off there are no subtitles to size.
    local subtitleSize = layout:Slider(L.OPT_SUBTITLE_SIZE, SIZES.SubtitleScale[1], SIZES.SubtitleScale[2],
        SIZES.SubtitleScale[3],
        function() return transcript().SubtitleScale end,
        function(v) transcript().SubtitleScale = v end, refreshSubtitle)
    Only(subtitleSize, Subtitles)
    Requires(subtitleSize, Narrator, L.REASON_NARRATOR)
    Only(layout:Checkbox(L.OPT_SHOW_NARRATOR, nil,
        function() return transcript().Enabled end,
        function(v) Transcript:SetEnabled(v) end, function() Options:UpdateRows() end), MarksWords)
    -- Each module's narrator, on unless turned off: a player can read the quest window and want the
    -- subtitles only for the places and the writings.
    layout:Indent()
    for _, part in ipairs(Options:Parts()) do
        local key = part.key
        local row = layout:Checkbox(part.label, nil,
            function() return not transcript().WordsOff[key] end,
            function(v) transcript().WordsOff[key] = (not v) or nil end, refreshTranscript)
        Only(row, MarksWords)
        Only(row, function() return Sources:Get(key) ~= nil end)
        Requires(row, Narrator, L.REASON_NARRATOR)
    end
    layout:Outdent()
    -- On, the window or the subtitles keep the speaker and the controls and list the queue in the
    -- words' place.
    local hideSubtitles = layout:Checkbox(L.OPT_HIDE_SUBTITLES, nil,
        function() return transcript().HideSubtitles == true end,
        function(v) transcript().HideSubtitles = v end, function() refreshText(); Options:UpdateRows() end)
    Only(hideSubtitles, function() return InWindow() or Subtitles() end)
    Requires(hideSubtitles, Narrator, L.REASON_NARRATOR)
    local size = layout:Slider(L.TRANSCRIPT_SIZE, SIZES.FontSize[1], SIZES.FontSize[2], SIZES.FontSize[3],
        function() return transcript().FontSize end,
        function(v) transcript().FontSize = v end, refreshText,
        Layout.Number)
    Only(size, function() return InWindow() or Subtitles() end)
    Requires(size, Narrator, L.REASON_NARRATOR)
    Only(layout:Checkbox(L.OPT_LOCK_FRAME, nil,
        function() return cfg().LockFrame end, function(v) cfg().LockFrame = v end, refresh), Shown)
    -- Nothing on the windows or the subtitles shows their wheel shortcuts.
    local wheel = layout:Note(L.WINDOW_WHEEL_HINT, nil, 40)
    Only(wheel, function() return Small() or DUI() or Subtitles() end)
    layout:OnRefresh(function() wheel:SetText(Subtitles() and L.SUBTITLE_WHEEL_HINT or L.WINDOW_WHEEL_HINT) end)

    -- The voice language, once for every module: they share the same list of languages, and a
    -- player who picks Portuguese means it for quests and readables alike.
    layout:Section(L.OPT_LANGUAGE_TITLE)
    local language = function() return Addon.db.profile.Language end
    local voices, fallbacks = { "auto" }, { "none" }
    for _, locale in ipairs(LANGUAGES) do
        if not locale.hidden then
            table.insert(voices, locale.code)
            table.insert(fallbacks, locale.code)
        end
    end
    layout:Dropdown(L.OPT_VOICE_LANGUAGE, nil, voices,
        function() return language().Voice or "auto" end,
        function(code) language().Voice = code end, function() Options:UpdateRows() end,
        function(code)
            if code == "auto" then return format(L.OPT_LANG_AUTO_FMT, Options:LanguageName(Options:ClientLanguage())) end
            return Options:LanguageName(code)
        end)
    layout:Dropdown(L.OPT_FALLBACK_LANGUAGE, nil, fallbacks,
        function() return language().Fallback or "enUS" end,
        function(code) language().Fallback = code end, function() Options:UpdateRows() end,
        function(code) return code == "none" and L.OPT_FALLBACK_NONE or Options:LanguageName(code) end)

    layout:Section(L.OPT_AUDIO_TITLE)
    layout:Dropdown(L.OPT_CHANNEL, nil, CHANNELS,
        function() return audio().SoundChannel end,
        function(v) audio().SoundChannel = v end,
        -- The handle belongs to the old channel, so a line already speaking cannot move.
        function() SoundQueue:RemoveAllSoundsFromQueue(); Options:UpdateRows() end,
        function(channel) return CHANNEL_LABELS[channel] end)
    -- On Dialog, NPC voices and Spoken's are one sound.
    local dialogWarning = layout:Note(L.OPT_CHANNEL_DIALOG_WARN, nil, 32)
    dialogWarning:SetTextColor(1, 0.5, 0.25)
    layout:ShowWhen(dialogWarning, function() return audio().SoundChannel == "Dialog" end)

    -- The game's own sounds while a line is read: its NPCs, then everything else.
    layout:Section(L.OPT_WHILE_READING_TITLE)
    local silence = layout:Checkbox(L.OPT_MUTE_DIALOGUE, nil,
        function() return audio().AutoToggleDialog end,
        function(v)
            audio().AutoToggleDialog = v
            -- Turning it off while it holds the channel down would leave it muted.
            if not v then
                SoundUtils:MuteChannel("Dialog", false)
            end
        end, function() Options:UpdateRows() end)
    -- Muting Dialog would mute Spoken's own line, so on Dialog the queue never does.
    Requires(silence, function() return Sources:PlayerChannel() ~= "Dialog" end, L.REASON_DIALOG_CHANNEL)
    local lower = function() return audio().LowerOthers end
    local applyLower = function() OtherSounds:RefreshConfig(); Options:UpdateRows() end
    -- What Spoken starts by itself waits outside a battleground.
    layout:Checkbox(L.OPT_READ_IN_BATTLEGROUNDS, nil,
        function() return audio().ReadInBattlegrounds ~= false end,
        function(v) audio().ReadInBattlegrounds = v end,
        function() Addon:StopWhereNotRead() end)
    if OtherSounds:IsAvailable() then
        layout:Checkbox(L.OPT_LOWER_OTHERS, nil,
            function() return lower().Enabled end, function(v) lower().Enabled = v end, applyLower)
    end

    -- Keys for the queue, said here as well as in the game's key bindings: with subtitles only
    -- or voice only there is no window to click, and a player needs to know these exist.
    layout:Section(L.OPT_KEYS_TITLE)
    -- Each action by its name, with its key beside it where a setting's control would be: read
    -- at a glance down the box, the way the game's own bindings list reads, and set right there.
    local function KeyText(key)
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
    if Settings.KEYBINDINGS_CATEGORY_ID then
        layout:Button(L.OPT_KEYS_SET, 160, function()
            pcall(Settings.OpenToCategory, Settings.KEYBINDINGS_CATEGORY_ID)
        end)
    end

    -- Azeroth's Compendium: the window Places and Readables each add a tab to, Quests too where
    -- either is there, opened here and from the minimap menu, with each tab's Unlock switch. The
    -- tabs register once the world is up, after this page is built, so the rows ask for them each
    -- time they are drawn; with no tab registered the section has nothing showing and hides.
    local function Compendium() return _G.SpokenCompendium end
    local function Tab(key)
        local compendium = Compendium()
        return compendium and compendium.Tab and compendium:Tab(key)
    end
    layout:Section(L.OPT_COMPENDIUM_TITLE)
    local open = layout:Button(L.OPT_COMPENDIUM_OPEN, 200, function() Options:ToggleCompendium() end)
    Only(open, function() local compendium = Compendium(); return compendium ~= nil and compendium.Toggle ~= nil end)
    local function Available()
        local compendium = Compendium()
        return compendium ~= nil and compendium.Available ~= nil and compendium:Available()
    end
    Requires(open, Available, L.REASON_COMPENDIUM_OFF)
    -- The words of every tab's stories, and of Places' panel beside the map.
    local size = layout:Slider(L.OPT_COMPENDIUM_FONT_SIZE, 9, 20, 1,
        function() return Spoken:CompendiumFontSize() end,
        function(v) Spoken:SetCompendiumFontSize(v) end, nil, Layout.Number)
    Only(size, function() return Compendium() ~= nil end)
    Requires(size, Available, L.REASON_COMPENDIUM_OFF)
    -- In the order of the window's tabs.
    for _, unlock in ipairs({
        { tab = "quests", part = "quests", label = L.OPT_UNLOCK_QUESTS, module = L.OPT_PART_QUESTS },
        { tab = "places", part = "places", label = L.OPT_UNLOCK_PLACES, module = L.OPT_PART_PLACES },
        { tab = "readables", part = "readables", label = L.OPT_UNLOCK_READABLES, module = L.OPT_PART_READABLES },
        -- Spoken NPCs has no part to turn off: its tab is there while the addon is.
        { tab = "bosses", label = L.OPT_UNLOCK_BOSSES },
    }) do
        local row = layout:Checkbox(unlock.label, nil,
            function() local tab = Tab(unlock.tab); return tab ~= nil and tab.unlock ~= nil and tab.unlock.get() end,
            function(v) local tab = Tab(unlock.tab); if tab and tab.unlock then tab.unlock.set(v) end end)
        Only(row, function() local tab = Tab(unlock.tab); return tab ~= nil and tab.unlock ~= nil end)
        if unlock.part then
            Requires(row, function() return Spoken:IsPartOn(unlock.part) end, format(L.REASON_MODULE_OFF_FMT, unlock.module))
        end
    end

    -- Where a player goes when something is wrong, for every module at once. Each module's page
    -- keeps its own Play a Test Line, beside its voice packs. It sits on the Contribute & Report
    -- page (ContributeRows).
    local function FixRows(rows)
        rows:Section(L.OPT_FIX_TITLE)
        rows:Columns(2)
        rows:Button(L.OPT_DIAGNOSTICS, 200, function() Options:ShowDiagnostics() end)
        -- For what belongs to no one line; each line has its own Report. The game cannot open a
        -- link, so it hands over the address to copy.
        if Spoken.ShowContribution then
            rows:Button(L.DIALOGUE_REPORT_PROBLEM, 200, function() Spoken:ShowContribution(Spoken.SITE_URL, nil, true) end)
        end
        rows:Columns(nil)
        rows:ShowWhen(rows:Button(L.OPT_RESET, 200, function() Options:ResetPositions() end), Shown)
    end
    -- The finer settings from here on.

    -- How the window and the subtitles look.
    layout:Section(L.OPT_LOOK_TITLE)
    -- Parchment or Dark, for each window that has a choice: the Small Window's own, and the
    -- DialogueUI window's, which can also follow DialogueUI's. None in EllesmereUI's look, which
    -- has its own.
    Only(layout:Dropdown(L.OPT_DUI_THEME, nil, { "parchment", "dark" },
        function() return cfg().MinimalBackground end, function(v) cfg().MinimalBackground = v end, refresh,
        function(v) return v == "dark" and L.OPT_DUI_THEME_DARK or L.OPT_DUI_THEME_PARCHMENT end),
        function() return Small() and not Ellesmere:On() end)
    DialogueUIOptions:ThemeRow(layout, function(row) return Only(row, DUI) end, refresh)
    local shadow = layout:Slider(L.TRANSCRIPT_SHADOW, 0, 1, 0.05,
        function() return transcript().SubtitleShadow end,
        function(v) transcript().SubtitleShadow = v end, refreshSubtitle)
    Only(shadow, Subtitles)
    Requires(shadow, Narrator, L.REASON_NARRATOR)
    Only(layout:Checkbox(L.OPT_SUBTITLE_NAME, nil,
        function() return transcript().SubtitleName ~= false end,
        function(v) transcript().SubtitleName = v end, function() refreshSubtitle(); Options:UpdateRows() end),
        Subtitles)
    -- The subtitles' portrait sits with their name and title, and goes with them: under that
    -- row, and greyed while it is off.
    layout:Indent()
    local subtitlePortrait = layout:Checkbox(L.OPT_HIDE_PORTRAIT, nil,
        function() return cfg().HidePortrait end, function(v) cfg().HidePortrait = v end,
        function() refresh(); Subtitle:Update() end)
    layout:Outdent()
    Only(subtitlePortrait, Subtitles)
    Requires(subtitlePortrait, function() return transcript().SubtitleName ~= false end, L.REASON_SUBTITLE_NAME)
    -- The windows' portrait: not the DialogueUI window's, whose header has the face's socket
    -- built in.
    Only(layout:Checkbox(L.OPT_HIDE_PORTRAIT, nil,
        function() return cfg().HidePortrait end, function(v) cfg().HidePortrait = v end, refresh),
        function() return InWindow() and not DUI() end)
    local progress = layout:Checkbox(L.OPT_SUBTITLE_PROGRESS, nil,
        function() return transcript().SubtitleProgress ~= false end,
        function(v) transcript().SubtitleProgress = v end, function() refreshSubtitle(); refresh() end)
    Only(progress, function() return Subtitles() or InWindow() end)
    Requires(progress, function() return not Subtitles() or Narrator() end, L.REASON_NARRATOR)
    -- Forever only, where it matches the game's own frames: every frame Spoken draws, whatever
    -- the style.
    if Version.IsCamelot then
        layout:Checkbox(L.OPT_BRONZE_TINT, nil,
            function() return cfg().BronzeTint end, function(v) cfg().BronzeTint = v end, refresh)
    end

    -- How the words of a line show, past whether they show at all and how big.
    layout:Section(L.OPT_TEXT_TITLE)
    -- How much shows at once: rows in a window or a row-by-row subtitle, sentences in a paged one.
    local function Rolling() return transcript().SubtitleScroll == "line" end
    local lines = layout:Slider(L.TRANSCRIPT_LINES, 1, 2, 1,
        function() return transcript().Lines end,
        function(v) transcript().Lines = v end, refreshText,
        Layout.Number)
    -- Listing the queue, the subtitles take as many rows, whichever way their words would scroll.
    Only(lines, function() return (InWindow() and Style() ~= "classic")
        or (Subtitles() and (Rolling() or not Words())) end)
    Requires(lines, Narrator, L.REASON_NARRATOR)
    local sentences = layout:Slider(L.OPT_SUBTITLE_SENTENCES, 1, 4, 1,
        function() return transcript().SubtitleSentences or 3 end,
        function(v) transcript().SubtitleSentences = v end, refreshSubtitle, Layout.Number)
    Only(sentences, function() return Subtitles() and not Rolling() end)
    Requires(sentences, Narrator, L.REASON_NARRATOR)
    Requires(sentences, Words, L.REASON_SUBTITLES_HIDDEN)
    local fit = DialogueUIOptions:FitRow(layout, function(row) return Only(row, DUI) end, refresh)
    if fit then
        Requires(fit, Narrator, L.REASON_NARRATOR)
        Requires(fit, Words, L.REASON_SUBTITLES_HIDDEN)
    end
    local SCROLL_LABELS = { line = L.TRANSCRIPT_SCROLL_LINE, page = L.TRANSCRIPT_SCROLL_PAGE,
        off = L.TRANSCRIPT_SCROLL_OFF }
    local scroll = layout:Dropdown(L.TRANSCRIPT_SCROLL, nil, { "line", "page", "off" },
        function() return Transcript:ScrollMode() end,
        function(v) transcript().ScrollMode = v; Transcript.manualScroll = false end, refreshTranscript,
        function(v) return SCROLL_LABELS[v] or v end)
    Only(scroll, InWindow)
    Requires(scroll, Narrator, L.REASON_NARRATOR)
    Requires(scroll, Words, L.REASON_SUBTITLES_HIDDEN)
    -- The subtitle's Auto-Scroll has no Off: it cannot be scrolled by hand.
    local subtitleScroll = layout:Dropdown(L.TRANSCRIPT_SCROLL, nil, { "line", "page" },
        function() return transcript().SubtitleScroll or "page" end,
        function(v) transcript().SubtitleScroll = v end, function() refreshSubtitle(); Options:UpdateRows() end,
        function(v) return SCROLL_LABELS[v] or v end)
    Only(subtitleScroll, Subtitles)
    Requires(subtitleScroll, Narrator, L.REASON_NARRATOR)
    Requires(subtitleScroll, Words, L.REASON_SUBTITLES_HIDDEN)
    subtitleScroll.layoutSubtitles = true
    -- The subtitle lights the word only while its words show whole: typed at their own pace, an
    -- estimated word timing would show every miss.
    local highlight = layout:Checkbox(L.TRANSCRIPT_HIGHLIGHT, nil,
        function() return transcript().HighlightWord end,
        function(v) transcript().HighlightWord = v end, refreshTranscript)
    Only(highlight, MarksWords)
    Requires(highlight, Narrator, L.REASON_NARRATOR)
    Requires(highlight, WordsOrMarks, L.REASON_SUBTITLES_HIDDEN)
    Requires(highlight, function() return not (Subtitles() and transcript().Typewriter) end, L.REASON_UNTYPED)
    local typewriter = layout:Checkbox(L.TRANSCRIPT_TYPEWRITER, nil,
        function() return transcript().Typewriter end,
        function(v) transcript().Typewriter = v end, refreshTranscript)
    Only(typewriter, MarksWords)
    Requires(typewriter, Narrator, L.REASON_NARRATOR)
    Requires(typewriter, WordsOrMarks, L.REASON_SUBTITLES_HIDDEN)
    layout:Indent()
    local by = layout:Dropdown(L.TRANSCRIPT_TYPEWRITER_BY, nil, { "letter", "word" },
        function() return transcript().TypewriterBy or "letter" end,
        function(v) transcript().TypewriterBy = v end, refreshTranscript,
        function(v) return v == "letter" and L.TRANSCRIPT_BY_LETTER or L.TRANSCRIPT_BY_WORD end)
    layout:Outdent()
    Only(by, MarksWords)
    Requires(by, Narrator, L.REASON_NARRATOR)
    Requires(by, WordsOrMarks, L.REASON_SUBTITLES_HIDDEN)
    Requires(by, function() return transcript().Typewriter end, L.REASON_TYPEWRITER)

    -- The rows feature addons add for DialogueUI's own window, where it is installed.
    DialogueUIOptions:Place(layout)

    -- How lines follow one another.
    layout:Section(L.OPT_PLAYBACK_TITLE)
    layout:Slider(L.OPT_LINE_GAP, 0, 5, 0.25,
        function() return audio().LineGap or 0 end, function(v) audio().LineGap = v end,
        nil, Layout.Seconds)
    layout:Checkbox(L.OPT_CUE_BETWEEN, nil,
        function() return audio().CueBetweenLines end,
        function(v) audio().CueBetweenLines = v end)
    if BackgroundSound:IsAvailable() then
        layout:Checkbox(L.OPT_BACKGROUND_SOUND, nil,
            function() return audio().KeepTalkingInBackground end,
            function(v) audio().KeepTalkingInBackground = v end,
            function() BackgroundSound:Sync() end)
    end

    -- Each sound's level under Turn Other Sounds Down. A section of its own rather than indented
    -- under its switch: an indented slider starts its bar out of line with every other control.
    if OtherSounds:IsAvailable() then
        layout:Section(L.OPT_LOWER_TITLE)
        for _, row in ipairs({ { "Music", L.OPT_LOWER_MUSIC }, { "Ambience", L.OPT_LOWER_AMBIENCE },
            { "SFX", L.OPT_LOWER_SFX }, { "Dialog", L.OPT_LOWER_DIALOG } }) do
            local channel = row[1]
            local slider = layout:Slider(row[2], 0, 1, 0.05,
                function() return lower()[channel] end, function(v) lower()[channel] = v end, applyLower)
            Requires(slider, function() return lower().Enabled end, L.REASON_LOWER)
            -- Never lowered while it carries the voices.
            Requires(slider, function() return Sources:PlayerChannel() ~= channel end, L.REASON_VOICE_CHANNEL)
            if channel == "Dialog" then
                -- With the game's dialogue silenced outright, there is no level to set.
                Requires(slider, function() return not audio().AutoToggleDialog end, L.REASON_DIALOG_MUTED)
            end
        end
    end

    -- The buttons live on Blizzard's quest, book and map frames, not on the player, but
    -- they all open the player's box, so the one switch for them is Spoken's. They have a page
    -- of their own under Spoken's, in the list beside the modules'.
    local function ContributeRows(rows)
        -- How much there is to send, first, so a player knows when it is worth sending.
        rows:Badge(L.OPT_GATHER_ROW, function()
            if not Gather:IsEnabled() then return "off", L.GATHER_OFF end
            local count = Gather:Count()
            if count == 0 then return "off", L.GATHER_NONE end
            return "ok", format(L.GATHER_BADGE_FMT, count)
        end, nil, true)
        -- The opt-out the first Contribute click promises. Independent of hiding the
        -- buttons: a player who collects has no use for them, and hiding them must not stop it.
        rows:Checkbox(L.OPT_GATHER, nil,
            function() return Gather:IsEnabled() end,
            function(v)
                -- Choosing here is an answer to the first-click question too.
                Gather:SetIntroduced()
                Gather:SetEnabled(v)
            end, function() Options:UpdateRows() end)
        rows:Columns(2)
        rows:Button(L.OPT_GATHER_SHARE, 200, function() Spoken:ShowGatherInstructions() end)
        rows:Button(L.OPT_GATHER_CLEAR, 200, function() Gather:Clear(); Options:UpdateRows() end)
        rows:Columns(nil)
        rows:Checkbox(L.OPT_HIDE_CONTRIBUTE, nil,
            function() return Addon.db.profile.Contribute.HideButtons end,
            function(v) Addon.db.profile.Contribute.HideButtons = v end,
            function() Callbacks:Fire("CONTRIBUTE_SETTINGS_CHANGED") end)
        -- Report on the window and the subtitles.
        rows:Checkbox(L.OPT_HIDE_REPORT, nil,
            function() return cfg().HiddenActions.report end,
            function(v) cfg().HiddenActions.report = v or nil end, function()
                refresh()
                Subtitle:Update()
                Callbacks:Fire("REPORT_SETTINGS_CHANGED")
            end)
    end
    BuildContributePage(function(rows)
        ContributeRows(rows)
        FixRows(rows)
    end)

    layout:Section(L.OPT_MINIMAP_TITLE)
    layout:Checkbox(L.OPT_MINIMAP_SHOW, nil,
        function() return not mm().hide end,
        function(v) mm().hide = not v end, function() Minimap:Refresh() end)
    layout:Checkbox(L.OPT_MINIMAP_LOCK, nil,
        function() return mm().lock end,
        function(v) mm().lock = v end, function() Minimap:Refresh() end)
    -- Blizzard's addon compartment exists on the modern clients only; the player's
    -- button shows there too, opening the same menu, and this row switches it.
    if AddonCompartmentFrame then
        layout:Checkbox(L.OPT_MINIMAP_COMPARTMENT, nil,
            function() return mm().showInCompartment end,
            function(v) Minimap:ToggleCompartment(v) end)
    end

    -- Profiles, for all of Spoken at once: the player's own settings and every part that keeps
    -- its settings in profiles switch, copy and delete together.
    Options:AddProfiles(layout)

    -- Spoken outside the game: its code, its Discord and its download page.
    Options.links = Options:AddLinks(layout)

    -- Every setting back, from the header's Defaults as the game's pages have it.
    layout:StartOver(L.OPT_START_OVER_TITLE, L.OPT_RESET_ALL, function()
        Layout.Confirm(L.OPT_RESET_ALL_CONFIRM, L.OPT_RESET_AND_RELOAD, L.CANCEL, function()
            -- The Unlock switches are on this page but kept with each part's settings, which
            -- ResetProfile does not reach, and each part's own Reset skips them.
            for _, key in ipairs({ "places", "readables", "quests", "bosses" }) do
                local tab = Tab(key)
                if tab and tab.unlock then tab.unlock.set(false) end
            end
            -- The feature addons' DialogueUI rows are kept in their own settings too.
            DialogueUIOptions:Reset()
            Addon.db:ResetProfile()
            -- Unset, the Compendium's Text Size is the one the Places page had: set, it is back
            -- to its default.
            Addon.db.profile.CompendiumFontSize = 12
            Addon.db.global.Layout = nil
            ReloadUI()
        end)
    end, L.OPT_RESET_ALL_TIP)

    -- The modules register on entering the world, after this page is built: drawn again for each,
    -- or their rows in the module list say "Not installed" until something else redraws them.
    Callbacks:Register("SOURCE_REGISTERED", function() Options:UpdateRows() end)
    if panel.HookScript then
        panel:HookScript("OnShow", function() Options:UpdateRows() end)
        -- The sample is for placing the subtitle while the settings are open, not after.
        panel:HookScript("OnHide", function()
            if Subtitle:IsShowingSample() then Subtitle:ShowSample(false) end
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
    if contribute then contribute.layout:Refresh() end
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

--- Whether no voice pack is installed for any module that says how many it has: the first-run
--- state, where nothing is read aloud yet.
function Options:NoVoicePacks()
    local known, total = false, 0
    for _, source in Sources:Iterate() do
        local count = self:PackCount(source)
        if count then known, total = true, total + count end
    end
    return known and total == 0
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

--- Delete `name` where it is not in use. AceDB clears the key of each character on it; each is put
--- on its own profile, so it is not taken for a new character at its next login. The choice of it
--- for new characters goes too, so a later profile of that name is not chosen.
function Options:DeleteProfile(name)
    for _, db in ipairs(self:ProfileDBs()) do
        if db.DeleteProfile and Has(db, name) and db:GetCurrentProfile() ~= name then
            local keys, moved = db.sv and db.sv.profileKeys, {}
            for key, profile in pairs(keys or {}) do
                if profile == name then table.insert(moved, key) end
            end
            db:DeleteProfile(name)
            for _, key in ipairs(moved) do keys[key] = key end
        end
    end
    if Addon.db and Addon.db.global.NewCharacterProfile == name and not Addon:SavedProfile(name) then
        Addon.db.global.NewCharacterProfile = nil
    end
end

--- The profile a character logging in with Spoken for the first time starts on: one of Spoken's
--- saved profiles, or false for a profile of its own.
function Options:NewCharacterProfile()
    return Addon:NewCharacterProfile() or false
end

function Options:SetNewCharacterProfile(name)
    Addon.db.global.NewCharacterProfile = name or nil
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
    layout:Dropdown(L.OPT_PROFILE, nil, function() return self:ProfileNames() end,
        function() return self:CurrentProfile() end,
        function(name) self:SetProfile(name); layout:Refresh() end)
    layout:Dropdown(L.OPT_COPY_PROFILE, nil, Others, function() return nil end,
        function(name) self:CopyProfile(name); layout:Refresh() end, nil, Pick)
    layout:Dropdown(L.OPT_DELETE_PROFILE, nil, Others, function() return nil end,
        function(name) self:DeleteProfile(name); layout:Refresh() end, nil, Pick)
    if StaticPopupDialogs and StaticPopup_Show then
        StaticPopupDialogs.SPOKEN_NEW_PROFILE = StaticPopupDialogs.SPOKEN_NEW_PROFILE or {
            text = L.OPT_PROFILE_NEW_PROMPT, button1 = _G.ACCEPT or "Accept", button2 = L.CANCEL,
            hasEditBox = true, timeout = 0, whileDead = true, hideOnEscape = true,
            OnAccept = function(popup)
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
                local popup = box and box:GetParent()
                if popup and popup.button1 then popup.button1:Click() end
            end,
        }
        layout:Button(L.OPT_PROFILE_NEW, 200, function() StaticPopup_Show("SPOKEN_NEW_PROFILE") end)
    end
    if Addon.db then
        layout:Dropdown(L.OPT_NEW_CHARACTER_PROFILE, L.OPT_NEW_CHARACTER_PROFILE_TIP,
            -- Only Spoken's saved profiles: it reads the choice before any other settings load.
            function()
                local names = {}
                for _, name in ipairs(Addon.db:GetProfiles()) do
                    if Addon:SavedProfile(name) then table.insert(names, name) end
                end
                table.sort(names)
                table.insert(names, 1, false)
                return names
            end,
            function() return self:NewCharacterProfile() end,
            function(name) self:SetNewCharacterProfile(name) end,
            nil, function(name) return name or L.OPT_PROFILE_OWN end)
    end
end

--- Whether a settings page was added in `order`: a part with none has no button to it.
function Options:HasPage(order)
    for _, page in ipairs(self.pages or {}) do
        if page.order == order then return true end
    end
    return false
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
    C_Timer.After(0.05, Land)
end

local function FitScroller()
    scroller:SetContentHeight(TOP + panel.layout:Height() + BOTTOM)
end

function Options:Setup()
    if panel then return end
    Build()
    -- Rows come and go with the way lines are shown; the scroller follows what is left.
    panel.layout.onResize = FitScroller
    self:UpdateRows()
    -- Spoken's entry in the game's settings, and each feature addon's page an entry nested
    -- under it (Options:RegisterPage).
    FitScroller()
    self.category = Settings.RegisterCanvasLayoutCategory(panel, "Spoken")
    Settings.RegisterAddOnCategory(self.category)
    if not pagesHeld then self:ReleasePages() end
end

--- A feature addon's page, as a tab on Spoken's. A feature addon may build its panel before
--- this one exists, at its own load, so the page waits until it does. `page.Open` opens Spoken
--- on its tab, and `page.category` is Spoken's own entry once registered.
function Options:AddPage(frame, name, order, layout, pageScroller)
    -- The layout and its scroller come along so the search on Home can reach this page's rows.
    local page = { frame = frame, name = name, order = order or 100, layout = layout, scroller = pageScroller }
    page.Open = function() return Options:OpenPage(page.order) end
    self.pages = self.pages or {}
    table.insert(self.pages, page)
    table.sort(self.pages, function(a, b) return a.order < b.order end)
    if self.category and not pagesHeld then
        self:RegisterPage(page)
    else
        table.insert(pendingPages, page)
    end
    return page
end

--- Register the pages held so far, in their order. The game lists the pages under Spoken in the
--- order they were registered, not sorted, and the modules ask for theirs on entering the world,
--- in whatever order their frames hear it: so every page waits until just after that, and they
--- are registered together. One asked for later is registered at once, after them.
function Options:ReleasePages()
    pagesHeld = false
    if not self.category then return end
    table.sort(pendingPages, function(a, b) return a.order < b.order end)
    for _, page in ipairs(pendingPages) do self:RegisterPage(page) end
    pendingPages = {}
end

local release = CreateFrame("Frame")
release:RegisterEvent("PLAYER_ENTERING_WORLD")
release:SetScript("OnEvent", function()
    release:UnregisterEvent("PLAYER_ENTERING_WORLD")
    -- The next frame: after every module's own PLAYER_ENTERING_WORLD.
    C_Timer.After(0, function() Options:ReleasePages() end)
end)

function Options:RegisterPage(page)
    page.category = Settings.RegisterCanvasLayoutSubcategory(self.category, page.frame, page.name)
end

function Options:Open()
    if self.category then
        Layout.OpenCategory(self.category, L.OPT_OPEN_COMBAT)
    end
end
