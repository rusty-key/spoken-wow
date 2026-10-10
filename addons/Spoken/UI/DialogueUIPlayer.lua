setfenv(1, SpokenEnv)

-- The "dialogueui" narrator style: the queue drawn as a smaller twin of DialogueUI's quest
-- window in its own art. DialogueUI's art, window size and colours come through DialogueUITheme.lua.
--
-- Parsed by the 1.12 client too (addon.xml is shared), so Lua 5.0 syntax throughout; the
-- stub below is all that client runs.

DialogueUIPlayer = { rows = {}, offset = 0 }

if Version.IsAnyLegacy then
    function DialogueUIPlayer:IsEnabled() return false end
    function DialogueUIPlayer:SetVisible() end
    function DialogueUIPlayer:HasClip() return false end
    function DialogueUIPlayer:Describe() return "dialogueui skin: not available on this client" end
    return
end

local Skin = DialogueUIPlayer
local Theme = DialogueUITheme
local MAX_ROWS, ROW_HEIGHT = 4, 20
local PORTRAIT = 48
local CORNER_ICON = 20
local CONTROL_HEIGHT = 22
local BAR_HEIGHT = 3
local MIN_LINES = 2
-- The panel's share of DialogueUI's window at the default Window Size, small enough to read
-- beside the dialog.
local BASE_SCALE = 0.65
local DEFAULT_WINDOW_SIZE = Defaults.profile.Frame.FrameScale
-- Text Size's default, at which the words are DialogueUI's own size.
local BASE_FONT_SIZE = 16
local SCROLLBAR = 10
-- Smaller than DialogueUI's quest title, since the speaker's name shares the strip here.
local TITLE_SHARE = 0.85
-- Shift-drag width limits as shares of DialogueUI's width; the minimum still fits the face
-- and a title on the header strip.
local MIN_WIDTH_SHARE, MAX_WIDTH_SHARE = 0.6, 2
-- DialogueUI's paddings at multiplier 1.
local PAD_H, PAD_TOP, PAD_BOTTOM = 26, 48, 36
-- Where in Parchment.png each strip is. The caps are 256 of 2048 rows each, the middle
-- the 640 between them; the dividers sit lower in the same image.
local CAP_ROWS, MIDDLE_ROWS = 0.125, 0.3125
local HEADER_DIVIDER = { 0, 0.65625, 0.56640625, 0.61328125, 358, 51 }
-- Where, of the strip's 358, the portrait socket at its left end gives way to the plain
-- line. The socket is drawn as is; only the line past it stretches with the panel.
local SOCKET_WIDTH = 64
local FOOTER_DIVIDER = { 0, 0.71875, 0.6875, 0.71875, 392, 34 }
-- Ctrl-wheel limits for Window Size and Text Size, matching their sliders' ranges.
local WINDOW_SIZES, WINDOW_STEP = { 0.5, 2 }, 0.05
local FONT_SIZES = { 12, 26 }

local parts = MinimalPlayer.parts
local Font, Removable, ShowRemove, Label = parts.Font, parts.Removable, parts.ShowRemove, parts.Label
local HeldLabel, Clamp, Waiting, BelongsTo = parts.HeldLabel, parts.Clamp, parts.Waiting, parts.BelongsTo
local function Round(n) return math.floor(n + 0.5) end
-- Through Addon:Profile: the frame still redraws during UI teardown, after AceDB strips
-- the profile.
local function Config() return Addon:Profile("Frame") end
-- The expand state, shared with the other windows' captions.
local function Expanded() return Addon.db and Addon:Layout().CaptionsExpanded and true or false end

function Skin:IsEnabled()
    return Addon.db and Addon:DisplayStyle() == "dialogueui"
end

function Skin:HideTooltip()
    if BelongsTo(GameTooltip:GetOwner(), self.frame) then GameTooltip_Hide() end
end

function Skin:HasClip()
    return self:IsEnabled() and self.wanted and SoundQueue:GetCurrentSound() ~= nil
end

--- A flat text button with DialogueUI's gossip-option glow. `fn` runs only while a clip plays.
local function TextButton(parent, text, fn)
    local button = CreateFrame("Button", nil, parent)
    button:SetHeight(CONTROL_HEIGHT)
    button.text = Font(button, 12, 1, 1, 1)
    button.text:SetPoint("LEFT", 6, 0)
    button.text:SetPoint("RIGHT", -6, 0)
    button.text:SetJustifyH("CENTER")
    button.text:SetText(text)
    button:SetHighlightTexture([[Interface\Buttons\UI-Listbox-Highlight2]])
    button:GetHighlightTexture():SetAlpha(0.25)
    button:SetScript("OnClick", function()
        if Skin:HasClip() then fn() end
    end)
    return button
end

-- No control shows the wheel sizing (Skin:Wheel), so the face, fold and resize tooltips
-- mention it.
local function WheelHint()
    GameTooltip:AddLine(L.DUI_WHEEL_HINT, 1, .82, 0, true)
end

