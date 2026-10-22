setfenv(1, SpokenEnv)

-- The "minimal" narrator style, the Small Window: the speaker's portrait beside a panel with the
-- name, the line's title, its words and the round controls. Playback and source-owned actions
-- belong to the queue and actions services.
MinimalPlayer = {}
local ART = [[Interface\AddOns\Spoken\Textures\]]
local HEIGHT, WIDTH = 98, 380
-- Down the content, from its top: the name's row, then the title's. The words start WORDS_TOP
-- down, and the progress line PROGRESS_GAP under them (under the title, with no words); FOOT is
-- the room under the last of them to the frame's bottom, over the border.
local NAME_HEIGHT, TITLE_HEIGHT = 21, 19
local WORDS_TOP, PROGRESS_GAP, FOOT = 44, 6, 27
-- The content's inset from the frame's top and right; its left edge clears the portrait.
local INSET, BESIDE_PORTRAIT, NO_PORTRAIT = 18, 96, 16
-- Between the name or the title and the header's buttons; between the buttons.
local CONTROLS_CLEAR, ROUND_GAP = 8, Actions.ROUND_GAP
-- The narrowest the window goes, and the room the portrait takes left of the panel.
local function MinWidth() return Addon:Profile("Frame").HidePortrait and 200 or 280 end
local function PortraitWidth() return Addon:Profile("Frame").HidePortrait and 80 or 0 end
-- The text colours for each background (Frame.MinimalBackground): dark ink with no shadow on
-- parchment, light text on the rock.
local LOOKS = {
    parchment = { name = { .19, .17, .13 }, title = { .19, .17, .13 }, tail = { .50, .36, .24 }, shadow = 0,
        words = { color = { .19, .17, .13 }, shadow = false, highlight = "|cff9c1a1a" } },
    dark = { name = { 1, .82, 0 }, title = { .88, .84, .76 }, tail = { .62, .58, .46 }, shadow = 1 },
}
-- Shipped with Spoken: the Classic clients list the retail parchment atlases without their art,
-- so those draw nothing.
local PARCHMENT = ART .. "MinimalParchment"
-- The right-click menu's border, where Bronze Border does not tint it.
local MENU_EDGE = { .6, .57, .48 }
local function Clamp(n, low, high) return math.max(low, math.min(high, n)) end
-- The frame still resizes while the UI is torn down, after AceDB strips it (Addon:Profile).
local function Config() return Addon:Profile("Frame") end
local Label, Waiting, BelongsTo, Font = Actions.Label, Actions.Waiting, Actions.BelongsTo, Actions.Text

function MinimalPlayer:IsEnabled()
    return Addon.db and Addon:DisplayStyle() == "minimal"
end

function MinimalPlayer:HideTooltip()
    local owner = GameTooltip:GetOwner()
    if BelongsTo(owner, self.frame) or BelongsTo(owner, self.menu) then GameTooltip_Hide() end
end

function MinimalPlayer:HasClip()
    return self:IsEnabled() and self.wanted and SoundQueue:GetCurrentSound() ~= nil
end

