setfenv(1, SpokenEnv)

-- Captions as a subtitle, after LoreTeller Forever's subtitle style, with the picture and the grey
-- title after the name from shorley's Spoken Subtitles.
--
-- One of the narrator styles (Addon:PlayerStyle), the one with no window: the two windows
-- hide while it is chosen. This file owns only its frame and how the text is revealed. The
-- clip, its cleaned text and how far the voice has got all come from Transcript, so pause,
-- restart, skip and Stop behave exactly as they do in the windows.
Subtitle = {}

-- The widest a line runs, padding included. LoreTeller matched Plumber's talking head.
local WIDTH = 512
local PAD, TOP_PAD, TITLE_GAP, BOTTOM_PAD, LINE_GAP = 16, 12, 8, 12, 2
-- The player's SubtitleSentences, 1 to 4. A page also never runs past MAX_LINES lines.
local MAX_LINES, MAX_SENTENCES = 4, 4
local function PageSentences()
    local sentences = tonumber(Addon:Profile("Transcript").SubtitleSentences) or 3
    return math.max(1, math.min(MAX_SENTENCES, math.floor(sentences)))
end
local FADE_IN, FADE_OUT = .6, .5
-- Until it is dragged: the top edge, in UI units up from the bottom of the screen.
local DEFAULT_TOP = 336
-- Spoken Subtitles' band shade (shorley, MIT), stretched over the subtitle and 40 past the words
-- either side.
local SHADOW = [[Interface\AddOns\Spoken\Textures\SubtitleBand]]
local SHADOW_REACH = 40
local TEXTURES = [[Interface\AddOns\Spoken\Textures\]]
-- A page fades out before the next fades in; the shadow eases to the new page's size.
local PAGE_OUT, PAGE_IN = .18, .28
local PAUSED_FADE = .25
local PICTURE, PICTURE_GAP, LABEL_GAP = 36, 8, 6
-- The progress line follows Spoken Subtitles' layout and spark, framed as the game frames a status
-- bar (UIWidgetTemplateStatusBar). Without that art, Spoken Subtitles' own hairline.
local PROGRESS_SHARE, PROGRESS_HEIGHT = 0.45, 7
local PROGRESS_LINE = [[Interface\AddOns\Spoken\Textures\SubtitleLine]]
local SPARK = [[Interface\CastingBar\UI-CastingBar-Spark]]
-- Called through the global environment: the client looks up Vector2DMixin in the caller's
-- environment, and from SpokenEnv it fails with "unable to find mixin or metatable".
local AtlasInfo = setfenv(function(name)
    return C_Texture and C_Texture.GetAtlasInfo and C_Texture.GetAtlasInfo(name) or nil
end, _G)
local SIZE_EASE = 10
-- The controls shown on hover: the windows' round pause button, skip, and Report.
local CONTROL_SIZE, CONTROL_GAP = 24, 4
local CONTROLS_FADE = .15
local PORTRAIT_ATLAS_SIZE = 512
local UTF8_CHAR = "[%z\1-\127\194-\244][\128-\191]*"

local function Config()
    return Addon:Profile("Transcript")
end
-- The player's lock covers this frame too: locked, it is click-through. So does hosting:
-- the clicks belong to the host's window.
local function Locked()
    return Addon:IsFrameLocked() or Addon.playerHost ~= nil
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

-- A phrase ends after a comma, semicolon, colon or dash, Latin or CJK. A closing quote or bracket,
-- and the space after, stay with it.
local PHRASE_ENDS = { [","] = true, [";"] = true, [":"] = true, ["\226\128\148"] = true, ["\226\128\147"] = true,
    ["\239\188\140"] = true, ["\227\128\129"] = true, ["\239\188\155"] = true, ["\239\188\154"] = true }
local PHRASE_CLOSERS = { ['"'] = true, ["'"] = true, [")"] = true, ["]"] = true, ["\226\128\157"] = true,
    ["\226\128\153"] = true, ["\227\128\141"] = true, ["\227\128\143"] = true, ["\239\188\137"] = true }