function Skin:Initialize()
    if self.frame then return end
    local frame = CreateFrame("Frame", "SpokenDialogueUIPlayerFrame", UIParent)
    self.frame = frame
    frame.spokenBaseScale = 1
    frame:SetSize(300, 400)
    -- RefreshConfig re-runs PlaceDefault until the player drags it.
    if not Addon:RestoreLayout("DialogueUI", frame) then self:PlaceDefault() end
    frame:SetMovable(true)
    frame:SetResizable(true)
    frame:SetClampedToScreen(true)
    frame:SetUserPlaced(false)
    frame:EnableMouse(true)
    frame:RegisterForDrag("LeftButton")
    frame:SetScript("OnDragStart", function() self:StartDrag() end)
    frame:SetScript("OnDragStop", function() self:StopDrag() end)
    frame:SetScript("OnMouseUp", function(_, button)
        if button == "RightButton" then Options:Open() end
    end)
    frame:SetScript("OnUpdate", function(_, elapsed) self:Tick(elapsed) end)
    -- While the handle is dragged the captions follow the edge, not the drop.
    frame:SetScript("OnSizeChanged", function()
        if self.sizing and not self.layingOut then self:Layout() end
    end)
    frame:SetScript("OnHide", function() self:HideTooltip() end)
    -- The captions and the queue take the wheel first and hand it here when Ctrl is held.
    frame:EnableMouseWheel(true)
    frame:SetScript("OnMouseWheel", function(_, delta) self:Wheel(delta) end)
    frame.spokenWheel = function(delta) return self:Wheel(delta) end
    frame:Hide()

    -- DialogueUI's three parchment strips: caps centred on the frame's ends, the middle
    -- stretched between, all wider than the frame.
    self.parchments = {}
    for index = 1, 3 do
        local strip = frame:CreateTexture(nil, "BACKGROUND", nil, -1)
        self.parchments[index] = strip
    end
    self.parchments[1]:SetPoint("CENTER", frame, "TOP", 0, 0)
    self.parchments[3]:SetPoint("CENTER", frame, "BOTTOM", 0, 0)
    self.parchments[2]:SetPoint("TOPLEFT", self.parchments[1], "BOTTOMLEFT", 0, 0)
    self.parchments[2]:SetPoint("BOTTOMRIGHT", self.parchments[3], "TOPRIGHT", 0, 0)
    self.parchments[1]:SetTexCoord(0, 1, 0, CAP_ROWS)
    self.parchments[2]:SetTexCoord(0, 1, CAP_ROWS, CAP_ROWS + MIDDLE_ROWS)
    self.parchments[3]:SetTexCoord(0, 1, CAP_ROWS + MIDDLE_ROWS, 2 * CAP_ROWS + MIDDLE_ROWS)

    local content = CreateFrame("Frame", nil, frame)
    self.content, frame.container = content, content
    content.buttons = {}

    -- DialogueUI's header strip in two pieces: the face's socket, never stretched, and the
    -- line past it, stretched to the panel's width.
    local socketU = HEADER_DIVIDER[1] + (HEADER_DIVIDER[2] - HEADER_DIVIDER[1]) * SOCKET_WIDTH / HEADER_DIVIDER[5]
    self.headerSocket = content:CreateTexture(nil, "ARTWORK")
    self.headerSocket:SetTexCoord(HEADER_DIVIDER[1], socketU, HEADER_DIVIDER[3], HEADER_DIVIDER[4])
    self.headerDivider = content:CreateTexture(nil, "ARTWORK")
    self.headerDivider:SetTexCoord(socketU, HEADER_DIVIDER[2], HEADER_DIVIDER[3], HEADER_DIVIDER[4])
    local host = CreateFrame("Frame", nil, content)
    self.portrait, frame.portrait = host, host
    host:SetSize(PORTRAIT, PORTRAIT)
    self.viewport = CreateFrame("Frame", nil, host)
    self.viewport:SetAllPoints()
    self.viewport:SetClipsChildren(true)
    local pause = CreateFrame("Button", nil, host)
    self.pause = pause
    pause:SetAllPoints()
    pause:SetFrameLevel(host:GetFrameLevel() + 3)
    pause.wash = pause:CreateTexture(nil, "BACKGROUND")
    pause.wash:SetAllPoints()
    -- The round mask as a disc, so the wash stops at the face's edge.
    pause.wash:SetTexture([[Interface\AddOns\Spoken\Textures\MinimalPortraitMask]])
    pause.wash:SetVertexColor(0, 0, 0, .45)
    pause:SetNormalTexture([[Interface\AddOns\Spoken\Textures\PortraitFrameAtlas]])
    local glyph = pause:GetNormalTexture()
    glyph:ClearAllPoints()
    glyph:SetPoint("CENTER")
    glyph:SetSize(18, 18)
    pause:SetScript("OnClick", function()
        if self:HasClip() and SoundQueue:CanBePaused() then SoundQueue:TogglePauseQueue() end
    end)
    pause:SetScript("OnEnter", function()
        self:UpdateControls()
        if not self:HasClip() then return end
        GameTooltip:SetOwner(pause, "ANCHOR_RIGHT")
        local stopped = SoundQueue:IsPaused()
        GameTooltip:SetText(stopped and L.REPLAY or L.STOP)
        GameTooltip:AddLine(stopped and L.REPLAY_TOOLTIP or L.STOP_TOOLTIP, 1, 1, 1, true)
        WheelHint()
        GameTooltip:Show()
    end)
    pause:SetScript("OnLeave", function() self:UpdateControls(); self:HideTooltip() end)
    self.name = Font(content, 18, 1, 1, 1)
    content.name = self.name -- Actions' header anchor contract.
    self.title = CreateFrame("Button", nil, content)
    self.name:SetHeight(20)
    Removable(self.title, 12, 1, 1, 1)
    self.title:SetScript("OnClick", function()
        if self:HasClip() then SoundQueue:RemoveSoundFromQueue(self.clip) end
    end)
    self.title:SetScript("OnEnter", function()
        if not self:HasClip() then return end
        ShowRemove(self.title, true)
        GameTooltip:SetOwner(self.title, "ANCHOR_RIGHT")
        GameTooltip:SetText(Label(self.clip))
        GameTooltip:AddLine(L.QUEUE_REMOVE_TOOLTIP, 1, .82, 0, true)
        GameTooltip:Show()
    end)
    self.title:SetScript("OnLeave", function()
        ShowRemove(self.title, false)
        self:HideTooltip()
    end)

    self.close = CreateFrame("Button", nil, content)
    self.close:SetSize(CORNER_ICON, CORNER_ICON)
    self.close:SetPoint("TOPRIGHT", content, "TOPRIGHT", 4, 4)
    self.close:SetNormalTexture([[Interface\Buttons\UI-Panel-MinimizeButton-Up]])
    self.close:SetPushedTexture([[Interface\Buttons\UI-Panel-MinimizeButton-Down]])
    self.close:SetHighlightTexture([[Interface\Buttons\UI-Panel-MinimizeButton-Highlight]], "ADD")
    self.close:SetScript("OnClick", function()
        if self:HasClip() then SoundQueue:Skip() end
    end)
    self.close:SetScript("OnEnter", function()
        GameTooltip:SetOwner(self.close, "ANCHOR_LEFT")
        GameTooltip:SetText(L.DUI_CLOSE)
        GameTooltip:AddLine(L.DUI_CLOSE_TIP, 1, 1, 1, true)
        GameTooltip:Show()
    end)
    self.close:SetScript("OnLeave", function() self:HideTooltip() end)
    self.fold = CreateFrame("Button", nil, content)
    self.fold:SetSize(CORNER_ICON - 4, CORNER_ICON - 4)
    self.fold:SetPoint("RIGHT", self.close, "LEFT", 0, 0)
    self.fold:SetHighlightTexture([[Interface\Buttons\UI-PlusButton-Hilight]], "ADD")
    self.fold:SetScript("OnClick", function() self:SetExpanded(not Expanded()) end)
    self.fold:SetScript("OnEnter", function()
        GameTooltip:SetOwner(self.fold, "ANCHOR_LEFT")
        GameTooltip:SetText(Expanded() and L.TRANSCRIPT_COLLAPSE or L.TRANSCRIPT_EXPAND)
        WheelHint()
        GameTooltip:Show()
    end)
    self.fold:SetScript("OnLeave", function() self:HideTooltip() end)

    self.drawer = CreateFrame("Frame", nil, content)
    self.drawer:EnableMouseWheel(true)
    self.drawer:SetScript("OnMouseWheel", function(_, delta)
        if self:Wheel(delta) then return end
        self.offset = Clamp(self.offset - delta, 0, math.max(0, Waiting() - MAX_ROWS))
        self:LayoutQueue()
    end)
    self.queueNote = Font(self.drawer, 10, 1, 1, 1)
    self.drawer:Hide()

    self.bar = CreateFrame("StatusBar", nil, content)
    self.bar:SetHeight(BAR_HEIGHT)
    self.bar:SetStatusBarTexture([[Interface\TargetingFrame\UI-StatusBar]])
    self.bar:SetMinMaxValues(0, 1)
    self.bar:SetValue(0)
    -- A faint track, so the line reads as a bar even when little of it is filled.
    self.track = self.bar:CreateTexture(nil, "BACKGROUND")
    self.track:SetAllPoints()
    self.footerDivider = content:CreateTexture(nil, "ARTWORK")
    self.footerDivider:SetTexCoord(FOOTER_DIVIDER[1], FOOTER_DIVIDER[2], FOOTER_DIVIDER[3], FOOTER_DIVIDER[4])
    self.controls = CreateFrame("Frame", nil, content)
    self.controls:SetHeight(CONTROL_HEIGHT)
    self.play = TextButton(self.controls, L.STOP, function()
        if SoundQueue:CanBePaused() then SoundQueue:TogglePauseQueue() end
    end)
    self.stop = TextButton(self.controls, L.MIN_STOP_ALL, function() SoundQueue:RemoveAllSoundsFromQueue() end)
    self.buttons = { self.play, self.stop }
    Actions:Build(frame)

    -- The captions scroll themselves on the wheel; the scrollbar shows the position and
    -- lets the reader drag.
    self.scrollbar = CreateFrame("Slider", nil, content)
    self.scrollbar:SetOrientation("VERTICAL")
    self.scrollbar:SetWidth(SCROLLBAR)
    -- The thumb's length is the page's share of the line, so it shows how much is left to read.
    self.scrollbar.track = self.scrollbar:CreateTexture(nil, "BACKGROUND")
    self.scrollbar.track:SetPoint("TOPLEFT", 2, 0)
    self.scrollbar.track:SetPoint("BOTTOMRIGHT", -2, 0)
    self.scrollbar:SetThumbTexture([[Interface\Buttons\WHITE8x8]])
    local thumb = self.scrollbar:GetThumbTexture()
    if thumb then thumb:SetSize(SCROLLBAR - 2, 24) end
    self.scrollbar:SetMinMaxValues(1, 1)
    self.scrollbar:SetValueStep(0)
    self.scrollbar:SetScript("OnValueChanged", function(_, value, byUser)
        if byUser then Transcript:ScrollTo(value) end
    end)
    self.scrollbar:Hide()

    -- The width changes only with Shift held at drag start, so a height drag cannot knock
    -- the column out of DialogueUI's shape.
    self.resizer = CreateFrame("Button", nil, frame)
    self.resizer:SetSize(14, 14)
    self.resizer:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", -2, 2)
    self.resizer:SetNormalTexture([[Interface\AddOns\Spoken\Textures\SizeGrabber-Up]])
    self.resizer:SetAlpha(.5)
    self.resizer:SetScript("OnEnter", function()
        self.resizer:SetAlpha(1)
        GameTooltip:SetOwner(self.resizer, "ANCHOR_LEFT")
        GameTooltip:SetText(L.DUI_RESIZE_TIP, 1, 1, 1, 1, true)
        WheelHint()
        GameTooltip:Show()
    end)
    self.resizer:SetScript("OnLeave", function() self.resizer:SetAlpha(.5); self:HideTooltip() end)
    self.resizer:SetScript("OnMouseDown", function(_, button)
        if button ~= "LeftButton" or Addon:IsFrameLocked() or not Expanded() then return end
        self.sizing = true
        self.sizingWidth = IsShiftKeyDown and IsShiftKeyDown() and true or false
        self:Layout() -- the resize bounds for this drag: free width only with Shift
        frame:StartSizing(self.sizingWidth and "BOTTOMRIGHT" or "BOTTOM")
    end)
    self.resizer:SetScript("OnMouseUp", function()
        frame:StopMovingOrSizing()
        if self.sizing then
            Addon:Layout().DialogueUIHeight = Round(frame:GetHeight())
            if self.sizingWidth then Addon:Layout().DialogueUIWidth = Round(frame:GetWidth()) end
            -- Sizing pins the top-left, so the panel now counts as placed by the player.
            Addon:SaveLayout("DialogueUI", frame)
        end
        self.sizing, self.sizingWidth = false, false
        self:Layout(); self:Update()
    end)