function MinimalPlayer:Initialize(original)
    if self.frame then return end
    local frame = CreateFrame("Frame", "SpokenMinimalPlayerFrame", UIParent)
    self.frame = frame
    frame:SetSize(WIDTH, HEIGHT)
    if not Addon:RestoreLayout("Minimal", frame) then
        local point, relative, relativePoint, x, y = original:GetPoint(1)
        frame:SetPoint(point or "BOTTOM", relative or UIParent, relativePoint or "BOTTOM", x or 0, y or 200)
    end
    frame:SetMovable(true)
    frame:SetResizable(true)
    frame:SetClampedToScreen(true)
    -- Placed from the saved layout instead; the client's cache would only fight it.
    frame:SetUserPlaced(false)
    frame:EnableMouse(true)
    frame:RegisterForDrag("LeftButton")
    frame:SetScript("OnDragStart", function() self:StartDrag() end)
    frame:SetScript("OnDragStop", function() self:StopDrag() end)
    frame:SetScript("OnMouseUp", function(_, button)
        if button == "RightButton" then self:ToggleMenu() end
    end)
    -- It takes the wheel only while Ctrl is held over it, unlocked (MinimalPlayer:Tick), so the
    -- camera zooms otherwise. The captions take the wheel first and hand it here when Ctrl is held.
    frame:SetScript("OnMouseWheel", function(_, delta) self:Wheel(delta) end)
    frame.spokenWheel = function(delta) return self:Wheel(delta) end
    frame:Hide()
    self.fader = Actions.Fader(frame, function() return { self.viewport and self.viewport.model } end, function()
        -- Faded out for a turn: show the next line.
        if self.turning then self.turning = nil; self:Update() end
    end)

    self.panel = CreateFrame("Frame", nil, frame, "BackdropTemplate")
    self.panel:SetBackdrop({
        edgeFile = [[Interface\DialogFrame\UI-DialogBox-Border]], edgeSize = 24,
        insets = { left = 7, right = 7, top = 7, bottom = 7 },
    })
    -- The rock is tiled by hand: the backdrop's own tiling stretches it when the words make the
    -- panel taller.
    self.paper = self.panel:CreateTexture(nil, "BACKGROUND")
    self.paper:SetPoint("TOPLEFT", 7, -7)
    self.paper:SetPoint("BOTTOMRIGHT", -7, 7)
    self.panel:SetScript("OnSizeChanged", function() self:TileRock() end)

    local content = CreateFrame("Frame", nil, frame)
    self.content, frame.container = content, content
    content:SetHeight(76)
    content:SetFrameLevel(self.panel:GetFrameLevel() + 1)
    self.header = CreateFrame("Button", nil, content)
    self.header:SetPoint("TOPLEFT")
    self.header:SetPoint("TOPRIGHT")
    self.header:SetHeight(NAME_HEIGHT + TITLE_HEIGHT)
    self.header:RegisterForClicks("RightButtonUp")
    self.header:RegisterForDrag("LeftButton")
    self.header:SetScript("OnClick", function() self:ToggleMenu() end)
    self.header:SetScript("OnDragStart", function() self:StartDrag() end)
    self.header:SetScript("OnDragStop", function() self:StopDrag() end)
    self.header:SetScript("OnEnter", function()
        if not self:HasClip() or self.menu:IsShown() then return end
        GameTooltip:SetOwner(self.header, "ANCHOR_RIGHT")
        GameTooltip:SetText(Label(self.clip))
        GameTooltip:AddLine(L.MIN_MENU_HINT, 1, .82, 0, true)
        GameTooltip:Show()
    end)
    self.header:SetScript("OnLeave", function() self:HideTooltip() end)

    self.controls = CreateFrame("Frame", nil, content)
    self.controls:SetHeight(1)
    self.controls:SetFrameLevel(content:GetFrameLevel() + 3)
    self.controls:SetPoint("RIGHT", content, "TOPRIGHT", 0, -(NAME_HEIGHT + TITLE_HEIGHT) / 2)
    self.play = Actions.StopButton(self.controls, function() return self:HasClip() end,
        function() self:UpdateControls() end)
    self.skip = Actions.SkipButton(self.controls)
    self.buttons = { self.play, self.skip }

    self.name = Font(self.header, 16, 1, .82, 0)
    self.name:SetHeight(NAME_HEIGHT)
    self.name:SetPoint("TOPLEFT", content, "TOPLEFT", 0, 0)
    self.name:SetPoint("RIGHT", self.controls, "LEFT", -CONTROLS_CLEAR, 0)
    content.name = self.name -- Actions' header anchor contract.
    self.title = CreateFrame("Frame", nil, content)
    self.title:SetHeight(TITLE_HEIGHT)
    self.title:SetPoint("TOPLEFT", content, "TOPLEFT", 0, -NAME_HEIGHT)
    self.title:SetPoint("RIGHT", self.controls, "LEFT", -CONTROLS_CLEAR, 0)
    self.title.text = Font(self.title, 12, .88, .84, .76)
    self.stopped = Font(self.title, 12, .62, .58, .46)
    self.stopped:SetText(format("• (%s)", L.SUBTITLE_STOPPED))
    self.stopped:Hide()
    self.count = Font(self.title, 12, .62, .58, .46)
    self.count:Hide()
    self.held = Font(self.title, 12, .62, .58, .46)
    self.held:Hide()
    self.tail = Actions.Tail(self.stopped, self.count, self.held)

    self.progress = Actions.ProgressBar(content)

    self:BuildPortrait()
    self:BuildMenu()
    Actions:Build(frame)

    self.resizer = CreateFrame("Button", nil, frame)
    self.resizer:SetSize(12, 12)
    self.resizer:SetPoint("BOTTOMRIGHT", -5, 12)
    -- The client's own, as Azeroth's Compendium's.
    self.resizer:SetNormalTexture([[Interface\ChatFrame\UI-ChatIM-SizeGrabber-Up]])
    self.resizer:SetAlpha(0)
    self.resizer:SetScript("OnMouseDown", function(_, button)
        if button ~= "LeftButton" or Addon:IsFrameLocked() then return end
        self.sizing = true
        frame:StartSizing("BOTTOMRIGHT")
    end)
    self.resizer:SetScript("OnMouseUp", function()
        frame:StopMovingOrSizing()
        if self.sizing then self:SaveLayout() end
        self.sizing = false
    end)
    frame:SetScript("OnSizeChanged", function() self:Layout() end)
    frame:SetScript("OnUpdate", function(_, elapsed) self:Tick(elapsed) end)
    frame:SetScript("OnHide", function()
        self.menu:Hide()
        self:HideTooltip()
        Actions.DropWheel(frame)
    end)
