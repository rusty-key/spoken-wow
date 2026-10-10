setfenv(1, SpokenEnv)

-- The "dialogueui" narrator style: the line playing drawn as a smaller twin of DialogueUI's quest
-- window in its own art. DialogueUI's art, window size and colours come through DialogueUITheme.lua.
--
-- Parsed by the 1.12 client too (addon.xml is shared), so Lua 5.0 syntax throughout; the
-- stub below is all that client runs.

DialogueUIPlayer = {}

if Version.IsAnyLegacy then
    function DialogueUIPlayer:IsEnabled() return false end
    function DialogueUIPlayer:SetVisible() end
    function DialogueUIPlayer:HasClip() return false end
    function DialogueUIPlayer:Describe() return "dialogueui skin: not available on this client" end
    return
end

local Skin = DialogueUIPlayer
local Theme = DialogueUITheme
local PORTRAIT = 48
-- The panel's share of DialogueUI's window at the default Window Size, small enough to read
-- beside the next dialog. Taking over from the dialog, it starts at the dialog's whole size and
-- shrinks to this (Skin:Settle).
local BASE_SCALE = 0.65
-- Where it settles when the dialog closes: this far from the screen's top left, the paper's
-- edge rather than the frame's. And how long it takes to get there from the dialog.
local EDGE = 16
local SETTLE_TIME = 0.4
-- The paper's visible edge in Parchment.png, inside its transparent margin: the top cap's first
-- opaque row of its 256 and the first opaque column of the 1024 (Brown 122 and 130, Dark 126
-- and 125; the smaller of each, so the paper never runs off the screen).
local PAPER_TOP, PAPER_LEFT = 122 / 256, 125 / 1024
-- The bottom cap's light paper ends this share of its height over the window's foot: its rows to
-- 105 of 256 are light, the curled rim under them, and the cap is centred on the foot.
local PAPER_FOOT = 23 / 256
-- Showing and hiding, the paper first and the rest over it (Skin:SetLevel).
local FADE_IN, FADE_OUT = .28, .32
-- A new line on a window already showing: its words fade in over LINE_IN, and the window eases to
-- its new height, as the subtitle's do (Subtitle's PAGE_IN and SIZE_EASE).
local LINE_IN, SIZE_EASE = .28, 10
-- Every fade is of the window as one image (Skin:Buffer), and nothing in it may change while it is
-- one. Before it becomes one: still this long (a face or picture just set is drawn or loaded a
-- moment after), and, fading out, deaf to the pointer for ARM_FRAMES frames so a click's pressed
-- and lit states have settled. Never waiting longer than ARM_MOST.
local STILL, ARM_FRAMES, ARM_MOST = 0.1, 2, 0.5
-- What follows the title, "• (Stopped)" and the waiting count "• +N": this far after it, fading
-- over COUNT_IN, Stopped in and out as the line stops and plays, the count in as a line is added.
local COUNT_GAP, COUNT_IN = 6, .25
-- Between the round controls in the header, as the subtitle's (Subtitle:BuildControls).
local ROUND_GAP = 4
-- The words take this share of DialogueUI's column, centred in it: a narrower column than the
-- header's and the progress line's, read more easily.
local WORDS_SHARE = 0.9
-- A place's picture over its words, as Place Lore draws it (Spoken_Zones' TextView): 2:1, as
-- wide as the words, PICTURE_GAP above them, the page's grain through it.
local PICTURE_GAP, PICTURE_ALPHA = 10, 0.95
-- Where the header strip's line ends, of the strip's height: its art is clear under that (its
-- last dark row is 77 of the 96 in Parchment.png).
local DIVIDER_LINE = 0.8
local DEFAULT_WINDOW_SIZE = Defaults.profile.Frame.FrameScale
-- Text Size's default, at which the words are DialogueUI's own size.
local BASE_FONT_SIZE = 16
-- Smaller than DialogueUI's quest title, since the speaker's name shares the strip here.
local TITLE_SHARE = 0.85
-- DialogueUI's paddings at multiplier 1.
local PAD_H, PAD_TOP, PAD_BOTTOM = 26, 48, 36
-- Where in Parchment.png each strip is. The caps are 256 of 2048 rows each, the middle
-- the 640 between them; the dividers sit lower in the same image.
local CAP_ROWS, MIDDLE_ROWS = 0.125, 0.3125
local HEADER_DIVIDER = { 0, 0.65625, 0.56640625, 0.61328125, 358, 51 }
-- Where, of the strip's 358, the portrait socket at its left end gives way to the plain
-- line. The socket is drawn as is; only the line past it stretches with the panel.
local SOCKET_WIDTH = 64
-- Ctrl-wheel limits for Window Size and Text Size, matching their sliders' ranges.
local WINDOW_SIZES, WINDOW_STEP = { 0.5, 2 }, 0.05
local FONT_SIZES = { 12, 26 }

local parts = MinimalPlayer.parts
local Font, Label, Clamp, Waiting, BelongsTo = parts.Font, parts.Label, parts.Clamp, parts.Waiting, parts.BelongsTo
local function Round(n) return math.floor(n + 0.5) end
-- Through Addon:Profile: the frame still redraws during UI teardown, after AceDB strips
-- the profile.
local function Config() return Addon:Profile("Frame") end

function Skin:IsEnabled()
    return Addon.db and Addon:DisplayStyle() == "dialogueui"
end

function Skin:HideTooltip()
    if BelongsTo(GameTooltip:GetOwner(), self.frame) then GameTooltip_Hide() end
end