end

function Skin:StartDrag()
    if not Addon:IsFrameLocked() then self.frame:StartMoving() end
end

function Skin:StopDrag()
    self.frame:StopMovingOrSizing()
    if not Addon:IsFrameLocked() then Addon:SaveLayout("DialogueUI", self.frame) end
end

--- Runs on every refresh, so a theme or size change in DialogueUI lands on the next one.
function Skin:Layout()
    local frame, cfg = self.frame, Theme:Config()
    local parchment = Theme:TexturePath() .. "Parchment.png"
    self.layingOut = true
    -- Laid out at DialogueUI's own size, paddings and text; Window Size then scales the
    -- whole frame from BASE_SCALE.
    local scale = BASE_SCALE * (Config().FrameScale or DEFAULT_WINDOW_SIZE) / DEFAULT_WINDOW_SIZE
    frame.spokenBaseScale = scale * Theme:FrameScale() / UIParent:GetEffectiveScale()
    local duiWidth, duiHeight = Theme:FrameSize()
    -- The multiplier DialogueUI drew its window at, so the paddings keep its proportions.
    local multiplier = duiHeight / (Theme.HEIGHT_SHARE * math.max(1, UIParent:GetHeight()))
    local padH, padTop, padBottom = PAD_H * multiplier, PAD_TOP * multiplier, PAD_BOTTOM * multiplier
    local width = self.sizingWidth and Round(frame:GetWidth()) or Addon:Layout().DialogueUIWidth or Round(duiWidth)
    local minWidth, maxWidth = Round(duiWidth * MIN_WIDTH_SHARE), Round(duiWidth * MAX_WIDTH_SHARE)
    width = Clamp(width, minWidth, maxWidth)
    local inner = math.max(1, width - 2 * padH)
    -- The header and footer are sized from DialogueUI's own column, so a wider panel stretches
    -- the strips but keeps the face, the title and the strips' thickness.
    local baseInner = math.max(1, Round(duiWidth) - 2 * padH)
    -- DialogueUI's spacing: 0.35 of the text size under each line, four of those between
    -- paragraphs, which an empty line approximates.
    local fonts = Theme:Fonts()
    local fontSize = fonts.paragraphSize
    local textSize = tonumber(Addon:Profile("Transcript").FontSize) or BASE_FONT_SIZE
    local captionSize = math.max(6, Round(fontSize * textSize / BASE_FONT_SIZE))
    local lineGap = Round(0.35 * captionSize)
    local lineHeight = captionSize + lineGap
    self.fonts, self.captionSize, self.lineGap = fonts, captionSize, lineGap

    -- DialogueUI's header strip thickness and its face and title placements, scaled to its column.
    local ratio = baseInner / HEADER_DIVIDER[5]
    local stripHeight = Round(HEADER_DIVIDER[6] * ratio)
    local face = Round(34 * ratio)
    -- DialogueUI's gap under its header line, before the text.
    local textGap = Round(4 * 0.35 * fontSize)
    local headerHeight = stripHeight + textGap
    local footerStrip = Round(FOOTER_DIVIDER[6] * baseInner / FOOTER_DIVIDER[5])
    -- The same gap above the progress line, so the words sit as far from the foot as from the
    -- head. The last line's own spacing counts towards it.
    local footerHeight = CONTROL_HEIGHT + footerStrip + BAR_HEIGHT + 6 + math.max(0, textGap - lineGap)
    local waiting = Waiting()
    local shownRows = math.min(MAX_ROWS, waiting)
    local queueHeight = shownRows * ROW_HEIGHT + (waiting > MAX_ROWS and 14 or 0)
    -- A panel too small for MIN_LINES grows to fit them, so the controls are never cut off.
    local height = self.sizing and Round(frame:GetHeight()) or Addon:Layout().DialogueUIHeight or Round(duiHeight)
    local body = height - padTop - headerHeight - queueHeight - padBottom - footerHeight
    local lines = math.max(MIN_LINES, math.floor(body / lineHeight))
    local expanded = Expanded()
    if not expanded then
        lines = Addon:Profile("Transcript").Lines == 1 and 1 or 2
        height = 0
    end
    -- Fit to the Words, except while the handle is dragged and the panel follows the pointer.
    if cfg.FitText ~= false and not self.sizing then
        local needed = self:TextLines(inner)
        if needed and needed < lines then
            lines, height = math.max(needed, expanded and MIN_LINES or 1), 0
        end
    end
    local captionHeight = lines * lineHeight
    height = math.max(height, padTop + headerHeight + captionHeight + queueHeight + padBottom + footerHeight)
    frame:SetSize(width, height)
    local minHeight = padTop + headerHeight + MIN_LINES * lineHeight + queueHeight + padBottom + footerHeight
    if frame.SetResizeBounds then
        if self.sizingWidth then
            frame:SetResizeBounds(minWidth, minHeight, maxWidth, 4000)
        else
            frame:SetResizeBounds(width, minHeight, width, 4000)
        end
    end
    self.resizer:SetShown(expanded and not Addon:IsFrameLocked())
    self.lines = lines

    local capWidth, capHeight = Theme:ParchmentSize()
    for index = 1, 3 do self.parchments[index]:SetTexture(parchment) end
    -- The paper follows the panel's width, keeping DialogueUI's overhang either side.
    local paperWidth = capWidth * width / math.max(1, Round(duiWidth))
    self.parchments[1]:SetSize(paperWidth, capHeight)
    self.parchments[3]:SetSize(paperWidth, capHeight)

    local content = self.content
    content:ClearAllPoints()
    content:SetPoint("TOPLEFT", padH, -padTop)
    content:SetPoint("BOTTOMRIGHT", -padH, padBottom)
    local socket = Round(SOCKET_WIDTH * ratio)
    self.headerSocket:ClearAllPoints()
    self.headerSocket:SetPoint("TOPLEFT", content, "TOPLEFT", 0, 0)
    self.headerSocket:SetSize(socket, stripHeight)
    self.headerSocket:SetTexture(parchment)
    self.headerDivider:ClearAllPoints()
    self.headerDivider:SetPoint("TOPLEFT", self.headerSocket, "TOPRIGHT", 0, 0)
    self.headerDivider:SetSize(math.max(1, inner - socket), stripHeight)
    self.headerDivider:SetTexture(parchment)
    self.portrait:SetSize(face, face)
    self.portrait:ClearAllPoints()
    self.portrait:SetPoint("CENTER", self.headerSocket, "TOPLEFT", Round(23 * ratio), -Round(23 * ratio))
    -- The line's title sits where DialogueUI puts its quest title, the speaker's name in its
    -- small line above.
    self.title:ClearAllPoints()
    self.title:SetPoint("LEFT", self.headerSocket, "LEFT", Round(53 * ratio), Round(2 * ratio))
    self.title:SetPoint("RIGHT", content, "RIGHT", -(2 * CORNER_ICON), 0)
    self.title:SetHeight(Round(fonts.titleSize * TITLE_SHARE) + 4)
    self.name:ClearAllPoints()
    self.name:SetPoint("BOTTOMLEFT", self.title, "TOPLEFT", 0, 2)
    self.name:SetPoint("RIGHT", content, "RIGHT", -(2 * CORNER_ICON), 0)
    self.name:SetHeight(fonts.subtitleSize + 2)
    local glyph = [[Interface\Buttons\UI-]] .. (expanded and "Minus" or "Plus")
    self.fold:SetNormalTexture(glyph .. "Button-Up")
    self.fold:SetPushedTexture(glyph .. "Button-Down")

    -- The text takes DialogueUI's full column; the scrollbar sits in the margin beside it.
    Transcript:Dock(frame, content, "TOPLEFT", 0, -headerHeight, inner, captionHeight)
    self.scrollbar:ClearAllPoints()
    self.scrollbar:SetPoint("TOPLEFT", content, "TOPRIGHT", 4, -headerHeight)
    self.scrollbar:SetHeight(captionHeight)

    self.drawer:ClearAllPoints()
    self.drawer:SetPoint("TOPLEFT", content, "TOPLEFT", 0, -(headerHeight + captionHeight))
    self.drawer:SetSize(inner, math.max(1, queueHeight))

    self.controls:ClearAllPoints()
    self.controls:SetPoint("BOTTOMLEFT", content, "BOTTOMLEFT", 0, 0)
    self.controls:SetPoint("BOTTOMRIGHT", content, "BOTTOMRIGHT", 0, 0)
    self.footerDivider:ClearAllPoints()
    self.footerDivider:SetPoint("BOTTOM", self.controls, "TOP", 0, 0)
    self.footerDivider:SetSize(inner, footerStrip)
    self.footerDivider:SetTexture(parchment)
    self.bar:ClearAllPoints()
    self.bar:SetPoint("BOTTOMLEFT", self.footerDivider, "TOPLEFT", 0, 2)
    self.bar:SetPoint("BOTTOMRIGHT", self.footerDivider, "TOPRIGHT", 0, 2)

    self:Dress()
    self.layingOut = false