end

function MinimalPlayer:BuildPortrait()
    local host = Face.Build(self.frame, 90, self.content:GetFrameLevel() + 2)
    self.portrait, self.frame.portrait = host, host
    host:SetPoint("TOPLEFT", 0, -4)
    self.viewport, self.ring = host.viewport, host.ring
    self.badgeBackground, self.badge = host.badgeBackground, host.badge
end

function MinimalPlayer:BuildMenu()
    local menu = CreateFrame("Frame", "SpokenMinimalPlayerMenu", UIParent, "BackdropTemplate")
    self.menu = menu
    menu:SetSize(210, 144)
    menu:SetFrameStrata("TOOLTIP")
    menu:SetClampedToScreen(true)
    menu:EnableMouse(true)
    menu:SetBackdrop({ bgFile = [[Interface\Tooltips\UI-Tooltip-Background]],
        edgeFile = [[Interface\Tooltips\UI-Tooltip-Border]], tile = true, tileSize = 16, edgeSize = 12,
        insets = { left = 3, right = 3, top = 3, bottom = 3 } })
    menu:SetBackdropColor(.07, .065, .05, .98)
    menu:SetBackdropBorderColor(MENU_EDGE[1], MENU_EDGE[2], MENU_EDGE[3], 1)
    menu:Hide()
    table.insert(UISpecialFrames, "SpokenMinimalPlayerMenu")
    menu:RegisterEvent("GLOBAL_MOUSE_DOWN")
    menu:SetScript("OnEvent", function()
        if menu:IsShown() and not MouseIsOver(menu) and not MouseIsOver(self.frame) then menu:Hide(); self:HideTooltip() end
    end)
    self.menuButtons = {}
    local function Item(text, fn)
        local button = self:MenuItem(getn(self.menuButtons) + 1, fn)
        button.text:SetText(text)
        table.insert(self.menuButtons, button)
        return button
    end
    self.menuPlay = Item(L.STOP, function() if SoundQueue:CanBePaused() then SoundQueue:TogglePauseQueue() end end)
    self.menuSkip = Item(L.MIN_SKIP, function() SoundQueue:Skip() end)
    self.menuStop = Item(L.MIN_STOP_ALL, function() SoundQueue:RemoveAllSoundsFromQueue() end)
    -- The minimap menu's rows too: the Compendium and the settings.
    Item(L.OPT_COMPENDIUM_OPEN, function() Options:ToggleCompendium() end)
    Item(L.SETTINGS, function() Options:Open() end)
    self.actionRows = {}
end

--- A row of the menu, `index` rows down; `fn(row)` runs on click while a clip plays.
function MinimalPlayer:MenuItem(index, fn)
    local button = CreateFrame("Button", nil, self.menu)
    button:SetPoint("TOPLEFT", 10, -8 - (index - 1) * 23)
    button:SetPoint("TOPRIGHT", -10, -8 - (index - 1) * 23)
    button:SetHeight(23)
    button.text = Font(button, 12, 1, .82, 0)
    button.text:SetPoint("LEFT", 4, 0)
    button:SetHighlightTexture([[Interface\QuestFrame\UI-QuestTitleHighlight]])
    button:GetHighlightTexture():SetAlpha(.25)
    button:SetScript("OnClick", function()
        self.menu:Hide()
        self:HideTooltip()
        if self:HasClip() then fn(button) end
    end)
    return button
