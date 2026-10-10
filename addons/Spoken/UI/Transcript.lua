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
    return Addon:Profile("Transcript")
end
-- In the account-wide layout with the players' places, not the profile: see Addon:Layout.
local function Expanded()
    return Addon.db and Addon:Layout().CaptionsExpanded or false
end
local Label
local function LineCount()
    if Transcript.style and Transcript.style.lines then return Transcript.style.lines end
    if Expanded() then return EXPANDED_LINES end
    return Config().Lines == 1 and 1 or 2
end
-- How the captions follow the voice, by Config().ScrollMode:
--   line      the text glides up a line at a time as the voice reaches each line, the
--             line being read on the last row when typed out, else in the middle; the default
--   page      a page at a time, turned when the voice leaves it
--   off       the captions hold still; the wheel moves them
local function Mode()
    local mode = Config().ScrollMode
    if mode == "page" or mode == "off" then return mode end
    return "line"
end
local function PageOf(line)
    return math.floor((line - 1) / LineCount()) + 1
end
-- The glide's time constant, in seconds: it is 95% of the way there in three of these.
local GLIDE = 0.09
local function FontSize()
    return Transcript.style and Transcript.style.size or Config().FontSize or 16
end
local function LineGap()
    return Transcript.style and Transcript.style.lineGap or GAP
end
local function CharacterCount(text)
    local _, count = text:gsub(UTF8_CHAR, "")
    return math.max(1, count)
end
-- Trailing punctuation lengthens a word's share of the recording.
local STOPS = { ["."] = 0.7, ["!"] = 0.7, ["?"] = 0.7, ["。"] = 0.7, ["！"] = 0.7, ["？"] = 0.7,
    [","] = 0.35, [";"] = 0.35, [":"] = 0.35, ["，"] = 0.35, ["、"] = 0.35, ["；"] = 0.35, ["："] = 0.35 }
local CLOSERS = { ['"'] = true, ["'"] = true, [")"] = true, ["]"] = true, ["”"] = true, ["’"] = true,
    ["」"] = true, ["』"] = true, ["）"] = true, ["》"] = true, ["】"] = true }
local OPENERS = { ["“"] = true, ["‘"] = true, ["「"] = true, ["『"] = true, ["（"] = true,
    ["《"] = true, ["【"] = true }
local function PausesAfter(chars)
    local i = #chars
    while i > 1 and CLOSERS[chars[i]] do i = i - 1 end
    return STOPS[chars[i]] or 0
end
local function CodePoint(char)
    local a, b, c = char:byte(1, 3)
    if #char ~= 3 then return 0 end
    return (a % 16) * 4096 + (b % 64) * 64 + c % 64
end
-- Chinese has no spaces between words: each character (and kana) is a word of its own.
local function IsHan(char)
    local code = CodePoint(char)
    return code >= 0x3040 and code <= 0x30FF -- kana
        or code >= 0x3400 and code <= 0x9FFF or code >= 0xF900 and code <= 0xFAFF
end
-- Punctuation after a character stays with it, so no line starts with "，".
local function IsPunctuation(char)
    local code = CodePoint(char)
    return char:find("^%p$") or code >= 0x2000 and code <= 0x206F
        or code >= 0x3000 and code <= 0x303F or code >= 0xFF00 and code <= 0xFF65
