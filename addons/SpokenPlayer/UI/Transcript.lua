setfenv(1, SpokenEnv)

-- Use the text captured with each queued clip, never the currently open dialog.
-- Recordings have durations, not word timestamps; the highlight is an estimate.
Transcript = { elapsed = 0, manualScroll = false }

local GAP = 4
local EXPANDED_LINES = 8
local BUTTON_SIZE = 14
local HIGHLIGHT = "|cffffd100"
local UTF8_CHAR = "[%z\1-\127\194-\244][\128-\191]*"
local function Clamp(value, low, high)
    return math.max(low, math.min(high, value))
end
local function Config()
    return Addon.db and Addon.db.profile.Transcript or Defaults.profile.Transcript
end
-- In the account-wide layout with the players' places, not the profile: see Addon:Layout.
local function Expanded()
    return Addon.db and Addon:Layout().CaptionsExpanded or false
end
local function LineCount()
    if Expanded() then return EXPANDED_LINES end
    return Config().Lines == 1 and 1 or 2
end
local function CharacterCount(text)
    local _, count = text:gsub(UTF8_CHAR, "")
    return math.max(1, count)
end

function Transcript:CleanText(text)
    if type(text) ~= "string" then return "" end
    text = text:gsub("|H.-|h(.-)|h", "%1")
    text = text:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")
    text = text:gsub("|T.-|t", ""):gsub("|A.-|a", "")
    text = text:gsub("|n", "\n"):gsub("\r\n", "\n"):gsub("\r", "\n")
    return (text:gsub("^%s+", ""):gsub("%s+$", ""))
end

function Transcript:TextFor(clip)
    if not clip then return "" end
    return self:CleanText((clip.present or {}).transcript or clip.text)
end

function Transcript:AudioElapsed()
    if self.startedAt and self.clip and SoundQueue:IsPlaying(self.clip) then
        return GetTime() - self.startedAt - (self.clip.delay or 0)
    end
    return self.elapsed or 0
end

function Transcript:GetElapsed()
    return math.max(0, self:AudioElapsed())
end

function Transcript:GetProgress()
    local duration = self.clip and tonumber(self.clip.length)
    if not duration or duration <= 0 then return nil end
    return Clamp(self:GetElapsed() / duration, 0, 1)
end

function Transcript:Tokenize()
    self.words, self.totalWeight = {}, 0
    for space, text in self.text:gmatch("(%s*)(%S+)") do
        local count = CharacterCount(text)
        -- Longer words get more time, with a little extra for punctuation.
        -- Normalize these weights to the known duration of this recording.
        local weight = 0.6 + count * 0.12
        if text:find("[.!?][\"')%]]*$") then weight = weight + 0.7
        elseif text:find("[,;:][\"')%]]*$") then weight = weight + 0.35 end
        self.words[#self.words + 1] = { text = text, count = count,
            breakBefore = space:find("\n") ~= nil,
            start = self.totalWeight, finish = self.totalWeight + weight }
        self.totalWeight = self.totalWeight + weight
    end
end

function Transcript:SetClip(clip)
    self.clip, self.text = clip, self:TextFor(clip)
    self.manualScroll, self.page, self.hasStarted = false, 1, false
    self:Tokenize()
    if not self.frame then return end
    self:Reflow()
end

function Transcript:Started(clip)
    self.elapsed, self.startedAt = -(clip.delay or 0), GetTime()
    self:SetClip(clip)
    self.hasStarted = true
    -- CLIP_STARTED precedes installation of the queue's timer. AUDIO_CHANGED
    -- follows it and supplies the final playback state.
    self:Update()
end

function Transcript:Sync()
    local current = SoundQueue:GetCurrentSound()
    if current ~= self.clip then
        self.elapsed, self.startedAt = 0, nil
        self:SetClip(current)
    elseif self.startedAt and not SoundQueue:IsPlaying(current) then
        -- Pausing stops the sound. Keep its position, including any initial
        -- delay. Resume starts the file over and fires CLIP_STARTED again.
        self.elapsed = GetTime() - self.startedAt - (current and current.delay or 0)
        self.startedAt = nil
    end
    self:Update()
end

function Transcript:TextWidth(text)
    self.measure:SetText(text)
    return self.measure:GetStringWidth()
end