end

--- An icon action that names itself also gets a menu row, "[icon] label".
function MinimalPlayer:ActionRow(index)
    local row = self.actionRows[index]
    if row then return row end
    row = self:MenuItem(getn(self.menuButtons) + index, function(button)
        if button.action.onClick then button.action.onClick(self.frame.actions.clip) end
    end)
    row.icon = row:CreateTexture(nil, "ARTWORK")
    row.icon:SetSize(16, 16)
    row.icon:SetPoint("LEFT", 4, 0)
    row.text:ClearAllPoints()
    row.text:SetPoint("LEFT", row.icon, "RIGHT", 5, 0)
    self.actionRows[index] = row
    return row
end

function MinimalPlayer:ConfigureActions()
    self.row = Actions:HeaderControls(self.frame, self.controls, self.buttons, self.clip)
    Actions.LayOutRow(self.controls, self.row, ROUND_GAP)
    local rows = 0
    for _, button in ipairs(self.frame.actions.buttons) do
        local action = button.action
        if action.anchor ~= "header" and action.icon and action.label then
            rows = rows + 1
            local row = self:ActionRow(rows)
            row.action = action
            row.icon:SetTexture(action.icon)
            row.text:SetText(action.label)
            row:Show()
        end
    end
    for index = rows + 1, getn(self.actionRows) do self.actionRows[index]:Hide() end
    self.menu:SetHeight(8 + (getn(self.menuButtons) + rows) * 23 + 9)
end

function MinimalPlayer:ToggleMenu()
    if not self:HasClip() then return end
    if self.menu:IsShown() then self.menu:Hide(); self:HideTooltip(); return end
    self:ConfigureActions()
    self:UpdateControls()
    self:HideTooltip()
    self.menu:ClearAllPoints()
    self.menu:SetPoint("TOPLEFT", self.frame, "BOTTOMLEFT", Config().HidePortrait and 12 or 36, 8)
    -- The window's parent, not UIParent, which a hosting dialog addon may have hidden.
    self.menu:SetParent(self.frame:GetParent())
    self.menu:SetFrameStrata("TOOLTIP")
    self.menu:SetScale(self.frame:GetScale())
    self.menu:Show()
end

--- Ctrl-wheel steps Window Size, Ctrl-Shift-wheel Text Size (Actions.WheelSize), its top-left
--- corner staying put. True when the wheel was taken.
function MinimalPlayer:Wheel(delta)
    local frame = self.frame
    local left, top, before = frame:GetLeft(), frame:GetTop(), frame:GetEffectiveScale()
    local text = Actions.WheelSize(delta, "FrameScale")
    if not text then return false end
    if left and top then
        local after = frame:GetEffectiveScale()
        frame:ClearAllPoints()
        frame:SetPoint("TOPLEFT", UIParent, "BOTTOMLEFT", left * before / after, top * before / after)
        if Addon:Layout().Minimal then self:SaveLayout() end
    end
    Actions.WheelTip(frame, text)
    return true
end

function MinimalPlayer:StartDrag()
    if not Addon:IsFrameLocked() then
        self.menu:Hide()
        Snap.Start(self.frame, { locked = function() return Addon:IsFrameLocked() end })
    end
end

function MinimalPlayer:StopDrag()
    Snap.Stop()
    if not Addon:IsFrameLocked() then self:SaveLayout() end
end

-- Saved as the width with the portrait, which RefreshConfig takes off when hidden.
function MinimalPlayer:SaveLayout()
    Addon:SaveLayout("Minimal", self.frame, self.frame:GetWidth() + PortraitWidth())
end

function MinimalPlayer:ConfigurePortrait()
    if Config().HidePortrait then return end
    Face.Show(self.portrait, self.clip)
end

--- The rock repeats once per 256 units, inside the inset.
function MinimalPlayer:TileRock()
    if not self.dark then return end
    local width, height = self.panel:GetWidth() or 0, self.panel:GetHeight() or 0
    self.paper:SetTexCoord(0, math.max(0, width - 14) / 256, 0, math.max(0, height - 14) / 256)