function Skin:HasClip()
    return self:IsEnabled() and self.wanted and SoundQueue:GetCurrentSound() ~= nil
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
    frame:SetScript("OnHide", function() self:HideTooltip() end)
    -- The captions take the wheel first and hand it here when Ctrl is held.
    frame:EnableMouseWheel(true)
    frame:SetScript("OnMouseWheel", function(_, delta) self:Wheel(delta) end)
    frame.spokenWheel = function(delta) return self:Wheel(delta) end
    frame:Hide()
    -- DialogueUI's window closing on a line that plays on: this one takes over from it. Told by a
    -- child of that window, as DialogueUIBridge's driver is: DialogueUI sets the window's own
    -- OnHide with SetScript, which drops a hook.
    local dialog = _G.DUIQuestFrame
    if dialog then
        self.dialog = dialog
        self.dialogWatch = CreateFrame("Frame", nil, dialog)
        self.dialogWatch:SetScript("OnHide", function() self:Settle(dialog) end)
        -- Opening, it shows the line itself: this window steps aside at once (Skin:Covered).
        self.dialogWatch:SetScript("OnShow", function() self:Update() end)
    end

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
    -- The words are docked here (Skin:Layout), and hand Ctrl-wheel to their parent.
    content.spokenWheel = frame.spokenWheel
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
    -- What kind of line it is, on a dark disc at the face's lower right, as the subtitle and the
    -- small window badge theirs (MinimalPlayer.BADGES).
    local chrome = CreateFrame("Frame", nil, host)
    chrome:SetAllPoints()
    chrome:SetFrameLevel(host:GetFrameLevel() + 8)
    self.badgeDisc = chrome:CreateTexture(nil, "BACKGROUND")
    self.badgeDisc:SetTexture([[Interface\AddOns\Spoken\Textures\MinimalPortraitMask]])
    self.badgeDisc:SetVertexColor(.04, .04, .035, 1)
    self.badge = chrome:CreateTexture(nil, "OVERLAY")
    self.name = Font(content, 18, 1, 1, 1)
    content.name = self.name -- Actions' header anchor contract.
    self.name:SetHeight(20)
    -- The line's name, nothing to click: Skip takes a line away, as on the subtitle.
    self.title = CreateFrame("Frame", nil, content)
    self.title.text = Font(self.title, 12, 1, 1, 1)
    self.title.text:SetPoint("TOPLEFT")
    self.title.text:SetPoint("BOTTOMRIGHT")
    -- Stopped and the lines waiting, after the title: each its own text, so each fades by itself.
    self.stopped = Font(self.title, 12, 1, 1, 1)
    self.stopped:SetText(format("• (%s)", L.SUBTITLE_STOPPED))
    self.stopped:Hide()
    self.stoppedAlpha = 0
    self.count = Font(self.title, 12, 1, 1, 1)
    self.count:Hide()

    self.picture = content:CreateTexture(nil, "ARTWORK")
    self.picture:SetAlpha(PICTURE_ALPHA)
    self.picture:Hide()
    -- Its frayed edge, where the client has mask textures.
    if content.CreateMaskTexture and self.picture.AddMaskTexture then
        self.pictureMask = content:CreateMaskTexture()
        self.pictureMask:SetAllPoints(self.picture)
        self.picture:AddMaskTexture(self.pictureMask)
    end

    -- The subtitle's progress line, along the foot of the words.
    self.progress = Actions.ProgressBar(content)
    -- The subtitle's controls (Subtitle:BuildControls) at the header's right end, beside the
    -- speaker and the line: Stop or Replay, Skip, then Report (Skin:ConfigureActions).
    self.controls = CreateFrame("Frame", nil, content)
    self.controls:SetHeight(1)
    local play = Actions.RoundButton(self.controls, 12)
    play:SetScript("OnClick", function()
        if not (self:HasClip() and SoundQueue:CanBePaused()) then return end
        SpokenLayout.Sound("U_CHAT_SCROLL_BUTTON")
        SoundQueue:TogglePauseQueue()
        self:UpdateControls()
    end)
    play:SetScript("OnEnter", function()
        play.glyph:SetAlpha(1)
        GameTooltip:SetOwner(play, "ANCHOR_TOP")
        GameTooltip:SetText(SoundQueue:IsPaused() and L.REPLAY or L.STOP)
        GameTooltip:Show()
    end)
    self.play, self.skip = play, Actions.SkipButton(self.controls)
    self.buttons = { self.play, self.skip }
    Actions:Build(frame)

    -- No scrollbar: the captions scroll themselves on the wheel.
end