end

function Skin:Dress()
    local colors = Theme:Colors()
    local fonts = self.fonts or Theme:Fonts()
    local body = fonts.paragraphSize
    local function Paint(text, face, size, color)
        text:SetFont(face, size, "")
        text:SetShadowColor(0, 0, 0, 0)
        text:SetTextColor(color[1], color[2], color[3])
    end
    Paint(self.name, fonts.subtitle, fonts.subtitleSize, colors.title)
    Paint(self.title.text, fonts.title, Round(fonts.titleSize * TITLE_SHARE), colors.title)
    self.title.color = colors.title
    Paint(self.queueNote, fonts.paragraph, math.max(8, body - 2), colors.disabled)
    for _, row in ipairs(self.rows) do
        Paint(row.text, fonts.paragraph, math.max(8, body - 1), colors.gossip)
        row.color = colors.gossip
    end
    for _, button in ipairs(self.buttons) do Paint(button.text, fonts.paragraph, body, colors.paragraph) end
    -- Layout runs this on every step of a resize drag, so a clip's own face goes back on here
    -- rather than waiting for the drop.
    Addon:ClipFont(self.name, self.clip)
    Addon:ClipFont(self.title.text, self.clip)
    for _, row in ipairs(self.rows) do Addon:ClipFont(row.text, row.clip) end
    self.colors = colors
    local tint = colors.portraitTint
    if self.viewport.texture then self.viewport.texture:SetVertexColor(tint[1], tint[2], tint[3]) end
    local track = colors.disabled
    self.track:SetColorTexture(track[1], track[2], track[3], .25)
    self.scrollbar.track:SetColorTexture(track[1], track[2], track[3], .2)
    local thumb = self.scrollbar:GetThumbTexture()
    if thumb then thumb:SetVertexColor(track[1], track[2], track[3], .75) end
    local captionSize = self.captionSize or body
    Transcript:SetStyle({ font = fonts.paragraph, size = captionSize, lineGap = self.lineGap or Round(0.35 * captionSize),
        paragraphs = true, color = colors.paragraph, shadow = false,
        highlight = colors.highlight, lines = self.lines })
