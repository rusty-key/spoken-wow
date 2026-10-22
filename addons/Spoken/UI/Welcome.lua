setfenv(1, SpokenEnv)

-- A one-time welcome: the choices that shape what Spoken is like, in one window, instead of
-- a first visit to a settings page full of rows. Built from the same boxes, cards and pictures
-- as General, laid out in a scroller as a settings page is, in the same frame as the game's
-- settings window, so a player who opens the settings later recognises all of it and the window
-- fits any screen. Each choice applies as it is made; Done only closes.
-- Shown once per account, at the first login after it ships, and again from the button on the
-- What Spoken Reads title of Spoken's page. Only where the Settings API exists: "All Settings"
-- opens its page.
Welcome = {}

local Layout = SpokenLayout
local WIDTH = 760
local BORDER = 7        -- the frame's edge, inside which the margins are measured
local BAR = 19          -- the frame's title bar
local TITLE_X = BORDER + 24
local CONTENT_X = BORDER + 44
local BOTTOM_MARGIN = 22
-- A settings page's own margins: its rows start INDENT in, the name TOP down, and BOTTOM is left under
-- the last row.
local INDENT, TOP, BOTTOM = 25, 16, 16
-- Room kept round the window on the screen.
local SCREEN_MARGIN = 100
local MIN_VIEW = 220
local RULE_GAP = 16     -- between the footer's divider and its buttons
local BUTTON_WIDTH, BUTTON_HEIGHT = 160, 22   -- the game's red panel button
-- A second switch, above the one beside the buttons. As tall as a switch, so the two do not
-- overlap, and no taller: the window had 25 to spare before running off a 768-high screen.
local CHECK_ROW, CHECK_SIZE = 24, 24
-- From the window's bottom to the bottom of the scrolling view: the footer's buttons, its divider and a gap.
local VIEW_BOTTOM = BORDER + BOTTOM_MARGIN + BUTTON_HEIGHT + RULE_GAP + 8

local function Refresh()
    PlayerFrame:RefreshConfig()
    Transcript:RefreshConfig()
    Options:UpdateRows()
end

-- The settings window's own frame where the client has it (SettingsFrameTemplate: the same
-- border, title bar and close button), an older dialog frame where not.
local function Window()
    local frame
    for _, template in ipairs({ "SettingsFrameTemplate", "BasicFrameTemplateWithInset" }) do
        local ok, made = pcall(CreateFrame, "Frame", "SpokenWelcomeFrame", UIParent, template)
        if ok and made then
            frame = made
            break
        end
    end
    if not frame then
        frame = CreateFrame("Frame", "SpokenWelcomeFrame", UIParent, "BackdropTemplate")
        frame:SetBackdrop({ bgFile = [[Interface\DialogFrame\UI-DialogBox-Background]],
            edgeFile = [[Interface\DialogFrame\UI-DialogBox-Border]], tile = true, tileSize = 32, edgeSize = 32,
            insets = { left = 11, right = 12, top = 12, bottom = 11 } })
    end
    -- The template's own title string: on the settings frame's border, or where the older
    -- frame keeps it (its key moved between builds).
    local title = type(frame.NineSlice) == "table" and frame.NineSlice.Text
    if type(title) ~= "table" then title = frame.TitleText end
    if type(title) ~= "table" and type(frame.TitleContainer) == "table" then title = frame.TitleContainer.TitleText end
    if type(title) ~= "table" or not title.SetText then
        title = frame:CreateFontString(nil, "OVERLAY", "GameFontNormal")
        title:SetPoint("TOP", 0, -6)
    end
    title:SetText("Spoken")
    return frame
end

local function Button(frame, label, onClick)
    local button = Layout.NewButton(frame, label)
    button:SetSize(BUTTON_WIDTH, BUTTON_HEIGHT)
    button:SetScript("OnClick", onClick)
    return button
end

-- A switch in the footer, its label beside it and what it does in its tooltip, `y` above the
-- window's bottom.
local function FooterCheck(page, frame, y, label, tip, write)
    local check = Layout.NewCheck(page, CHECK_SIZE)
    check:SetPoint("LEFT", frame, "BOTTOMLEFT", CONTENT_X, y)
    check.label = page:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
    check.label:SetPoint("LEFT", check, "RIGHT", 8, 0)
    check.label:SetText(label)
    check:SetScript("OnClick", function(button) write(button:GetChecked() and true or false) end)
    check:SetScript("OnEnter", function(button)
        GameTooltip:SetOwner(button, "ANCHOR_RIGHT")
        GameTooltip:SetText(label, 1, 1, 1)
        GameTooltip:AddLine(tip, nil, nil, nil, true)
        GameTooltip:Show()
    end)
    check:SetScript("OnLeave", function() GameTooltip:Hide() end)
    return check
