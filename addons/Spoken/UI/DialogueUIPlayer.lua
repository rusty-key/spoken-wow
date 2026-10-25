setfenv(1, SpokenEnv)

-- The "dialogueui" narrator style: the line playing drawn as a smaller twin of DialogueUI's quest
-- window in its own art. DialogueUI's art, window size and colours come through DialogueUITheme.lua.
--
-- How it comes out of a closing dialog and how a dialog's page goes behind it are
-- DialogueUITransitions.lua's.

DialogueUIPlayer = {}

local Skin = DialogueUIPlayer
local Theme = DialogueUITheme
local PORTRAIT = 48
-- The panel's share of DialogueUI's window at the default Window Size, small enough to read
-- beside the next dialog.
local BASE_SCALE = 0.65
-- Where it settles when the dialog closes: this far from the screen's top left, the paper's
-- edge rather than the frame's.
local EDGE = 16
-- The art a line is drawn in, as DialogueUI draws it. Each file is 2048 rows: a top cap, a middle
-- that stretches and a bottom cap, the caps centred on the window's top and foot. The middle runs
-- on `under` rows under the bottom cap, which fades in over it. In the caps' 256 rows and the
-- file's 1024 columns, paperTop is the top cap's first opaque row, paperLeft the first opaque
-- column, and foot how far over the window's foot the bottom cap's light paper ends. The quest
-- parchment's paperTop and paperLeft are the smaller of its Brown and Dark themes', so the paper
-- never runs off the screen.
local BOOK_ART = "Interface/AddOns/DialogueUI/Art/Book/TextureKit-"
local LOOKS = {
    quest = { top = { 0, 256 }, middle = { 256, 896 }, bottom = { 896, 1152 }, under = 0,
        paperTop = 122, paperLeft = 125, foot = 23 },
    paper = { file = BOOK_ART .. "Parchment.png", top = { 0, 256 }, middle = { 256, 896 },
        bottom = { 1152, 1408 }, under = 40, paperTop = 128, paperLeft = 128, foot = 8, palette = 1, book = true },
    stone = { file = BOOK_ART .. "Metal.png", top = { 0, 256 }, middle = { 256, 896 },
        bottom = { 1152, 1408 }, under = 40, paperTop = 123, paperLeft = 112, foot = 12, palette = 2, book = true,
        shadow = true },
}
-- The book art's paper spans columns 128 to 896, and DialogueUI makes that the frame's width.
local BOOK_PAPER = 768 / 1024
-- DialogueUI's book view: TextureKit 2 (stone) for these materials, 1 (paper) for every other
-- (MaterialTextureKitID in DialogueUI 1.0.5's Code/Book/BookUI.lua).
local STONE = { Stone = true, Marble = true, Silver = true, Bronze = true, Progenitor = true }
-- In the book art: the line under its title, and the ring it draws round an item's icon, whose
-- opening is 56 of its 96 across, where the face sits.
local BOOK_DIVIDER = { 0, 768 / 1024, 1520 / 2048, 1552 / 2048 }
local BOOK_RING, RING_OPENING = { 768 / 1024, 864 / 1024, 1616 / 2048, 1712 / 2048 }, 56 / 96

--- A look's paper: a book's own art, or the quest parchment of DialogueUI's theme.
local function PaperOf(look)
    return look.file or Theme:TexturePath() .. "Parchment.png"
end

--- A look's cap size for a window `width` wide: a book's puts its paper on that width; the quest
--- parchment's is DialogueUI's, at `q` of it.
local function CapSize(look, width, q)
    if look.book then
        local capWidth = width / BOOK_PAPER
        return capWidth, capWidth * (look.top[2] - look.top[1]) / 1024
    end
    local capWidth, capHeight = Theme:ParchmentSize()
    return capWidth * (q or 1), capHeight * (q or 1)
end

--- The three strips in `look`'s art from `file`, the middle hung between the caps. The caller
--- places and sizes the caps.
local function DressStrips(strips, file, look, capHeight)
    for index = 1, 3 do strips[index]:SetTexture(file) end
    strips[1]:SetTexCoord(0, 1, look.top[1] / 2048, look.top[2] / 2048)
    strips[2]:SetTexCoord(0, 1, look.middle[1] / 2048, look.middle[2] / 2048)
    strips[3]:SetTexCoord(0, 1, look.bottom[1] / 2048, look.bottom[2] / 2048)
    strips[2]:ClearAllPoints()
    strips[2]:SetPoint("TOPLEFT", strips[1], "BOTTOMLEFT", 0, 0)
    strips[2]:SetPoint("BOTTOMRIGHT", strips[3], "TOPRIGHT", 0, -capHeight * look.under / 256)
end
-- Showing and hiding, the paper first and the rest over it (Skin:SetLevel).
local FADE_IN, FADE_OUT = .18, .2
-- A new line on a window already showing: its words fade in over LINE_IN, and the window eases to
-- its new height at SIZE_EASE.
local LINE_IN, SIZE_EASE = .28, 10
-- Every fade is of the window as one image, and nothing in it may change while it is one.
-- Before it becomes one: still this long (a face or picture just set is drawn or loaded a
-- moment after), and, fading out, deaf to the pointer for ARM_FRAMES frames so a click's pressed
-- and lit states have settled. Never waiting longer than ARM_MOST. Fading in, a texture that never
-- says it has loaded would keep it unseen: after PREPARE_MOST it fades in as itself, not one image,
-- so a late load cannot crash it.
local STILL, ARM_FRAMES, ARM_MOST, PREPARE_MOST = 0.1, 2, 0.5, 1
-- The gap between the round controls in the header, and the buttons' size, which is also the
-- least room between them and the title's end, so a long title cut short does not crowd them.
local ROUND_GAP, ROUND_SIZE = Actions.ROUND_GAP, Actions.ROUND_SIZE
-- The words take this share of DialogueUI's column, centred in it: a narrower column than the
-- header's and the progress line's, read more easily.
local WORDS_SHARE = 0.9
-- A place's picture over its words: 2:1, as wide as the words, PICTURE_GAP above them, the
-- page's grain through it.
local PICTURE_GAP, PICTURE_ALPHA = 10, 0.95
-- With no picture, the words start this share of their size under the divider's line: closer than
-- DialogueUI's own gap under its header strip, which on this smaller window looked adrift.
local WORDS_UNDER_LINE = 1.4
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
-- The quest parchment's header strip: its texture coordinates, then its size in pixels.
local HEADER_DIVIDER = { 0, 0.65625, 0.56640625, 0.61328125, 358, 51 }
-- Where, of the strip's 358, the portrait socket at its left end gives way to the plain
-- line. The socket is drawn as is; only the line past it stretches with the panel.
local SOCKET_WIDTH = 64

local Font, Label, Waiting, BelongsTo = Actions.Text, Actions.Label, Actions.Waiting, Actions.BelongsTo
local function Clamp(n, low, high) return math.max(low, math.min(high, n)) end
local function Round(n) return math.floor(n + 0.5) end
local function Smooth(t) return t * t * (3 - 2 * t) end
local function EaseOut(t) return 1 - (1 - t) * (1 - t) end
-- Through Addon:Profile: the frame still redraws during UI teardown, after AceDB strips
-- the profile.
local function Config() return Addon:Profile("Frame") end
-- What DialogueUITransitions.lua draws the dialog's page in, as this window draws its own.
Skin.art = { LOOKS = LOOKS, PaperOf = PaperOf, CapSize = CapSize, DressStrips = DressStrips }

--------------------------------------------------------------------------------
-- The header: DialogueUI's header strip, the speaker's face in its socket, and their name and
-- the line's title beside it.
--------------------------------------------------------------------------------

--- DialogueUI's window as this one copies it: its width, the column inside its paddings, and the
--- multiplier DialogueUI drew it at, which the paddings scale by.
local function Column()
    local duiWidth, duiHeight = Theme:FrameSize()
    local multiplier = duiHeight / (Theme.HEIGHT_SHARE * math.max(1, UIParent:GetHeight()))
    local width = Round(duiWidth)
    return width, math.max(1, width - 2 * PAD_H * multiplier), multiplier
end

--- The header strip across a column `inner` wide: its scale from the art's, and its height.
local function Strip(inner)
    local ratio = inner / HEADER_DIVIDER[5]
    return ratio, Round(HEADER_DIVIDER[6] * ratio)
end

--- The header's parts on `parent`, placed by PlaceHeader.
local function BuildHeader(parent)
    local head = {}
    -- The face and the title are placed on this, whatever the look.
    head.anchor = CreateFrame("Frame", nil, parent)
    -- In the quest parchment, DialogueUI's header strip in two pieces: the face's socket, never
    -- stretched, and the line past it, stretched to the column's width. In a book's, the ring
    -- round the face and the line under the title.
    head.socket = parent:CreateTexture(nil, "ARTWORK")
    head.divider = parent:CreateTexture(nil, "ARTWORK")
    local host = CreateFrame("Frame", nil, parent)
    head.portrait = host
    host:SetSize(PORTRAIT, PORTRAIT)
    head.viewport = CreateFrame("Frame", nil, host)
    head.viewport:SetAllPoints()
    head.viewport:SetClipsChildren(true)
    -- What kind of line it is, on a dark disc at the face's lower right.
    local chrome = CreateFrame("Frame", nil, host)
    chrome:SetAllPoints()
    chrome:SetFrameLevel(host:GetFrameLevel() + 8)
    head.badgeBackground = chrome:CreateTexture(nil, "BACKGROUND")
    head.badgeBackground:SetTexture([[Interface\AddOns\Spoken\Textures\MinimalPortraitMask]])
    head.badgeBackground:SetVertexColor(.04, .04, .035, 1)
    head.badge = chrome:CreateTexture(nil, "OVERLAY")
    head.name = Font(parent, 18, 1, 1, 1)
    -- The line's name, nothing to click.
    head.title = CreateFrame("Frame", nil, parent)
    head.title.text = Font(head.title, 12, 1, 1, 1)
    head.title.text:SetPoint("TOPLEFT")
    head.title.text:SetPoint("BOTTOMRIGHT")
    return head
end

--- Lays the header out across the top of `parent`, a column `inner` wide, in `look`'s art from
--- `paper`, with `fonts` at `k` of their size. The title and the name stop `clear` short of the
--- round controls, `right`.
--- Returns the strip's height, the controls' middle and where the strip's line ends, from its top.
local function PlaceHeader(head, parent, inner, look, paper, fonts, k, clear, right)
    local ratio, stripHeight = Strip(inner)
    local face = Round(34 * ratio)
    local socket = Round(SOCKET_WIDTH * ratio)
    local lineBottom = Round(stripHeight * DIVIDER_LINE)
    head.anchor:ClearAllPoints()
    head.anchor:SetPoint("TOPLEFT", parent, "TOPLEFT", 0, 0)
    head.anchor:SetSize(socket, stripHeight)
    head.portrait:SetSize(face, face)
    head.portrait:ClearAllPoints()
    head.portrait:SetPoint("CENTER", head.anchor, "TOPLEFT", Round(23 * ratio), -Round(23 * ratio))
    head.socket:SetTexture(paper)
    head.divider:SetTexture(paper)
    head.socket:ClearAllPoints()
    head.divider:ClearAllPoints()
    if look.book then
        -- The book's ring round the face, its opening the face's size, and its line under the
        -- title where the quest strip's line ends.
        local ring = Round(face / RING_OPENING)
        head.socket:SetTexCoord(BOOK_RING[1], BOOK_RING[2], BOOK_RING[3], BOOK_RING[4])
        head.socket:SetSize(ring, ring)
        head.socket:SetPoint("CENTER", head.portrait, "CENTER", 0, 0)
        local lineHeightArt = math.max(1, Round(inner * 32 / 768))
        head.divider:SetTexCoord(BOOK_DIVIDER[1], BOOK_DIVIDER[2], BOOK_DIVIDER[3], BOOK_DIVIDER[4])
        head.divider:SetSize(inner, lineHeightArt)
        head.divider:SetPoint("CENTER", parent, "TOP", 0, -(lineBottom - Round(lineHeightArt / 2)))
    else
        local socketU = HEADER_DIVIDER[1] + (HEADER_DIVIDER[2] - HEADER_DIVIDER[1]) * SOCKET_WIDTH / HEADER_DIVIDER[5]
        head.socket:SetTexCoord(HEADER_DIVIDER[1], socketU, HEADER_DIVIDER[3], HEADER_DIVIDER[4])
        head.socket:SetPoint("TOPLEFT", head.anchor, "TOPLEFT", 0, 0)
        head.socket:SetSize(socket, stripHeight)
        head.divider:SetTexCoord(socketU, HEADER_DIVIDER[2], HEADER_DIVIDER[3], HEADER_DIVIDER[4])
        head.divider:SetPoint("TOPLEFT", head.socket, "TOPRIGHT", 0, 0)
        head.divider:SetSize(math.max(1, inner - socket), stripHeight)
    end
    local badgeAt = Round(face * 0.36)
    head.badgeBackground:SetSize(Round(face * 0.42), Round(face * 0.42))
    head.badge:SetSize(Round(face * 0.3), Round(face * 0.3))
    for _, part in ipairs({ head.badgeBackground, head.badge }) do
        part:ClearAllPoints()
        part:SetPoint("CENTER", head.portrait, "CENTER", badgeAt, -badgeAt)
    end
    local nameHeight = fonts.subtitleSize * k + 2
    -- The controls centred on the speaker's name and the line's title together: the title sits on
    -- the socket's middle, 2 up, and the name above it.
    local middle = stripHeight / 2 - Round(2 * ratio) - (2 + nameHeight) / 2
    local function StopShort(text)
        text:SetPoint("RIGHT", right, "LEFT", -clear, 0)
    end
    -- The line's title sits where DialogueUI puts its quest title, the speaker's name in its
    -- small line above.
    head.title:ClearAllPoints()
    head.title:SetPoint("LEFT", head.anchor, "LEFT", Round(53 * ratio), Round(2 * ratio))
    StopShort(head.title)
    head.title:SetHeight(Round(fonts.titleSize * TITLE_SHARE * k) + 4)
    head.name:ClearAllPoints()
    head.name:SetPoint("BOTTOMLEFT", head.title, "TOPLEFT", 0, 2)
    StopShort(head.name)
    head.name:SetHeight(nameHeight)
    return stripHeight, middle, lineBottom
end

--- `text` in `face` at `size` and `color`, over a shadow `shadow` strong.
local function PaintText(text, face, size, color, shadow)
    local before, beforeSize = text:GetFont()
    text:SetFont(face, size, "")
    text:SetShadowColor(0, 0, 0, shadow)
    text:SetShadowOffset(1, -1)
    text:SetTextColor(color[1], color[2], color[3])
    -- The client can leave a string blank when its font changes under text it already has, and
    -- ignores the same text set again: a book's title after a quest's stayed empty. Emptied and
    -- set again, it is drawn.
    local shown = text:GetText()
    if (before ~= face or beforeSize ~= size) and shown and shown ~= "" then
        text:SetText("")
        text:SetText(shown)
    end
end

--- The name and the title in DialogueUI's subtitle and title fonts at `k` of their size, in
--- `colors`; on stone, over the book view's shadow under its pale text.
local function PaintHeader(head, look, fonts, colors, k)
    local shadow = look.shadow and 1 or 0
    PaintText(head.name, fonts.subtitle, fonts.subtitleSize * k, colors.title, shadow)
    PaintText(head.title.text, fonts.title, Round(fonts.titleSize * TITLE_SHARE * k), colors.title, shadow)
end

function Skin:IsEnabled()
    return Addon.db and Addon:DisplayStyle() == "dialogueui"
end

--- The art a line is drawn in: Spoken Readables' pages in the book view's paper, or its stone for
--- the materials DialogueUI draws in stone; every other line in the quest parchment.
local function LookOf(clip)
    local present = clip and clip.present
    if present and (present.material or present.bullet == "book") then
        return STONE[present.material or ""] and LOOKS.stone or LOOKS.paper
    end
    return LOOKS.quest
end
Skin.art.LookOf = LookOf

function Skin:Look()
    return LookOf(self.clip)
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
    -- Its round buttons stay round in EllesmereUI's look: this window keeps DialogueUI's.
    frame.spokenRound = true
    frame.spokenBaseScale = 1
    frame:SetSize(300, 400)
    -- RefreshConfig re-runs PlaceDefault until the player drags it.
    self:PlaceHome()
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
    frame.spokenEndFade = function() self:EndFade() end
    frame:SetScript("OnHide", function() self:HideTooltip(); Actions.DropWheel(frame) end)
    -- It takes the wheel only while Ctrl is held over it, unlocked (Skin:Tick), so the camera
    -- zooms otherwise. The captions take the wheel first and hand it here when Ctrl is held.
    frame:SetScript("OnMouseWheel", function(_, delta) self:Wheel(delta) end)
    frame.spokenWheel = function(delta) return self:Wheel(delta) end
    frame:Hide()
    self:WatchDialogs()

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
    -- Over the middle, which runs on under the book art's bottom cap.
    self.parchments[3]:SetDrawLayer("BACKGROUND", 0)

    local content = CreateFrame("Frame", nil, frame)
    self.content, frame.container = content, content
    -- The captions are docked here and hand Ctrl-wheel to their parent.
    content.spokenWheel = frame.spokenWheel

    local head = BuildHeader(content)
    self.head = head
    self.header, self.headerSocket, self.headerDivider = head.anchor, head.socket, head.divider
    self.portrait, frame.portrait, self.viewport = head.portrait, head.portrait, head.viewport
    self.badgeBackground, self.badge = head.badgeBackground, head.badge
    self.name, self.title = head.name, head.title
    content.name = self.name -- Actions' header anchor contract.
    -- Why the line waits, Stopped and the lines waiting, after the title: each its own text, so
    -- each fades by itself.
    self.stopped = Font(self.title, 12, 1, 1, 1)
    self.stopped:SetText(format("• (%s)", L.SUBTITLE_STOPPED))
    self.stopped:Hide()
    self.count = Font(self.title, 12, 1, 1, 1)
    self.count:Hide()
    self.held = Font(self.title, 12, 1, 1, 1)
    self.held:Hide()
    self.tail = Actions.Tail(self.stopped, self.count, self.held)

    self.picture = content:CreateTexture(nil, "ARTWORK")
    self.picture:SetAlpha(PICTURE_ALPHA)
    self.picture:Hide()
    -- Its frayed edge, where the client has mask textures.
    if content.CreateMaskTexture and self.picture.AddMaskTexture then
        self.pictureMask = content:CreateMaskTexture()
        self.pictureMask:SetAllPoints(self.picture)
        self.picture:AddMaskTexture(self.pictureMask)
    end

    self.progress = Actions.ProgressBar(content)
    self.controls = CreateFrame("Frame", nil, content)
    self.controls:SetHeight(1)
    local play = Actions.StopButton(self.controls, function() return self:HasClip() end,
        function() self:UpdateControls() end)
    self.play, self.skip = play, Actions.SkipButton(self.controls)
    self.buttons = { self.play, self.skip }
    Actions:Build(frame)

    -- No scrollbar: the captions scroll themselves on the wheel.
end

--- DialogueUI's own window open over this one, which then stays hidden: the dialog shows the line.
--- Not while this one sits on the dialog (Show Spoken Over DialogueUI).
function Skin:Covered()
    for _, dialog in ipairs(self.dialogs or {}) do
        if dialog:IsShown() and self.frame:GetParent() ~= dialog then return true end
    end
    return false
end

function Skin:StartDrag()
    if Addon:IsFrameLocked() then return end
    Snap.Start(self.frame, {
        locked = function() return Addon:IsFrameLocked() end,
        -- Where it rests until it is dragged: it holds there as it holds on the screen's lines.
        home = function()
            local left, top = self:Home()
            local ui = UIParent:GetEffectiveScale()
            return left / ui, top / ui
        end,
    })
end

function Skin:StopDrag()
    Snap.Stop()
    if not Addon:IsFrameLocked() then Addon:SaveLayout("DialogueUI", self.frame) end
end

--- Runs on every refresh, so a theme or size change in DialogueUI lands on the next one.
function Skin:Layout()
    -- Fonts and widths change here: the title's tail is laid out afresh.
    self.countLaid = nil
    self:Touch()
    local frame, cfg = self.frame, Theme:Config()
    local look = self:Look()
    self.look = look
    local parchment = PaperOf(look)
    -- Laid out at DialogueUI's own size, paddings and text; Window Size then scales the
    -- whole frame from BASE_SCALE.
    local scale = BASE_SCALE * (Config().FrameScale or DEFAULT_WINDOW_SIZE) / DEFAULT_WINDOW_SIZE
    frame.spokenBaseScale = scale * Theme:FrameScale() / UIParent:GetEffectiveScale()
    local width, inner, multiplier = Column()
    local padH, padTop, padBottom = PAD_H * multiplier, PAD_TOP * multiplier, PAD_BOTTOM * multiplier
    local wordsWidth = math.max(1, Round(inner * WORDS_SHARE))
    local wordsLeft = Round((inner - wordsWidth) / 2)
    -- DialogueUI's spacing: 0.35 of the text size under each line, four of those between
    -- paragraphs, which an empty line approximates.
    local fonts = Theme:Fonts(look.book)
    local fontSize = fonts.paragraphSize
    local textSize = tonumber(Addon:Profile("Transcript").FontSize) or BASE_FONT_SIZE
    local captionSize = math.max(6, Round(fontSize * textSize / BASE_FONT_SIZE))
    local lineGap = Round(0.35 * captionSize)
    local lineHeight = captionSize + lineGap
    self.fonts, self.captionSize, self.lineGap = fonts, captionSize, lineGap

    -- DialogueUI's header strip thickness, scaled to its column, whatever the look.
    local _, stripHeight = Strip(inner)
    -- DialogueUI's gap under its header line, before the text.
    local textGap = Round(4 * 0.35 * fontSize)
    -- A place's picture (Spoken Places gives one with its line) between the header and the words,
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
    local wordsTop = picture and pictureTop + pictureHeight + pictureGap or lineBottom + Round(WORDS_UNDER_LINE * captionSize)
    -- The same gap above the progress line, so the words sit as far from the foot as from the
    -- head. The last line's own spacing counts towards it.
    -- Show Progress off: the bar goes and the window closes up under the words.
    local progress = Addon:Profile("Transcript").SubtitleProgress ~= false
    self.progress.track:SetShown(progress)
    local footGap = math.max(0, textGap - lineGap)
    local footerHeight = (progress and self.progress.height + 6 or 0) + footGap
    -- A line's room over and under the words, which a line gliding out or in fades through, so no
    -- line is seen cut at the edge. It lies over the gaps there and adds none: the words keep
    -- their place.
    -- Under the progress line, as far to where the paper's light ends as the last line is over it:
    -- the 6 and the header's gap over the line, and the line's own spacing under its letters.
    local capWidth, capHeight = CapSize(look, width)
    local barLift = 0
    if progress then
        local above = 6 + footGap + lineGap
        local foot = capHeight * look.foot / 256
        barLift = Round(above - (padBottom - foot))
        footerHeight = footerHeight + barLift
        self.progressGaps = { above = above, below = padBottom + barLift - foot }
    end
    -- Only the line playing, in Lines Shown of its words; the title counts the lines waiting.
    local lines = Addon:Profile("Transcript").Lines == 1 and 1 or 2
    -- Fit to the Words: no more lines than the words take.
    if cfg.FitText ~= false then
        local needed = self:TextLines(wordsWidth)
        if needed and needed < lines then lines = needed end
    end
    -- Hide Subtitles on: a row for each line the queue lists in their place.
    if Transcript:ListsQueue(self.clip) then lines = math.min(lines, math.max(1, Transcript:QueueRows())) end
    local captionHeight = lines * lineHeight
    local height = padTop + wordsTop + captionHeight + padBottom + footerHeight
    self.settledHeight = height
    -- A new line on a window already showing eases to its height.
    local easing = self.easeNext and not self.settling
    self.easeNext = nil
    self.heightWant = easing and height or nil
    frame:SetSize(width, (self.settling or easing) and frame:GetHeight() or height)
    self.lines = lines

    DressStrips(self.parchments, parchment, look, capHeight)
    self.parchments[1]:SetSize(capWidth, capHeight)
    self.parchments[3]:SetSize(capWidth, capHeight)

    local content = self.content
    content:ClearAllPoints()
    content:SetPoint("TOPLEFT", padH, -padTop)
    content:SetPoint("BOTTOMRIGHT", -padH, padBottom)
    -- The round buttons as large on screen as Place Lore draws them (24, at UIParent's scale) at
    -- the default Window Size, growing and shrinking with it from there. The name and the title
    -- stop a button's width short of them.
    self.controlsRound = (Config().FrameScale or DEFAULT_WINDOW_SIZE) / DEFAULT_WINDOW_SIZE / frame.spokenBaseScale
    local _, middle = PlaceHeader(self.head, content, inner, look, parchment, fonts, 1,
        Round(ROUND_SIZE * self.controlsRound), self.controls)
    self.controlsMiddle = middle
    self:FitControls()

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
    -- The captions span that room too; the lines fade through it (Transcript:Place). Over the words
    -- it ends at the divider's line, so a line leaving never crosses it.
    self.lineRoom = picture and lineHeight or math.max(1, math.min(lineHeight, wordsTop - lineBottom))
    Transcript:Dock(content, content, "TOPLEFT", wordsLeft, -(wordsTop - self.lineRoom), wordsWidth,
        captionHeight + self.lineRoom + lineHeight)

    self.progress.track:ClearAllPoints()
    self.progress.track:SetPoint("BOTTOMLEFT", content, "BOTTOMLEFT", wordsLeft, barLift)
    self.progress.track:SetWidth(wordsWidth)

    self:Dress()
end

function Skin:Dress()
    local look, fonts = self.look, self.fonts
    local colors = Theme:Colors(look.palette)
    PaintHeader(self.head, look, fonts, colors, 1)
    local shadow = look.shadow and 1 or 0
    PaintText(self.count, fonts.title, Round(fonts.titleSize * TITLE_SHARE), colors.disabled, shadow)
    PaintText(self.stopped, fonts.title, Round(fonts.titleSize * TITLE_SHARE), colors.disabled, shadow)
    PaintText(self.held, fonts.title, Round(fonts.titleSize * TITLE_SHARE), colors.disabled, shadow)
    -- A clip's own face goes back on over the theme's (Addon:ClipFont).
    Addon:ClipFont(self.name, self.clip)
    Addon:ClipFont(self.title.text, self.clip)
    self.colors = colors
    local tint = colors.portraitTint
    if self.viewport.texture then self.viewport.texture:SetVertexColor(tint[1], tint[2], tint[3]) end
    Transcript:SetStyle({ font = fonts.paragraph, size = self.captionSize, lineGap = self.lineGap,
        paragraphs = true, color = colors.paragraph, shadow = look.shadow and true or false,
        highlight = colors.highlight, lines = self.lines, padTop = self.lineRoom })
end

function Skin:ConfigurePortrait()
    -- One image fading: the face is painted by the update waiting for it (Skin:Unbuffer).
    if self:Defer("update") then return end
    -- A face set or redrawn: it is drawn a moment after.
    self:Touch()
    -- Always the face: the header strip has its socket, which would stand empty without it.
    self.portrait:Show()
    Face.Show(self.head, self.clip)
    local viewport = self.viewport
    local tint = self.colors and self.colors.portraitTint
    if tint and viewport.texture then viewport.texture:SetVertexColor(tint[1], tint[2], tint[3]) end
end

function Skin:ConfigureActions()
    self.row = Actions:HeaderControls(self.frame, self.controls, { self.play, self.skip }, self.clip)
    self:LayoutControls()
end

--- Ctrl-wheel steps Window Size, Ctrl-Shift-wheel Text Size (Actions.WheelSize). True when the
--- wheel was taken.
function Skin:Wheel(delta)
    local frame = self.frame
    local left, top, before = frame:GetLeft(), frame:GetTop(), frame:GetEffectiveScale()
    local text = Actions.WheelSize(delta, "FrameScale")
    if not text then return false end
    -- Dragged before: its top-left corner stays put. Never dragged: it stays at the screen's top
    -- left, where RefreshConfig has placed it at its new size.
    if left and top and Addon:Layout().DialogueUI then
        local after = frame:GetEffectiveScale()
        frame:ClearAllPoints()
        frame:SetPoint("TOPLEFT", UIParent, "BOTTOMLEFT", left * before / after, top * before / after)
        Addon:SaveLayout("DialogueUI", frame)
    end
    Actions.WheelTip(frame, text)
    return true
end

function Skin:LayoutControls()
    Actions.LayOutRow(self.controls, self.row or self.buttons, ROUND_GAP)
end

--- `relayout` when the row's buttons may have changed (Update); otherwise the row is laid out
--- again only when the play button's label does.
function Skin:UpdateControls(relayout)
    if not self.clip then return end
    local paused = SoundQueue:IsPaused()
    Actions.SetPlayGlyph(self.play, Actions.HeadState())
    self.title.text:SetText(Actions.Title(self.clip))
    Addon:ClipFont(self.title.text, self.clip)
    -- Why it has not started (the NPC's own greeting first, a fight), as every style says.
    self.tail:SetHeld(SoundQueue:GetHeldReason(self.clip))
    self.tail:SetStopped(paused)
    self:Count(Waiting())
    Actions.SetPausable(self.buttons)
    if relayout then self:LayoutControls() end
end

function Skin:UpdateProgress()
    Actions.FollowProgress(self)
end

--- How much of the window shows, 0 to 1: as one image, its alpha. Where the client has no frame
--- buffers, the paper takes the lower half and everything on it the upper, so the two never fade
--- at once and the paper never shows through the strips and words.
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

--- Nothing in the window may change: it is one image.
function Skin:Frozen()
    return self.buffered and true or false
end

--- Still a while, and nothing in it loading: it may become one image.
function Skin:Still()
    if self.settling or self.landing or self.tuck then return false end
    if (self.stillFor or STILL) < STILL then return false end
    local viewport = self.viewport
    return not (Loading(self.picture) or Loading(self.badge)
        or Loading(viewport and viewport.activeFrame) or Loading(viewport and viewport.texture))
end

--- Deaf to the pointer, so nothing in the window lights or presses: before it becomes one image,
--- and while it is.
function Skin:Deafen()
    if self.deafened then return end
    -- The frame's own wheel goes first, and is not given back: Skin:Tick takes it again.
    Actions.DropWheel(self.frame)
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
    self:ApplyLock()
end

function Skin:ApplyLock()
    Actions.ClickThrough(self.frame)
end

--- Switch the window into or out of being one image while it is hidden: switched while on screen
--- and faded, the client crashes (ASSERT(flattenedBatch != nullptr)). Hidden and shown again in
--- the one frame, so nothing flickers; this also resets its buttons' lit and pressed states.
local function SwitchHidden(frame, on)
    local shown = frame:IsShown()
    if shown then frame:Hide() end
    local ok = pcall(frame.SetIsFrameBuffer, frame, on)
    if shown then frame:Show() end
    return ok
end

--- The window drawn as one image (a frame buffer) and faded as one, its parts ignoring its alpha
--- so only the finished image fades. Anything in it changing while it is one crashes the client
--- (CSimpleRender.cpp's texture asserts, ASSERT(!m_deleted), ASSERT(flattenedBatch != nullptr)),
--- so while it is: deaf to the pointer, the captions held, its own updates waiting, the portrait
--- cache not painting its face. False where the client has no frame buffers.
function Skin:Buffer()
    local frame = self.frame
    if self.buffered then return true end
    if not frame.SetIsFrameBuffer then return false end
    -- Its own small animations finished first, and a tuck that outlasted the wait (ARM_MOST): it
    -- may not move as one image.
    self:StopTuck()
    self.lineFade = nil
    if self.tail then
        self.tail:Finish()
        self:Count(self.tail.counted or 0)
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
    -- A move onto or off DialogueUI's window that waited happens now.
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

--- One image fading: nothing in it may change, so `what` ("update", or "refresh", which runs one)
--- waits for Skin:Unbuffer. True when it waits.
function Skin:Defer(what)
    if not self.buffered then return false end
    if what == "refresh" or not self.pending then self.pending = what end
    return true
end

--- What is on the paper: its share of the window's fade, times a new line's own fade-in.
function Skin:PaintContent()
    local line = self.lineFade and Clamp(self.lineFade / LINE_IN, 0, 1) or 1
    -- Times its words' own fade as it settles out of a dialog (Skin:HideWords).
    self.content:SetAlpha(Clamp((self.level or 0) * 2 - 1, 0, 1) * EaseOut(line) * (self.wordsAlpha or 1))
end

function Skin:SetVisible(visible, immediate)
    if not self.frame then return end
    if not visible then self:HideTooltip(); self.tuckWaiting = nil end
    if immediate then
        self.turning = nil
        self:StopTuck()
        self:StopSettle()
        self:StopLanding()
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
    -- Going: never still flying or landing, which would change it while it fades as one image.
    if not visible then
        self:StopSettle()
        self:StopLanding()
    end
    if visible then
        self.arming = nil
        if self.buffered or (self.frame:IsShown() and (self.level or 0) > 0) then
            -- Fading out, or still on screen: back up from where it is, as it is.
            if not self.buffered then self:Undeafen(); Transcript:Release() end
            self.fadeFrom, self.fadeTime = self.level or 0, 0
            return
        end
        -- From nothing: laid out unseen, then once it is still, faded in as one image.
        self:SetLevel(0)
        self.frame:Show()
        self.preparing, self.fadeTime = { waited = 0 }, nil
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
    -- image once it is still. Its words held from now, so they fade out with it.
    self:Deafen()
    Transcript:Hold()
    self.arming, self.fadeTime = { waited = 0, frames = 0 }, nil
end

--- Start the fade, as one image where the client can draw one, unless asked not to.
function Skin:StartFade(asItself)
    if not asItself then self:Buffer() end
    self.fadeFrom, self.fadeTime, self.fadeSlow = self.level or 0, 0, nil
end

--- The fade at its end: hidden if it went out, itself again, and the next line in if it turned.
function Skin:EndFade()
    self:SetLevel(self.wanted and 1 or 0)
    self.fadeTime, self.fadeSlow = nil, nil
    if not self.wanted then
        self.frame:Hide()
        self:Undeafen()
        -- Held from the start of the fade-out, frame buffer or not (Skin:SetVisible).
        Transcript:Release()
    end
    self:Unbuffer()
    if self.turning then
        self.turning = nil
        if not self.wanted then self:Update() end
    end
end

--- After the title: why the line waits, "• (Stopped)" while it is stopped, and the lines waiting
--- behind it, "• +N". The title is cut short, not these.
function Skin:Count(waiting)
    local tail = self.tail
    tail:SetCount(waiting)
    local text, width = self.title.text, self.title:GetWidth() or 0
    local stoppedShown = tail.want or tail.alpha > 0
    -- Polled while a line plays: laid out again only when something moved.
    local laid = self.countLaid
    if laid and laid.waiting == waiting and laid.stopped == stoppedShown and laid.held == tail.reason
        and laid.text == text:GetText() and laid.width == width then
        if stoppedShown or waiting > 0 then tail:Paint() end
        return
    end
    self.countLaid = { waiting = waiting, stopped = stoppedShown, held = tail.reason, text = text:GetText(),
        width = width }
    tail:Fit(text, width)
end

function Skin:Tick(elapsed)
    -- Landing from the frame after it lands, so it touches down where it rests.
    if self.landing then self:LandStep(elapsed) end
    if self.settling then self:SettleStep(elapsed) end
    self.stillFor = (self.stillFor or 0) + elapsed
    -- Waiting to be still before it becomes one image: in, laid out unseen; out, deaf to the pointer.
    local preparing = self.preparing
    if preparing then
        preparing.waited = preparing.waited + elapsed
        local still = self:Still()
        if still or preparing.waited >= PREPARE_MOST then
            self.preparing = nil
            self:StartFade(not still)
        end
    end
    local arming = self.arming
    if arming then
        arming.frames, arming.waited = arming.frames + 1, arming.waited + elapsed
        if (arming.frames >= ARM_FRAMES and self:Still()) or arming.waited >= ARM_MOST then
            self.arming = nil
            self:StartFade()
        end
    end
    -- A page waiting for this window to fade in (Skin:TuckWhenShown): it goes behind it now, if its
    -- line still waits behind the one playing.
    local waiting = self.tuckWaiting
    if waiting and self:Settled() then
        self.tuckWaiting = nil
        for index, clip in ipairs(SoundQueue.sounds) do
            if index > 1 and clip == waiting.clip then self:TuckWhenShown(waiting.dialog, clip); break end
        end
    end
    -- Stopped faded out: its room given back.
    if self.tail and self.tail:Step(elapsed) then self:Count(self.tail.counted or 0) end
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
        local t = Clamp(self.fadeTime / ((self.wanted and FADE_IN or FADE_OUT) * (self.fadeSlow or 1)), 0, 1)
        local eased = Smooth(t)
        self:SetLevel(self.fadeFrom + ((self.wanted and 1 or 0) - self.fadeFrom) * eased)
        if t == 1 then
            self:EndFade()
            if not self.wanted then return end
        end
    end
    -- Nothing in it changes while it is one image, nor while it waits to be one.
    if not self.wanted or self.buffered or self.preparing or self.arming then return end
    Actions.TakeWheel(self.frame, Addon:IsFrameLocked())
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
    local look = self.look or LOOKS.quest
    return math.max(0, (paperWidth - self.frame:GetWidth()) / 2 - look.paperLeft / 1024 * paperWidth),
        math.max(0, capHeight * (0.5 - look.paperTop / 256))
end

--- Where it rests: the place the player dragged it to, or the default.
function Skin:PlaceHome()
    if not Addon:RestoreLayout("DialogueUI", self.frame) then self:PlaceDefault() end
end

--- The screen's top left, EDGE from the paper: where the window settles when DialogueUI's
--- window closes on a line that plays on, out of the way of the next dialog.
function Skin:PlaceDefault()
    local frame = self.frame
    -- In the frame's own units: its effective scale is UIParent's times its base scale.
    local k = 1 / (frame.spokenBaseScale or 1)
    local left, top = self:PaperOverhang()
    frame:ClearAllPoints()
    frame:SetPoint("TOPLEFT", UIParent, "TOPLEFT", Round(EDGE * k + left), -Round(EDGE * k + top))
end

--- Where the window rests, its top left in the screen's pixels: where it was dragged to, or the
--- screen's top left. Worked out rather than read off the frame, which has no place on screen
--- while DialogueUI hides the interface.
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

--- The header's round buttons as large on screen as they settle at, also while the window slides
--- out of the dialog at a larger scale. The slide and a layout both set them, in either order.
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

--- Whether this window, showing a line, will fade out to turn to `clip` (Skin:Update), so the
--- captions should keep the words it shows until it has.
function Skin:WillTurn(clip)
    return self:IsEnabled() and self.frame ~= nil and self.clip ~= nil and clip ~= self.clip and self.wanted
        and self.frame:IsShown() and (self.level or 0) > 0 and not self.settling and not self.wordsHidden
        and not self:Covered() and true or false
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
    if self:Defer("refresh") then return end
    -- A setting changed as it flies: it lands at once, so the flight does not undo the change.
    self:StopSettle()
    local frame = self.frame
    frame:SetFrameStrata(Config().FrameStrata)
    self:Layout()
    frame:SetScale(frame.spokenBaseScale)
    if not Addon:Layout().DialogueUI then self:PlaceDefault() end
    if Addon:IsFrameLocked() then Snap.Stop() end
    self:ApplyLock()
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
    if self:Defer("update") then return end
    self:Touch()
    -- Fading out to turn to the next line: it comes in once faded (Skin:EndFade).
    if self.turning and self.frame:IsShown() then return end
    -- Not turning after all: the captions held for it go on (Skin:WillTurn).
    if not self.turning and not self.arming and Transcript.held and clip == self.clip then
        Transcript:Release()
    end
    if clip ~= self.clip then
        -- Following another line on screen: this one fades out whole and the next fades in from
        -- nothing once it has (Skin:EndFade), its paper, height and words changed unseen. Not while
        -- it settles out of a dialog with its words hidden: there the next simply takes its place.
        if self:WillTurn(clip) then
            self.turning = true
            self:SetVisible(false)
            return
        end
        self:HideTooltip()
        self.clip, self.seconds = clip, 0
    end
    -- The line's words decide how tall the panel is (Fit to the Words): a new line, or its words
    -- arriving late. Its art too: a stone page after a paper one with as many lines is redrawn.
    local textLines = Transcript.clip == clip and Transcript.lines and #Transcript.lines or 0
    if Transcript:ListsQueue(clip) then textLines = "queue" .. Transcript:QueueRows() end
    local picture = clip.present and clip.present.picture
    local key = textLines .. ":" .. (picture and picture.file or "")
        .. ":" .. (self:Look().file or "quest")
    if key ~= self.laidOutFor then
        self.laidOutFor = key
        self:Layout()
    end
    self:SetVisible(true)
    self.name:SetText(Actions.Speaker(clip))
    Addon:ClipFont(self.name, clip)
    self:ConfigurePortrait()
    self:ConfigureActions()
    self:UpdateProgress()
    self:UpdateControls(true)
end

--- Its saved place forgotten: back at the screen's top left (RefreshConfig, with no saved place),
--- now while it is the style shown, else when it is next chosen.
function Skin:Reset()
    Addon:Layout().DialogueUI = nil
    if not self.frame then return end
    Snap.Stop()
    if self:IsEnabled() then self:RefreshConfig(PlayerFrame) end
end

function Skin:Describe()
    if not self.frame then return "dialogueui skin: no frame built" end
    return format("dialogueui skin: enabled=%s visible=%s theme=%d size=%.0fx%.0f lines=%d portrait=%s",
        tostring(self:IsEnabled()), tostring(self.frame:IsVisible()), Theme:Available() and Theme:ThemeID() or 0,
        self.frame:GetWidth() or 0, self.frame:GetHeight() or 0, self.lines or 0, tostring(self.viewport.active))
end