end

function Skin:ConfigurePortrait()
    if Config().HidePortrait then self.portrait:Hide(); return end
    self.portrait:Show()
    if not StaticPortrait:Configure(self.viewport, self.clip) then Portrait:Configure(self.viewport, self.clip) end
    local viewport = self.viewport
    if viewport.active == "texture" and viewport.texture then StaticPortrait:Mask(viewport, viewport.texture) end
    local tint = self.colors and self.colors.portraitTint
    if tint and viewport.texture then viewport.texture:SetVertexColor(tint[1], tint[2], tint[3]) end
end

function Skin:ConfigureActions()
    Actions:Configure(self.frame, self.clip)
    local corner, x = nil, 0
    local right = self.controls:GetWidth()
    for _, button in ipairs(self.frame.actions.buttons) do
        local action = button.action
        if action.anchor == "header" then
            button:Hide()
        elseif action.anchor == "topright" and button.showsIcon and not corner then
            -- Report sits faint in the controls row, as the corner belongs to Close, at Close's
            -- size since smaller was hard to see on the parchment. Hooked: its scripts carry the
            -- tooltip.
            corner = button
            button:SetParent(self.controls)
            button:SetFrameLevel(self.controls:GetFrameLevel() + 1)
            button:SetSize(CORNER_ICON, CORNER_ICON)
            button:ClearAllPoints()
            button:SetPoint("RIGHT", self.controls, "RIGHT", 0, 0)
            button:SetAlpha(.4)
            if not button.spokenDimmed then
                button.spokenDimmed = true
                button:HookScript("OnEnter", function(b) b:SetAlpha(1) end)
                button:HookScript("OnLeave", function(b) b:SetAlpha(.4) end)
            end
            x = CORNER_ICON + 6
        else
            button:SetParent(self.controls)
            button:SetFrameLevel(self.controls:GetFrameLevel() + 1)
            button:ClearAllPoints()
            button:SetPoint("RIGHT", self.controls, "RIGHT", -x, 0)
            x = x + button:GetWidth() + 6
        end
    end
    self.actionsWidth = x