--- DialogueUI's own window open over this one, which then stays hidden: the dialog shows the line.
--- Not while this one sits on the dialog (Show Spoken Over DialogueUI).
function Skin:Covered()
    local dialog = self.dialog
    return dialog ~= nil and dialog:IsShown() and self.frame:GetParent() ~= dialog
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
    self:Touch()
    local frame, cfg = self.frame, Theme:Config()
    local parchment = Theme:TexturePath() .. "Parchment.png"
    -- Laid out at DialogueUI's own size, paddings and text; Window Size then scales the
    -- whole frame from BASE_SCALE.
    local scale = BASE_SCALE * (Config().FrameScale or DEFAULT_WINDOW_SIZE) / DEFAULT_WINDOW_SIZE
    frame.spokenBaseScale = scale * Theme:FrameScale() / UIParent:GetEffectiveScale()
    local duiWidth, duiHeight = Theme:FrameSize()
    -- The multiplier DialogueUI drew its window at, so the paddings keep its proportions.
    local multiplier = duiHeight / (Theme.HEIGHT_SHARE * math.max(1, UIParent:GetHeight()))
    local padH, padTop, padBottom = PAD_H * multiplier, PAD_TOP * multiplier, PAD_BOTTOM * multiplier
    local width = Round(duiWidth)
    local inner = math.max(1, width - 2 * padH)
    local wordsWidth = math.max(1, Round(inner * WORDS_SHARE))
    local wordsLeft = Round((inner - wordsWidth) / 2)
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
    local ratio = inner / HEADER_DIVIDER[5]
    local stripHeight = Round(HEADER_DIVIDER[6] * ratio)
    local face = Round(34 * ratio)
    -- DialogueUI's gap under its header line, before the text.
    local textGap = Round(4 * 0.35 * fontSize)
    local headerHeight = stripHeight + textGap
    -- A place's picture (Spoken Zones gives one with its line) between the header and the words,
    -- as wide as they are.
    local picture = self.clip and self.clip.present and self.clip.present.picture
    local pictureWidth = picture and wordsWidth or 0
    local pictureHeight = Round(pictureWidth / 2)
    -- With a picture, one gap over it and under it: from the divider's line to the picture, and
    -- from the picture to the words. Halfway between the header's gap under the line and the
    -- picture's own.
    local lineBottom = Round(stripHeight * DIVIDER_LINE)
    local pictureGap = Round((stripHeight - lineBottom + textGap + PICTURE_GAP) / 2)
    local pictureTop = lineBottom + pictureGap
    local wordsTop = picture and pictureTop + pictureHeight + pictureGap or headerHeight
    -- The same gap above the progress line, so the words sit as far from the foot as from the
    -- head. The last line's own spacing counts towards it.
    -- Show Progress, as the subtitle has it: off, the bar goes and the window closes up under the words.
    local progress = Addon:Profile("Transcript").SubtitleProgress ~= false
    self.progress.track:SetShown(progress)
    local footerHeight = (progress and self.progress.height + 6 or 0) + math.max(0, textGap - lineGap)
    -- A line's room over and under the words, which a line gliding out or in fades through: it is
    -- at nothing by the time it reaches the edge, so no line is ever seen cut there. It reaches
    -- over the gaps there (the header's or the picture's, the one over the progress line) and
    -- adds none: the words keep their place.
    -- Under the progress line, as far to where the paper's light ends as the last line is over it:
    -- the 6 and the header's gap over the line, and the line's own spacing under its letters.
    local barLift = 0
    if progress then
        local _, capHeight = Theme:ParchmentSize()
        local above = 6 + math.max(0, textGap - lineGap) + lineGap
        barLift = Round(above - (padBottom - capHeight * PAPER_FOOT))
        footerHeight = footerHeight + barLift
        self.progressGaps = { above = above, below = padBottom + barLift - capHeight * PAPER_FOOT }
    end
    -- Only the line playing, in Lines Shown of its words; the title counts the lines waiting.
    local lines = Addon:Profile("Transcript").Lines == 1 and 1 or 2
    -- Fit to the Words: no more lines than the words take.
    if cfg.FitText ~= false then
        local needed = self:TextLines(wordsWidth)
        if needed and needed < lines then lines = needed end
    end
    local captionHeight = lines * lineHeight
    local height = padTop + wordsTop + captionHeight + padBottom + footerHeight
    self.settledHeight = height
    -- A new line on a window already showing eases to its height (Skin:Tick).
    local easing = self.easeNext and not self.settling
    self.easeNext = nil
    self.heightWant = easing and height or nil
    frame:SetSize(width, (self.settling or easing) and frame:GetHeight() or height)
    self.lines = lines

    local capWidth, capHeight = Theme:ParchmentSize()
    for index = 1, 3 do self.parchments[index]:SetTexture(parchment) end
    self.parchments[1]:SetSize(capWidth, capHeight)
    self.parchments[3]:SetSize(capWidth, capHeight)

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
    local badgeAt = Round(face * 0.36)
    self.badgeDisc:SetSize(Round(face * 0.42), Round(face * 0.42))
    self.badge:SetSize(Round(face * 0.3), Round(face * 0.3))
    for _, part in ipairs({ self.badgeDisc, self.badge }) do
        part:ClearAllPoints()
        part:SetPoint("CENTER", self.portrait, "CENTER", badgeAt, -badgeAt)
    end
    -- The line's title sits where DialogueUI puts its quest title, the speaker's name in its
    -- small line above.
    self.title:ClearAllPoints()
    self.title:SetPoint("LEFT", self.headerSocket, "LEFT", Round(53 * ratio), Round(2 * ratio))
    self.title:SetPoint("RIGHT", self.controls, "LEFT", -6, 0)
    self.title:SetHeight(Round(fonts.titleSize * TITLE_SHARE) + 4)
    self.name:ClearAllPoints()
    self.name:SetPoint("BOTTOMLEFT", self.title, "TOPLEFT", 0, 2)
    self.name:SetPoint("RIGHT", self.controls, "LEFT", -6, 0)
    self.name:SetHeight(fonts.subtitleSize + 2)
    -- Centred on the speaker's name and the line's title together: the title sits on the
    -- socket's middle, 2 up, and the name above it.
    local nameHeight = fonts.subtitleSize + 2
    local middle = stripHeight / 2 - Round(2 * ratio) - (2 + nameHeight) / 2
    -- The round buttons as large on screen as Place Lore draws them (24, at UIParent's scale) at
    -- the default Window Size, growing and shrinking with it from there. Its anchor's offset is
    -- in its own scale.
    self.controlsRound = (Config().FrameScale or DEFAULT_WINDOW_SIZE) / DEFAULT_WINDOW_SIZE / frame.spokenBaseScale
    self.controlsMiddle = middle
    self:FitControls()

    -- The words in their narrower column, the picture over them.
    self.picture:SetShown(picture ~= nil)
    if picture then
        self.picture:SetTexture(picture.file)
        if self.pictureMask then
            self.pictureMask:SetTexture(picture.mask or [[Interface\Buttons\WHITE8X8]], "CLAMPTOBLACKADDITIVE",
                "CLAMPTOBLACKADDITIVE")
        end
        self.picture:SetSize(pictureWidth, pictureHeight)
        self.picture:ClearAllPoints()
        self.picture:SetPoint("TOP", content, "TOPLEFT", Round(inner / 2), -pictureTop)
    end
    -- The captions span that room too; the lines fade through it (Transcript:Place).
    self.lineRoom = lineHeight
    Transcript:Dock(content, content, "TOPLEFT", wordsLeft, -(wordsTop - lineHeight), wordsWidth,
        captionHeight + 2 * lineHeight)

    -- The progress line as wide as the words and the picture over it.
    self.progress.track:ClearAllPoints()
    self.progress.track:SetPoint("BOTTOMLEFT", content, "BOTTOMLEFT", wordsLeft, barLift)
    self.progress.track:SetWidth(wordsWidth)

    self:Dress()
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
    Paint(self.count, fonts.title, Round(fonts.titleSize * TITLE_SHARE), colors.disabled)
    Paint(self.stopped, fonts.title, Round(fonts.titleSize * TITLE_SHARE), colors.disabled)
    self.title.color = colors.title
    self.colors = colors
    local tint = colors.portraitTint
    if self.viewport.texture then self.viewport.texture:SetVertexColor(tint[1], tint[2], tint[3]) end
    local captionSize = self.captionSize or body
    Transcript:SetStyle({ font = fonts.paragraph, size = captionSize, lineGap = self.lineGap or Round(0.35 * captionSize),
        paragraphs = true, color = colors.paragraph, shadow = false,
        highlight = colors.highlight, lines = self.lines, padTop = self.lineRoom })
end

function Skin:ConfigurePortrait()
    -- A face set or redrawn: it is drawn a moment after.
    self:Touch()
    -- Always the face: the header strip has its socket, which would stand empty without it.
    self.portrait:Show()
    if not StaticPortrait:Configure(self.viewport, self.clip) then Portrait:Configure(self.viewport, self.clip) end
    local viewport = self.viewport
    if viewport.active == "texture" and viewport.texture then StaticPortrait:Mask(viewport, viewport.texture) end
    local tint = self.colors and self.colors.portraitTint
    if tint and viewport.texture then viewport.texture:SetVertexColor(tint[1], tint[2], tint[3]) end
    local id = self.clip and self.clip.present and self.clip.present.bullet
    local badge = MinimalPlayer.BADGES[id] or (Bullets and Bullets[id] and Bullets[id].texture)
    self.badge:SetTexture(badge)
    self.badge:SetShown(badge ~= nil)
    self.badgeDisc:SetShown(badge ~= nil)
end

function Skin:ConfigureActions()
    Actions:Configure(self.frame, self.clip)
    local row = { self.play, self.skip }
    for _, button in ipairs(self.frame.actions.buttons) do
        if button.action.anchor == "header" then
            button:Hide()
        else
            -- Report and anything else a line offers, after Skip and as strong as it, as the
            -- subtitle shows them.
            button:SetParent(self.controls)
            button:SetFrameLevel(self.controls:GetFrameLevel() + 1)
            if button.showsIcon then button:SetSize(self.play:GetWidth(), self.play:GetHeight()) end
            button:SetAlpha(1)
            if button:IsShown() then table.insert(row, button) end
        end
    end
    self.row = row
    self:LayoutControls()
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

function Skin:LayoutControls()
    local x, tallest = 0, 1
    for _, button in ipairs(self.row or self.buttons) do
        button:ClearAllPoints()
        button:SetPoint("LEFT", self.controls, "LEFT", x, 0)
        x = x + button:GetWidth() + ROUND_GAP
        tallest = math.max(tallest, button:GetHeight())
    end
    self.controls:SetSize(math.max(1, x - ROUND_GAP), tallest)
end

--- `relayout` when the row's buttons may have changed (Update); otherwise the row is laid out
--- again only when the play button's label does.
function Skin:UpdateControls(relayout)
    if not self.clip then return end
    local paused = SoundQueue:IsPaused()
    Actions.SetPlayGlyph(self.play, Actions.HeadState())
    -- The line's name alone, as the subtitle shows it: not why it waits (the NPC's own greeting
    -- first, a fight).
    self.title.text:SetText(Label(self.clip))
    -- Stopped, said after its name, as the subtitle does.
    if paused ~= (self.shownStopped or false) then self.shownStopped = paused end
    self:Count(Waiting())
    local pausable = SoundQueue:CanBePaused()
    for _, button in ipairs(self.buttons) do
        button:SetAlpha(pausable and 1 or .4)
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
    Actions.SetProgress(self.progress, duration > 0 and (self.seconds or 0) / duration or 0)
