setfenv(1, SpokenEnv)

QueuePlayer = {}
local ART = [[Interface\AddOns\Spoken\Textures\]]
local WIDTH, FACE, ROW, MAX_ROWS = 460, 100, 24, 3
local function Config() return Addon:Profile("Frame") end
local function Label(clip)
    local present = clip and clip.present or {}
    return present.label or present.header or (clip and clip.key) or ""
end
local CATEGORIES = { quests = L.QUEUE_CATEGORY_QUEST, books = L.QUEUE_CATEGORY_BOOK, zones = L.QUEUE_CATEGORY_ZONE }
local function RowLabel(clip)
    local source = clip and clip.source
    if not source or source.key == "sample" then return Label(clip) end
    local present = clip.present or {}
    if source.key == "quests" and present.bullet == "gossip" then
        return present.header and present.header ~= "" and present.header or Label(clip)
    end
    local category = CATEGORIES[source.key] or source.title or source.key
    return category and format("(%s) %s", category, Label(clip)) or Label(clip)
end
local function Text(parent, size)
    local text = parent:CreateFontString(nil, "OVERLAY")
    text:SetFont(GameFontNormal:GetFont(), size, "")
    text:SetShadowColor(0, 0, 0, 1)
    text:SetShadowOffset(1, -1)
    text:SetJustifyH("LEFT")
    text:SetWordWrap(false)
    return text
end

function QueuePlayer:IsEnabled()
    return Addon.db and Addon:DisplayStyle() == "queue"
end

function QueuePlayer:HasClip()
    return self:IsEnabled() and self.wanted and SoundQueue:GetCurrentSound() ~= nil
end

function QueuePlayer:ConfigurePortrait()
    if not self.portrait or not self.clip or Config().HidePortrait then return end
    Portrait:Configure(self.portrait, self.clip)
end