local function Phrases(sentence)
    local chars = {}
    for char in sentence:gmatch(UTF8_CHAR) do chars[#chars + 1] = char end
    local phrases, current, i = {}, "", 1
    while i <= #chars do
        local char = chars[i]
        current = current .. char
        -- "--", as the lore writes a dash in plain text.
        local dash = char == "-" and chars[i + 1] == "-"
        if dash then
            i = i + 1
            current = current .. chars[i]
        end
        if PHRASE_ENDS[char] or dash then
            while chars[i + 1] and PHRASE_CLOSERS[chars[i + 1]] do
                i = i + 1
                current = current .. chars[i]
            end
            while chars[i + 1] and chars[i + 1]:find("^%s$") do
                i = i + 1
                current = current .. chars[i]
            end
            phrases[#phrases + 1] = current
            current = ""
        end
        i = i + 1
    end
    if current:find("%S") then phrases[#phrases + 1] = current end
    return phrases
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

--- Pages of whole sentences, at most PageSentences() and MAX_LINES lines each. A longer sentence turns
--- at its phrases, and only a longer phrase between words. Joined, the pages give back the text's
--- words in order, which page timing relies on.
function Subtitle:Paginate(text)
    local most = PageSentences()
    self.pageSentences = most
    local function Fits(candidate) return #self:Wrap(candidate) <= MAX_LINES end
    local sentences = Sentences(text)
    if #sentences <= most and Fits(text) then return { text } end
    local pages, page, count = {}, "", 0
    local function Close()
        if page:find("%S") then pages[#pages + 1] = (page:gsub("%s+$", "")) end
        page, count = "", 0
    end
    -- A phrase longer than MAX_LINES, cut between words into runs that fit.
    local function Cut(piece)
        local runs, run = {}, ""
        for word, space in piece:gmatch("(%S+)(%s*)") do
            if run ~= "" and not Fits(run .. word) then
                runs[#runs + 1] = run
                run = ""
            end
            if Fits(word) then
                run = run .. word .. space
            else
                -- An unbroken run longer than a page, as in text without spaces, is cut between characters.
                for char in word:gmatch(UTF8_CHAR) do
                    if run ~= "" and not Fits(run .. char) then
                        runs[#runs + 1] = run
                        run = ""
                    end
                    run = run .. char
                end
                run = run .. space
            end
        end
        if run:find("%S") then runs[#runs + 1] = run end
        return runs
    end
    for _, sentence in ipairs(sentences) do
        if Fits(sentence) then
            if count >= most or (page ~= "" and not Fits(page .. sentence)) then Close() end
            page, count = page .. sentence, count + 1
        else
            Close()
            for _, phrase in ipairs(Phrases(sentence)) do
                for _, part in ipairs(Fits(phrase) and { phrase } or Cut(phrase)) do
                    if page ~= "" and not Fits(page .. part) then Close() end
                    page = page .. part
                end
            end
            Close()
        end
    end
    Close()
    return pages
end

function Subtitle:Build()
    local frame = CreateFrame("Frame", "SpokenSubtitleFrame", UIParent)
    self.frame = frame
    frame:SetSize(WIDTH, 100)
    -- Low, under every panel: the map, the quest log or Lore of Azeroth opened over a line in
    -- progress covers the words, rather than the words lying across the window.
    frame:SetFrameStrata("LOW")
    -- The strata Addon:ApplyHost restores when the host lets go.
    frame.spokenBaseStrata = "LOW"
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
    -- Hung from the top, so an eased height grows downward.
    self.shadow:SetPoint("TOP", frame, "TOP", 0, 0)
    -- Hung from the background's foot, so the buttons follow it as it eases to a new size.
    self.controls:SetPoint("TOP", self.shadow, "BOTTOM", 0, -2)

    self.title = frame:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
    self.title:SetJustifyH("LEFT")
    self.title:SetTextColor(1, .82, 0)
    self.title:SetShadowColor(0, 0, 0, 1)
    self.title:SetShadowOffset(1, -1)
    self.dot = frame:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
    self.dot:SetTextColor(.62, .62, .62)
    self.dot:SetShadowColor(0, 0, 0, 1)
    self.dot:SetShadowOffset(1, -1)
    self.dot:SetText("•")
    -- Cut short with an ellipsis where the row would run too wide.
    self.label = frame:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
    self.label:SetJustifyH("LEFT")
    self.label:SetWordWrap(false)
    self.label:SetTextColor(.62, .62, .62)
    self.label:SetShadowColor(0, 0, 0, 1)
    self.label:SetShadowOffset(1, -1)
    -- No window shows the stop, so "(paused)" takes the label's place, fading across.
    self.pausedLabel = frame:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
    self.pausedLabel:SetJustifyH("LEFT")
    self.pausedLabel:SetTextColor(.62, .62, .62)
    self.pausedLabel:SetShadowColor(0, 0, 0, 1)
    self.pausedLabel:SetShadowOffset(1, -1)
    self.pausedLabel:SetText(format("(%s)", L.SUBTITLE_STOPPED))
    self.pausedLabel:SetAlpha(0)
    self.pausedAlpha = 0
    self:BuildPicture()

    -- Guarded as a whole: a progress bar that fails to build leaves the subtitle without one, and
    -- says why in chat once, rather than leaving the subtitle half built and erroring every frame.
    local built, why = pcall(self.BuildProgress, self)
    if not built then
        print("|cff66bbffSpoken:|r progress bar: " .. tostring(why))
        self.track = CreateFrame("Frame", nil, frame)
        self.fill = self.track:CreateTexture(nil, "ARTWORK")
        self.spark = self.track:CreateTexture(nil, "OVERLAY")
        self.fillRoom, self.progressHeight, self.progressBroken = 0, 0, true
    end

    self.moreDot = frame:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
    self.more = frame:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
    for _, part in ipairs({ self.moreDot, self.more }) do
        part:SetTextColor(.62, .62, .62)
        part:SetShadowColor(0, 0, 0, 1)
        part:SetShadowOffset(1, -1)
    end
    self.moreDot:SetText("•")
    self.waiting = 0

    -- Unwrapped, so its width is the true width of a candidate line.
    self.measure = frame:CreateFontString(nil, "OVERLAY", "QuestFont")
    self.measure:SetWordWrap(false)
    self.measure:Hide()
    self.lines = {}
    self:Place()
end

--- `self.track` is the frame the fill runs along; `self.fillRoom`, how far in from each end it runs.
function Subtitle:BuildProgress()
    local frame = self.frame
    local track = CreateFrame("Frame", nil, frame)
    local fill = track:CreateTexture(nil, "ARTWORK")
    local left, right, middle = AtlasInfo("widgetstatusbar-borderleft"), AtlasInfo("widgetstatusbar-borderright"),
        AtlasInfo("widgetstatusbar-bordercenter")
    local yellow = AtlasInfo("widgetstatusbar-fill-yellow")
    self.fillRoom = 0
    local framed = left and right and middle and yellow and fill.SetAtlas
        and tonumber(middle.height) and tonumber(left.width) and tonumber(right.width) and true or false
    if framed then
        local ok, err = pcall(self.FrameProgress, self, track, fill, left, right, middle, yellow)
        if not ok then
            framed = false
            if geterrorhandler then geterrorhandler()(err) end
        end
    end
    if not framed then
        self.fillRoom = 0
        local back = track:CreateTexture(nil, "BACKGROUND")
        back:SetAllPoints()
        if back.SetColorTexture then back:SetColorTexture(0, 0, 0, 0.5) end
        track:SetHeight(1.5)
        fill:SetTexture(PROGRESS_LINE)
        fill:SetHeight(1.5)
        self.progressHeight = 2
    end
    fill:SetPoint("LEFT", track, "LEFT", self.fillRoom, 0)
    -- Hung from the background's foot, so the bar follows it as it eases.
    track:SetPoint("BOTTOM", self.shadow, "BOTTOM", 0, BOTTOM_PAD)
    local spark = track:CreateTexture(nil, "OVERLAY", nil, 1)
    spark:SetTexture(SPARK)
    if spark.SetBlendMode then spark:SetBlendMode("ADD") end
    -- Taller than the bar, so its glow reaches past the frame.
    spark:SetSize(12, framed and self.progressHeight + 9 or 14)
    spark:SetPoint("CENTER", fill, "RIGHT")
    self.track, self.fill, self.spark = track, fill, spark
end

function Subtitle:FrameProgress(track, fill, left, right, middle, yellow)
    do
        -- As the cards' meter lays the art out: the fill 8 inside the border's ends and 2 short of
        -- the background's, the border's own 31 rows scaled to PROGRESS_HEIGHT.
        local k = PROGRESS_HEIGHT / (middle.height > 0 and middle.height or 31)
        track:SetHeight(PROGRESS_HEIGHT)
        local function Piece(atlas, layer, width)
            local texture = track:CreateTexture(nil, layer)
            texture:SetAtlas(atlas)
            texture:SetHeight(PROGRESS_HEIGHT)
            if width then texture:SetWidth(width * k) end
            return texture
        end
        local l = Piece("widgetstatusbar-borderleft", "OVERLAY", left.width)
        local r = Piece("widgetstatusbar-borderright", "OVERLAY", right.width)
        local m = Piece("widgetstatusbar-bordercenter", "OVERLAY")
        l:SetPoint("LEFT", track, "LEFT", 0, 0)
        r:SetPoint("RIGHT", track, "RIGHT", 0, 0)
        m:SetPoint("LEFT", l, "RIGHT", 0, 0)
        m:SetPoint("RIGHT", r, "LEFT", 0, 0)
        self.fillRoom = 8 * k
        local back = track:CreateTexture(nil, "BACKGROUND")
        if AtlasInfo("widgetstatusbar-bgcenter") then back:SetAtlas("widgetstatusbar-bgcenter")
        elseif back.SetColorTexture then back:SetColorTexture(0, 0, 0, 0.6) end
        back:SetPoint("TOPLEFT", track, "TOPLEFT", self.fillRoom - 2 * k, -2 * k)
        back:SetPoint("BOTTOMRIGHT", track, "BOTTOMRIGHT", -(self.fillRoom - 2 * k), 2 * k)
        fill:SetAtlas("widgetstatusbar-fill-yellow")
        fill:SetHeight(math.min(tonumber(yellow.height) or 15, middle.height - 4) * k)
        self.progressHeight = PROGRESS_HEIGHT
    end
end

function Subtitle:BuildPicture()
    local k = PICTURE / 90
    local host = CreateFrame("Frame", nil, self.frame)
    host:SetSize(PICTURE, PICTURE)
    local background = host:CreateTexture(nil, "BACKGROUND")
    background:SetAllPoints()
    background:SetTexture(TEXTURES .. "MinimalPortraitBackground")
    local viewport = CreateFrame("Frame", nil, host)
    viewport:SetSize(78 * k, 78 * k)
    viewport:SetPoint("CENTER", host, "TOPLEFT", PICTURE * 35 / 71, -PICTURE * 34 / 71)
    if viewport.SetClipsChildren then viewport:SetClipsChildren(true) end
    local chrome = CreateFrame("Frame", nil, host)
    chrome:SetAllPoints()
    chrome:SetFrameLevel(host:GetFrameLevel() + 8)
    -- The badge's socket is open in the ring: without its disc the face shows through it.
    local disc = chrome:CreateTexture(nil, "BACKGROUND")
    disc:SetSize(24 * k + 2, 24 * k + 2)
    disc:SetPoint("CENTER", host, "TOPLEFT", PICTURE * 56.5 / 71, -PICTURE * 56.5 / 71)
    disc:SetTexture(TEXTURES .. "MinimalPortraitMask")
    disc:SetVertexColor(.04, .04, .035, 1)
    local ring = chrome:CreateTexture(nil, "ARTWORK")
    ring:SetAllPoints()
    ring:SetTexture(TEXTURES .. "MinimalPortraitRing")
    local badge = chrome:CreateTexture(nil, "OVERLAY")
    badge:SetSize(16 * k + 2, 16 * k + 2)
    badge:SetPoint("CENTER", disc, "CENTER", 0, 0)
    self.picture, self.viewport, self.badge = host, viewport, badge
end

--- The speaker's face where one was captured, else the clip's own picture, with its badge.
function Subtitle:ConfigurePicture(clip)
    local viewport = self.viewport
    if not StaticPortrait:Configure(viewport, clip) then Portrait:Configure(viewport, clip) end
    if viewport.active == "texture" and viewport.texture then StaticPortrait:Mask(viewport, viewport.texture) end
    local id = clip and clip.present and clip.present.bullet
    local badges = MinimalPlayer and MinimalPlayer.BADGES or {}
    local texture = badges[id] or (Bullets and Bullets[id] and Bullets[id].texture)
    self.badge:SetTexture(texture)
    self.badge:SetShown(texture ~= nil)
end

function Subtitle:RowHeight()
    return math.max(PICTURE, self.title:GetStringHeight() or 0)
end

--- The row's visible width, so it centres on what shows. The title is cut to keep it within WIDTH.
function Subtitle:RowWidth(paused)
    local start = PICTURE + PICTURE_GAP + (self.title:GetStringWidth() or 0)
    -- The waiting count's room, taken first so a long title is cut rather than the count.
    local more = 0
    if (self.waiting or 0) > 0 then
        more = LABEL_GAP + (self.moreDot:GetStringWidth() or 0) + LABEL_GAP + (self.more:GetStringWidth() or 0)
    end
    if self.labelText then
        local lead = LABEL_GAP + (self.dot:GetStringWidth() or 0) + LABEL_GAP
        self.label:SetWidth(0)
        local label = math.min(self.label:GetStringWidth() or 0, math.max(0, WIDTH - PAD * 2 - start - lead - more))
        self.label:SetWidth(math.max(1, label))
        return start + lead + (paused and (self.pausedLabel:GetStringWidth() or 0) or label) + more
    end
    return start + (paused and LABEL_GAP + (self.pausedLabel:GetStringWidth() or 0) or 0) + more
end

function Subtitle:PlaceRow(left)
    left = math.floor(left + .5)
    local textY = -TOP_PAD - math.floor((self:RowHeight() - (self.title:GetStringHeight() or 0)) / 2)
    self.picture:ClearAllPoints()
    self.picture:SetPoint("TOPLEFT", self.frame, "TOP", left, -TOP_PAD)
    self.title:ClearAllPoints()
    self.title:SetPoint("TOPLEFT", self.frame, "TOP", left + PICTURE + PICTURE_GAP, textY)
    self.dot:ClearAllPoints()
    self.dot:SetPoint("LEFT", self.title, "RIGHT", LABEL_GAP, 0)
    self.label:ClearAllPoints()
    self.label:SetPoint("LEFT", self.dot, "RIGHT", LABEL_GAP, 0)
    self.pausedLabel:ClearAllPoints()
    self.pausedLabel:SetPoint("LEFT", self.labelText and self.dot or self.title, "RIGHT", LABEL_GAP, 0)
    local last = self.shownPaused and self.pausedLabel or (self.labelText and self.label or self.title)
    local shown = (self.waiting or 0) > 0
    self.moreDot:SetShown(shown)
    self.more:SetShown(shown)
    self.moreDot:ClearAllPoints()
    self.moreDot:SetPoint("LEFT", last, "RIGHT", LABEL_GAP, 0)
    self.more:ClearAllPoints()
    self.more:SetPoint("LEFT", self.moreDot, "RIGHT", LABEL_GAP, 0)
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
    -- The size the player chose, not the frame's scale: over a host that scale makes up for
    -- the host's, and the offset is counted in the effective scale, which hosting keeps.
    local scale = self.frame.spokenBaseScale or self.frame:GetScale() or 1
    self.frame:ClearAllPoints()
    self.frame:SetPoint("TOP", UIParent, "BOTTOM", 0, (top or self:Top()) / scale)
end

--- Follow the cursor up or down from where the drag began, kept on the screen.
function Subtitle:DragTo()
    local from = self.dragFrom
    if Locked() then return end
    local _, y = GetCursorPosition()
    local top = from.top + (y - from.cursor) / UIParent:GetEffectiveScale()
    local height = self.frame:GetHeight() * (self.frame.spokenBaseScale or self.frame:GetScale())
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
    local titleHeight, widest = self:RowHeight(), self:RowWidth(self.shownPaused)
    self.rows = {}
    for index, wrapped in ipairs(self:Wrap(text)) do
        local width = self:Width(wrapped)
        widest = math.max(widest, width)
        self.rows[index] = { text = wrapped, count = Characters(wrapped) }
        local line = self:Line(index)
        Addon:ClipFont(line, self.clip)
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
    local wordsBottom = TOP_PAD + titleHeight + TITLE_GAP + #self.rows * (lineHeight + LINE_GAP) - LINE_GAP
    self.progressShown = self:ProgressWanted()
    for _, part in ipairs({ self.track, self.fill, self.spark }) do part:SetShown(self.progressShown) end
    -- As far under the words as the words are under the name: the name sits in the middle of the
    -- picture's height, so its gap is the row's spare half and TITLE_GAP.
    local gap = TITLE_GAP + math.floor((titleHeight - (self.title:GetStringHeight() or 0)) / 2)
    self.progressGap = gap
    if self.progressShown then wordsBottom = wordsBottom + gap + self.progressHeight end
    self.rowsWidest, self.rowsHeight = widest, wordsBottom + BOTTOM_PAD
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

function Subtitle:Fit()
    if not self.rowsWidest then return end
    local row = self:RowWidth(self.shownPaused)
    local widest = math.max(self.rowsWidest, row)
    -- A new line starts in place; a pause slides the row to its new middle.
    self.rowWant = -row / 2
    if not self.rowLeft then self.rowLeft = self.rowWant end
    self:PlaceRow(self.rowLeft)
    local height = self.rowsHeight
    self.frame:SetSize(widest + PAD * 2, math.max(48, height))
    self.shadowWant = { w = widest + SHADOW_REACH * 2, h = math.max(48, height) }
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
    local title, label = present.header, present.label
    if not title or title == "" then title, label = label or "", nil end
    -- A zone's own story names the zone twice; said once.
    if label == "" or label == title then label = nil end
    self.titleText, self.labelText, self.shownPaused = title, label, nil
    -- The waiting count as it is now, so a line that follows a skip lays its row out once, with
    -- the count already in, rather than sliding as if lines had just been added.
    self.rowLeft, self.share = nil, 0
    self:SetWaiting(self:Waiting())
    -- The measure too: pages are cut by the width of the text in the face it is drawn in.
    for _, text in ipairs({ self.title, self.label, self.measure }) do Addon:ClipFont(text, clip) end
    self.title:SetText(title)
    self.label:SetText(label or "")
    self.dot:SetShown(label ~= nil)
    self:ConfigurePicture(clip)
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
    return cfg.Enabled and Addon:DisplayStyle() == "subtitle" and Transcript.clip ~= nil
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
    if math.abs((self.frame.spokenBaseScale or 0) - scale) > .001 then
        self.frame.spokenBaseScale = scale
        self.frame:SetScale(scale)
        -- Built or resized while hosted: onto the host, scaled to match.
        Addon:ApplyHost(self.frame)
        self:Place()
    end
    local clip = speaking and Transcript.clip or self.sample
    -- The sentences at once changed in the settings: the line paged again, from where the voice is.
    if self.clip and self.pages and self.pageSentences and self.pageSentences ~= PageSentences() then
        self:Prepare(self.clip, self.sample and L.SUBTITLE_SAMPLE_TEXT or Transcript.text)
        self.revealed = nil
    end
    -- The progress line turned on or off in the settings: the page laid out again with or without it.
    if self.page and self.pages and self.pages[self.page]
        and self:ProgressWanted() ~= self.progressShown then
        self:Layout(self.pages[self.page].text)
        self.revealed = nil
    end
    if wanted and clip ~= self.clip then
        -- A line still on screen fades out first, as when it ends, and the new one fades in after it.
        if speaking and self.clip and self.frame:IsShown() and self.frame:GetAlpha() > 0 then
            self.switching = true
            self:SetWanted(false)
            return
        end
        self.switching = nil
        self:Prepare(clip, speaking and Transcript.text or L.SUBTITLE_SAMPLE_TEXT)
        -- Every new line fades in from nothing, the way LoreTeller showed each narration.
        self.wanted, self.fadeFrom, self.fadeTime = true, 0, 0
        self.frame:SetAlpha(0)
        self.frame:Show()
    end
    self:SetWanted(wanted)
    -- Report stays while the subtitle fades out, and goes with it (Tick).
    if speaking or self.sample then self:Corner(speaking and Transcript.clip or nil) end
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
    -- As wide as the buttons it shows, so the row stays centred under the subtitle.
    local count = action and 3 or 2
    self.controls:SetWidth(CONTROL_SIZE * count + CONTROL_GAP * (count - 1))
end

-- The round button every window shows (Actions.RoundButton), the lore pages' and the quest
-- log's Play and Report among them. Looked up when called: Actions may load after this file.
local function RoundButton(parent, glyphSize)
    return Actions.RoundButton(parent, glyphSize)
end

--- They fade in while the pointer is over the subtitle or them, and out after it leaves (Tick).
function Subtitle:BuildControls()
    local frame = self.frame
    local controls = CreateFrame("Frame", nil, frame)
    controls:SetSize(CONTROL_SIZE * 3 + CONTROL_GAP * 2, CONTROL_SIZE)
    controls:SetFrameLevel(frame:GetFrameLevel() + 2)
    controls:SetAlpha(0)
    controls:Hide()
    self.controls, self.controlsAlpha = controls, 0

    local pause = RoundButton(controls, 12)
    pause:SetPoint("LEFT", controls, "LEFT", 0, 0)
    pause:SetScript("OnClick", function()
        if not SoundQueue:CanBePaused() then return end
        SpokenLayout.Sound("U_CHAT_SCROLL_BUTTON")
        SoundQueue:TogglePauseQueue()
        self:UpdatePause()
    end)
    pause:SetScript("OnEnter", function()
        pause.glyph:SetAlpha(1)
        GameTooltip:SetOwner(pause, "ANCHOR_TOP")
        GameTooltip:SetText(SoundQueue:IsPaused() and L.REPLAY or L.STOP)
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
        SpokenLayout.Sound("U_CHAT_SCROLL_BUTTON")
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
            Actions.AddLogMenuHint(GameTooltip)
            GameTooltip:Show()
        end
    end)
    Actions.OfferLogMenu(report)
    report:Hide()
    self.reportButton = report
end

function Subtitle:UpdatePause()
    Actions.SetPlayGlyph(self.pause, Actions.HeadState())
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
                self:Corner(nil)
                -- Faded out to make way for the next line: bring it in.
                if self.switching then self.switching = nil; self:Update() end
                return
            end
        end
    end
    if self.wanted and self.pages then self:Render() end
    if self.wanted and self.pages then self:CountWaiting() end
    self:ShowProgress()
    self:Animate(elapsed)
    self:FadeControls(elapsed)
    self.poll = (self.poll or 0) + elapsed
    if self.poll >= .2 then
        self.poll = 0
        self:Mouse()
        self:UpdatePause()
    end
end

--- Held where the voice stopped while the queue is stopped, as the words are.
function Subtitle:ShowProgress()
    if not self.progressShown then return end
    -- Read only while this line speaks, so the bar fades out where the voice left it.
    local length = self.clip and tonumber(self.clip.length) or 0
    if self.wanted and not self.sample and length > 0 and Transcript.clip == self.clip then
        self.share = math.max(0, math.min(1, Transcript:AudioElapsed() / length))
    end
    local size = self.shadowSize or self.shadowWant
    local width = size and math.floor(size.w * PROGRESS_SHARE)
    if width then self.track:SetWidth(width) else width = self.track:GetWidth() or 0 end
    local room = math.max(0, width - 2 * self.fillRoom)
    self.fill:SetWidth(math.max(0.01, room * (self.share or 0)))
end

--- Lines waiting behind the one on screen, shown as "+2".
function Subtitle:Waiting()
    if self.sample or not self.clip or Transcript.clip ~= self.clip then return 0 end
    return math.max(0, SoundQueue:GetQueueSize() - 1)
end

function Subtitle:SetWaiting(waiting)
    self.waiting = waiting
    self.more:SetText(waiting > 0 and ("+" .. waiting) or "")
end

function Subtitle:CountWaiting()
    local waiting = self:Waiting()
    if waiting ~= self.waiting then
        self:SetWaiting(waiting)
        self:Fit()
    end
end

--- Whether the progress line is wanted: the setting on, and the bar built.
function Subtitle:ProgressWanted()
    return Config().SubtitleProgress ~= false and not self.progressBroken
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
        self.label:SetAlpha(1 - self.pausedAlpha)
    end
    if self.rowWant and self.rowLeft and self.rowLeft ~= self.rowWant then
        local k = math.min(1, elapsed * SIZE_EASE)
        self.rowLeft = self.rowLeft + (self.rowWant - self.rowLeft) * k
        if math.abs(self.rowLeft - self.rowWant) < .5 then self.rowLeft = self.rowWant end
        self:PlaceRow(self.rowLeft)
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
    local hidden = Addon:Profile("Frame").HiddenActions or {}
    if hidden.report then return "hidden-by-setting" end
    if not self.report then return "not-built" end
    return format("built parent=%s shown=%s", self.report:GetParent() == self.controls and "controls" or "other",
        tostring(self.report:IsShown()))
end