end

--- How much of the window shows, 0 to 1: as one image, its alpha (Skin:Buffer). Where the client
--- has no frame buffers, the paper takes the lower half and everything on it the upper, so the two
--- never fade at once and the paper never shows through the strips and words.
function Skin:SetLevel(level)
    self.level = level
    if self.buffered then
        self.frame:SetAlpha(level)
        self.content:SetAlpha(1)
        return
    end
    self.frame:SetAlpha(Clamp(level * 2, 0, 1))
    self:PaintContent()
end

-- The window's direct parts, which ignore its alpha while it is one image.
local function Parts(self)
    return { self.content, self.parchments[1], self.parchments[2], self.parchments[3] }
end

-- What the pointer lights, presses or scrolls in the window: a button pressed or lit changes its
-- textures, which must not happen while it is one image.
local function Clickables(self)
    local list = { self.frame, self.play, self.skip, Transcript.frame }
    for _, button in ipairs(self.row or {}) do table.insert(list, button) end
    return list
end

-- A texture in the window still loading, which it must not be while it becomes one image.
local function Loading(texture)
    return texture ~= nil and texture.IsObjectLoaded ~= nil and texture:IsShown() and not texture:IsObjectLoaded()
end

--- Something in the window changed: it waits to be still again before it becomes one image.
function Skin:Touch()
    self.stillFor = 0