function QueuePlayer:Initialize(original)
    if self.frame then return end
    local frame = CreateFrame("Frame", "SpokenQueuePlayerFrame", UIParent)
    self.frame, self.rows, self.offset = frame, {}, 0
    frame:SetSize(WIDTH, 150)
    if not Addon:RestoreLayout("Queue", frame) then
        local point, relative, relativePoint, x, y = original:GetPoint(1)
        frame:SetPoint(point or "BOTTOM", relative or UIParent, relativePoint or "BOTTOM", x or 0, y or 200)
    end
    frame:SetMovable(true)
    frame:SetClampedToScreen(true)
    frame:SetUserPlaced(false)
    frame:EnableMouse(true)
    frame:RegisterForDrag("LeftButton")
    frame:SetScript("OnDragStart", function()
        if not Addon:IsFrameLocked() then frame:StartMoving() end
    end)
    frame:SetScript("OnDragStop", function()
        frame:StopMovingOrSizing()
        Addon:SaveLayout("Queue", frame)
    end)
    frame:SetScript("OnMouseUp", function(_, button)
        if button == "RightButton" then Options:Open() end
    end)
    frame:EnableMouseWheel(true)
    frame:SetScript("OnMouseWheel", function(_, delta) self:Scroll(-delta) end)
    frame:SetScript("OnUpdate", function() self:UpdateProgress() end)
    frame:Hide()
    self.fader = Actions.Fader(frame, function() return { self.portrait.model } end)

    local background = frame:CreateTexture(nil, "BACKGROUND")
    background:SetTexture(ART .. "BackgroundGradient")
    background:SetAllPoints()
    self.portrait = CreateFrame("Frame", nil, frame)
    frame.portrait = self.portrait
    self.portrait:SetSize(FACE, FACE)
    self.portrait:SetPoint("TOPLEFT", 10, -14)
    local backing = self.portrait:CreateTexture(nil, "BACKGROUND")
    backing:SetTexture(ART .. "PortraitFrameBackground")
    backing:SetAllPoints()
    local border = CreateFrame("Frame", nil, self.portrait)
    border:SetFrameLevel(self.portrait:GetFrameLevel() + 3)
    border:SetAllPoints()
    local ring = border:CreateTexture(nil, "OVERLAY")
    ring:SetTexture(ART .. "PortraitFrameAtlas")
    ring:SetTexCoord(0, 416 / 512, 0, 416 / 512)
    ring:SetPoint("TOPLEFT", -10, 10)
    ring:SetPoint("BOTTOMRIGHT", 10, -10)

    self.content = CreateFrame("Frame", nil, frame)
    frame.container = self.content
    self.name = Text(self.content, 17)
    self.content.name = self.name
    self.name:SetTextColor(1, .82, 0)
    self.name:SetHeight(24)
    self.name:SetPoint("TOPLEFT")
    self.controls = CreateFrame("Frame", nil, self.content)
    self.controls:SetHeight(1)
    self.controls:SetPoint("RIGHT", self.content, "TOPRIGHT", 0, -12)
    self.name:SetPoint("RIGHT", self.controls, "LEFT", -8, 0)
    self.play = Actions.RoundButton(self.controls, 12)
    self.play:SetScript("OnClick", function()
        if not self.wanted or SoundQueue:IsEmpty() or not SoundQueue:CanBePaused() then return end
        SoundQueue:TogglePauseQueue()
    end)
    self.play:SetScript("OnEnter", function(button)
        GameTooltip:SetOwner(button, "ANCHOR_TOP")
        GameTooltip:SetText(SoundQueue:IsPaused() and L.PLAY or L.QUEUE_PAUSE)
        GameTooltip:Show()
    end)
    self.pauseBars = {}
    for index = 1, 2 do
        local bar = self.play:CreateTexture(nil, "OVERLAY")
        bar:SetColorTexture(1, .82, 0, 1)
        bar:SetSize(3, 11)
        bar:SetPoint("CENTER", index == 1 and -3 or 3, 0)
        self.pauseBars[index] = bar
    end
    self.buttons = { self.play }
    Actions:Build(frame)
    self.progress = Actions.ProgressBar(self.content)
    self.progress.track:SetPoint("TOPLEFT", self.content, "TOPLEFT", 0, -27)

    local function Arrow(direction, click)
        local button = CreateFrame("Button", nil, self.content)
        button:SetSize(20, 20)
        local texture = [[Interface\Buttons\UI-ScrollBar-Scroll]] .. direction .. "Button-"
        button:SetNormalTexture(texture .. "Up")
        button:SetPushedTexture(texture .. "Down")
        button:SetHighlightTexture(texture .. "Highlight", "ADD")
        button:SetScript("OnClick", click)
        return button
    end
    self.up = Arrow("Up", function() self:Scroll(-1) end)
    self.down = Arrow("Down", function() self:Scroll(1) end)
    self.more = Text(self.content, 16)
    self.more:SetText("...")
    self.more:SetTextColor(1, .82, 0)
    self.more:SetJustifyH("CENTER")
    self.more:SetSize(30, 10)
    -- The bottom padding holds the cue without changing the window's height.
    self.more:SetPoint("TOP", self.content, "BOTTOM", -14, 0)
    self.more:Hide()
end