end

--- Paints the panel's background, and the text in colours that read on it.
function MinimalPlayer:Dress()
    local dark = Config().MinimalBackground == "dark"
    local look = dark and LOOKS.dark or LOOKS.parchment
    local paper = self.paper
    self.dark = dark
    if dark then
        paper:SetTexture(ART .. "MinimalBackground", "REPEAT", "REPEAT")
        self:TileRock()
    else
        paper:SetTexture(PARCHMENT)
        paper:SetTexCoord(0, 1, 0, 1)
    end
    local function Ink(text, color)
        text:SetTextColor(color[1], color[2], color[3])
        text:SetShadowColor(0, 0, 0, look.shadow)
    end
    Ink(self.name, look.name)
    Ink(self.title.text, look.title)
    Ink(self.stopped, look.tail)
    Ink(self.count, look.tail)
    Ink(self.held, look.tail)
    Transcript:SetStyle(look.words)
end

function MinimalPlayer:UpdateControls()
    if not self.clip then return end
    local paused = SoundQueue:IsPaused()
    Actions.SetPlayGlyph(self.play, Actions.HeadState())
    self.title.text:SetText(Label(self.clip))
    Addon:ClipFont(self.title.text, self.clip)
    self.tail:SetHeld(SoundQueue:GetHeldReason(self.clip))
    self.tail:SetStopped(paused)
    self:Count(Waiting())
    local pausable = Actions.SetPausable(self.buttons)
    self.menuPlay.text:SetText(paused and L.REPLAY or L.STOP)
    for _, button in ipairs({ self.menuPlay, self.menuSkip, self.menuStop }) do
        if pausable then button:Enable(); button.text:SetAlpha(1)
        else button:Disable(); button.text:SetAlpha(.35) end
    end
end

--- Puts the tail after the title: the title is cut short, not it.
function MinimalPlayer:Count(waiting)
    self.tail:SetCount(waiting)
    self.tail:Fit(self.title.text, self.title:GetWidth() or 0)
end

function MinimalPlayer:UpdateProgress()
    Actions.FollowProgress(self)
end

--- The window as tall as its words, with the progress line along their foot.
function MinimalPlayer:Layout()
    if not self.frame or self.layingOut then return end
    self.layingOut = true
    local cfg = Config()
    local words = Transcript:HeightForClip(self.clip)
    -- Show Progress, one setting for every window.
    local progress = Addon:Profile("Transcript").SubtitleProgress ~= false
    local width = math.max(1, self.frame:GetWidth() - (cfg.HidePortrait and NO_PORTRAIT or BESIDE_PORTRAIT) - INSET)
    local bottom = words > 0 and WORDS_TOP + words or NAME_HEIGHT + TITLE_HEIGHT
    local barTop = bottom + PROGRESS_GAP
    if progress then bottom = barTop + self.progress.height end
    Transcript:ResizePlayer(self.frame, math.max(HEIGHT, INSET + bottom + FOOT), MinWidth(), 1000)
    Transcript:Dock(self.frame, self.content, "TOPLEFT", 0, -WORDS_TOP, width, words)
    self.progress.track:SetShown(progress)
    self.progress.track:ClearAllPoints()
    self.progress.track:SetPoint("TOPLEFT", self.content, "TOPLEFT", 0, -barTop)
    self.progress.track:SetWidth(width)
    self.panel:ClearAllPoints()
    -- The panel starts behind the portrait's centre and is centred on it vertically,
    -- so its left corners sit beneath the opaque disc and the text gets even margins.
    self.panel:SetPoint("TOPLEFT", self.frame, "TOPLEFT", cfg.HidePortrait and 0 or 44, -6)
    self.panel:SetPoint("BOTTOMRIGHT", self.frame, "BOTTOMRIGHT", 0, 10)
    self.resizer:SetShown(not Addon:IsFrameLocked())
    self.layingOut = false
end

function MinimalPlayer:SetVisible(visible, immediate)
    if not self.frame then return end
    if not visible then self.menu:Hide(); self:HideTooltip() end
    self.wanted = visible and true or false
    self.fader:Set(visible, immediate)
end