end

--- Ctrl-wheel steps Window Size, Ctrl-Shift-wheel Text Size, keeping the top-left corner in
--- place as the scale changes. True when the wheel was taken.
function Skin:Wheel(delta)
    if delta == 0 or not (IsControlKeyDown and IsControlKeyDown()) then return false end
    local text
    if IsShiftKeyDown and IsShiftKeyDown() then
        local transcript = Addon:Profile("Transcript")
        transcript.FontSize = Clamp((transcript.FontSize or BASE_FONT_SIZE) + (delta > 0 and 1 or -1),
            FONT_SIZES[1], FONT_SIZES[2])
        text = format("%s: %d", L.TRANSCRIPT_SIZE, transcript.FontSize)
    else
        local cfg = Config()
        local value = (cfg.FrameScale or DEFAULT_WINDOW_SIZE) + (delta > 0 and WINDOW_STEP or -WINDOW_STEP)
        cfg.FrameScale = Clamp(math.floor(value / WINDOW_STEP + 0.5) * WINDOW_STEP, WINDOW_SIZES[1], WINDOW_SIZES[2])
        text = format("%s: %d%%", L.OPT_SCALE, Round(cfg.FrameScale * 100))
    end
    local frame = self.frame
    local left, top, before = frame:GetLeft(), frame:GetTop(), frame:GetEffectiveScale()
    PlayerFrame:RefreshConfig()
    -- Dragged before: its top-left corner stays put. Never dragged: it stays where DialogueUI
    -- puts its window, and RefreshConfig has placed it there at its new size.
    if left and top and Addon:Layout().DialogueUI and not Addon:IsFrameLocked() then
        local after = frame:GetEffectiveScale()
        frame:ClearAllPoints()
        frame:SetPoint("TOPLEFT", UIParent, "BOTTOMLEFT", left * before / after, top * before / after)
        Addon:SaveLayout("DialogueUI", frame)
    end
    GameTooltip:SetOwner(frame, "ANCHOR_CURSOR")
    GameTooltip:SetText(text)
    GameTooltip:Show()
    return true