function QueuePlayer:Row(index)
    if self.rows[index] then return self.rows[index] end
    local row = CreateFrame("Frame", nil, self.content)
    row:SetHeight(ROW)
    row:SetPoint("TOPLEFT", 0, -38 - (index - 1) * ROW)
    row:SetPoint("RIGHT")
    row.marker = row:CreateTexture(nil, "OVERLAY")
    row.marker:SetSize(12, 12)
    row.marker:SetPoint("LEFT", 3, 0)
    Actions.Glyph(row.marker, "play")
    row.remove = CreateFrame("Button", nil, row)
    row.remove:SetSize(20, 20)
    row.remove:SetPoint("RIGHT")
    row.remove:SetNormalTexture(ART .. "SoundQueueBulletDelete")
    row.remove:SetScript("OnClick", function()
        -- Scrolling reuses the row, so dismiss the clip it currently represents.
        if row.clip then SoundQueue:RemoveSoundFromQueue(row.clip) end
    end)
    row.remove:SetScript("OnEnter", GameTooltip_Hide)
    row.remove:SetScript("OnLeave", GameTooltip_Hide)
    row.label = Text(row, 13)
    row.label:SetPoint("LEFT", row.marker, "RIGHT", 2, 0)
    row.label:SetPoint("RIGHT", row.remove, "LEFT", -5, 0)
    row.label:SetHeight(ROW)
    row:EnableMouse(true)
    row:SetScript("OnEnter", function()
        if not row.clip then return end
        GameTooltip:SetOwner(row, "ANCHOR_RIGHT")
        GameTooltip:SetText(RowLabel(row.clip))
        local present = row.clip.present or {}
        if present.header and present.header ~= Label(row.clip) and present.header ~= RowLabel(row.clip) then
            GameTooltip:AddLine(present.header, 1, .82, 0)
        end
        local reason = SoundQueue:GetHeldReason(row.clip)
        if reason then GameTooltip:AddLine(reason, 1, .82, 0, true) end
        GameTooltip:Show()
    end)
    row:SetScript("OnLeave", GameTooltip_Hide)
    self.rows[index] = row
    return row
end

function QueuePlayer:Scroll(delta)
    self.offset = math.max(0, math.min(math.max(0, SoundQueue:GetQueueSize() - MAX_ROWS), self.offset + delta))
    self:Update()
end

function QueuePlayer:SetVisible(shown, immediate)
    if not self.frame then return end
    self.wanted = shown and true or false
    if not shown then
        local owner = GameTooltip:GetOwner()
        if MinimalPlayer.parts.BelongsTo(owner, self.frame) then GameTooltip_Hide() end
    end
    self.fader:Set(shown, immediate)
end

function QueuePlayer:RefreshConfig(original)
    self:Initialize(original.frame)
    local cfg = Config()
    self.frame:SetScale(cfg.FrameScale)
    self.frame:SetFrameStrata(cfg.FrameStrata)
    self.portrait:SetShown(not cfg.HidePortrait)
    self.content:ClearAllPoints()
    self.content:SetPoint("TOPLEFT", cfg.HidePortrait and 16 or 128, -12)
    self.content:SetWidth(WIDTH - (cfg.HidePortrait and 16 or 128) - 16)
    self.progress.track:SetWidth(self.content:GetWidth())
    if Addon:IsFrameLocked() then self.frame:StopMovingOrSizing() end
    Addon:ApplyHost(self.frame)
    self:Update()
end