function MinimalPlayer:Tick(elapsed)
    Actions.TakeWheel(self.frame, Addon:IsFrameLocked())
    if not self.wanted then return end
    -- Once "(Stopped)" has faded out, the title gets its room back.
    if self.tail:Step(elapsed) then self:Count(Waiting()) end
    if StaticPortrait:Resolved() then self:ConfigurePortrait() end
    self:UpdateProgress()
    self.poll = (self.poll or 0) + elapsed
    if self.poll >= .2 then
        self.poll = 0
        self:UpdateControls()
        self.resizer:SetAlpha(MouseIsOver(self.frame) and .65 or 0)
    end
end

function MinimalPlayer:RefreshConfig(original)
    self:Initialize(original.frame)
    local cfg, frame = Config(), self.frame
    frame:SetScale(cfg.FrameScale)
    frame:SetFrameStrata(cfg.FrameStrata)
    frame:SetResizeBounds(MinWidth(), frame:GetHeight(), 1000, frame:GetHeight())
    local saved = Addon:Layout().Minimal
    frame:SetWidth(Clamp((saved and saved.width or WIDTH) - PortraitWidth(), MinWidth(), 1000))
    self.content:ClearAllPoints()
    self.content:SetPoint("TOPLEFT", cfg.HidePortrait and NO_PORTRAIT or BESIDE_PORTRAIT, -INSET)
    self.content:SetPoint("TOPRIGHT", -INSET, -INSET)
    self.portrait:SetShown(not cfg.HidePortrait)
    local bronze = Actions.Bronze()
    local r, g, b = 1, 1, 1
    if bronze then r, g, b = bronze[1], bronze[2], bronze[3] end
    self.panel:SetBackdropBorderColor(r, g, b)
    Actions.TintProgress(self.progress, r, g, b)
    local edge = bronze or MENU_EDGE
    self.menu:SetBackdropBorderColor(edge[1], edge[2], edge[3], 1)
    self:Dress()
    if Addon:IsFrameLocked() then frame:StopMovingOrSizing(); self.sizing = false end
    -- Locked, clicks on the window pass through to the game, as the subtitle's do; the header
    -- still opens the menu.
    Actions.ClickThrough(frame)
    Addon:ApplyHost(frame)
    self:Update()
end

--- Whether this window, showing a line, will fade out before it shows `clip`.
function MinimalPlayer:WillTurn(clip)
    return self:IsEnabled() and self.frame ~= nil and self.clip ~= nil and clip ~= self.clip and self.wanted
        and self.frame:IsShown() and not Actions.DialogCovers() and true or false
end

function MinimalPlayer:Update()
    if not self.frame then return end
    if not self:IsEnabled() then self.turning = nil; self:SetVisible(false, true); return end
    local clip = PlayerFrame:Current()
    if not clip or Actions.DialogCovers() then self.turning = nil; self:SetVisible(false); return end
    -- Mid-turn: the fader's callback shows the next line once faded out.
    if self.turning and self.frame:IsShown() then return end
    -- A new line while one shows: fade out whole first, so the change happens unseen.
    if clip ~= self.clip and self.clip and self.wanted and self.frame:IsShown() then
        self.turning = true
        self:SetVisible(false)
        return
    end
    if clip ~= self.clip then
        self.menu:Hide()
        self:HideTooltip()
        self.clip, self.seconds = clip, 0
    end
    self:SetVisible(true)
    self.name:SetText(Actions.Speaker(clip))
    Addon:ClipFont(self.name, clip)
    self:ConfigurePortrait()
    self:ConfigureActions()
    self:Layout()
    self:UpdateProgress()
    self:UpdateControls()
end

--- Its saved place and width forgotten, and back at its default spot. Drawn again only while it
--- is the style shown; another picks the default up when it switches.
function MinimalPlayer:Reset()
    Addon:Layout().Minimal = nil
    if not self.frame then return end
    self.frame:StopMovingOrSizing()
    self.frame:ClearAllPoints()
    self.frame:SetPoint("BOTTOM", UIParent, "BOTTOM", 0, 200)
    if self:IsEnabled() then self:RefreshConfig(PlayerFrame) end
end

function MinimalPlayer:Describe()
    return format("minimal=%s visible=%s portrait=%s background=%s progress=%.1fs",
        tostring(self:IsEnabled()), tostring(self.frame and self.frame:IsShown()),
        tostring(self.viewport and self.viewport.active), tostring(Config().MinimalBackground),
        self.seconds or 0)
end
