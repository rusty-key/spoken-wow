setfenv(1, SpokenEnv)

-- The frame's settings, or their defaults once AceDB has stripped them (Addon:Profile).
local function FrameConfig()
    return Addon:Profile("Frame")
end

-- The player: who is speaking, what is waiting, and the controls for both.
--
-- ZoneLore's SoundQueueUI.lua is the base -- itself VoiceOverRedux's with the domain
-- taken out and an actions row added -- with the things Redux had that the fork dropped
-- put back: the hide-portrait mode with its vertical line and mini pause button, and
-- the 1.12 layout quirks. Everything domain-shaped now comes from the clip's
-- presentation: the header, the row label, the bullet, the portrait, the actions.
--
-- Refreshed through the player's AUDIO_CHANGED callback rather than by the queue
-- calling this file, which is what keeps SoundQueue.lua free of any dependency on it.
PlayerFrame = {}

local PORTRAIT_SIZE = 120
local PORTRAIT_ATLAS_SIZE = 512
local PORTRAIT_ATLAS_BORDER_SIZE = 416
local PORTRAIT_ATLAS_VIEWPORT_SIZE = 348
local PORTRAIT_BORDER_SCALE = PORTRAIT_SIZE / PORTRAIT_ATLAS_VIEWPORT_SIZE
local PORTRAIT_BORDER_SIZE = PORTRAIT_ATLAS_BORDER_SIZE * PORTRAIT_BORDER_SCALE
local PORTRAIT_BORDER_OUTSET = 34 * PORTRAIT_BORDER_SCALE
local PORTRAIT_LINE_WIDTH = 56 * PORTRAIT_BORDER_SCALE
local FRAME_WIDTH_WITHOUT_PORTRAIT = 300
local MAX_ROWS = 4
local TEXTURES = [[Interface\AddOns\Spoken\Textures\]]

do
    local font = CreateFont("SpokenNameFont")
    font:SetFont(GameFontNormal:GetFont(), 19, "")
    font:SetShadowColor(0, 0, 0)
    font:SetShadowOffset(1, -1)
    font:SetJustifyH("LEFT")
    font:SetJustifyV("TOP")
end
do
    local font = CreateFont("SpokenRowFont")
    font:SetFont(GameFontNormal:GetFont(), 16, "")
    font:SetShadowColor(0, 0, 0)
    font:SetShadowOffset(1, -1)
    font:SetJustifyH("LEFT")
    font:SetJustifyV("MIDDLE")
end

-- 1.12 reports no width for a frame that has not been laid out; the edges are reliable.
local function WidthOf(frame)
    if Version.IsLegacyVanilla then
        return (frame:GetRight() or 0) - (frame:GetLeft() or 0)
    end
    return frame:GetWidth()
end

function PlayerFrame:Initialize()
    if self.frame then return end
    self:InitDisplay()
    self:InitPortraitLine()
    self:InitPortrait()
    self:InitMover()
    Actions:Build(self.frame)
    self:RefreshConfig()
    Callbacks:Register("AUDIO_CHANGED", function() PlayerFrame:Update() end)
end