function QueuePlayer:Update()
    if not self.frame then return end
    if not self:IsEnabled() then self:SetVisible(false, true); return end
    local clip = PlayerFrame:Current()
    if not clip or Actions.DialogCovers() then self:SetVisible(false); return end
    if clip ~= self.clip then self.clip, self.seconds, self.offset = clip, 0, 0 end
    self.name:SetText((clip.present or {}).header or Label(clip))
    Addon:ClipFont(self.name, clip)
    self:ConfigurePortrait()
    local controls = Actions:HeaderControls(self.frame, self.controls, self.buttons, clip)
    Actions.LayOutRow(self.controls, controls, 4)
    local paused = SoundQueue:IsPaused()
    Actions.SetPlayGlyph(self.play, "play")
    self.play.glyph:SetShown(paused)
    for _, bar in ipairs(self.pauseBars) do bar:SetShown(not paused) end
    self.play.state = paused and "play" or "pause"
    Actions.SetPausable(self.buttons)
    if not SoundQueue:IsEmpty() and SoundQueue:CanBePaused() then self.play:Enable() else self.play:Disable() end
    local queue = SoundQueue:GetQueue()
    -- Preview uses a sample without adding synthetic entries to the audio queue.
    if getn(queue) == 0 then queue = { clip } end
    local count = getn(queue)
    self.offset = math.max(0, math.min(self.offset, count - math.min(count, MAX_ROWS)))
    local visible = math.min(count, MAX_ROWS)
    local rowTop = Config().QueueProgress == true and 38 or 27
    for index = 1, MAX_ROWS do
        local row = self:Row(index)
        row:ClearAllPoints()
        row:SetPoint("TOPLEFT", 0, -rowTop - (index - 1) * ROW)
        -- Reserve the arrows' column even when the queue is too short to scroll.
        row:SetPoint("TOPRIGHT", self.content, "TOPRIGHT", -28, -rowTop - (index - 1) * ROW)
        local entry = index <= visible and queue[self.offset + index] or nil
        row.clip = entry
        row:SetShown(entry ~= nil)
        if entry then
            local current = entry == queue[1]
            row.label:SetText(RowLabel(entry))
            Addon:ClipFont(row.label, entry)
            row.label:SetTextColor(current and 1 or .85, current and .82 or .85, current and 0 or .85)
            row.marker:SetShown(current and SoundQueue:IsPlaying(entry))
            row.remove:SetShown(entry ~= PlayerFrame.sample)
            if not current or SoundQueue:CanBePaused() then row.remove:Enable() else row.remove:Disable() end
        end
    end
    local paging = count > MAX_ROWS
    self.up:ClearAllPoints()
    self.up:SetPoint("TOPRIGHT", self.content, "TOPRIGHT", 0, -rowTop - (ROW - 20) / 2)
    self.down:ClearAllPoints()
    self.down:SetPoint("TOPRIGHT", self.content, "TOPRIGHT", 0, -rowTop - ROW - (ROW - 20) / 2)
    self.up:SetShown(paging)
    self.down:SetShown(paging)
    self.more:SetShown(paging)
    self.up:SetAlpha(self.offset > 0 and 1 or .4)
    self.down:SetAlpha(self.offset + visible < count and 1 or .4)
    if self.offset > 0 then self.up:Enable() else self.up:Disable() end
    if self.offset + visible < count then self.down:Enable() else self.down:Disable() end
    self.content:SetHeight(rowTop + visible * ROW + 4)
    local height = math.max(FACE + 28, self.content:GetHeight() + 24)
    local oldHeight = self.frame:GetHeight()
    if height ~= oldHeight then
        local point, relative, relativePoint, x, y = self.frame:GetPoint(1)
        self.frame:SetHeight(height)
        if point then
            local shift = point:find("TOP") and 0 or point:find("BOTTOM") and 1 or .5
            self.frame:ClearAllPoints()
            self.frame:SetPoint(point, relative, relativePoint, x, y - (height - oldHeight) * shift)
        end
    end
    self:UpdateProgress()
    self:SetVisible(true)
end

function QueuePlayer:UpdateProgress()
    if not self.clip or not self:IsEnabled() then return end
    self.seconds = Actions.Elapsed(self.clip, self.seconds or 0)
    Actions.SetProgress(self.progress, SoundQueue:Share(self.clip, self.seconds))
    self.progress.track:SetShown(Config().QueueProgress == true)
end

function QueuePlayer:Reset()
    Addon:Layout().Queue = nil
    if not self.frame then return end
    self.frame:StopMovingOrSizing()
    self.frame:ClearAllPoints()
    self.frame:SetPoint("BOTTOM", UIParent, "BOTTOM", 0, 200)
    self:RefreshConfig(PlayerFrame)
end

function QueuePlayer:Describe()
    return format("queue style=%s visible=%s offset=%d", tostring(self:IsEnabled()),
        tostring(self.frame and self.frame:IsShown()), self.offset or 0)
end