end

--- The state persists and is shared with the other windows' expand button.
function Skin:SetExpanded(expanded)
    expanded = expanded and true or false
    if Expanded() == expanded then return end
    Addon:Layout().CaptionsExpanded = expanded
    if self.frame then self:Layout(); self:Update() end
end

function Skin:LayoutControls()
    local x = 0
    for _, button in ipairs(self.buttons) do
        button:ClearAllPoints()
        button:SetPoint("LEFT", self.controls, "LEFT", x, 0)
        button:SetWidth(button.text:GetStringWidth() + 12)
        x = x + button:GetWidth() + 4
    end
end

--- `relayout` when the row's buttons may have changed (Update); otherwise the row is laid out
--- again only when the play button's label does.
function Skin:UpdateControls(relayout)
    if not self.clip then return end
    local paused, playing = SoundQueue:IsPaused(), SoundQueue:IsPlaying()
    local label = paused and L.REPLAY or L.STOP
    if self.play.text:GetText() ~= label then
        self.play.text:SetText(label)
        relayout = true
    end
    Actions.Glyph(self.pause:GetNormalTexture(), Actions.HeadState())
    self.pause:GetNormalTexture():SetAlpha((paused or MouseIsOver(self.pause)) and .9 or 0)
    self.pause.wash:SetShown(paused and not playing)
    local colors = self.colors
    if colors then
        local bar = paused and colors.disabled or colors.gossip
        self.bar:SetStatusBarColor(bar[1], bar[2], bar[3])
    end
    local held = not paused and not playing and SoundQueue:GetHeldReason(self.clip)
    self.title.text:SetText(held and format("%s (%s)", Label(self.clip), held) or Label(self.clip))
    Addon:ClipFont(self.title.text, self.clip)
    local pausable = SoundQueue:CanBePaused()
    for _, button in ipairs(self.buttons) do
        local color = pausable and colors and colors.paragraph or colors and colors.disabled
        if color then button.text:SetTextColor(color[1], color[2], color[3]) end
        if pausable then button:Enable() else button:Disable() end
    end
    if relayout then self:LayoutControls() end
end

function Skin:UpdateProgress()
    local clip = self.clip
    if not clip then return end
    local duration = tonumber(clip.length) or 0
    if clip.nextSoundTimer and duration > 0 then
        self.seconds = SoundQueue:VoiceElapsed(clip)
    elseif not SoundQueue:IsPaused() then self.seconds = 0 end
    self.bar:SetValue(duration > 0 and (self.seconds or 0) / duration or 0)
end

function Skin:CreateQueueRow(index)
    local button = CreateFrame("Button", nil, self.drawer)
    self.rows[index] = button
    button:SetPoint("TOPLEFT", 0, -(index - 1) * ROW_HEIGHT)
    button:SetPoint("TOPRIGHT", 0, -(index - 1) * ROW_HEIGHT)
    button:SetHeight(ROW_HEIGHT)
    local color = self.colors and self.colors.gossip or { 1, 1, 1 }
    Removable(button, 11, color[1], color[2], color[3])
    local fonts = self.fonts or Theme:Fonts()
    button.text:SetFont(fonts.paragraph, math.max(8, fonts.paragraphSize - 1), "")
    button.text:SetShadowColor(0, 0, 0, 0)
    button:SetScript("OnEnter", function()
        ShowRemove(button, true)
        GameTooltip:SetOwner(button, "ANCHOR_RIGHT")
        GameTooltip:SetText(Label(button.clip))
        GameTooltip:AddLine(L.QUEUE_REMOVE_TOOLTIP, 1, .82, 0, true)
        GameTooltip:Show()
    end)
    button:SetScript("OnLeave", function() ShowRemove(button, false); self:HideTooltip() end)
    button:SetScript("OnClick", function()
        if self:HasClip() then SoundQueue:RemoveSoundFromQueue(button.clip) end
    end)
    return button
end

function Skin:LayoutQueue()
    local waiting = Waiting()
    self.offset = Clamp(self.offset, 0, math.max(0, waiting - MAX_ROWS))
    local shown = math.min(MAX_ROWS, waiting - self.offset)
    for index = 1, MAX_ROWS do
        local button = self.rows[index]
        if index <= shown then
            button = button or self:CreateQueueRow(index)
            button.clip = SoundQueue.sounds[index + self.offset + 1]
            button.text:SetText(HeldLabel(button.clip))
            Addon:ClipFont(button.text, button.clip)
            ShowRemove(button, false)
            button:Show()
        elseif button then button:Hide(); button.clip = nil end
    end
    self.queueNote:ClearAllPoints()
    self.queueNote:SetPoint("BOTTOMLEFT")
    self.queueNote:SetText(format(L.MIN_SCROLL_QUEUE, self.offset + 1, self.offset + shown, waiting))
    self.queueNote:SetShown(waiting > MAX_ROWS)
    self.drawer:SetShown(shown > 0)
end

function Skin:SetVisible(visible, immediate)
    if not self.frame then return end
    if not visible then self:HideTooltip() end
    if immediate then
        self.wanted = false
        self.frame:Hide()
        self.frame:SetAlpha(0)
        self.fadeTime = nil
        return
    end
    if self.wanted == visible then return end
    self.wanted = visible
    self.fadeFrom = self.frame:IsShown() and self.frame:GetAlpha() or 0
    self.fadeTime = 0
    if visible then self.frame:SetAlpha(self.fadeFrom); self.frame:Show() end
end