function PlayerFrame:InitDisplay()
    self.frame = CreateFrame("Frame", "SpokenPlayerFrame", UIParent, "BackdropTemplate")
    function self.frame:Reset()
        self:SetWidth(PORTRAIT_SIZE + FRAME_WIDTH_WITHOUT_PORTRAIT)
        self:SetHeight(PORTRAIT_SIZE)
        self:ClearAllPoints()
        self:SetPoint("BOTTOM", 0, 200)
    end
    self.frame:Reset()
    if Addon:RestoreLayout("Player", self.frame) then
        -- Saved as the width with the portrait, which RefreshConfig takes off when hidden.
        self.frame:SetWidth(Addon:Layout().Player.width or self.frame:GetWidth())
    end
    self.frame:SetMovable(true)
    self.frame:SetResizable(true)
    self.frame:SetClampedToScreen(true)
    -- Placed from the saved layout instead; the client's cache would only fight it.
    self.frame:SetUserPlaced(false)
    self.frame:SetFrameStrata(FrameConfig().FrameStrata)
    self.frame:Hide()

    self.frame.background = self.frame:CreateTexture(nil, "BACKGROUND")
    self.frame.background:SetPoint("RIGHT")
    self.frame.background:SetTexture(TEXTURES .. "BackgroundGradient")

    self.frame.resizer = CreateFrame("Button", nil, self.frame)
    self.frame.resizer:SetPoint("BOTTOMRIGHT")
    self.frame.resizer:SetSize(16, 16)
    self.frame.resizer:SetNormalTexture(TEXTURES .. "SizeGrabber-Up")
    self.frame.resizer:SetPushedTexture(TEXTURES .. "SizeGrabber-Down")
    self.frame.resizer:SetHighlightTexture(TEXTURES .. "SizeGrabber-Highlight")
    self.frame.resizer:HookScript("OnEnter", function() SetCursor([[Interface\Cursor\UI-Cursor-SizeRight]]) end)
    self.frame.resizer:HookScript("OnLeave", function() SetCursor(nil) end)
    self.frame.resizer:HookScript("OnMouseDown", function()
        self.frame.resizer:GetHighlightTexture():Hide()
        self.frame:StartSizing("BOTTOMRIGHT")
    end)
    self.frame.resizer:HookScript("OnMouseUp", function()
        self.frame.resizer:GetHighlightTexture():Show()
        self.frame:StopMovingOrSizing()
        self:SaveLayout()
    end)

    self.frame.container = CreateFrame("Frame", nil, self.frame)
    self.frame.container:SetPoint("RIGHT")
    self.frame.container.buttons = {}
    function self.frame.container.buttons:Update()
        for _, button in ipairs(self) do button:Update() end
    end

    self.frame.container.name = self.frame.container:CreateFontString(nil, "ARTWORK", "SpokenNameFont")
    self.frame.container.name:SetPoint("TOPLEFT")
    self.frame.container.name:SetWordWrap(false)
    self.frame.container.name:SetTextColor(214 / 255, 214 / 255, 214 / 255)
    function self.frame.container.name:Update()
        local containerWidth = WidthOf(self:GetParent())
        self:SetWidth(0)
        self:SetText(self:GetText())
        self:SetWidth(math.min(containerWidth, self:GetStringWidth() + 1))
    end

    self.frame:SetScript("OnSizeChanged", function()
        self.frame.container.name:Update()
        self.frame.container.buttons:Update()
        self:LayoutCaptions()
    end)
end