end

--- Nothing in the window may change: it is one image. The portrait cache asks before it paints a
--- face anew (StaticPortrait:Capture).
function Skin:Frozen()
    return self.buffered and true or false
end

--- Still a while, and nothing in it loading: it may become one image.
function Skin:Still()
    if (self.stillFor or STILL) < STILL then return false end
    local viewport = self.viewport
    return not (Loading(self.picture) or Loading(self.badge)
        or Loading(viewport and viewport.activeFrame) or Loading(viewport and viewport.texture))
end

--- Deaf to the pointer, so nothing in the window lights or presses: before it becomes one image,
--- and while it is.
function Skin:Deafen()
    if self.deafened then return end
    self.deafened = {}
    for _, part in ipairs(Clickables(self)) do
        local entry = { part = part }
        if part.IsMouseEnabled and part:IsMouseEnabled() then entry.mouse = true; part:EnableMouse(false) end
        if part.IsMouseWheelEnabled and part:IsMouseWheelEnabled() then entry.wheel = true; part:EnableMouseWheel(false) end
        table.insert(self.deafened, entry)
    end
end

function Skin:Undeafen()
    if not self.deafened then return end
    for _, entry in ipairs(self.deafened) do
        if entry.mouse then entry.part:EnableMouse(true) end
        if entry.wheel then entry.part:EnableMouseWheel(true) end
    end
    self.deafened = nil
    -- Locked, clicks still pass through (Skin:RefreshConfig).
    local frame = self.frame
    if frame.SetMouseClickEnabled and frame.SetMouseMotionEnabled then
        frame:SetMouseMotionEnabled(true)
        frame:SetMouseClickEnabled(not Addon:IsFrameLocked())
    end
end

--- Switch the window into or out of being one image while it is hidden: switched while on screen
--- and faded (fading in from nothing), the client crashed at once (ASSERT(flattenedBatch !=
--- nullptr)), as Place Lore's panel did; made one while hidden, as at its creation, it never did.
--- Hidden and shown again in the one frame, so nothing flickers, and its buttons' lit and pressed
--- states are reset by it.
local function SwitchHidden(frame, on)
    local shown = frame:IsShown()
    if shown then frame:Hide() end
    local ok = pcall(frame.SetIsFrameBuffer, frame, on)
    if shown then frame:Show() end
    return ok
end

--- The window drawn as one image (a frame buffer, as the world map is) and faded as one, its parts
--- ignoring its alpha so only the finished image fades. Every crash came of something in it
--- changing while it was one (the title's remove cross loading, the captions clearing at a line's
--- end, Skip going from pressed to normal: CSimpleRender.cpp's texture asserts, ASSERT(!m_deleted),
--- ASSERT(flattenedBatch != nullptr)), so while it is: deaf to the pointer, the captions held, its
--- own updates waiting (Skin:Tick, Skin:Update), the portrait cache not painting its face. False
--- where the client has no frame buffers.
function Skin:Buffer()
    local frame = self.frame
    if self.buffered then return true end
    if not frame.SetIsFrameBuffer then return false end
    -- Its own small animations finished first.
    self.lineFade, self.countFade = nil, nil
    if self.count then
        self.stoppedAlpha = self.shownStopped and 1 or 0
        self:Count(self.counted or 0)
    end
    if self.heightWant then frame:SetHeight(self.heightWant); self.heightWant = nil end
    self:Deafen()
    if not SwitchHidden(frame, true) then
        self:Undeafen()
        return false
    end
    self.buffered = true
    frame.spokenFrozen = true
    Transcript:Hold()
    for _, part in ipairs(Parts(self)) do
        if part.SetIgnoreParentAlpha then part:SetIgnoreParentAlpha(true) end
    end
    self:SetLevel(self.level or 0)
    return true
end

--- Itself again, and catching up on what waited: the captions, and an update or a refresh.
function Skin:Unbuffer()
    if not self.buffered then return end
    self.buffered = nil
    for _, part in ipairs(Parts(self)) do
        if part.SetIgnoreParentAlpha then part:SetIgnoreParentAlpha(false) end
    end
    SwitchHidden(self.frame, false)
    self:Undeafen()
    self:SetLevel(self.level or 0)
    -- Moved onto or off DialogueUI's window meanwhile (Addon:ApplyHost): now.
    self.frame.spokenFrozen = nil
    if self.frame.spokenHostPending then
        self.frame.spokenHostPending = nil
        Addon:ApplyHost(self.frame)
    end
    Transcript:Release()
    local pending = self.pending
    self.pending = nil
    if pending == "refresh" then self:RefreshConfig()
    elseif pending == "update" then self:Update() end
end

--- What is on the paper: its share of the window's fade, times a new line's own fade-in.
function Skin:PaintContent()
    local line = self.lineFade and Clamp(self.lineFade / LINE_IN, 0, 1) or 1
    self.content:SetAlpha(Clamp((self.level or 0) * 2 - 1, 0, 1) * (1 - (1 - line) * (1 - line)))