end
-- Splits one whitespace-separated run into words: Chinese characters each
-- (with their punctuation), anything else in between as a whole.
local function SplitRun(run)
    local words, open = {}, {}
    local function Add(char, han)
        local word = { chars = open, han = han }
        word.chars[#word.chars + 1] = char
        words[#words + 1], open = word, {}
    end
    for char in run:gmatch(UTF8_CHAR) do
        local last = words[#words]
        if IsHan(char) then Add(char, true)
        elseif OPENERS[char] then open[#open + 1] = char
        elseif #open == 0 and last and (not last.han or IsPunctuation(char)) then
            last.chars[#last.chars + 1] = char
        else Add(char, false) end
    end
    if #open > 0 then -- An opening quote with nothing after it.
        if #words == 0 then words[1] = { chars = {} } end
        local last = words[#words].chars
        for _, char in ipairs(open) do last[#last + 1] = char end
    end
    return words
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

-- first/last are the word's bytes in text: SplitRun keeps every character in order, so a
-- caller can find the word in its own copy of the text.
local function Split(text)
    local words, total = {}, 0
    for at, space, run in text:gmatch("()(%s*)(%S+)") do
        local first = at + #space
        for i, word in ipairs(SplitRun(run)) do
            local count = #word.chars
            -- Longer words get more time, with a little extra for punctuation.
            -- Normalize these weights to the known duration of this recording.
            local weight = 0.6 + count * 0.12 + PausesAfter(word.chars)
            local wordText = table.concat(word.chars)
            words[#words + 1] = { text = wordText, count = count,
                breakBefore = i == 1 and space:find("\n") ~= nil, joined = i > 1,
                start = total, finish = total + weight,
                first = first, last = first + #wordText - 1 }
            first = first + #wordText
            total = total + weight
        end
    end
    return words, total
end

function Transcript:Split(text)
    return Split(text)
end

function Transcript:Tokenize()
    self.words, self.totalWeight = Split(self.text)
end

function Transcript:IsSpeaking(progress)
    return self.hasStarted and self:AudioElapsed() >= 0 and progress ~= nil and progress < 1
end

--- The word being read at progress, as ActiveSegment finds it but without the layout, so it
--- answers while the captions are hidden and not laid out.
function Transcript:WordAt(progress)
    local words = self.words
    if not progress or not words or #words == 0 then return nil end
    local target, low, high = progress * self.totalWeight, 1, #words
    while low < high do
        local mid = math.floor((low + high) / 2)
        if words[mid].finish <= target then low = mid + 1 else high = mid end
    end
    return low
end

function Transcript:SetClip(clip)
    self.clip, self.text = clip, self:TextFor(clip)
    self.manualScroll, self.hasStarted = false, false
    self.top, self.topTarget = 1, 1
    self:Tokenize()
    if not self.frame then return end
    self:Reflow()
end

--- Held while the window the captions are in is drawn as one image (DialogueUIPlayer:Buffer):
--- nothing in that image may change, or the client crashes (ASSERT(!m_deleted), CSimpleRender.cpp).
--- The line that ends as the window fades out keeps its words, which fade with it; whatever came
--- meanwhile is caught up on Release.
function Transcript:Hold()
    self.held = true
end

function Transcript:Release()
    if not self.held then return end
    self.held = nil
    local start = self.heldStart
    self.heldStart = nil
    if start then
        self:Started(start.clip)
        self.startedAt = start.at
    end
    self:Sync()
end

--- A window that turns to the next line by fading out first sets this: fn(clip) is true while it
--- will, and the captions keep the words showing until it has faded (it releases them).
Transcript.holdFor = nil

-- Whether the window asks the captions to wait before taking `clip`.
local function HeldFor(self, clip)
    return clip ~= nil and clip ~= self.clip and self.holdFor ~= nil and self.holdFor(clip) and true or false
end

function Transcript:Started(clip)
    if not self.held and HeldFor(self, clip) then self.held = true end
    if self.held then self.heldStart = { clip = clip, at = GetTime() }; return end
    self.elapsed, self.startedAt = -(clip.delay or 0), GetTime()
    self:SetClip(clip)
    self.hasStarted = true
    -- CLIP_STARTED precedes installation of the queue's timer. AUDIO_CHANGED
    -- follows it and supplies the final playback state.
    self:Update()
end

function Transcript:Sync()
    if self.held then return end
    -- The line playing, or the sample a window previews (PlayerFrame:ShowSample).
    local current = SoundQueue:GetCurrentSound() or (PlayerFrame and PlayerFrame.sample)
    -- A window turning to it by fading out first: these words stay until it has.
    if HeldFor(self, current) then
        self.held, self.heldStart = true, { clip = current, at = GetTime() }
        return
    end
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
    local button = self.expand:IsShown() and BUTTON_SIZE + GAP or 0
    local available = math.max(1, self.frame:GetWidth() - button)
    local paragraphs = self.style and self.style.paragraphs
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
            local prefix = line and #line > 0 and not word.joined and " " or ""
            local paragraph = pi == 1 and word.breakBefore and line and #line > 0
            if not line or paragraph or pi > 1 or self:TextWidth(lineText .. prefix .. text) > width then
                -- An empty line, about DialogueUI's paragraph gap, so the text still moves a
                -- line at a time.
                if paragraph and paragraphs then NewLine() end
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
    self.topTarget = self:Snap(self.topTarget or 1)
    self.top = Clamp(self.top or self.topTarget, 1, self:MaxTop())
    self.renderedKey, self.placedKey = nil, nil
    self:Render()
end

function Transcript:PageCount()
    return math.max(1, math.ceil(#(self.lines or {}) / LineCount()))
end

--- The scroll mode, with anything unknown saved read as "line".
function Transcript:ScrollMode()
    return Mode()
end

function Transcript:Page()
    return PageOf(self.topTarget or 1)
end

--- The highest first visible line; in page mode, the last page's first line.
function Transcript:MaxTop()
    if Mode() == "page" then return (self:PageCount() - 1) * LineCount() + 1 end
    return math.max(1, #(self.lines or {}) - LineCount() + 1)
end

--- `line` as a first visible line: within the text, and in page mode its page's first line.
function Transcript:Snap(line)
    local top = Clamp(math.floor(line + 0.5), 1, self:MaxTop())
    if Mode() == "page" then top = (PageOf(top) - 1) * LineCount() + 1 end
    return top
end

--- Where the first visible line goes for the voice on `line`, before Snap.
function Transcript:TargetFor(line)
    if Mode() == "page" then return line end
    local n = LineCount()
    -- Typed out, every line below the voice is still blank: keep it on the last row, with
    -- what has been read above it.
    local above = Config().Typewriter and n - 1 or math.floor((n - 1) / 2)
    return line - above
end

--- Whether the text can be drawn part-way between two lines: the frame must clip what
--- slides past its edges, or a half line would hang outside the captions.
function Transcript:CanGlide()
    return self.frame ~= nil and self.frame.SetClipsChildren ~= nil
end

--- The first visible line, fractional mid-glide, and the highest it can be. For a player
--- that draws its own scrollbar beside the captions.
function Transcript:GetScroll()
    return self.top or 1, self:MaxTop()
end

--- Show the captions from `line` on, holding there as a wheel scroll does.
function Transcript:ScrollTo(line)
    self.manualScroll = true
    self.topTarget = self:Snap(line)
    self.top = self.topTarget
    self:Update()
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
    local n, mode = LineCount(), Mode()
    local following = mode ~= "off" and not self.manualScroll
    if following then self.topTarget = segment and self:TargetFor(segment.line) or 1 end
    self.topTarget = self:Snap(self.topTarget or 1)
    -- Pages turn at once, and so does a far move: the glide is for following a voice.
    if mode == "page" or not self:CanGlide() or math.abs(self.topTarget - (self.top or 1)) > n then
        self.top = self.topTarget
    end
    local inSpeech = self:IsSpeaking(progress)
    local active = inSpeech and segment and segment.index or nil
    self.activeWord = active and segment.word or nil
    local highlighted = cfg.HighlightWord and self.activeWord or nil
    local neighbor
    if highlighted then
        -- The words at the page's two ends, past any empty line between paragraphs.
        local firstLine, lastLine = self.topTarget, math.min(#self.lines, self.topTarget + n - 1)
        while firstLine < lastLine and #self.lines[firstLine] == 0 do firstLine = firstLine + 1 end
        while lastLine > firstLine and #self.lines[lastLine] == 0 do lastLine = lastLine - 1 end
        local first, last = self.lines[firstLine], self.lines[lastLine]
        local firstWord = first and first[1] and first[1].word or 0
        local lastWord = last and last[#last] and last[#last].word or 0
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
    local first = math.floor(self.top)
    local key = format("%d:%d:%d:%d:%d", first, highlighted or 0, neighbor or 0, n, typedTo or -1)
    if self.renderedKey ~= key then
        self.renderedKey = key
        local color = self.style and self.style.highlight or HIGHLIGHT
        -- One row past the page, for the line sliding in under it mid-glide.
        for row, label in ipairs(self.labels) do
            local line = row <= n + 1 and self.lines[first + row - 1]
            local parts = {}
            for _, piece in ipairs(line or {}) do
                if typedTo and piece.word > typedTo then break end
                parts[#parts + 1] = piece.prefix .. ((piece.word == highlighted or piece.word == neighbor)
                    and color .. piece.text .. "|r" or piece.text)
            end
            label:SetText(table.concat(parts))
        end
    end
    self:Place()
end

function Transcript:Place()
    if not self.labels then return end
    local top = self.top or 1
    local first = math.floor(top)
    local fraction = top - first
    local step = FontSize() + LineGap()
    local n = LineCount()
    local placed = format("%.4f:%d:%d:%d", top, step, n, #(self.lines or {}))
    if self.placedKey == placed then return end
    self.placedKey = placed
    -- Room over the first line (style.padTop): the DialogueUI window leaves a line's room over
    -- and under the words, which a line gliding out or in fades through before it reaches the edge.
    local padTop = self.style and self.style.padTop
    for row, label in ipairs(self.labels) do
        label:ClearAllPoints()
        label:SetPoint("TOPLEFT", 0, -((padTop or 0) + ((row - 1) - fraction) * step))
        local line = self.lines and self.lines[first + row - 1]
        label:SetShown(line ~= nil and (row <= n or (row == n + 1 and fraction > 0)))
        -- The line leaving at the top fades out as it slides up and the one coming in under the
        -- page fades in, so the words never stop on a clean cut at an edge.
        label:SetAlpha(row == 1 and 1 - fraction or row == n + 1 and fraction or 1)
    end
end

function Transcript:Glide(elapsed)
    local top, target = self.top, self.topTarget
    if not top or not target or top == target then return end
    local moved = top + (target - top) * (1 - math.exp(-elapsed / GLIDE))
    if math.abs(target - moved) < 0.01 then moved = target end
    self.top = moved
    if math.floor(moved) ~= math.floor(top) then
        self:Render()
    else
        self:Place()
    end
end

--- With following turned off, clicking the captions turns it back on, line by line.
function Transcript:Follow()
    if Mode() == "off" then Config().ScrollMode = "line" end
    self.manualScroll = false
    self:Update()
end

--- The wheel: a page at a time in page mode, otherwise most of a page, gliding.
function Transcript:TurnPage(delta)
    if delta == 0 then return end
    self.manualScroll = true
    local n = LineCount()
    local step = Mode() == "page" and n or math.max(1, n - 1)
    self.topTarget = self:Snap((self.topTarget or 1) + (delta > 0 and -step or step))
    self:Update()
end

function Transcript:ToggleExpanded()
    -- Keep a manually chosen passage in view when the page size changes.
    local firstLine = self.topTarget or 1
    Addon:Layout().CaptionsExpanded = not Expanded()
    self.topTarget, self.top = firstLine, firstLine
    self:RefreshConfig()
end

-- The player owns position, scale, border and controls. This module owns only
-- the caption text and its reading position.
function Transcript:HeightForClip(clip)
    -- Subtitles stand apart from the player, which then keeps its compact height.
    if not Config().Enabled or Addon:DisplayStyle() == "subtitle" or not clip or self:TextFor(clip) == "" then return 0 end
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
    if not self.frame or self.held then return end
    self:Render()
    self.frame:SetShown(Config().Enabled and Addon:DisplayStyle() ~= "subtitle" and self.clip ~= nil and self.text ~= "")
    Subtitle:Update()
end

function Transcript:Reset()
    local cfg = Config()
    -- Back to the defaults a first install has (Core.lua). The style stays, as Enabled does: it
    -- is the choice of where captions go, not a tweak.
    local defaults = Defaults.profile.Transcript
    for _, key in ipairs({ "Lines", "FontSize", "ScrollMode", "HighlightWord", "Typewriter", "TypewriterBy",
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

local function SameStyle(a, b)
    if a == b then return true end
    if not a or not b then return false end
    if a.font ~= b.font or a.shadow ~= b.shadow or a.highlight ~= b.highlight or a.lines ~= b.lines
        or a.size ~= b.size or a.lineGap ~= b.lineGap or a.paragraphs ~= b.paragraphs
        or a.padTop ~= b.padTop then return false end
    local ca, cb = a.color or {}, b.color or {}
    return ca[1] == cb[1] and ca[2] == cb[2] and ca[3] == cb[3]
end

--- How a skin wants the captions drawn, or nil for the player's own look:
---   { font = face?, size = n?, lineGap = n?, paragraphs = true?, color = { r, g, b }?,
---     shadow = false?, highlight = "|cff..."?, lines = n? }
--- `paragraphs` puts an empty line between paragraphs. `lines` fixes the page size and hides
--- the expand button, so the account-wide expanded flag is not changed under the skin's panel.
function Transcript:SetStyle(style)
    -- Compared by content: a skin hands over a fresh table on every refresh.
    if SameStyle(self.style, style) then return end
    self.style = style
    self.renderedKey = nil
    self:RefreshConfig()
end

function Transcript:RefreshConfig()
    if not self.frame then return end
    local size = FontSize()
    local style = self.style or {}
    local face = style.font or GameFontNormal:GetFont()
    local color = style.color or { .88, .84, .76 }
    local glyph = [[Interface\Buttons\UI-]] .. (Expanded() and "Minus" or "Plus")
    self.expand:SetNormalTexture(glyph .. "Button-Up")
    self.expand:SetPushedTexture(glyph .. "Button-Down")
    self.expand:SetShown(style.lines == nil)
    -- A skin's page may be taller than the expanded eight lines; one label more than the
    -- page, for the line sliding in mid-glide.
    for row = #self.labels + 1, LineCount() + 1 do self.labels[row] = Label(self.frame) end
    self.measure:SetFont(face, size, "")
    for row, label in ipairs(self.labels) do
        label:SetFont(face, size, "")
        label:SetTextColor(color[1], color[2], color[3])
        label:SetShadowColor(0, 0, 0, style.shadow == false and 0 or 1)
        label:SetHeight(size + LineGap())
    end
    if PlayerFrame.frame then PlayerFrame:Update() end
    self:Reflow()
    self:Update()
end

function Label(parent)
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
    -- The frame it is docked in may take the wheel first (the DialogueUI panel, with Ctrl).
    frame:SetScript("OnMouseWheel", function(_, delta)
        local owner = frame:GetParent()
        if owner and owner.spokenWheel and owner.spokenWheel(delta) then return end
        self:TurnPage(delta)
    end)
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
    -- One more than a page holds, for the line sliding in mid-glide; what slides past the
    -- edges is cut there. Without clipping the text steps a line at a time instead.
    if frame.SetClipsChildren then frame:SetClipsChildren(true) end
    for row = 1, EXPANDED_LINES + 1 do self.labels[row] = Label(frame) end
    self.measure = Label(frame)
    self.measure:Hide() -- No width/anchors: measure the actual unwrapped glyphs.
    frame:SetScript("OnSizeChanged", function() self:Reflow() end)
    local accumulated = 0
    frame:SetScript("OnUpdate", function(_, elapsed)
        if self.held then return end
        self:Glide(elapsed)
        accumulated = accumulated + elapsed
        if accumulated >= 0.05 then accumulated = 0; self:Update() end
    end)
    Callbacks:Register("CLIP_STARTED", function(clip) self:Started(clip) end)
    Callbacks:Register("AUDIO_CHANGED", function() self:Sync() end)
    self:RefreshConfig()
    self:Sync()
end

function Transcript:Describe()
    return format("transcript=%s visible=%s lines=%d scroll=%s top=%.2f/%d page=%d/%d word=%s estimated=true; %s",
        tostring(Config().Enabled), tostring(self.frame and self.frame:IsVisible()),
        LineCount(), Mode(), self.top or 1, self:MaxTop(), self:Page(), self:PageCount(),
        tostring(self.activeWord), Subtitle:Describe())
end