end

function Welcome:Build()
    local frame = Window()
    self.frame = frame
    Ellesmere:When(function(skin)
        skin.Shell(frame)
        local close = frame.ClosePanelButton or frame.CloseButton
        if type(close) == "table" then skin.CloseButton(close) end
    end)
    frame:SetWidth(WIDTH)
    frame:SetPoint("CENTER", 0, 40)
    frame:SetFrameStrata("DIALOG")
    frame:SetClampedToScreen(true)
    frame:SetMovable(true)
    frame:EnableMouse(true)
    frame:RegisterForDrag("LeftButton")
    frame:SetScript("OnDragStart", frame.StartMoving)
    frame:SetScript("OnDragStop", frame.StopMovingOrSizing)
    -- Seen is seen, however the window closes: Done, the X or Escape.
    frame:SetScript("OnHide", function()
        Addon.db.global.Welcomed = true
        if Subtitle:IsShowingSample() then Subtitle:ShowSample(false) end
        if Options.previewing or Addon.previewStyle or PlayerFrame:IsShowingSample() then Options:SetPreviewing(false) end
    end)
    table.insert(UISpecialFrames, "SpokenWelcomeFrame")
    frame:Hide()

    -- The footer's widgets sit on `page`, a few levels above the window: a section's box is drawn a
    -- level under what it is laid out on, so drawn straight on the window it would land behind the
    -- window's own background. The rows scroll in `view` between the title bar and the footer, laid
    -- out as a settings page is (Layout.Scroll, Layout:Intro), a bar showing where they run past it.
    local page = CreateFrame("Frame", nil, frame)
    page:SetPoint("TOPLEFT", frame, "TOPLEFT", 0, -BAR)
    page:SetWidth(WIDTH)
    page:SetHeight(1)
    page:SetFrameLevel(frame:GetFrameLevel() + 5)
    local view = CreateFrame("Frame", nil, frame)
    view:SetPoint("TOPLEFT", frame, "TOPLEFT", BORDER, -BAR)
    view:SetSize(WIDTH - BORDER * 2, MIN_VIEW)
    view:SetFrameLevel(frame:GetFrameLevel() + 5)
    local scroller = Layout.Scroll(view)
    local layout = Layout.New(scroller.child, INDENT, -TOP)
    -- Its name and words across the middle, as a window that opens unasked is read top down; the
    -- questions under them start at the left, as a settings page's titles do.
    layout.centred = true
    layout.leftTitles = true
    layout.onResize = function() self:Resize() end
    self.page, self.view, self.scroller, self.layout = page, view, scroller, layout
    -- Headed as the settings' pages are, with a name, and then what the window is for: unlike
    -- a settings page, it opens unasked, and has to say what it is.
    layout:Intro([[Interface\AddOns\Spoken\icon.tga]], L.WELCOME_TITLE, L.WELCOME_INTRO)
    -- Voices are a separate download: said here while none is installed, or a first quest is
    -- accepted in silence with no word why.
    local noPack = layout:Note(L.MODULE_NO_PACK .. " " .. L.WELCOME_PACK_WHERE, nil, 32)
    layout:ShowWhen(noPack, function() return Options:NoVoicePacks() end)
    self.noPack = noPack

    -- What Spoken reads: the modules' list, as on General, a click turning each on or off.
    layout:Section(L.WELCOME_PARTS, true)
    local modules = {}
    for _, part in ipairs(Options:Parts()) do
        local key = part.key
        table.insert(modules, { icon = part.icon, title = part.label, text = part.text,
            read = function() return Spoken:IsPartOn(key) end,
            write = function(v) Sources:SetTurnedOff(key, not v) end,
            apply = function() Options:UpdateRows(); layout:Refresh() end,
            disabled = function() if not Sources:Get(key) then return L.REASON_NOT_INSTALLED end end,
            status = function() return Options:PartVoice(key) end,
            hint = function(on) return on and L.OPT_PART_CLICK_OFF or L.OPT_PART_CLICK_ON end })
    end
    self.modules = layout:List(modules)

    -- How lines appear: the same list as Spoken's settings page, a sketch on each row. Choosing
    -- subtitles shows one, so it can be seen and dragged into place now.
    layout:Section(L.WELCOME_SHOW, true)
    -- Preview mode, at the end of the question's line, as on Spoken's settings page.
    self.preview = Options:PreviewButton(layout)
    local styles = {}
    for _, style in ipairs(Options:Styles()) do
        table.insert(styles, { value = style, title = Options.STYLE_LABELS[style], text = Options.STYLE_TEXTS[style],
            art = Options.SKETCHES[style] })
    end
    self.styles = layout:Choices(styles, function() return Addon:PlayerStyle() end,
        function(v) Addon:SetPlayerStyle(v) end,
        function()
            Refresh()
            Options:StyleChosen()
        end, { choose = L.STYLE_CHOOSE })

    -- The footer: the header's divider again, as wide and as centred, then the switches on the
    -- left and the two ways out on the right: Lower Other Sounds where the client has it, and the
    -- debug log where the Spoken_Developer module is installed, beside the buttons, the other
    -- stacked above it.
    local lowerShown = OtherSounds:IsAvailable()
    local logShown = Developer.provider ~= nil
    local extra = (lowerShown and logShown) and CHECK_ROW or 0
    local rule = Layout.Rule(page)
    local ruleY = BORDER + BOTTOM_MARGIN + BUTTON_HEIGHT + RULE_GAP + extra
    rule:SetPoint("BOTTOM", frame, "BOTTOM", 0, ruleY)
    if not rule.layoutAtlas then rule:SetWidth(WIDTH - TITLE_X * 2) end
    self.rule = rule

    local done = Button(page, L.WELCOME_DONE, function() frame:Hide() end)
    done:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", -CONTENT_X, BORDER + BOTTOM_MARGIN)
    local all = Button(page, L.WELCOME_SETTINGS, function()
        frame:Hide()
        Options:Open()
    end)
    all:SetPoint("RIGHT", done, "LEFT", -10, 0)
    self.done, self.all = done, all

    -- Along the bottom beside the buttons rather than in sections of their own: a third section
    -- would make the window taller than the screen at the default UI scale. Their tooltips say
    -- what they do. Stacked, not side by side: two labels and the buttons do not fit one row
    -- in German.
    local bottomY = BORDER + BOTTOM_MARGIN + BUTTON_HEIGHT / 2
    if lowerShown then
        self.lower = FooterCheck(page, frame, bottomY + extra, L.OPT_LOWER_OTHERS, L.WELCOME_LOWER_TIP,
            function(on)
                Addon.db.profile.Audio.LowerOthers.Enabled = on
                OtherSounds:RefreshConfig()
                Options:UpdateRows()
            end)
    end
    -- The debug log, where the Spoken_Developer module is installed: on from the start, so the
    -- first report has a log to send with it, and turned off here as on the Developer page. Its
    -- words are the module's.
    if logShown then
        self.log = FooterCheck(page, frame, bottomY, Developer:Call("SwitchLabel") or "",
            Developer:Call("SwitchTip") or "", function(on) Developer:Call("SetLogOn", on) end)
    end

    self.extra = extra
    self:Resize()