end

function Skin:SetVisible(visible, immediate)
    if not self.frame then return end
    if not visible then self:HideTooltip() end
    if immediate then
        self.wanted, self.preparing, self.arming, self.fadeTime, self.pending = false, nil, nil, nil, nil
        self.frame:Hide()
        self:Unbuffer()
        self:Undeafen()
        Transcript:Release()
        self:SetLevel(0)
        return
    end
    if self.wanted == visible then return end
    self.wanted = visible
    if visible then
        self.arming = nil
        if self.buffered or (self.frame:IsShown() and (self.level or 0) > 0) then
            -- Fading out, or still on screen: back up from where it is, as it is.
            if not self.buffered then self:Undeafen(); Transcript:Release() end
            self.fadeFrom, self.fadeTime = self.level or 0, 0
            return
        end
        -- From nothing: laid out unseen, then once it is still, faded in as one image (Skin:Tick).
        self:SetLevel(0)
        self.frame:Show()
        self.preparing, self.fadeTime = true, nil
        return
    end
    if self.preparing or not self.frame:IsShown() or (self.level or 0) <= 0 then
        -- Never seen: gone at once.
        self.preparing, self.fadeTime = nil, nil
        self.frame:Hide()
        self:SetLevel(0)
        return
    end
    if self.buffered then
        -- Fading in as one image: back out the same way.
        self.fadeFrom, self.fadeTime = self.level or 0, 0
        return
    end
    -- On screen: deaf to the pointer first, so a click's pressed and lit states settle, then one
    -- image once it is still (Skin:Tick). Its words held from now, so they fade out with it.
    self:Deafen()
    Transcript:Hold()
    self.arming, self.fadeTime = { waited = 0, frames = 0 }, nil
end

--- Start the fade, as one image where the client can draw one.
function Skin:StartFade()
    self:Buffer()
    self.fadeFrom, self.fadeTime = self.level or 0, 0
end

--- After the title, as the subtitle has them: "• (Stopped)" while the line is stopped, and the
--- lines waiting behind it, "• +N". One more fades the count in; Stopped fades in and out, and
--- keeps its room until it has faded. The title is cut short, not these.
function Skin:Count(waiting)
    local count, stopped = self.count, self.stopped
    if waiting ~= self.counted then
        if waiting > (self.counted or 0) then self.countFade = 0 end
        self.counted = waiting
        count:SetText(waiting > 0 and "• +" .. waiting or "")
    end
    local tail = {}
    local stoppedShown = self.shownStopped or self.stoppedAlpha > 0
    stopped:SetShown(stoppedShown)
    if stoppedShown then table.insert(tail, stopped) end
    count:SetShown(waiting > 0)
    if waiting > 0 then table.insert(tail, count) end
    local room = 0
    for _, part in ipairs(tail) do room = room + (part:GetStringWidth() or 0) + COUNT_GAP end
    local text = self.title.text
    text:ClearAllPoints()
    text:SetPoint("TOPLEFT")
    text:SetPoint("BOTTOMRIGHT", -room, 0)
    if #tail == 0 then return end
    local x = math.min(text:GetStringWidth() or 0, math.max(0, (self.title:GetWidth() or 0) - room))
    for _, part in ipairs(tail) do
        part:ClearAllPoints()
        part:SetPoint("LEFT", text, "LEFT", x + COUNT_GAP, 0)
        x = x + COUNT_GAP + (part:GetStringWidth() or 0)
    end
    self:PaintCount()
end

local function EaseOut(t) return 1 - (1 - t) * (1 - t) end

function Skin:PaintCount()
    self.count:SetAlpha(EaseOut(self.countFade and Clamp(self.countFade / COUNT_IN, 0, 1) or 1))
    self.stopped:SetAlpha(EaseOut(self.stoppedAlpha))
end

function Skin:Tick(elapsed)
    if self.settling then self:SettleStep(elapsed) end
    self.stillFor = (self.stillFor or 0) + elapsed
    -- Waiting to be still before it becomes one image: in, laid out unseen; out, deaf to the pointer.
    if self.preparing and self:Still() then
        self.preparing = nil
        self:StartFade()
    end
    local arming = self.arming
    if arming then
        arming.frames, arming.waited = arming.frames + 1, arming.waited + elapsed
        if (arming.frames >= ARM_FRAMES and self:Still()) or arming.waited >= ARM_MOST then
            self.arming = nil
            self:StartFade()
        end
    end
    if self.countFade then
        self.countFade = self.countFade + elapsed
        self:PaintCount()
        if self.countFade >= COUNT_IN then self.countFade = nil end
    end
    local stoppedWant = self.shownStopped and 1 or 0
    if self.stopped and self.stoppedAlpha ~= stoppedWant then
        local step = elapsed / COUNT_IN
        self.stoppedAlpha = stoppedWant > self.stoppedAlpha and math.min(1, self.stoppedAlpha + step)
            or math.max(0, self.stoppedAlpha - step)
        self:PaintCount()
        -- Faded out: its room given back.
        if self.stoppedAlpha == 0 then self:Count(self.counted or 0) end
    end
    if self.lineFade then
        self.lineFade = self.lineFade + elapsed
        if self.lineFade >= LINE_IN then self.lineFade = nil end
        self:PaintContent()
    end
    local want = self.heightWant
    if want then
        local height = self.frame:GetHeight()
        height = height + (want - height) * math.min(1, elapsed * SIZE_EASE)
        if math.abs(want - height) < .5 then height, self.heightWant = want, nil end
        self.frame:SetHeight(height)
    end
    if self.fadeTime then
        self.fadeTime = self.fadeTime + elapsed
        local t = Clamp(self.fadeTime / (self.wanted and FADE_IN or FADE_OUT), 0, 1)
        local eased = t * t * (3 - 2 * t)
        self:SetLevel(self.fadeFrom + ((self.wanted and 1 or 0) - self.fadeFrom) * eased)
        if t == 1 then
            self.fadeTime = nil
            if not self.wanted then
                self.frame:Hide()
                self:Undeafen()
                -- Held from the start of the fade-out, frame buffer or not (Skin:SetVisible).
                Transcript:Release()
            end
            -- Faded: itself again, catching up on what waited.
            self:Unbuffer()
            if not self.wanted then return end
        end
    end
    -- Nothing in it changes while it is one image, nor while it waits to be one.
    if not self.wanted or self.buffered or self.preparing or self.arming then return end
    if StaticPortrait:Resolved() then self:ConfigurePortrait() end
    self:UpdateProgress()
    self.poll = (self.poll or 0) + elapsed
    if self.poll >= .2 then
        self.poll = 0
        self:UpdateControls()
    end