-- The vertical line and the small pause button that stand in for the portrait when the
-- player has turned it off. Redux's; the zones fork dropped them, and that was an
-- omission rather than a decision.
function PlayerFrame:InitPortraitLine()
    self.frame.portraitLine = self.frame:CreateTexture(nil, "BORDER")
    self.frame.portraitLine:SetPoint("TOPLEFT", -PORTRAIT_LINE_WIDTH / 2 + 2, PORTRAIT_BORDER_OUTSET)
    self.frame.portraitLine:SetPoint("BOTTOMRIGHT", self.frame, "BOTTOMLEFT", PORTRAIT_LINE_WIDTH / 2 + 2, -PORTRAIT_BORDER_OUTSET)
    self.frame.portraitLine:SetTexture(TEXTURES .. "PortraitFrameAtlas")
    self.frame.portraitLine:SetTexCoord(456 / PORTRAIT_ATLAS_SIZE, 512 / PORTRAIT_ATLAS_SIZE, 0, PORTRAIT_ATLAS_BORDER_SIZE / PORTRAIT_ATLAS_SIZE)

    self.frame.miniPause = CreateFrame("Button", nil, self.frame)
    self.frame.miniPause:SetSize(26, 26)
    self.frame.miniPause:SetPoint("CENTER", self.frame.container, "LEFT", -20 + 2, 0)
    self.frame.miniPause:SetNormalTexture(TEXTURES .. "PortraitFrameAtlas")
    self.frame.miniPause:GetNormalTexture():ClearAllPoints()
    self.frame.miniPause:GetNormalTexture():SetPoint("CENTER")
    self.frame.miniPause:GetNormalTexture():SetSize(14, 14)
    self.frame.miniPause:SetPushedTexture(TEXTURES .. "PortraitFrameAtlas")
    self.frame.miniPause:GetPushedTexture():ClearAllPoints()
    self.frame.miniPause:GetPushedTexture():SetPoint("CENTER")
    self.frame.miniPause:GetPushedTexture():SetSize(12, 12)
    self.frame.miniPause.background = self.frame.miniPause:CreateTexture(nil, "BACKGROUND")
    self.frame.miniPause.background:SetTexture(TEXTURES .. "SettingsButton")
    self.frame.miniPause.background:SetPoint("CENTER")
    self.frame.miniPause.background:SetSize(32, 32)
    function self.frame.miniPause:Update()
        local state = Actions.HeadState()
        Actions.Glyph(self:GetNormalTexture(), state)
        Actions.Glyph(self:GetPushedTexture(), state)
        self:GetNormalTexture():SetAlpha(MouseIsOver(self) and 1 or 0.75)
    end
    self.frame.miniPause:Update()
    self.frame.miniPause:HookScript("OnEnter", function(button) button:GetNormalTexture():SetAlpha(1) end)
    self.frame.miniPause:HookScript("OnLeave", function(button) button:GetNormalTexture():SetAlpha(0.75) end)
    self.frame.miniPause:HookScript("OnClick", function()
        PlaySound(SOUNDKIT.U_CHAT_SCROLL_BUTTON)
        SoundQueue:TogglePauseQueue()
    end)
end