function Skin:Tick(elapsed)
    if self.fadeTime then
        self.fadeTime = self.fadeTime + elapsed
        local t = Clamp(self.fadeTime / (self.wanted and .18 or .24), 0, 1)
        local eased = 1 - (1 - t) * (1 - t)
        self.frame:SetAlpha(self.fadeFrom + ((self.wanted and 1 or 0) - self.fadeFrom) * eased)
        if t == 1 then
            self.fadeTime = nil
            if not self.wanted then self.frame:Hide(); return end
        end
    end
    if not self.wanted then return end
    if StaticPortrait:Resolved() then self:ConfigurePortrait() end
    self:UpdateProgress()
    self:UpdateScrollbar()
    self.poll = (self.poll or 0) + elapsed
    if self.poll >= .2 then
        self.poll = 0
        self:UpdateControls()
    end
end

--- Where DialogueUI puts its own window, so a line that plays on after the dialog closes
--- stays where the dialog was. Without DialogueUI's place, left of centre.
function Skin:PlaceDefault()
    local frame = self.frame
    local x, top = Theme:WindowPlace()
    frame:ClearAllPoints()
    if x then
        -- In the frame's own units: its effective scale is UIParent's times its base scale,
        -- also while a host holds it (Addon:ApplyHost keeps the effective scale).
        local k = 1 / (frame.spokenBaseScale or 1)
        frame:SetPoint("TOP", UIParent, "BOTTOMLEFT", Round(x * k), Round(top * k))
    else
        frame:SetPoint("CENTER", UIParent, "CENTER", -Round(UIParent:GetWidth() / 4), 0)
    end
end

--- Caption lines the current clip's words take at `width`; nil while the captions hold
--- another clip's words, or none.
function Skin:TextLines(width)
    if not (self.clip and Transcript.clip == self.clip and Transcript.frame) then return nil end
    -- Wrapped at this width first: the captions reflow only when their width changes.
    if Transcript.frame:GetWidth() ~= width then
        Transcript:Dock(self.frame, self.content, "TOPLEFT", 0, 0, width, math.max(1, Transcript.frame:GetHeight()))
    end
    local count = Transcript.lines and #Transcript.lines or 0
    return count > 0 and count or nil
end

function Skin:RefreshConfig(original)
    self:Initialize()
    local frame = self.frame
    frame:SetFrameStrata(Config().FrameStrata)
    self:Layout()
    frame:SetScale(frame.spokenBaseScale)
    if not Addon:Layout().DialogueUI and not self.sizing then self:PlaceDefault() end
    if Addon:IsFrameLocked() then frame:StopMovingOrSizing() end
    Addon:ApplyHost(frame)
    self:Update()
end

function Skin:Update()
    if not self.frame then return end
    if not self:IsEnabled() then self:SetVisible(false, true); return end
    -- The line playing, or the sample a style tile previews (PlayerFrame:ShowSample).
    local clip = PlayerFrame:Current()
    if not clip then self:SetVisible(false); return end
    if clip ~= self.clip then
        self:HideTooltip()
        self.clip, self.seconds, self.offset = clip, 0, 0
    end
    -- The queue's length decides how much of the body the captions get, and the line's words
    -- how tall the panel is (Fit to the Words): a new line, or its words arriving late.
    local textLines = Transcript.clip == clip and Transcript.lines and #Transcript.lines or 0
    local key = Waiting() .. ":" .. textLines
    if key ~= self.laidOutFor then
        self.laidOutFor = key
        self:Layout()
    end
    self:SetVisible(true)
    self.name:SetText(clip.present and clip.present.header or "")
    Addon:ClipFont(self.name, clip)
    self:ConfigurePortrait()
    self:ConfigureActions()
    self:LayoutQueue()
    self:UpdateProgress()
    self:UpdateControls(true)
end

--- Shown only when the line runs past the page; its range is the page count.
function Skin:UpdateScrollbar()
    -- By line, so the thumb rides the captions' glide rather than jumping a page at a time.
    local top, maxTop = Transcript:GetScroll()
    if maxTop <= 1 then self.scrollbar:Hide(); return end
    -- The range and the thumb only when the page or the text changed; the value every frame.
    local lines, height = self.lines or 1, self.scrollbar:GetHeight() or 0
    local key = maxTop .. ":" .. lines .. ":" .. height
    if key ~= self.scrollKey then
        self.scrollKey = key
        self.scrollbar:SetMinMaxValues(1, maxTop)
        local thumb = self.scrollbar:GetThumbTexture()
        if thumb then thumb:SetHeight(math.max(24, height * lines / (lines + maxTop - 1))) end
    end
    if math.abs((self.scrollbar:GetValue() or 1) - top) > 0.001 then self.scrollbar:SetValue(top) end
    self.scrollbar:Show()
end

function Skin:Reset()
    if not self.frame then return end
    self.frame:StopMovingOrSizing()
    Addon:Layout().DialogueUI = nil
    Addon:Layout().DialogueUIHeight = nil
    Addon:Layout().DialogueUIWidth = nil
    -- Back where DialogueUI puts its window (RefreshConfig, with no saved place).
    self:RefreshConfig(PlayerFrame)
end

function Skin:Describe()
    if not self.frame then return "dialogueui skin: no frame built" end
    return format("dialogueui skin: enabled=%s visible=%s theme=%d size=%.0fx%.0f lines=%d portrait=%s",
        tostring(self:IsEnabled()), tostring(self.frame:IsVisible()), Theme:Available() and Theme:ThemeID() or 0,
        self.frame:GetWidth() or 0, self.frame:GetHeight() or 0, self.lines or 0, tostring(self.viewport.active))
end