function Transcript:SplitWord(text, width)
    if self:TextWidth(text) <= width then return { text } end
    local pieces, part = {}, ""
    -- A very long name/word must fit too. Split only between UTF-8 characters.
    for char in text:gmatch(UTF8_CHAR) do
        if part ~= "" and self:TextWidth(part .. char) > width then
            pieces[#pieces + 1], part = part, ""
        end
        part = part .. char
    end
    if part ~= "" then pieces[#pieces + 1] = part end
    return pieces
end

function Transcript:Reflow()
    if not self.measure or not self.labels then return end
    local available = math.max(1, self.frame:GetWidth() - BUTTON_SIZE - GAP)
    local width = math.max(1, available - 2) -- Leave room for glyph rounding.
    self.lines, self.segments = {}, {}
    local line, lineText
    local function NewLine()
        line, lineText = {}, ""
        self.lines[#self.lines + 1] = line
    end
    for wi, word in ipairs(self.words or {}) do
        local pieces = self:SplitWord(word.text, width)
        local chars = 0
        for pi, text in ipairs(pieces) do
            local prefix = line and #line > 0 and " " or ""
            if not line or (pi == 1 and word.breakBefore and #line > 0)
                or pi > 1 or self:TextWidth(lineText .. prefix .. text) > width then
                NewLine()
                prefix = ""
            end
            local count = CharacterCount(text)
            local weight = word.finish - word.start
            local segment = { text = text, prefix = prefix, word = wi, line = #self.lines,
                start = word.start + weight * chars / word.count,
                finish = word.start + weight * (chars + count) / word.count }
            chars = chars + count
            self.segments[#self.segments + 1] = segment
            segment.index = #self.segments
            line[#line + 1] = segment
            lineText = lineText .. prefix .. text
        end
    end
    for _, label in ipairs(self.labels) do label:SetWidth(available) end
    self.page = Clamp(self.page or 1, 1, self:PageCount())
    self.renderedKey = nil
    self:Render()
end

function Transcript:PageCount()
    return math.max(1, math.ceil(#(self.lines or {}) / LineCount()))
end

function Transcript:ActiveSegment(progress)
    if not progress or not self.segments or #self.segments == 0 then return nil end
    local target = progress * self.totalWeight
    local low, high = 1, #self.segments
    while low < high do
        local mid = math.floor((low + high) / 2)
        if self.segments[mid].finish <= target then low = mid + 1 else high = mid end
    end
    return self.segments[low]
end

function Transcript:Render()
    if not self.labels then return end
    local cfg = Config()
    local progress = self:GetProgress()
    local segment = self:ActiveSegment(progress)
    local following = cfg.AutoScroll and not self.manualScroll
    if following then
        self.page = segment and math.floor((segment.line - 1) / LineCount()) + 1 or 1
    end
    self.page = Clamp(self.page or 1, 1, self:PageCount())
    local inSpeech = self.hasStarted and self:AudioElapsed() >= 0 and progress and progress < 1
    local active = inSpeech and segment and segment.index or nil
    self.activeWord = active and segment.word or nil
    local highlighted = cfg.HighlightWord and self.activeWord or nil
    local neighbor
    if highlighted then
        local firstLine = (self.page - 1) * LineCount() + 1
        local first = self.lines[firstLine]
        local last = self.lines[math.min(#self.lines, firstLine + LineCount() - 1)]
        local firstWord, lastWord = first[1].word, last[#last].word
        if highlighted < firstWord or highlighted > lastWord then
            highlighted = nil -- Manually reading a different page.
        elseif highlighted < lastWord then
            neighbor = highlighted + 1
        elseif highlighted > firstWord then
            -- Keep the last pair lit at a page boundary; do not advance the
            -- captions early just to show the next word.
            neighbor = highlighted - 1
        end
    end
    -- Typed out, as the subtitle is: the words up to the one being read, the rest still to
    -- come. Nothing before the voice starts; the whole line once it has finished.
    local typedTo
    -- Only with a length to time it by: a clip with none shows its whole line, as before.
    if cfg.Typewriter and progress then
        if inSpeech then typedTo = self.activeWord
        elseif not (progress and progress >= 1) then typedTo = 0 end
    end
    local key = format("%d:%d:%d:%d:%d", self.page, highlighted or 0, neighbor or 0, LineCount(), typedTo or -1)
    if self.renderedKey == key then return end
    self.renderedKey = key
    for row, label in ipairs(self.labels) do
        local line = row <= LineCount() and self.lines[(self.page - 1) * LineCount() + row]
        local parts = {}
        for _, piece in ipairs(line or {}) do
            if typedTo and piece.word > typedTo then break end
            parts[#parts + 1] = piece.prefix .. ((piece.word == highlighted or piece.word == neighbor)
                and HIGHLIGHT .. piece.text .. "|r" or piece.text)
        end
        label:SetText(table.concat(parts))
        label:SetShown(line ~= nil and line ~= false)
    end
end

function Transcript:Follow()
    Config().AutoScroll, self.manualScroll = true, false
    self:Update()
end

function Transcript:TurnPage(delta)
    if delta == 0 then return end
    self.manualScroll = true
    self.page = Clamp((self.page or 1) + (delta > 0 and -1 or 1), 1, self:PageCount())
    self:Update()
end

function Transcript:ToggleExpanded()
    -- Keep a manually chosen passage in view when the page size changes.
    local firstLine = ((self.page or 1) - 1) * LineCount() + 1
    Addon:Layout().CaptionsExpanded = not Expanded()
    self.page = math.floor((firstLine - 1) / LineCount()) + 1
    self:RefreshConfig()
end

-- The player owns position, scale, border and controls. This module owns only
-- the caption text and its reading position.
function Transcript:HeightForClip(clip)
    -- Subtitles stand apart from the player, which then keeps its compact height.
    if not Config().Enabled or Addon:PlayerStyle() == "subtitle" or not clip or self:TextFor(clip) == "" then return 0 end
    return LineCount() * ((Config().FontSize or 16) + GAP)
end

function Transcript:ResizePlayer(frame, height, minWidth, maxWidth)
    local oldHeight = frame:GetHeight()
    local point, relative, relativePoint, x, y = frame:GetPoint(1)
    if frame.SetResizeBounds then
        frame:SetResizeBounds(minWidth, height, maxWidth, height)
    else
        frame:SetMinResize(minWidth, height)
        frame:SetMaxResize(maxWidth, height)
    end
    if oldHeight == height then return end
    frame:SetHeight(height)
    if point then
        -- Keep the portrait in place and grow downwards. The saved anchor may
        -- be TOPLEFT after a drag, BOTTOM by default, or CENTER after UI restore.
        local shift = point:find("TOP") and 0 or point:find("BOTTOM") and 1 or .5
        frame:ClearAllPoints()
        frame:SetPoint(point, relative, relativePoint, x, y - (height - oldHeight) * shift)
    end
end

function Transcript:Dock(parent, anchor, point, x, y, width, height)
    if not self.frame then return end
    local changed = self.frame:GetParent() ~= parent or self.frame:GetWidth() ~= width
        or self.frame:GetHeight() ~= height
    self.frame:SetParent(parent)
    self.frame:SetFrameLevel(anchor:GetFrameLevel() + 1)
    self.frame:ClearAllPoints()
    self.frame:SetPoint("TOPLEFT", anchor, point, x, y)
    self.frame:SetSize(width, height)
    self.frame:SetShown(height > 0)
    if changed then self:Reflow() end
end

function Transcript:Update()
    if not self.frame then return end
    self:Render()
    self.frame:SetShown(Config().Enabled and Addon:PlayerStyle() ~= "subtitle" and self.clip ~= nil and self.text ~= "")
    Subtitle:Update()
end

function Transcript:Reset()
    local cfg = Config()
    -- Back to the defaults a first install has (Core.lua). The style stays, as Enabled does: it
    -- is the choice of where captions go, not a tweak.
    local defaults = Defaults.profile.Transcript
    for _, key in ipairs({ "Lines", "FontSize", "AutoScroll", "HighlightWord", "Typewriter", "TypewriterBy",
        "SubtitleShadow", "SubtitleScale" }) do
        cfg[key] = defaults[key]
    end
    Subtitle:Reset()
    Addon:Layout().CaptionsExpanded = false
    self.manualScroll = false
    self:RefreshConfig()
end

function Transcript:SetEnabled(enabled)
    Config().Enabled = enabled and true or false
    if PlayerFrame.frame then PlayerFrame:Update() end
    self:Update()
end

function Transcript:RefreshConfig()
    if not self.frame then return end
    local size = Config().FontSize or 16
    local glyph = [[Interface\Buttons\UI-]] .. (Expanded() and "Minus" or "Plus")
    self.expand:SetNormalTexture(glyph .. "Button-Up")
    self.expand:SetPushedTexture(glyph .. "Button-Down")
    self.measure:SetFont(GameFontNormal:GetFont(), size, "")
    for row, label in ipairs(self.labels) do
        label:SetFont(GameFontNormal:GetFont(), size, "")
        label:ClearAllPoints()
        label:SetPoint("TOPLEFT", 0, -(row - 1) * (size + GAP))
        label:SetHeight(size + GAP)
    end
    if PlayerFrame.frame then PlayerFrame:Update() end
    self:Reflow()
    self:Update()
end

local function Label(parent)
    local label = parent:CreateFontString(nil, "OVERLAY")
    label:SetFont(GameFontNormal:GetFont(), 16, "")
    label:SetTextColor(.88, .84, .76)
    label:SetShadowColor(0, 0, 0, 1)
    label:SetShadowOffset(1, -1)
    label:SetJustifyH("LEFT")
    label:SetJustifyV("TOP")
    label:SetWordWrap(false)
    return label
end

function Transcript:Initialize()
    if self.frame then return end
    local frame = CreateFrame("Button", "SpokenTranscriptFrame", PlayerFrame.frame)
    self.frame = frame
    self.lines, self.words, self.segments = {}, {}, {}
    frame:Hide()
    frame:EnableMouseWheel(true)
    frame:RegisterForClicks("LeftButtonUp", "RightButtonUp")
    frame:SetScript("OnMouseWheel", function(_, delta) self:TurnPage(delta) end)
    frame:SetScript("OnClick", function(_, button)
        if button == "RightButton" then
            if MinimalPlayer:IsEnabled() then MinimalPlayer:ToggleMenu()
            else Options:Open() end
        else self:Follow() end
    end)
    frame:SetScript("OnEnter", function()
        GameTooltip:SetOwner(frame, "ANCHOR_RIGHT")
        GameTooltip:SetText(L.TRANSCRIPT)
        GameTooltip:AddLine(L.TRANSCRIPT_HINT, 1, .82, 0, true)
        GameTooltip:Show()
    end)
    local function HideTooltip()
        if GameTooltip:GetOwner() == frame then GameTooltip_Hide() end
    end
    frame:SetScript("OnLeave", HideTooltip)
    frame:SetScript("OnHide", HideTooltip)
    self.expand = CreateFrame("Button", nil, frame)
    self.expand:SetSize(BUTTON_SIZE, BUTTON_SIZE)
    self.expand:SetPoint("TOPRIGHT", 0, -1)
    self.expand:SetHighlightTexture([[Interface\Buttons\UI-PlusButton-Hilight]], "ADD")
    self.expand:SetScript("OnClick", function()
        self:ToggleExpanded()
        GameTooltip_Hide()
    end)
    self.expand:SetScript("OnEnter", function(button)
        GameTooltip:SetOwner(button, "ANCHOR_RIGHT")
        GameTooltip:SetText(Expanded() and L.TRANSCRIPT_COLLAPSE or L.TRANSCRIPT_EXPAND)
        GameTooltip:Show()
    end)
    local function HideExpandTooltip()
        if GameTooltip:GetOwner() == self.expand then GameTooltip_Hide() end
    end
    self.expand:SetScript("OnLeave", HideExpandTooltip)
    self.expand:SetScript("OnHide", HideExpandTooltip)
    self.labels = {}
    for row = 1, EXPANDED_LINES do self.labels[row] = Label(frame) end
    self.measure = Label(frame)
    self.measure:Hide() -- No width/anchors: measure the actual unwrapped glyphs.
    frame:SetScript("OnSizeChanged", function() self:Reflow() end)
    local accumulated = 0
    frame:SetScript("OnUpdate", function(_, elapsed)
        accumulated = accumulated + elapsed
        if accumulated >= 0.05 then accumulated = 0; self:Update() end
    end)
    Callbacks:Register("CLIP_STARTED", function(clip) self:Started(clip) end)
    Callbacks:Register("AUDIO_CHANGED", function() self:Sync() end)
    self:RefreshConfig()
    self:Sync()
end

function Transcript:Describe()
    return format("transcript=%s visible=%s lines=%d page=%d/%d word=%s estimated=true; %s",
        tostring(Config().Enabled), tostring(self.frame and self.frame:IsVisible()),
        LineCount(), self.page or 1, self:PageCount(), tostring(self.activeWord), Subtitle:Describe())
end