function PlayerFrame:InitPortrait()
    self.frame.portrait = CreateFrame("Frame", nil, self.frame)
    self.frame.portrait:SetPoint("TOPLEFT")
    self.frame.portrait:SetSize(PORTRAIT_SIZE, PORTRAIT_SIZE)

    self.frame.portrait.background = self.frame.portrait:CreateTexture(nil, "BACKGROUND")
    self.frame.portrait.background:SetAllPoints()
    self.frame.portrait.background:SetTexture(TEXTURES .. "PortraitFrameBackground")

    self.frame.portrait.pause = CreateFrame("Button", nil, self.frame.portrait)
    self.frame.portrait.pause:SetFrameLevel(self.frame.portrait:GetFrameLevel() + 2)
    self.frame.portrait.pause:SetAllPoints()
    self.frame.portrait.pause.background = self.frame.portrait.pause:CreateTexture(nil, "BACKGROUND")
    self.frame.portrait.pause.background:SetAllPoints()
    self.frame.portrait.pause.background:SetTexture(TEXTURES .. "PortraitFrameBackground")
    self.frame.portrait.pause.background:SetAlpha(0.75)
    self.frame.portrait.pause:SetNormalTexture(TEXTURES .. "PortraitFrameAtlas")
    self.frame.portrait.pause:GetNormalTexture():ClearAllPoints()
    self.frame.portrait.pause:GetNormalTexture():SetPoint("CENTER")
    self.frame.portrait.pause:GetNormalTexture():SetSize(32, 32)
    self.frame.portrait.pause:SetPushedTexture(TEXTURES .. "PortraitFrameAtlas")
    self.frame.portrait.pause:GetPushedTexture():ClearAllPoints()
    self.frame.portrait.pause:GetPushedTexture():SetPoint("CENTER")
    self.frame.portrait.pause:GetPushedTexture():SetSize(28, 28)
    function self.frame.portrait.pause:Update()
        local paused = SoundQueue:IsPaused()
        if paused and not SoundQueue:IsPlaying() then self.background:Show() else self.background:Hide() end
        local state = Actions.HeadState()
        Actions.Glyph(self:GetNormalTexture(), state)
        Actions.Glyph(self:GetPushedTexture(), state)
        self:GetNormalTexture():SetAlpha(MouseIsOver(self) and 1 or (paused and 0.75 or 0))
    end
    self.frame.portrait.pause:Update()
    self.frame.portrait.pause:HookScript("OnEnter", function(button)
        button:GetNormalTexture():SetAlpha(1)
        GameTooltip:SetOwner(button, "ANCHOR_RIGHT")
        local stopped = SoundQueue:IsPaused()
        GameTooltip:SetText(stopped and L.REPLAY or L.STOP)
        GameTooltip:AddLine(stopped and L.REPLAY_TOOLTIP or L.STOP_TOOLTIP, 1, 1, 1, true)
        GameTooltip:Show()
    end)
    self.frame.portrait.pause:HookScript("OnLeave", function(button)
        button:GetNormalTexture():SetAlpha(SoundQueue:IsPaused() and 0.75 or 0)
        GameTooltip_Hide()
    end)
    self.frame.portrait.pause:HookScript("OnClick", function()
        PlaySound(SOUNDKIT.U_CHAT_SCROLL_BUTTON)
        SoundQueue:TogglePauseQueue()
    end)

    -- A separate frame so the border and the mover draw above everything in the portrait.
    self.frame.portrait.border = CreateFrame("Frame", nil, self.frame.portrait)
    self.frame.portrait.border:SetFrameLevel(self.frame.portrait.pause:GetFrameLevel() + 1)
    self.frame.portrait.border:SetAllPoints()
    self.frame.portrait.border.texture = self.frame.portrait.border:CreateTexture(nil, "BORDER")
    self.frame.portrait.border.texture:SetSize(PORTRAIT_BORDER_SIZE, PORTRAIT_BORDER_SIZE)
    self.frame.portrait.border.texture:SetPoint("TOPLEFT", -PORTRAIT_BORDER_OUTSET, PORTRAIT_BORDER_OUTSET)
    self.frame.portrait.border.texture:SetPoint("BOTTOMRIGHT", PORTRAIT_BORDER_OUTSET, -PORTRAIT_BORDER_OUTSET)
    self.frame.portrait.border.texture:SetTexture(TEXTURES .. "PortraitFrameAtlas")
    self.frame.portrait.border.texture:SetTexCoord(0, PORTRAIT_ATLAS_BORDER_SIZE / PORTRAIT_ATLAS_SIZE, 0, PORTRAIT_ATLAS_BORDER_SIZE / PORTRAIT_ATLAS_SIZE)
end