end

--- How far the paper's visible edge reaches past the frame's left and top, in the frame's units:
--- its caps are centred on the frame's ends and wider than it, inside a transparent margin.
function Skin:PaperOverhang()
    local cap = self.parchments and self.parchments[1]
    local paperWidth, capHeight = cap and cap:GetWidth() or 0, cap and cap:GetHeight() or 0
    return math.max(0, (paperWidth - self.frame:GetWidth()) / 2 - PAPER_LEFT * paperWidth),
        math.max(0, capHeight * (0.5 - PAPER_TOP))
end

--- The screen's top left, EDGE from the paper: where the window settles when DialogueUI's
--- window closes on a line that plays on (Skin:Settle), out of the way of the next dialog.
function Skin:PlaceDefault()
    local frame = self.frame
    -- In the frame's own units: its effective scale is UIParent's times its base scale.
    local k = 1 / (frame.spokenBaseScale or 1)
    local left, top = self:PaperOverhang()
    frame:ClearAllPoints()
    frame:SetPoint("TOPLEFT", UIParent, "TOPLEFT", Round(EDGE * k + left), -Round(EDGE * k + top))
end

--- Where the window rests, its top left in the screen's pixels: where it was dragged to, or the
--- screen's top left (PlaceDefault). Worked out rather than read off the frame, which has no
--- place on screen while DialogueUI hides the interface.
function Skin:Home()
    local frame = self.frame
    local ui = UIParent:GetEffectiveScale()
    local scale = ui * (frame.spokenBaseScale or 1)
    local saved = Addon:Layout().DialogueUI
    if type(saved) == "table" and saved.left and saved.top then
        return saved.left * scale, saved.top * scale
    end
    local left, top = self:PaperOverhang()
    return EDGE * ui + left * scale, UIParent:GetHeight() * ui - EDGE * ui - top * scale
end

--- DialogueUI's window closed while its line plays on: this window takes the dialog's place, size
--- and height, then shrinks to its own size and height as it moves to where it rests, DialogueUI's
--- opening in reverse. Not while it sits on the dialog (Show Spoken Over DialogueUI): it is in
--- place already. Should anything fail, it is simply put where it rests.
function Skin:Settle(dialog)
    local frame = self.frame
    if not (self:IsEnabled() and PlayerFrame:Current()) or frame:GetParent() ~= UIParent then return end
    -- Fading as one image: it finishes, then shows the line as it does any (Skin:Unbuffer).
    if self.buffered then self.pending = self.pending or "update"; return end
    self.arming, self.preparing = nil, nil
    self:Undeafen()
    local ok, err = pcall(self.StartSettle, self, dialog)
    if not ok then
        self.settling = nil
        frame:SetScale(frame.spokenBaseScale or 1)
        if not Addon:RestoreLayout("DialogueUI", frame) then self:PlaceDefault() end
        self:Layout()
        if geterrorhandler then geterrorhandler()(err) end
    end
end

function Skin:StartSettle(dialog)
    local frame = self.frame
    self:Update()
    local ui = UIParent:GetEffectiveScale()
    -- The dialog's top left, width and height in the screen's pixels, from where DialogueUI puts
    -- it: it has no place on screen to read while it hides the interface.
    local x, top = Theme:WindowPlace()
    local width, height = Theme:FrameSize()
    local k = dialog:GetEffectiveScale()
    if not (x and top and frame:GetWidth() > 0) then error("DialogueUI's window has no place") end
    -- Its own scale, and the one at which it is drawn as wide as the dialog.
    local to = frame.spokenBaseScale or 1
    local from = width * k / (frame:GetWidth() * ui)
    local toLeft, toTop = self:Home()
    self.settling = { time = 0, from = from, to = to,
        left = x * ui - width * k / 2, top = top * ui, height = height * k, toLeft = toLeft, toTop = toTop }
    -- In full at once, where the dialog was: no fade.
    self.wanted, self.fadeTime = true, nil
    self:SetLevel(1)
    frame:Show()
    self:SettleStep(0)
end

--- The header's round buttons as large on screen as they settle at: while the window slides out
--- of the dialog at a larger scale, against that scale, whichever of the slide and a layout set
--- them last in a frame.
function Skin:FitControls()
    if not self.controlsRound then return end
    local settling = self.settling
    local now = self.frame:GetScale() or 1
    self:ScaleControls(self.controlsRound * (settling and now > 0 and settling.to / now or 1))
end

