setfenv(1, SpokenEnv)

-- Captions as a subtitle: the speaker's name, and the line typed in beneath it, centred low
-- on the screen over a soft shadow. Ported from LoreTeller Forever's subtitle style.
--
-- One of the narrator styles (Addon:PlayerStyle), the one with no window: the two windows
-- hide while it is chosen. This file owns only its frame and how the text is revealed. The
-- clip, its cleaned text and how far the voice has got all come from Transcript, so pause,
-- restart, skip and Stop behave exactly as they do in the windows.
Subtitle = {}

-- The widest a line runs, padding included. LoreTeller matched Plumber's talking head.
local WIDTH = 512
local PAD, TOP_PAD, TITLE_GAP, BOTTOM_PAD, LINE_GAP = 16, 12, 4, 12, 2
-- The most lines shown at once. Longer text is split into pages of up to this many, at sentence
-- ends where a sentence fits, and each page replaces the last once its share of the clip has
-- played.
local PAGE_LINES = 4
local FADE_IN, FADE_OUT = .6, .5
-- Until it is dragged: the top edge, in UI units up from the bottom of the screen.
local DEFAULT_TOP = 336
local SHADOW = [[Interface\AddOns\SpokenPlayer\Textures\SubtitleShadow]]
local SHADOW_ROOM = 26        -- how far the shadow reaches past the subtitle's frame, top and bottom
local TEXTURES = [[Interface\AddOns\SpokenPlayer\Textures\]]
-- A page fades out before the next fades in; the shadow eases to the new page's size.
local PAGE_OUT, PAGE_IN = .18, .28
-- "(paused)" beside the title fades in and out over this long.
local PAUSED_FADE = .25
local SIZE_EASE = 10
-- The controls shown on hover: the windows' round pause button, skip, and Report.
local CONTROL_SIZE, CONTROL_GAP = 24, 4
local CONTROLS_FADE = .15
local PORTRAIT_ATLAS_SIZE = 512
local UTF8_CHAR = "[%z\1-\127\194-\244][\128-\191]*"

local function Config()
    return Addon.db and Addon.db.profile.Transcript or Defaults.profile.Transcript
end
-- The player's lock covers this frame too: locked, it is click-through.
local function Locked()
    return (Addon.db and Addon.db.profile.Frame or Defaults.profile.Frame).LockFrame
end
-- Whether the pointer is over a shown frame.
local function Over(frame)
    if not (frame and frame:IsShown()) then return false end
    if frame.IsMouseOver then return frame:IsMouseOver() and true or false end
    return MouseIsOver and MouseIsOver(frame) and true or false
end
local function Characters(text)
    local _, count = text:gsub(UTF8_CHAR, "")
    return count
end
local function Words(text)
    local count = 0
    for _ in text:gmatch("%S+") do count = count + 1 end
    return count
end