end

-- Tall enough for what shows, and no taller than the screen: the rows scroll in the view between the
-- title bar and the footer, which gives up height first. The voice pack line comes and goes.
function Welcome:Resize()
    local content = TOP + self.layout:Height() + BOTTOM
    local chrome = BAR + VIEW_BOTTOM + self.extra
    local screen = UIParent and UIParent.GetHeight and UIParent:GetHeight() or 768
    local view = math.max(MIN_VIEW, math.min(Layout.HEADER_HEIGHT + 2 + content, screen - SCREEN_MARGIN - chrome))
    self.view:SetHeight(view)
    self.frame:SetHeight(chrome + view)
    self.scroller:SetContentHeight(content)
end

--- Show what is chosen now, and for each part whether it is installed.
function Welcome:Sync()
    if self.layout then
        self.layout:Refresh()
        self:Resize()
    end
    if self.lower then self.lower:SetChecked(Addon.db.profile.Audio.LowerOthers.Enabled and true or false) end
    if self.log then self.log:SetChecked(Developer:IsLogOn()) end
end

function Welcome:Show()
    if not Addon.db then return end
    if not self.frame then self:Build() end
    self:Sync()
    self.frame:Show()
end

-- At the first login it ships to, once the world is up and everything has registered, and
-- never in combat, where a window over the screen is the last thing anyone wants.
local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_ENTERING_WORLD")
events:SetScript("OnEvent", function()
    events:UnregisterEvent("PLAYER_ENTERING_WORLD")
    if not Addon.db or Addon.db.global.Welcomed then return end
    local function Open()
        if InCombatLockdown and InCombatLockdown() then return end
        Welcome:Show()
    end
    C_Timer.After(2, Open)
end)