--- The header's round buttons at `scale` of the window's, their anchor's offset in their own.
function Skin:ScaleControls(scale)
    self.controls:SetScale(scale)
    self.controls:ClearAllPoints()
    self.controls:SetPoint("RIGHT", self.content, "TOPRIGHT", 0, -(self.controlsMiddle or 0) / scale)
end

function Skin:SettleStep(elapsed)
    local settling, frame = self.settling, self.frame
    settling.time = settling.time + elapsed
    local t = Clamp(settling.time / SETTLE_TIME, 0, 1)
    local eased = t * t * (3 - 2 * t)
    local function Toward(a, b) return a + (b - a) * eased end
    local ui = UIParent:GetEffectiveScale()
    local scale = Toward(settling.from, settling.to)
    frame:SetScale(scale)
    -- The round buttons stay as large on screen as they settle at, as the dialog's own are, rather
    -- than starting at the dialog's larger scale with the rest.
    self:FitControls()
    local pixels = ui * scale
    local toHeight = (self.settledHeight or frame:GetHeight()) * ui * settling.to
    frame:ClearAllPoints()
    frame:SetPoint("TOPLEFT", UIParent, "BOTTOMLEFT", Toward(settling.left, settling.toLeft) / pixels,
        Toward(settling.top, settling.toTop) / pixels)
    frame:SetHeight(Toward(settling.height, toHeight) / pixels)
    if t == 1 then
        self.settling = nil
        frame:SetScale(settling.to)
        if not Addon:RestoreLayout("DialogueUI", frame) then self:PlaceDefault() end
        self:Layout()
    end
end

--- Caption lines the current clip's words take at `width`; nil while the captions hold
--- another clip's words, or none.
function Skin:TextLines(width)
    if not (self.clip and Transcript.clip == self.clip and Transcript.frame) then return nil end
    -- Wrapped at this width first: the captions reflow only when their width changes.
    if Transcript.frame:GetWidth() ~= width then
        Transcript:Dock(self.content, self.content, "TOPLEFT", 0, 0, width, math.max(1, Transcript.frame:GetHeight()))
    end
    local count = Transcript.lines and #Transcript.lines or 0
    return count > 0 and count or nil
end

function Skin:RefreshConfig(original)
    self:Initialize()
    -- One image fading: nothing in it may change; this waits for it (Skin:Unbuffer).
    if self.buffered then self.pending = "refresh"; return end
    local frame = self.frame
    frame:SetFrameStrata(Config().FrameStrata)
    self:Layout()
    frame:SetScale(frame.spokenBaseScale)
    if not Addon:Layout().DialogueUI then self:PlaceDefault() end
    if Addon:IsFrameLocked() then frame:StopMovingOrSizing() end
    -- Locked, clicks on the window pass through to the game, as the subtitle's and the small
    -- window's do; its buttons still take theirs. Where the client cannot tell a click from the
    -- pointer passing over, the window keeps both.
    if frame.SetMouseClickEnabled and frame.SetMouseMotionEnabled then
        frame:SetMouseMotionEnabled(true)
        frame:SetMouseClickEnabled(not Addon:IsFrameLocked())
    end
    Addon:ApplyHost(frame)
    self:Update()
end

function Skin:Update()
    if not self.frame then return end
    if not self:IsEnabled() then self:SetVisible(false, true); return end
    -- The line playing, or the sample a style tile previews (PlayerFrame:ShowSample).
    local clip = PlayerFrame:Current()
    -- Nothing to show: an image fading out goes on fading.
    if not clip then self:SetVisible(false); return end
    if self:Covered() then self:SetVisible(false, true); return end
    -- One image fading: nothing in it may change; this waits for it (Skin:Unbuffer).
    if self.buffered then self.pending = self.pending or "update"; return end
    self:Touch()
    if clip ~= self.clip then
        self:HideTooltip()
        -- Following another line on screen: its words fade in and the window eases to it.
        if self.clip and self.wanted and self.frame:IsShown() then
            self.easeNext, self.lineFade = true, 0
            self:PaintContent()
        end
        self.clip, self.seconds = clip, 0
    end
    -- The line's words decide how tall the panel is (Fit to the Words): a new line, or its words
    -- arriving late.
    local textLines = Transcript.clip == clip and Transcript.lines and #Transcript.lines or 0
    local picture = clip.present and clip.present.picture
    local key = textLines .. ":" .. (picture and picture.file .. ":" .. (picture.pixels or "") or "")
    if key ~= self.laidOutFor then
        self.laidOutFor = key
        self:Layout()
    end
    self:SetVisible(true)
    -- Said once: a name the same as the line's own is left off, as the subtitle leaves it.
    local header = clip.present and clip.present.header
    self.name:SetText(header ~= Label(clip) and header or "")
    self:ConfigurePortrait()
    self:ConfigureActions()
    self:UpdateProgress()
    self:UpdateControls(true)
end

function Skin:Reset()
    if not self.frame then return end
    self.frame:StopMovingOrSizing()
    Addon:Layout().DialogueUI = nil
    -- Back where DialogueUI puts its window (RefreshConfig, with no saved place).
    self:RefreshConfig(PlayerFrame)
end

function Skin:Describe()
    if not self.frame then return "dialogueui skin: no frame built" end
    return format("dialogueui skin: enabled=%s visible=%s theme=%d size=%.0fx%.0f lines=%d portrait=%s",
        tostring(self:IsEnabled()), tostring(self.frame:IsVisible()), Theme:Available() and Theme:ThemeID() or 0,
        self.frame:GetWidth() or 0, self.frame:GetHeight() or 0, self.lines or 0, tostring(self.viewport.active))
end