local function Prefix(text, count)
    local parts = {}
    for char in text:gmatch(UTF8_CHAR) do
        if #parts >= count then break end
        parts[#parts + 1] = char
    end
    return table.concat(parts)
end

-- Sentences with their trailing space kept, so joining them gives back the text exactly.
-- LoreTeller trimmed them and then measured what was left over against the untrimmed text,
-- which repeated the tail of any line with spaces in it.
-- Chinese and Japanese end a sentence with a full-width mark and no space after it: a piece is
-- cut after each, so text with no spaces still has sentence ends to page at.
local WIDE_ENDS = { "\227\128\130", "\239\188\129", "\239\188\159" } -- 。！？
local function SplitWide(piece, into)
    while true do
        local cut
        for _, mark in ipairs(WIDE_ENDS) do
            local _, finish = string.find(piece, mark, 1, true)
            if finish and (not cut or finish < cut) then cut = finish end
        end
        if not cut or cut >= string.len(piece) then break end
        into[#into + 1] = string.sub(piece, 1, cut)
        piece = string.sub(piece, cut + 1)
    end
    into[#into + 1] = piece
end
local function Sentences(text)
    local found, rest = {}, 1
    -- A closing quote or bracket after the stop belongs to the sentence it closes.
    for sentence, finish in text:gmatch("([^%.!?]*[%.!?]+[\"')%]]*%s*)()") do
        found[#found + 1] = sentence
        rest = finish
    end
    local tail = text:sub(rest)
    if tail:find("%S") then found[#found + 1] = tail end
    local sentences = {}
    for _, piece in ipairs(found) do SplitWide(piece, sentences) end
    return sentences
end

function Subtitle:Width(text)
    self.measure:SetText(text)
    return self.measure:GetStringWidth()
end

function Subtitle:Wrap(text)
    local limit, lines, line = WIDTH - PAD * 2, {}, ""
    local function Add(piece, joiner)
        local trial = line == "" and piece or line .. joiner .. piece
        if line == "" or self:Width(trial) <= limit then
            line = trial
        else
            lines[#lines + 1] = line
            line = piece
        end
    end
    for word in text:gmatch("%S+") do
        if self:Width(word) <= limit then
            Add(word, " ")
        else
            -- A word wider than a line, a long name or text written without spaces, breaks
            -- between characters, as the docked captions do.
            local joiner = " "
            for char in word:gmatch(UTF8_CHAR) do
                Add(char, joiner)
                joiner = ""
            end
        end
    end
    if line ~= "" then lines[#lines + 1] = line end
    return lines
end

--- Pages of at most PAGE_LINES lines each: as many whole sentences as fit on a page, and a
--- sentence too long for one page cut between words into runs that do. Joined, the pages give
--- back the text's words in order, which is what page timing and the active word count on.
function Subtitle:Paginate(text)
    if #self:Wrap(text) <= PAGE_LINES then return { text } end
    local function Fits(candidate) return #self:Wrap(candidate) <= PAGE_LINES end
    local pieces = {}
    for _, sentence in ipairs(Sentences(text)) do
        if Fits(sentence) then
            pieces[#pieces + 1] = sentence
        else
            local run = ""
            for word, space in sentence:gmatch("(%S+)(%s*)") do
                if run ~= "" and not Fits(run .. word) then
                    pieces[#pieces + 1] = run
                    run = ""
                end
                if Fits(word) then
                    run = run .. word .. space
                else
                    -- One unbroken run longer than a page, as text written without spaces is:
                    -- cut between characters, as Wrap breaks it into lines.
                    for char in word:gmatch(UTF8_CHAR) do
                        if run ~= "" and not Fits(run .. char) then
                            pieces[#pieces + 1] = run
                            run = ""
                        end
                        run = run .. char
                    end
                    run = run .. space
                end
            end
            if run:find("%S") then pieces[#pieces + 1] = run end
        end
    end
    local pages, page = {}, ""
    for _, piece in ipairs(pieces) do
        if page ~= "" and not Fits(page .. piece) then
            pages[#pages + 1] = (page:gsub("%s+$", ""))
            page = ""
        end
        page = page .. piece
    end
    if page:find("%S") then pages[#pages + 1] = (page:gsub("%s+$", "")) end
    return pages
end

function Subtitle:Build()
    local frame = CreateFrame("Frame", "SpokenSubtitleFrame", UIParent)
    self.frame = frame
    frame:SetSize(WIDTH, 100)
    -- Low, under every panel: the map, the quest log or Lore of Azeroth opened over a line in
    -- progress covers the words, rather than the words lying across the window.
    frame:SetFrameStrata("LOW")
    frame:SetClampedToScreen(true)
    -- Dragged by hand rather than with StartMoving, which would let it wander sideways: the
    -- subtitle always sits on the screen's centre line, and only its height is the player's.
    frame:RegisterForDrag("LeftButton")
    frame:SetScript("OnDragStart", function()
        if Locked() then return end
        local _, y = GetCursorPosition()
        self.dragFrom = { cursor = y, top = self:Top() }
    end)
    frame:SetScript("OnDragStop", function()
        if not self.dragFrom then return end
        self:DragTo()
        self.dragFrom = nil
        Addon:Layout().Subtitle = { top = self:Top() }
    end)
    -- The words do nothing when clicked: a subtitle mid-screen is clicked by accident all the
    -- time. Play or pause and Report come up beside it under the pointer (Subtitle:BuildControls).
    -- No right-click menu either: a right-drag here is the camera turning.
    frame:SetScript("OnUpdate", function(_, elapsed) self:Tick(elapsed) end)
    frame:Hide()
    self:BuildControls()

    self.shadow = frame:CreateTexture(nil, "BACKGROUND")
    self.shadow:SetTexture(SHADOW)
    -- Nine-sliced where the client can, so the faded edges keep their width at any size.
    -- Elsewhere the whole texture stretches, which softens the edges but still reads.
    if self.shadow.SetTextureSliceMargins then
        self.shadow:SetTextureSliceMargins(30, 30, 30, 30)
        self.shadow:SetTextureSliceMode(0)
    end
    -- From the frame's top, a little low: the last line's descenders and text shadow sit lower
    -- than the title's top. Hung from the top, an eased height grows it downward as the
    -- subtitle does, rather than both ways from its middle.
    self.shadow:SetPoint("TOP", frame, "TOP", 0, SHADOW_ROOM - 2)

    self.title = frame:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
    self.title:SetPoint("TOP", 0, -TOP_PAD)
    self.title:SetJustifyH("CENTER")
    self.title:SetTextColor(1, .82, 0)
    self.title:SetShadowColor(0, 0, 0, 1)
    self.title:SetShadowOffset(1, -1)
    -- With no window there is no paused portrait to say so: "(paused)" beside the title says it
    -- instead, fading in and out (Subtitle:Animate) rather than snapping onto the title.
    self.pausedLabel = frame:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
    self.pausedLabel:SetPoint("LEFT", self.title, "RIGHT", 6, 0)
    self.pausedLabel:SetTextColor(.62, .62, .62)
    self.pausedLabel:SetShadowColor(0, 0, 0, 1)
    self.pausedLabel:SetShadowOffset(1, -1)
    self.pausedLabel:SetText(format("(%s)", L.SUBTITLE_PAUSED))
    self.pausedLabel:SetAlpha(0)
    self.pausedAlpha = 0

    -- Unwrapped, so its width is the true width of a candidate line.
    self.measure = frame:CreateFontString(nil, "OVERLAY", "QuestFont")
    self.measure:SetWordWrap(false)
    self.measure:Hide()
    self.lines = {}
    self:Place()
end

-- The centre and the top edge, not a corner: the frame is as wide as its longest line, so
-- it has to grow out from its middle and down from its top to stay where it was put.
-- Its top edge in the screen's units, divided by the subtitle's own size when placed: an
-- anchor's offsets are counted in the frame's scale, so resizing it would otherwise move it.
-- Always on the screen's centre line, so the frame grows out from its middle as lines change.
function Subtitle:Top()
    local saved = Addon:Layout().Subtitle
    return type(saved) == "table" and tonumber(saved.top) or DEFAULT_TOP
end

function Subtitle:Place(top)
    local scale = self.frame:GetScale() or 1
    self.frame:ClearAllPoints()
    self.frame:SetPoint("TOP", UIParent, "BOTTOM", 0, (top or self:Top()) / scale)
end

--- Follow the cursor up or down from where the drag began, kept on the screen.
function Subtitle:DragTo()
    local from = self.dragFrom
    local _, y = GetCursorPosition()
    local top = from.top + (y - from.cursor) / UIParent:GetEffectiveScale()
    local height = self.frame:GetHeight() * self.frame:GetScale()
    top = math.max(height, math.min(UIParent:GetHeight(), top))
    Addon:Layout().Subtitle = { top = top }
    self:Place(top)
end

function Subtitle:Line(index)
    local line = self.lines[index]
    if line then return line end
    line = self.frame:CreateFontString(nil, "OVERLAY", "QuestFont")
    line:SetJustifyH("LEFT")
    line:SetJustifyV("TOP")
    line:SetWordWrap(false)
    line:SetTextColor(1, 1, 1)
    line:SetShadowColor(0, 0, 0, 1)
    line:SetShadowOffset(1, -1)
    self.lines[index] = line
    return line
end

-- Each line gets a slot of its finished width, centred, and its letters are typed in from
-- the left of it: the text fills in without re-centring or wobbling as it grows.
function Subtitle:Layout(text)
    self.measure:SetText("Ag")
    local lineHeight = self.measure:GetStringHeight()
    local titleHeight, widest = self.title:GetStringHeight(), self.title:GetStringWidth()
    self.rows = {}
    for index, wrapped in ipairs(self:Wrap(text)) do
        local width = self:Width(wrapped)
        widest = math.max(widest, width)
        self.rows[index] = { text = wrapped, count = Characters(wrapped) }
        local line = self:Line(index)
        line:SetWidth(width + 2)
        line:ClearAllPoints()
        line:SetPoint("TOP", self.frame, "TOP", 0,
            -(TOP_PAD + titleHeight + TITLE_GAP + (index - 1) * (lineHeight + LINE_GAP)))
        line:SetText("")
        line:Show()
    end
    for index = #self.rows + 1, #self.lines do
        self.lines[index]:SetText("")
        self.lines[index]:Hide()
    end
    self.rowsWidest, self.rowsHeight = widest, TOP_PAD + titleHeight + TITLE_GAP
        + #self.rows * (lineHeight + LINE_GAP) - LINE_GAP + BOTTOM_PAD
    self:Fit()
    -- Where each word ends, for typing by word (WholeWords): found once, not every frame.
    self.wordEnds = {}
    local n = 1
    while true do
        local start, finish = self:CharsSpan(n)
        if finish <= start then break end
        self.wordEnds[n], n = finish, n + 1
    end
    self.revealed = nil
end

--- The frame and its shadow sized to the rows and the title, with room either side of the
--- centred title for "(paused)" while the queue is paused.
function Subtitle:Fit()
    if not self.rowsWidest then return end
    local label = self.shownPaused and (self.pausedLabel:GetStringWidth() + 6) or 0
    local widest = math.max(self.rowsWidest, self.title:GetStringWidth() + label * 2)
    local height = self.rowsHeight
    self.frame:SetSize(widest + PAD * 2, math.max(48, height))
    -- The shadow's soft edge is 30 of its 64 rows top and bottom, so it reaches well past the
    -- words: 12 past, as LoreTeller had it, left the first and last lines on the faded part.
    self.shadowWant = { w = widest + 64, h = height + SHADOW_ROOM * 2 }
    if not self.shadowSize then
        self.shadowSize = { w = self.shadowWant.w, h = self.shadowWant.h }
        self.shadow:SetSize(self.shadowSize.w, self.shadowSize.h)
    end
end

--- Where the page's `n`th word starts and ends among the rows' characters (the rows drop the
--- space at each wrap, so this counts as Reveal does): what is typed before it, and through it.
function Subtitle:CharsSpan(n)
    local total = 0
    for _, row in ipairs(self.rows or {}) do
        local words = Words(row.text)
        if n <= words then
            local seen = 0
            for start, finish in row.text:gmatch("()%S+()") do
                seen = seen + 1
                if seen == n then
                    return total + Characters(row.text:sub(1, start - 1)),
                        total + Characters(row.text:sub(1, finish - 1))
                end
            end
        end
        n = n - words
        total = total + row.count
    end
    return total, total
end

--- The rows as the typing has them: each holds the letters typed so far, so nothing yet to come
--- is ever on screen. The subtitle lights no word: the word timing is an estimate, and typed in
--- front of the reader it showed every miss. The windows light it (Transcript).
function Subtitle:Reveal(count)
    if count == self.revealed then return end
    self.revealed = count
    for index, row in ipairs(self.rows) do
        self.lines[index]:SetText(count >= row.count and row.text or Prefix(row.text, count))
        count = math.max(0, count - row.count)
    end
end

function Subtitle:Prepare(clip, text)
    self.clip, self.page = clip, nil
    self.pageFade, self.shadowSize = nil, nil
    for _, line in ipairs(self.lines or {}) do line:SetAlpha(1) end
    local present = clip.present or {}
    local title = present.header
    if not title or title == "" then title = present.label or "" end
    self.titleText, self.shownPaused = title, nil
    self.title:SetText(title)
    -- A clip with no usable length still pages and types, at LoreTeller's reading pace.
    local duration = tonumber(clip.length)
    if not duration or duration <= 0 then duration = math.max(3, Characters(text) * .072) end
    local total = math.max(1, Characters(text))
    self.pages = {}
    local start = 0
    for index, page in ipairs(self:Paginate(text)) do
        local count = Characters(page)
        local length = duration * count / total
        -- Never turned in under a second, however short the first half.
        if index > 1 then start = math.max(1, start) end
        self.pages[index] = { text = page, count = count, start = start, length = length }
        start = start + length
    end
end

function Subtitle:Render()
    -- With no window there is no paused portrait to say so; the title says it instead.
    local paused = SoundQueue:IsPaused() and not self.sample
    if paused ~= self.shownPaused then
        self.shownPaused = paused
        self:Fit()
    end
    local elapsed = self.sample and 0 or Transcript:AudioElapsed()
    local index = 1
    for i, page in ipairs(self.pages) do
        if elapsed >= page.start then index = i end
    end
    if index ~= self.page then
        if self.page and self.pages[self.page] and not self.sample then
            -- The page on screen fades out first; Animate lays the next one out once it has gone.
            -- A fade already going out just heads for the newer page; one coming in turns back
            -- from the opacity it has reached rather than jumping to full.
            local fade = self.pageFade
            if fade and fade.phase == "out" then
                fade.to = index
            elseif not (fade and fade.to == index) then
                local from = fade and fade.alpha or 1
                self.pageFade = { to = index, t = (1 - from) * PAGE_OUT, phase = "out" }
            end
            index = self.page
        else
            self.page = index
            self.turnedAt = elapsed
            self:Layout(self.pages[index].text)
        end
    end
    local page = self.pages[index]
    if self.sample or not Config().Typewriter then
        self:Reveal(page.count)
        return
    end
    -- LoreTeller's pace: a little ahead of the voice, so each page is whole a moment before the
    -- voice finishes reading it, counted from the page's turn. By word, the word being typed
    -- shows whole.
    -- Fading out, the page stays whole: resuming restarts the clock, and it would empty at once.
    if self.pageFade and self.pageFade.phase == "out" then
        self:Reveal(page.count)
        return
    end
    local rate = page.count / math.max(.5, page.length - .4) + 10
    local typed = math.floor(math.max(0, elapsed - math.max(page.start, self.turnedAt or 0)) * rate)
    if Config().TypewriterBy == "word" then typed = self:WholeWords(typed) end
    self:Reveal(typed)
end

--- `count` characters typed, carried on to the end of the word they stop in.
function Subtitle:WholeWords(count)
    if count <= 0 then return 0 end
    for _, finish in ipairs(self.wordEnds or {}) do
        if count <= finish then return finish end
    end
    return count
end

-- Shown once the audio has begun, not while a clip waits on a gate: the typing is paced to
-- the voice, and before it starts there is nothing to type. A paused queue is the exception.
-- The line will not start until the player plays it, and with no window on screen a subtitle
-- saying "paused" is the only sign of why nothing is being read -- and the thing to click.
function Subtitle:Wanted()
    local cfg = Config()
    return cfg.Enabled and Addon:PlayerStyle() == "subtitle" and Transcript.clip ~= nil
        and Transcript.text ~= "" and (Transcript.hasStarted or SoundQueue:IsPaused())
end

function Subtitle:SetWanted(wanted)
    if self.wanted == wanted then return end
    self.wanted = wanted
    self.fadeFrom = self.frame:IsShown() and self.frame:GetAlpha() or 0
    self.fadeTime = 0
    if wanted then
        self.frame:SetAlpha(self.fadeFrom)
        self.frame:Show()
    end
end

function Subtitle:Update()
    if not Addon.db then return end
    -- A real line always takes the place of the sample.
    local speaking = self:Wanted() and true or false
    if speaking then self.sample = nil end
    local wanted = speaking or self.sample ~= nil
    if not self.frame then
        if not wanted then return end
        self:Build()
    end
    self.shadow:SetAlpha(Config().SubtitleShadow or .5)
    self:Mouse()
    local scale = Config().SubtitleScale or 1
    -- Within a hair: the client keeps the scale as a float, and the setting is a double.
    if math.abs((self.frame:GetScale() or 1) - scale) > .001 then
        self.frame:SetScale(scale)
        self:Place()
    end
    local clip = speaking and Transcript.clip or self.sample
    if wanted and clip ~= self.clip then
        self:Prepare(clip, speaking and Transcript.text or L.SUBTITLE_SAMPLE_TEXT)
        -- Every new line fades in from nothing, the way LoreTeller showed each narration.
        self.wanted, self.fadeFrom, self.fadeTime = true, 0, 0
        self.frame:SetAlpha(0)
        self.frame:Show()
    end
    self:SetWanted(wanted)
    self:Corner(speaking and Transcript.clip or nil)
    if self.wanted then
        self.revealed = nil
        self:Render()
    end
end

--- The Report icon, as the windows have it in their corner: beside the subtitle's top right,
--- level with the speaker's name, outside the words so it covers none of them. Not on the
--- sample, which has no line to report; hidden by the same setting as the windows' icon.
function Subtitle:Corner(clip)
    local action = Actions:CornerAction(clip)
    local button = self.reportButton
    button.action, button.clip = action, clip
    if action then
        button.glyph:SetTexture(action.icon)
        button:Show()
        self.report = button
    else
        button:Hide()
        self.report = nil
    end
end

-- The round button every window shows (Actions.RoundButton), the lore pages' and the quest
-- log's Play and Report among them. Looked up when called: Actions may load after this file.
local function RoundButton(parent, glyphSize)
    return Actions.RoundButton(parent, glyphSize)
end

--- Play or pause, skip and Report, in a row beside the subtitle's top right, outside its words. They
--- fade in while the pointer is over the subtitle or them, and out after it leaves (Tick).
function Subtitle:BuildControls()
    local frame = self.frame
    local controls = CreateFrame("Frame", nil, frame)
    controls:SetSize(CONTROL_SIZE * 3 + CONTROL_GAP * 2, CONTROL_SIZE)
    controls:SetPoint("TOPLEFT", frame, "TOPRIGHT", 4, -TOP_PAD + 4)
    controls:SetFrameLevel(frame:GetFrameLevel() + 2)
    controls:SetAlpha(0)
    controls:Hide()
    self.controls, self.controlsAlpha = controls, 0

    -- The windows' round pause button (PlayerFrame's mini pause): its ring, and the play or
    -- pause glyph from the portrait atlas.
    local pause = RoundButton(controls, 12)
    pause:SetPoint("LEFT", controls, "LEFT", 0, 0)
    pause.glyph:SetTexture(TEXTURES .. "PortraitFrameAtlas")
    pause:SetScript("OnClick", function()
        if not SoundQueue:CanBePaused() then return end
        if PlaySound and SOUNDKIT then PlaySound(SOUNDKIT.U_CHAT_SCROLL_BUTTON) end
        SoundQueue:TogglePauseQueue()
        self:UpdatePause()
    end)
    pause:SetScript("OnEnter", function()
        pause.glyph:SetAlpha(1)
        GameTooltip:SetOwner(pause, "ANCHOR_TOP")
        GameTooltip:SetText(SoundQueue:IsPaused() and L.PLAY or L.PAUSE)
        GameTooltip:Show()
    end)
    self.pause = pause
    self:UpdatePause()

    -- Skip, as the windows' queue offers: the play glyph against a bar, the usual "next" mark.
    local skip = RoundButton(controls, 10)
    skip:SetPoint("LEFT", pause, "RIGHT", CONTROL_GAP, 0)
    skip.glyph:SetTexture(TEXTURES .. "PortraitFrameAtlas")
    skip.glyph:SetTexCoord(0, 93 / PORTRAIT_ATLAS_SIZE, 419 / PORTRAIT_ATLAS_SIZE, 1)
    skip.glyph:ClearAllPoints()
    skip.glyph:SetPoint("CENTER", -2, 0)
    skip.bar = skip:CreateTexture(nil, "ARTWORK")
    skip.bar:SetSize(2, 9)
    skip.bar:SetPoint("LEFT", skip.glyph, "RIGHT", 0, 0)
    if skip.bar.SetColorTexture then skip.bar:SetColorTexture(1, 0.82, 0, 0.85) end
    skip:SetScript("OnClick", function()
        if PlaySound and SOUNDKIT then PlaySound(SOUNDKIT.U_CHAT_SCROLL_BUTTON) end
        SoundQueue:Skip()
    end)
    skip:SetScript("OnEnter", function()
        skip.glyph:SetAlpha(1)
        GameTooltip:SetOwner(skip, "ANCHOR_TOP")
        GameTooltip:SetText(L.BIND_SKIP)
        GameTooltip:Show()
    end)
    self.skip = skip

    -- Report, in the same ring, with the action's own bug icon: what the windows show in their
    -- corner, and what it does is the action's, as there.
    local report = RoundButton(controls)
    report:SetPoint("LEFT", skip, "RIGHT", CONTROL_GAP, 0)
    report:SetScript("OnClick", function()
        if report.action and report.action.onClick then report.action.onClick(report.clip) end
    end)
    report:SetScript("OnEnter", function()
        report.glyph:SetAlpha(1)
        if report.action and report.action.tooltip then
            GameTooltip:SetOwner(report, "ANCHOR_TOP")
            report.action.tooltip(GameTooltip)
            GameTooltip:Show()
        end
    end)
    report:Hide()
    self.reportButton = report
end

function Subtitle:UpdatePause()
    Actions.SetPauseGlyph(self.pause, SoundQueue:IsPaused())
end

-- Locked, the subtitle lets clicks through to the world but still knows the pointer is over
-- it, where the client can tell the two apart, so its controls still come up.
function Subtitle:Mouse()
    local frame = self.frame
    if frame.SetMouseClickEnabled and frame.SetMouseMotionEnabled then
        frame:SetMouseMotionEnabled(true)
        frame:SetMouseClickEnabled(not Locked())
    else
        frame:EnableMouse(not Locked())
    end
end

-- The controls toward shown while the pointer is over the subtitle or them, and toward
-- hidden otherwise; hidden outright once faded, so they cannot be clicked unseen.
function Subtitle:FadeControls(elapsed)
    local controls = self.controls
    local over = not self.sample and (Over(self.frame) or Over(controls))
    if over and not controls:IsShown() then controls:Show() end
    local target = over and 1 or 0
    local step = (elapsed or 0) / CONTROLS_FADE
    local alpha = self.controlsAlpha
    if alpha < target then alpha = math.min(target, alpha + step) elseif alpha > target then alpha = math.max(target, alpha - step) end
    self.controlsAlpha = alpha
    controls:SetAlpha(alpha)
    if alpha == 0 and controls:IsShown() then controls:Hide() end
end

function Subtitle:Tick(elapsed)
    if self.dragFrom then self:DragTo() end
    if self.fadeTime then
        self.fadeTime = self.fadeTime + elapsed
        local t = math.min(1, self.fadeTime / (self.wanted and FADE_IN or FADE_OUT))
        -- Eased out on the way in and in on the way out, as LoreTeller's animations were.
        local eased = self.wanted and 1 - (1 - t) * (1 - t) or t * t
        self.frame:SetAlpha(self.fadeFrom + ((self.wanted and 1 or 0) - self.fadeFrom) * eased)
        if t == 1 then
            self.fadeTime = nil
            if not self.wanted then
                self.frame:Hide()
                self.clip = nil
                return
            end
        end
    end
    if self.wanted and self.pages then self:Render() end
    self:Animate(elapsed)
    self:FadeControls(elapsed)
    self.poll = (self.poll or 0) + elapsed
    if self.poll >= .2 then
        self.poll = 0
        self:Mouse()
        self:UpdatePause()
    end
end

--- The page's fade between pages, and the shadow easing to a new page's size.
function Subtitle:Animate(elapsed)
    local alpha = 1
    local fade = self.pageFade
    if fade then
        fade.t = fade.t + elapsed
        if fade.phase == "out" then
            alpha = 1 - math.min(1, fade.t / PAGE_OUT)
            if fade.t >= PAGE_OUT then
                self.page = fade.to
                self.turnedAt = self.sample and 0 or Transcript:AudioElapsed()
                self:Layout(self.pages[fade.to].text)
                fade.phase, fade.t, alpha = "in", 0, 0
                self:Render()
            end
        else
            local t = math.min(1, fade.t / PAGE_IN)
            alpha = 1 - (1 - t) * (1 - t)
            if t >= 1 then self.pageFade = nil end
        end
    end
    if self.pageFade then self.pageFade.alpha = alpha end
    local wantPaused = self.shownPaused and 1 or 0
    if self.pausedAlpha ~= wantPaused then
        local step = elapsed / PAUSED_FADE
        self.pausedAlpha = wantPaused > self.pausedAlpha and math.min(1, self.pausedAlpha + step)
            or math.max(0, self.pausedAlpha - step)
        self.pausedLabel:SetAlpha(self.pausedAlpha)
    end
    for _, line in ipairs(self.lines) do line:SetAlpha(alpha) end

    local want, size = self.shadowWant, self.shadowSize
    if want and size and (size.w ~= want.w or size.h ~= want.h) then
        local k = math.min(1, elapsed * SIZE_EASE)
        size.w = size.w + (want.w - size.w) * k
        size.h = size.h + (want.h - size.h) * k
        if math.abs(size.w - want.w) < .5 and math.abs(size.h - want.h) < .5 then
            size.w, size.h = want.w, want.h
        end
        self.shadow:SetSize(size.w, size.h)
    end

end

--- A stand-in line, shown from the settings so the subtitle can be placed and sized without
--- waiting for someone to speak. The first real line replaces it; the settings hide it as
--- they close.
function Subtitle:ShowSample(shown)
    self.sample = shown and { present = { header = L.SUBTITLE_SAMPLE_TITLE }, length = 0 } or nil
    self:Update()
end

function Subtitle:IsShowingSample()
    return self.sample ~= nil
end

--- Back to the default spot, for a subtitle dragged somewhere it is no longer wanted.
function Subtitle:Reset()
    if Addon.db then Addon:Layout().Subtitle = nil end
    if self.frame then self:Place() end
end

function Subtitle:Describe()
    return format("subtitle player=%s visible=%s page=%d/%d typewriter=%s report=%s",
        tostring(Addon.db and Addon:PlayerStyle()), tostring(self.frame and self.frame:IsVisible()),
        self.page or 0, self.pages and #self.pages or 0, tostring(Config().Typewriter), self:ReportState())
end

--- Why the Report icon is or is not beside the subtitle, for /spoken diagnostics.
function Subtitle:ReportState()
    local clip = Transcript.clip
    if not clip then return "no-line" end
    local actions = clip.present and clip.present.actions
    if not actions then return "line-has-no-actions" end
    local hidden = (Addon.db.profile.Frame or Defaults.profile.Frame).HiddenActions or {}
    if hidden.report then return "hidden-by-setting" end
    if not self.report then return "not-built" end
    return format("built parent=%s shown=%s", self.report:GetParent() == self.controls and "controls" or "other",
        tostring(self.report:IsShown()))
end