function PlayerFrame:InitMover()
    self.frame.mover = CreateFrame("Button", nil, self.frame.portrait.border)
    self.frame.mover:SetSize(26, 26)
    self.frame.mover:SetPoint("CENTER", self.frame.portrait.border, "BOTTOMLEFT", 5, 6)
    self.frame.mover:SetNormalTexture(TEXTURES .. "PortraitFrameAtlas")
    self.frame.mover:GetNormalTexture():SetTexCoord(462 / PORTRAIT_ATLAS_SIZE, 512 / PORTRAIT_ATLAS_SIZE, 462 / PORTRAIT_ATLAS_SIZE, 512 / PORTRAIT_ATLAS_SIZE)
    self.frame.mover:GetNormalTexture():ClearAllPoints()
    self.frame.mover:GetNormalTexture():SetPoint("CENTER")
    self.frame.mover:GetNormalTexture():SetSize(16, 16)
    self.frame.mover:SetPushedTexture(TEXTURES .. "PortraitFrameAtlas")
    self.frame.mover:GetPushedTexture():SetTexCoord(462 / PORTRAIT_ATLAS_SIZE, 512 / PORTRAIT_ATLAS_SIZE, 462 / PORTRAIT_ATLAS_SIZE, 512 / PORTRAIT_ATLAS_SIZE)
    self.frame.mover:GetPushedTexture():ClearAllPoints()
    self.frame.mover:GetPushedTexture():SetPoint("CENTER")
    self.frame.mover:GetPushedTexture():SetSize(14, 14)
    self.frame.mover.background = self.frame.mover:CreateTexture(nil, "BACKGROUND")
    self.frame.mover.background:SetTexture(TEXTURES .. "SettingsButton")
    self.frame.mover.background:SetPoint("CENTER")
    self.frame.mover.background:SetSize(32, 32)
    self.frame.mover:HookScript("OnEnter", function(button)
        if Addon:IsFrameLocked() then return end
        SetCursor([[Interface\Cursor\UI-Cursor-Move]])
        GameTooltip:SetOwner(button, "ANCHOR_RIGHT")
        GameTooltip:SetText(L.QUEUE_TITLE)
        GameTooltip:AddLine(L.QUEUE_DRAG_HINT, 1, 1, 1, true)
        GameTooltip:Show()
    end)
    self.frame.mover:HookScript("OnLeave", function() SetCursor(nil); GameTooltip_Hide() end)
    self.frame.mover:HookScript("OnMouseDown", function()
        if Addon:IsFrameLocked() then return end
        self.frame:StartMoving()
    end)
    self.frame.mover:HookScript("OnMouseUp", function()
        if Addon:IsFrameLocked() then return end
        self.frame:StopMovingOrSizing()
        self:SaveLayout()
    end)
end

--- The skin drawing the queue in place of this window, or nil when this window does.
function PlayerFrame:Skin()
    if MinimalPlayer:IsEnabled() then return MinimalPlayer end
    if DialogueUIPlayer and DialogueUIPlayer:IsEnabled() then return DialogueUIPlayer end
    return nil
end

function PlayerFrame:RefreshConfig()
    -- Bronze Border tints every round button, whichever way lines are shown.
    Actions.RefreshRings()
    local skin = self:Skin()
    -- Each skin dresses the captions its own way; the others' look must not stay on them.
    if skin ~= DialogueUIPlayer then Transcript:SetStyle(nil) end
    for _, other in ipairs({ MinimalPlayer, DialogueUIPlayer }) do
        if other ~= skin then other:SetVisible(false, true) end
    end
    if skin then
        self.frame:Hide()
        skin:RefreshConfig(self)
        return
    end
    local cfg = FrameConfig()
    if cfg.HidePortrait then
        if self.frame.portrait:IsShown() then
            self.frame:SetWidth(self.frame:GetWidth() - PORTRAIT_SIZE)
        end
        self:SetResizeBounds(100)
        self.frame.portraitLine:Show()
        self.frame.portrait:Hide()
        self.frame.miniPause:Show()
        self.frame.container:SetPoint("LEFT", 20, 0)
        self.frame.background:SetPoint("TOPLEFT")
        self.frame.background:SetPoint("BOTTOMLEFT")
        self.frame.mover:SetParent(self.frame)
        self.frame.mover:SetPoint("CENTER", self.frame, "BOTTOMLEFT", 2, 6)
    else
        if not self.frame.portrait:IsShown() then
            self.frame:SetWidth(self.frame:GetWidth() + PORTRAIT_SIZE)
        end
        self:SetResizeBounds(PORTRAIT_SIZE + 100)
        self.frame.portraitLine:Hide()
        self.frame.portrait:Show()
        self.frame.miniPause:Hide()
        self.frame.container:SetPoint("LEFT", self.frame.portrait, "RIGHT", 15, 0)
        self.frame.background:SetPoint("TOPLEFT", self.frame.portrait, "TOPRIGHT")
        self.frame.background:SetPoint("BOTTOMLEFT", self.frame.portrait, "BOTTOMRIGHT")
        self.frame.mover:SetParent(self.frame.portrait.border)
        self.frame.mover:SetPoint("CENTER", self.frame.portrait.border, "BOTTOMLEFT", 5, 6)
    end

    self.frame.mover:SetShown(not Addon:IsFrameLocked())
    self.frame.resizer:SetShown(not Addon:IsFrameLocked())
    self.frame:SetScale(cfg.FrameScale)
    self.frame:SetFrameStrata(cfg.FrameStrata)
    Addon:ApplyHost(self.frame)
    self:Update()
