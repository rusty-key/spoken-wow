setfenv(1, SpokenEnv)

-- A one-time welcome: the choices that shape what Spoken is like, in one window, instead of
-- a first visit to a settings page full of rows. Built from the same boxes, cards and pictures
-- as General, in the same frame as the game's settings window, so a player who opens the
-- settings later recognises all of it. Each choice applies as it is made; Done only closes.
-- Shown once per account, at the first login after it ships, and again from the button at the
-- bottom of General. Only where the Settings API exists: "All Settings" opens a page the
-- legacy clients do not have.
Welcome = {}

local Layout = SpokenLayout
local WIDTH = 760
-- The settings page's own margins, measured from the inside of its frame: the page's name 24 in,
-- its lists and sections 44 in, from the left and the right alike. Above the name and under the
-- buttons 22 rather than the page's 35, so the two lists, four modules and five styles, fit a
-- 768-high screen.
local BORDER = 7        -- the frame's edge, inside which the margins are measured
local BAR = 19          -- the frame's title bar
local TITLE_X = BORDER + 24
local CONTENT_X = BORDER + 44
local TOP_MARGIN, BOTTOM_MARGIN = 22, 22
local NAME_Y = 22       -- the page's name, under the page's top: the layout's header puts it there
local FOOTER_GAP = 20   -- between the last row of tiles and the footer's divider
local RULE_GAP = 16     -- between the footer's divider and its buttons
local BUTTON_WIDTH, BUTTON_HEIGHT = 160, 22   -- the game's red panel button
-- A second switch, above the one beside the buttons. As tall as a switch, so the two do not
-- overlap, and no taller: the window had 25 to spare before running off a 768-high screen.
local CHECK_ROW, CHECK_SIZE = 24, 24
local FOOTER = FOOTER_GAP + 1 + RULE_GAP + BUTTON_HEIGHT + BORDER + BOTTOM_MARGIN

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
        if Subtitle and Subtitle:IsShowingSample() then Subtitle:ShowSample(false) end
        if Options.previewing or Addon.previewStyle or PlayerFrame:IsShowingSample() then Options:SetPreviewing(false) end
    end)
    table.insert(UISpecialFrames, "SpokenWelcomeFrame")
    frame:Hide()

    -- The page sits a few levels above the window, because a section's box is drawn a level
    -- under its page: drawn straight on the window, it would land behind the window's own
    -- background. Laid out in the window's own coordinates: its rows start CONTENT_X in and end
    -- CONTENT_X short of the right side, a page's rows ending RIGHT_MARGIN short of its edge.
    local page = CreateFrame("Frame", nil, frame)
    page:SetPoint("TOPLEFT", frame, "TOPLEFT", 0, -(BAR + TOP_MARGIN - NAME_Y))
    page:SetWidth(WIDTH - CONTENT_X + Layout.RIGHT_MARGIN)
    page:SetHeight(1)
    page:SetFrameLevel(frame:GetFrameLevel() + 5)
    local layout = Layout.New(page, CONTENT_X, 0)
    layout.titleX = TITLE_X
    -- Its name, words and questions across the middle: a window that opens unasked, read top down.
    layout.centred = true
    -- Its lists across its width, not from where a settings row's label starts, and compact, so
    -- every module fits with the window on a small screen.
    layout.boxLeft, layout.boxRight = 0, 0
    layout.compactList = true
    self.page, self.layout = page, layout
    -- Headed as the settings' pages are, with a name, and then what the window is for: unlike
    -- a settings page, it opens unasked, and has to say what it is.
    layout:Intro([[Interface\AddOns\Spoken\icon.tga]], L.WELCOME_TITLE, L.WELCOME_INTRO)

    -- What Spoken reads: the modules' list, as on General, a click turning each on or off.
    layout:Section(L.WELCOME_PARTS, true)
    local modules = {}
    for _, part in ipairs(Options.PARTS) do
        local key = part.key
        table.insert(modules, { icon = part.icon, title = part.label, text = part.text, tooltip = part.tip,
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
            tooltip = Options.STYLE_TIPS[style], art = Options.SKETCHES[style] })
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
    -- The debug log is offered here, off: a player who turns it on now has a log to send with
    -- the first report, rather than being asked to turn it on and wait for it to happen again.
    -- Its words are the module's.
    if logShown then
        self.log = FooterCheck(page, frame, bottomY, Developer:Call("SwitchLabel") or "",
            Developer:Call("SwitchTip") or "", function(on) Developer:Call("SetLogOn", on) end)
    end

    frame:SetHeight(BAR + TOP_MARGIN - NAME_Y + layout:Height() + Layout.BOX_MARGIN + FOOTER + extra)
end

--- Show what is chosen now, and for each part whether it is installed.
function Welcome:Sync()
    if self.layout then self.layout:Refresh() end
    if self.lower then self.lower:SetChecked(Addon.db.profile.Audio.LowerOthers.Enabled and true or false) end
    if self.log then self.log:SetChecked(Developer:IsLogOn()) end
end

function Welcome:Show()
    if not Addon.db then return end
    if not self.frame then self:Build() end
    self:Sync()
    self.frame:Show()
end

function Welcome:IsAvailable()
    return Settings ~= nil and Settings.RegisterCanvasLayoutCategory ~= nil
end

-- At the first login it ships to, once the world is up and everything has registered, and
-- never in combat, where a window over the screen is the last thing anyone wants.
local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_ENTERING_WORLD")
-- The upvalue, not the handler's `self`: this file loads before Compat.lua wraps CreateFrame,
-- and 1.12 and 2.4.3 hand an unwrapped handler nothing.
events:SetScript("OnEvent", function()
    events:UnregisterEvent("PLAYER_ENTERING_WORLD")
    if not (Addon.db and Welcome:IsAvailable()) or Addon.db.global.Welcomed then return end
    local function Open()
        if InCombatLockdown and InCombatLockdown() then return end
        Welcome:Show()
    end
    if C_Timer and C_Timer.After then C_Timer.After(2, Open) else Open() end
end)
