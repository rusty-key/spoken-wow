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
local LEFT = 17.5       -- the page's rows and cards, EDGE from the window's left
local TOP = -40         -- below the frame's title bar
local FOOTER = 64       -- the buttons along the bottom, and the room above and below them
local EDGE = 17.5       -- the boxes' distance from the window's sides, and the footer's
local BUTTON_WIDTH, BUTTON_HEIGHT = 160, 22   -- the game's red panel button

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
    end)
    table.insert(UISpecialFrames, "SpokenWelcomeFrame")
    frame:Hide()

    -- The page sits a few levels above the window, because a section's box is drawn a level
    -- under its page: drawn straight on the window, it would land behind the window's own
    -- background. Its width leaves the cards EDGE from either side of the window: a page's
    -- rows end RIGHT_MARGIN short of its right edge, and start LEFT in.
    local page = CreateFrame("Frame", nil, frame)
    page:SetPoint("TOPLEFT", frame, "TOPLEFT", 0, 0)
    page:SetWidth(WIDTH - EDGE + Layout.RIGHT_MARGIN)
    page:SetHeight(1)
    page:SetFrameLevel(frame:GetFrameLevel() + 5)
    local layout = Layout.New(page, LEFT, TOP)
    self.page, self.layout = page, layout
    -- Headed as the settings' pages are, with a name, and then what the window is for: unlike
    -- a settings page, it opens unasked, and has to say what it is.
    layout:Intro([[Interface\AddOns\SpokenPlayer\icon.tga]], L.WELCOME_TITLE, L.WELCOME_INTRO)

    -- What Spoken reads: the modules, a click turning each on or off, their tags saying whether
    -- each is enabled and has its voices, as on General.
    layout:Section(L.WELCOME_PARTS, true)
    local cards = {}
    for _, part in ipairs(Options.PARTS) do
        local key = part.key
        table.insert(cards, { icon = part.icon, title = part.label, text = part.text, tooltip = part.tip,
            read = function() return not Sources:IsTurnedOff(Sources:Get(key) or { key = key }) end,
            write = function(v) Sources:SetTurnedOff(key, not v) end,
            apply = function() Options:UpdateRows(); layout:Refresh() end,
            disabled = function() if not Sources:Get(key) then return L.REASON_NOT_INSTALLED end end,
            status = function() return Options:PartVoice(key) end,
            hint = function(on) return on and L.OPT_PART_CLICK_OFF or L.OPT_PART_CLICK_ON end })
    end
    self.cards = layout:Cards(cards)

    -- How lines appear: the same sketches as General. Choosing subtitles shows one, so it can
    -- be seen and dragged into place now.
    layout:Section(L.WELCOME_SHOW, true)
    local tiles = {}
    for _, style in ipairs(Options:Styles(true)) do
        table.insert(tiles, { value = style, title = Options.STYLE_LABELS[style], text = Options.STYLE_TEXTS[style],
            tooltip = Options.STYLE_TIPS[style], art = Options.SKETCHES[style] })
    end
    self.tiles = layout:Tiles(tiles, function() return Addon:PlayerStyle() end,
        function(v) Addon:SetPlayerStyle(v) end,
        function()
            Refresh()
            if Subtitle then Subtitle:ShowSample(Addon:PlayerStyle() == "subtitle") end
        end, { choose = L.STYLE_CHOOSE })

    -- The footer: a faint rule across, then the one switch
    -- more on the left and the two ways out on the right.
    local rule = page:CreateTexture(nil, "ARTWORK")
    if rule.SetColorTexture then rule:SetColorTexture(0.559, 0.559, 0.559, 0.2375) end
    rule:SetHeight(1)
    rule:SetPoint("BOTTOMLEFT", frame, "BOTTOMLEFT", EDGE, FOOTER - 6)
    rule:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", -EDGE, FOOTER - 6)
    self.rule = rule

    local done = Button(page, L.WELCOME_DONE, function() frame:Hide() end)
    done:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", -EDGE, 14)
    local all = Button(page, L.WELCOME_SETTINGS, function()
        frame:Hide()
        Options:Open()
    end)
    all:SetPoint("RIGHT", done, "LEFT", -10, 0)
    self.done, self.all = done, all

    -- Along the bottom beside the buttons rather than in a section of its own: a third section
    -- would make the window taller than the screen at the default UI scale. Its tooltip says
    -- what it does.
    if OtherSounds:IsAvailable() then
        local lower = Layout.NewCheck(page, 28)
        lower:SetPoint("LEFT", frame, "BOTTOMLEFT", EDGE + 4, 14 + BUTTON_HEIGHT / 2)
        lower.label = page:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
        lower.label:SetPoint("LEFT", lower, "RIGHT", 8, 0)
        lower.label:SetText(L.OPT_LOWER_OTHERS)
        lower:SetScript("OnClick", function(button)
            Addon.db.profile.Audio.LowerOthers.Enabled = button:GetChecked() and true or false
            OtherSounds:RefreshConfig()
            Options:UpdateRows()
        end)
        lower:SetScript("OnEnter", function(button)
            GameTooltip:SetOwner(button, "ANCHOR_RIGHT")
            GameTooltip:SetText(L.OPT_LOWER_OTHERS, 1, 1, 1)
            GameTooltip:AddLine(L.WELCOME_LOWER_TIP, nil, nil, nil, true)
            GameTooltip:Show()
        end)
        lower:SetScript("OnLeave", function() GameTooltip:Hide() end)
        self.lower = lower
    end

    frame:SetHeight(-TOP + layout:Height() + Layout.BOX_MARGIN + FOOTER)
end

--- Show what is chosen now, and for each part whether it is installed.
function Welcome:Sync()
    if self.layout then self.layout:Refresh() end
    if self.lower then self.lower:SetChecked(Addon.db.profile.Audio.LowerOthers.Enabled and true or false) end
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