end

-- SetResizeBounds replaced SetMinResize/SetMaxResize; both exist across these clients.
function PlayerFrame:SetResizeBounds(minWidth)
    local height = Transcript:HeightForClip(SoundQueue:GetCurrentSound())
    self.captionExtra = height > 0 and height + 16 or 0
    Transcript:ResizePlayer(self.frame, PORTRAIT_SIZE + self.captionExtra, minWidth, 10000)
end

function PlayerFrame:LayoutCaptions()
    if self:Skin() then return end
    local hidePortrait = FrameConfig().HidePortrait
    local left = hidePortrait and 20 or PORTRAIT_SIZE + 15
    local height = Transcript:HeightForClip(SoundQueue:GetCurrentSound())
    Transcript:Dock(self.frame, self.frame, "TOPLEFT", left, -PORTRAIT_SIZE - 4,
        math.max(1, WidthOf(self.frame) - left - 10), height)
    self.frame.background:ClearAllPoints()
    self.frame.background:SetPoint("TOPLEFT", hidePortrait and 0 or PORTRAIT_SIZE, 0)
    self.frame.background:SetPoint("BOTTOMRIGHT")
end

local function BulletFor(clip, isHead, hovered)
    if hovered then
        return TEXTURES .. "SoundQueueBulletDelete", 14
    end
    if isHead then
        local bullet = Bullets[clip.present and clip.present.bullet]
        if bullet then return bullet.texture, bullet.size or 14 end
    end
    return TEXTURES .. "SoundQueueBulletQueue", 22
end

function PlayerFrame:CreateRow(i)
    local button = CreateFrame("Button", nil, self.frame.container)
    self.frame.container.buttons[i] = button
    button:SetID(i)
    button:SetHeight(20)

    button.textWidget = button:CreateFontString(nil, "OVERLAY", "SpokenRowFont")
    button.textWidget:SetWordWrap(false)
    button.iconWidget = button:CreateTexture(nil, "ARTWORK")
    button.iconWidget:SetSize(16, 16)
    button.iconWidget:SetPoint("CENTER", button, "LEFT", 16 / 2, 0)

    function button:Configure(clip)
        self.clip = clip
        self:Update()
    end
    function button:Update(pushed, hovered)
        if pushed == nil then pushed = self.pushed else self.pushed = pushed end
        if hovered == nil then hovered = self.hovered else self.hovered = hovered end
        local clip = self.clip
        if not clip then self:Hide(); return end
        self:Show()
        local isHead = clip == SoundQueue:GetCurrentSound()
        local index = self:GetID()

        if isHead then
            self:SetAlpha(1)
            self.textWidget:SetShadowColor(0, 0, 0, 1)
            self:SetPoint("TOPLEFT", PlayerFrame.frame.container.name, "BOTTOMLEFT", 0, -2)
            self:EnableMouse(SoundQueue:CanBePaused())
        else
            local position = index - 1
            local alpha = math.max(0.1, math.min(1, 1 - (position - 1) / 3))
            self:SetAlpha(alpha)
            self.textWidget:SetShadowColor(0, 0, 0, 0.5 + 0.5 * alpha)
            self:SetPoint("TOPLEFT", PlayerFrame.frame.container.buttons[index - 1] or PlayerFrame.frame.container.name,
                "BOTTOMLEFT", 0, position == 1 and -8 or -2)
            self:EnableMouse(true)
        end

        -- A held clip says why; otherwise narration waiting out a pull looks exactly like
        -- narration that failed.
        local text = clip.present and clip.present.label or clip.key
        local held = SoundQueue:GetHeldReason(clip)
        if held then
            text = format("%s |cff888888(%s)|r", text, held)
        end
        self.textWidget:ClearAllPoints()
        self.textWidget:SetPoint("LEFT", 16 + 5, 0)
        self.textWidget:SetText(text)
        self:SetWidth(math.min(WidthOf(self:GetParent()), 16 + 5 + self.textWidget:GetWidth() + 1))
        self.textWidget:SetPoint("RIGHT")

        local texture, size = BulletFor(clip, isHead, hovered)
        self.iconWidget:SetTexture(texture)
        self.iconWidget:SetSize(size, size)
        if hovered then
            local r, g, b = unpack(RemoveColor)
            if pushed then r, g, b = r * 0.75, g * 0.75, b * 0.75 end
            self:SetAlpha(1)
            self.textWidget:SetTextColor(r, g, b)
            self.textWidget:SetShadowColor(0, 0, 0, 1)
        elseif isHead then
            local tint = clip.present and clip.present.tint
            if tint then
                self.textWidget:SetTextColor(tint[1] or tint.r, tint[2] or tint.g, tint[3] or tint.b)
            else
                self.textWidget:SetTextColor(245 / 255, 204 / 255, 24 / 255)
            end
        else
            self.textWidget:SetTextColor(123 / 255, 147 / 255, 167 / 255)
        end
    end

    button:HookScript("OnClick", function(self) SoundQueue:RemoveSoundFromQueue(self.clip) end)
    button:HookScript("OnMouseDown", function(self) self:Update(true) end)
    button:HookScript("OnMouseUp", function(self) self:Update(false) end)
    button:HookScript("OnEnter", function(self)
        self:Update(nil, true)
        GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
        GameTooltip:SetText(L.QUEUE_REMOVE_TOOLTIP)
        GameTooltip:Show()
    end)
    button:HookScript("OnLeave", function(self) self:Update(nil, false); GameTooltip_Hide() end)
    button:Update()
    return button
end

--- A line to show while none is playing, so a window chosen as the narrator style in the welcome
--- window can be seen at once, as the subtitles show theirs. Either window draws it; the first
--- real line puts it away.
function PlayerFrame:ShowSample(shown)
    self.sample = shown and {
        key = "sample", length = 0,
        source = { key = "sample", gates = {}, interClipGap = 0 },
        present = { header = L.SAMPLE_SPEAKER, label = L.SAMPLE_LINE,
            portrait = { kind = "texture", texture = [[Interface\AddOns\Spoken\icon.tga]] } },
    } or nil
    self:Update()
end

function PlayerFrame:IsShowingSample()
    return self.sample ~= nil
end

--- The line the window stands for: the one playing, or the sample while nothing is.
function PlayerFrame:Current()
    if not SoundQueue:IsEmpty() then self.sample = nil end
    return SoundQueue:GetCurrentSound() or self.sample
end

function PlayerFrame:Update()
    if not self.frame then return end
    local skin = self:Skin()
    if skin then skin:Update(); return end
    -- Hidden, not torn down, while subtitles stand in for it: going back finds it as it was.
    local head = self:Current()
    self.frame:SetShown(Addon:DisplayStyle() == "classic" and head ~= nil)
    if not self.frame:IsShown() then return end

    self:SetResizeBounds(FrameConfig().HidePortrait and 100 or PORTRAIT_SIZE + 100)

    self.frame.miniPause:Update()
    self.frame.portrait.pause:Update()

    Portrait:Configure(self.frame.portrait, head)
    local actionCount = Actions:Configure(self.frame, head)
    local strip = actionCount > 0 and Actions.STRIP_HEIGHT or 0
    self.frame.container:SetPoint("RIGHT", self.frame, "RIGHT", 0, (strip + (self.captionExtra or 0)) / 2)

    self.frame.container:SetHeight(self.frame:GetHeight())
    self.frame.container:Hide() -- 1.12 quirk: forces a relayout before measuring
    self.frame.container:Show()

    local lastRow = 0
    local lastContent = self.frame.container.name
    for i, clip in ipairs(SoundQueue:IsEmpty() and { head } or SoundQueue.sounds) do
        if i == 1 then
            self.frame.container.name:SetText(clip.present and clip.present.header or "")
        end
        lastRow = lastRow + 1
        local row = self.frame.container.buttons[lastRow] or self:CreateRow(lastRow)
        row:Configure(clip)
        lastContent = row
        if lastRow == MAX_ROWS then break end
    end
    for i = lastRow + 1, getn(self.frame.container.buttons) do
        self.frame.container.buttons[i]:Configure(nil)
    end
    self.frame.container.name:Update()

    local contentTop = self.frame.container.name:GetTop() or 0
    local contentBottom = lastContent:GetBottom() or 0
    self.frame.container:SetHeight(contentTop - contentBottom)
    self:LayoutCaptions()

    -- Again once the layout has settled: truncation and hover state both depend on where
    -- the rows ended up. Same frame on current clients, next frame on old ones.
    Addon:ScheduleTimer(function()
        self.frame.container.buttons:Update()
        self.frame.container.name:Update()
    end, 0)
end

--- What the frame is actually doing, for a bug report. A row that is present but drawn
--- nowhere, or drawn under something, looks from the outside exactly like a row that was
--- never built; this tells the two apart without a client to poke at.
function PlayerFrame:Describe()
    local lines = {}
    local function Say(text) table.insert(lines, text) end
    Say(MinimalPlayer:Describe())
    if DialogueUIPlayer then Say(DialogueUIPlayer:Describe()) end
    if not self.frame then
        Say("no frame built")
        return lines
    end
    local container = self.frame.container
    Say(format("frame shown=%s w=%.0f h=%.0f", tostring(self.frame:IsShown()),
        self.frame:GetWidth() or 0, self.frame:GetHeight() or 0))
    Say(format("container shown=%s w=%.0f h=%.0f header=%q", tostring(container:IsShown()),
        container:GetWidth() or 0, container:GetHeight() or 0, container.name:GetText() or ""))
    Say(format("portrait kind=%s actions=%d", tostring(self.frame.portrait.active),
        self.frame.actions and self.frame.actions.shown or 0))
    for index, button in ipairs(container.buttons) do
        if button:IsShown() then
            -- Whether a row takes a click matters: the head only does while the clip it
            -- stands for can be stopped, and a row that ignores clicks cannot be cancelled.
            Say(format("  row %d w=%.0f mouse=%s text=%q", index, button:GetWidth() or 0,
                tostring(button:IsMouseEnabled()), button.textWidget:GetText() or ""))
        end
    end
    for id, button in pairs(self.frame.actions.byId) do
        if button:IsShown() then
            Say(format("  action %s at %.0f,%.0f text=%q", id,
                button:GetLeft() or 0, button:GetBottom() or 0, button:GetText() or ""))
        end
    end
    Say(format("head can be stopped=%s", tostring(SoundQueue:CanBePaused())))
    Say(format("queue=%d", SoundQueue:GetQueueSize()))
    return lines
end

function PlayerFrame:SaveLayout()
    local width = self.frame:GetWidth() + (FrameConfig().HidePortrait and PORTRAIT_SIZE or 0)
    Addon:SaveLayout("Player", self.frame, width)
end

--- Back to the default spot and width, forgetting the saved ones, for a frame dragged
--- off-screen or sized past use.
function PlayerFrame:Reset()
    local skin = self:Skin()
    if skin then skin:Reset(); return end
    Addon:Layout().Player = nil
    if not self.frame then return end
    self.frame:Reset()
    -- Reset's width has the portrait in it, and RefreshConfig only takes it off on a change.
    if FrameConfig().HidePortrait then self.frame:SetWidth(self.frame:GetWidth() - PORTRAIT_SIZE) end
    self:RefreshConfig()
end
