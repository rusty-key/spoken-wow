setfenv(1, SpokenEnv)

-- The frame's settings, or their defaults once AceDB has stripped them (Addon:Profile).
local function FrameConfig()
    return Addon:Profile("Frame")
end

-- The large window, the "classic" narrator style: the game's Talking Head frame as
-- TalkingHeadUI.xml lays it out, with Spoken's round controls where it has its close button.
-- Clients without its atlases draw Spoken's own art in the same places.
--
-- Refreshed through the player's AUDIO_CHANGED callback rather than by the queue
-- calling this file, which is what keeps SoundQueue.lua free of any dependency on it.
PlayerFrame = {}

-- TalkingHeadUI.xml: the frame and its box are 570 by 155; the portrait's frame is 143 across, 5
-- in and 6 down; the model 115 across, 21 in and 21 down; the name 2 right of the portrait's frame
-- and 19 down from its top; the words 3 under the name, ending 42 from the right.
local FRAME_WIDTH, FRAME_HEIGHT = 570, 155
local RING_X, RING_Y, RING_SIZE = 5, -6, 143
local PORTRAIT_X, PORTRAIT_Y, PORTRAIT_SIZE = 21, -21, 115
local NAME_X, NAME_Y = RING_X + RING_SIZE + 2, RING_Y - 19
local WORDS_UNDER, RIGHT = 3, 42
-- The box art's shadow is full dark 15 under the frame's top, 12 in from its right and 13 over its
-- foot (measured in game); its edges fade out past that. The round controls and the progress line
-- sit PAD inside it.
local SHADE_TOP, SHADE_RIGHT, SHADE_FOOT, PAD = 15, 12, 13, 10
local CORNER_X, CORNER_Y, FOOT = SHADE_RIGHT + PAD, SHADE_TOP + PAD, SHADE_FOOT + PAD
-- At most this many lines of words, fewer where Text Size leaves no room for them over the
-- progress line, BAR_GAP above it.
local MOST_LINES, BAR_GAP = 3, 6
-- Where the name starts with the portrait hidden: as far in as the words end on the right.
local BARE_LEFT = RIGHT
-- The atlases, the first of each the client has. Forever's portrait frame for the dark box is the
-- Alliance one; Classic Era names the same art without the faction.
local RING = { "TalkingHeads-Alliance-PortraitFrame", "TalkingHeads-PortraitFrame" }
local BOX = { "TalkingHeads-TextBackground" }
local FACE = { "TalkingHeads-PortraitBg" }
-- Spoken's own portrait art: the border's cell in PortraitFrameAtlas, and the opening in it.
local PORTRAIT_ATLAS_SIZE = 512
local PORTRAIT_ATLAS_BORDER_SIZE = 416
local PORTRAIT_ATLAS_VIEWPORT_SIZE = 348
local PORTRAIT_BORDER_OUTSET = 34 * PORTRAIT_SIZE / PORTRAIT_ATLAS_VIEWPORT_SIZE
-- The name's height, for the words under it, and the gap left before the round controls.
local NAME_SIZE, NAME_GAP = 22, 8
local ROUND_GAP = Actions.ROUND_GAP
local TEXTURES = [[Interface\AddOns\Spoken\Textures\]]
-- TalkingHeadUI.lua's colours for its dark box: a gold name, white words, black shadows.
local NAME_COLOR = { 1, .82, .02 }
local WORDS_COLOR = { 1, 1, 1 }
local TAIL_COLOR = { .6, .6, .6 }

do
    local font = CreateFont("SpokenNameFont")
    font:SetFont(GameFontNormal:GetFont(), NAME_SIZE - 2, "")
    font:SetShadowColor(0, 0, 0)
    font:SetShadowOffset(1, -1)
    font:SetJustifyH("LEFT")
    font:SetJustifyV("TOP")
end
do
    local font = CreateFont("SpokenLabelFont")
    font:SetFont(GameFontNormal:GetFont(), 14, "")
    font:SetShadowColor(0, 0, 0)
    font:SetShadowOffset(1, -1)
    font:SetJustifyH("LEFT")
    font:SetJustifyV("MIDDLE")
end

local function Label(clip) return clip and (clip.present and clip.present.label or clip.key) or "" end
local Waiting = Actions.Waiting

local function FirstAtlas(names)
    for _, name in ipairs(names) do
        if Actions.HasAtlas(name) then return name end
    end
    return nil
end

function PlayerFrame:Initialize()
    if self.frame then return end
    self:InitDisplay()
    self:InitPortrait()
    self:InitHeader()
    self:InitMover()
    Actions:Build(self.frame)
    self.fader = Actions.Fader(self.frame, function() return { self.frame.portrait.model } end, function()
        -- Faded out to turn to the next line: now it comes in.
        if self.turning then self.turning = nil; self:Update() end
    end)
    -- A window turning to the next line fades out with the words it shows: the captions wait for
    -- it rather than taking the next line's first.
    Transcript.holdFor = function(clip)
        local window = self:Skin() or self
        return window.WillTurn ~= nil and window:WillTurn(clip)
    end
    self:RefreshConfig()
    Callbacks:Register("AUDIO_CHANGED", function() PlayerFrame:Update() end)
    Actions.WatchDialogs(function() PlayerFrame:Update() end)
end

function PlayerFrame:InitDisplay()
    self.frame = CreateFrame("Frame", "SpokenPlayerFrame", UIParent, "BackdropTemplate")
    function self.frame:Reset()
        self:ClearAllPoints()
        self:SetPoint("BOTTOM", 0, 200)
    end
    self.frame:SetSize(FRAME_WIDTH, FRAME_HEIGHT)
    self.frame:Reset()
    Addon:RestoreLayout("Player", self.frame)
    self.frame:SetMovable(true)
    self.frame:SetClampedToScreen(true)
    -- Placed from the saved layout instead; the client's cache would only fight it.
    self.frame:SetUserPlaced(false)
    self.frame:SetFrameStrata(FrameConfig().FrameStrata)
    self.frame:Hide()

    self.frame.background = self.frame:CreateTexture(nil, "BACKGROUND")
    self.frame.background:SetAllPoints()

    self.frame.container = CreateFrame("Frame", nil, self.frame)

    self.frame:SetScript("OnUpdate", function(_, elapsed) self:Tick(elapsed) end)
end

function PlayerFrame:InitPortrait()
    self.frame.portrait = CreateFrame("Frame", nil, self.frame)
    self.frame.portrait:SetSize(PORTRAIT_SIZE, PORTRAIT_SIZE)
    self.frame.portrait:SetPoint("TOPLEFT", self.frame, "TOPLEFT", PORTRAIT_X, PORTRAIT_Y)

    self.frame.portrait.background = self.frame.portrait:CreateTexture(nil, "BACKGROUND")
    self.frame.portrait.background:SetAllPoints()

    -- A separate frame so the border and the mover draw above the face.
    self.frame.portrait.border = CreateFrame("Frame", nil, self.frame.portrait)
    self.frame.portrait.border:SetFrameLevel(self.frame.portrait:GetFrameLevel() + 3)
    self.frame.portrait.border:SetAllPoints()
    self.frame.portrait.border.texture = self.frame.portrait.border:CreateTexture(nil, "OVERLAY")
end

function PlayerFrame:InitHeader()
    local container = self.frame.container
    container.name = container:CreateFontString(nil, "ARTWORK", "SpokenNameFont")
    -- The Talking Head's own font where the client has it.
    if Fancy22Font then container.name:SetFontObject(Fancy22Font) end
    container.name:SetJustifyH("LEFT")
    container.name:SetWordWrap(false)
    container.name:SetTextColor(NAME_COLOR[1], NAME_COLOR[2], NAME_COLOR[3])
    container.name:SetShadowColor(0, 0, 0, 1)
    container.name:SetShadowOffset(1, -1)
    container.name:SetPoint("TOPLEFT", container, "TOPLEFT", 0, 0)
    local function TailText()
        local text = container:CreateFontString(nil, "ARTWORK", "SpokenLabelFont")
        text:SetWordWrap(false)
        text:SetTextColor(TAIL_COLOR[1], TAIL_COLOR[2], TAIL_COLOR[3])
        text:Hide()
        return text
    end
    self.stopped, self.count, self.held = TailText(), TailText(), TailText()
    self.stopped:SetText(format("• (%s)", L.SUBTITLE_STOPPED))
    self.tail = Actions.Tail(self.stopped, self.count, self.held)

    self.controls = CreateFrame("Frame", nil, container)
    self.controls:SetHeight(1)
    self.controls:SetPoint("TOPRIGHT", self.frame, "TOPRIGHT", -CORNER_X, -CORNER_Y)
    self.play = Actions.StopButton(self.controls, function() return self:Current() ~= nil end,
        function() self:UpdateControls() end)
    self.skip = Actions.SkipButton(self.controls)
    self.buttons = { self.play, self.skip }

    self.progress = Actions.ProgressBar(container)
    self.progress.track:SetPoint("BOTTOMLEFT", container, "BOTTOMLEFT", 0, 0)
end

function PlayerFrame:InitMover()
    local mover = CreateFrame("Button", nil, self.frame.portrait.border)
    self.frame.mover = mover
    mover:SetSize(26, 26)
    -- The move arrows' cell of the portrait atlas, centred, a little smaller pushed in.
    local function Arrows(texture, size)
        texture:SetTexCoord(462 / PORTRAIT_ATLAS_SIZE, 512 / PORTRAIT_ATLAS_SIZE, 462 / PORTRAIT_ATLAS_SIZE, 512 / PORTRAIT_ATLAS_SIZE)
        texture:ClearAllPoints()
        texture:SetPoint("CENTER")
        texture:SetSize(size, size)
    end
    mover:SetNormalTexture(TEXTURES .. "PortraitFrameAtlas")
    Arrows(mover:GetNormalTexture(), 16)
    mover:SetPushedTexture(TEXTURES .. "PortraitFrameAtlas")
    Arrows(mover:GetPushedTexture(), 14)
    mover.background = mover:CreateTexture(nil, "BACKGROUND")
    mover.background:SetTexture(TEXTURES .. "SettingsButton")
    mover.background:SetPoint("CENTER")
    mover.background:SetSize(32, 32)
    Actions.TintWithRings(mover.background)
    mover:HookScript("OnEnter", function(button)
        if Addon:IsFrameLocked() then return end
        SetCursor([[Interface\Cursor\UI-Cursor-Move]])
        GameTooltip:SetOwner(button, "ANCHOR_RIGHT")
        GameTooltip:SetText(L.OPT_STYLE_CLASSIC)
        GameTooltip:AddLine(L.QUEUE_DRAG_HINT, 1, 1, 1, true)
        GameTooltip:Show()
    end)
    mover:HookScript("OnLeave", function() SetCursor(nil); GameTooltip_Hide() end)
    mover:HookScript("OnMouseDown", function()
        if Addon:IsFrameLocked() then return end
        Snap.Start(self.frame, { locked = function() return Addon:IsFrameLocked() end })
    end)
    mover:HookScript("OnMouseUp", function()
        if Addon:IsFrameLocked() then return end
        Snap.Stop()
        self:SaveLayout()
    end)
end

--- The skin drawing the queue in place of this window, or nil when this window does.
function PlayerFrame:Skin()
    if MinimalPlayer:IsEnabled() then return MinimalPlayer end
    if DialogueUIPlayer and DialogueUIPlayer:IsEnabled() then return DialogueUIPlayer end
    return nil
end

--- Whether this window shows the lines: the large window chosen, no skin in its place.
function PlayerFrame:IsShowing()
    return self:Skin() == nil and Addon:DisplayStyle() == "classic"
end

--- The Talking Head's atlases where the client has every one; nil for Spoken's own art.
function PlayerFrame:Art()
    local ring, box, face = FirstAtlas(RING), FirstAtlas(BOX), FirstAtlas(FACE)
    if not (ring and box and face) then return nil end
    return { ring = ring, box = box, face = face }
end

local function DrawArt(frame, art)
    local portrait = frame.portrait
    local border = portrait.border.texture
    border:ClearAllPoints()
    if art then
        frame.background:SetAtlas(art.box)
        portrait.background:SetAtlas(art.face)
        border:SetAtlas(art.ring)
        border:SetSize(RING_SIZE, RING_SIZE)
        border:SetPoint("TOPLEFT", portrait, "TOPLEFT", RING_X - PORTRAIT_X, RING_Y - PORTRAIT_Y)
        return
    end
    frame.background:SetTexture(TEXTURES .. "BackgroundGradient")
    frame.background:SetTexCoord(0, 1, 0, 1)
    portrait.background:SetTexture(TEXTURES .. "PortraitFrameBackground")
    portrait.background:SetTexCoord(0, 1, 0, 1)
    border:SetTexture(TEXTURES .. "PortraitFrameAtlas")
    border:SetTexCoord(0, PORTRAIT_ATLAS_BORDER_SIZE / PORTRAIT_ATLAS_SIZE, 0, PORTRAIT_ATLAS_BORDER_SIZE / PORTRAIT_ATLAS_SIZE)
    border:SetPoint("TOPLEFT", portrait, "TOPLEFT", -PORTRAIT_BORDER_OUTSET, PORTRAIT_BORDER_OUTSET)
    border:SetPoint("BOTTOMRIGHT", portrait, "BOTTOMRIGHT", PORTRAIT_BORDER_OUTSET, -PORTRAIT_BORDER_OUTSET)
end

--- The box and the portrait's art. Art that fails to draw leaves Spoken's own, and its error goes
--- to the error handler.
function PlayerFrame:ApplyArt()
    local art = self:Art()
    if art then
        local ok, err = pcall(DrawArt, self.frame, art)
        if not ok then
            art = nil
            if geterrorhandler then geterrorhandler()(err) end
        end
    end
    if not art then DrawArt(self.frame, nil) end
    self.art = art
end

function PlayerFrame:RefreshConfig()
    -- Bronze Border tints every round button, whichever way lines are shown.
    Actions.RefreshRings()
    local skin = self:Skin()
    -- Each window dresses the captions its own way; the others' look must not stay on them.
    if skin ~= DialogueUIPlayer and not self:IsShowing() then Transcript:SetStyle(nil) end
    for _, other in ipairs({ MinimalPlayer, DialogueUIPlayer }) do
        if other ~= skin then other:SetVisible(false, true) end
    end
    if skin then
        self.fader:Set(false, true)
        skin:RefreshConfig(self)
        return
    end
    local cfg = FrameConfig()
    self.frame.portrait:SetShown(not cfg.HidePortrait)
    self.frame.mover:ClearAllPoints()
    if cfg.HidePortrait then
        self.frame.mover:SetParent(self.frame)
        self.frame.mover:SetPoint("CENTER", self.frame, "BOTTOMLEFT", BARE_LEFT / 2, BARE_LEFT / 2)
    else
        self.frame.mover:SetParent(self.frame.portrait.border)
        self.frame.mover:SetPoint("CENTER", self.frame.portrait, "BOTTOMLEFT", 0, 0)
    end
    self:ApplyArt()

    self.frame.mover:SetShown(not Addon:IsFrameLocked())
    self.frame:SetScale(cfg.FrameScale)
    self.frame:SetFrameStrata(cfg.FrameStrata)
    Addon:ApplyHost(self.frame)
    self:Update()
end

--- Where the name and the words start: past the portrait, or BARE_LEFT with it hidden.
local function Left() return FrameConfig().HidePortrait and BARE_LEFT or NAME_X end

--- The lines of words that fit between the name and the progress line, up to MOST_LINES, and a
--- line's height; no lines where the line has no words to show (Show Narrator off or none written).
function PlayerFrame:WordLines(clip)
    local lineHeight = (Addon:Profile("Transcript").FontSize or 16) + 4
    if Transcript:HeightForClip(clip) <= 0 then return 0, lineHeight end
    local room = FRAME_HEIGHT + NAME_Y - FOOT - (NAME_SIZE + WORDS_UNDER) - BAR_GAP - self.progress.height
    return math.max(1, math.min(MOST_LINES, math.floor(room / lineHeight))), lineHeight
end

--- The column's place and the words docked in it. The window keeps the Talking Head's size.
function PlayerFrame:Layout()
    if self.laying or not self:IsShowing() then return end
    self.laying = true
    local frame, container = self.frame, self.frame.container
    local left = Left()
    container:ClearAllPoints()
    container:SetPoint("TOPLEFT", frame, "TOPLEFT", left, NAME_Y)
    container:SetWidth(FRAME_WIDTH - left - RIGHT)
    container:SetHeight(FRAME_HEIGHT + NAME_Y - FOOT)
    local width = container:GetWidth()

    -- A line's room over the words and under them, which a line gliding out or in fades through.
    local lines, lineHeight = self:WordLines(self:Current())
    local words = lines * lineHeight
    local font = GameFontHighlightLarge and GameFontHighlightLarge:GetFont() or nil
    self.styling = true
    Transcript:SetStyle({ lines = math.max(1, lines), padTop = lineHeight, color = WORDS_COLOR, font = font })
    self.styling = nil
    Transcript:Dock(container, container, "TOPLEFT", 0, -(NAME_SIZE + WORDS_UNDER - lineHeight), width,
        words > 0 and words + 2 * lineHeight or 0)

    self.progress.track:SetWidth(width)
    self.progress.track:SetShown(Addon:Profile("Transcript").SubtitleProgress ~= false)
    self:LayoutHeader()
    self.laying = nil
end

--- The name in full where it fits, then the tail, all short of the controls.
function PlayerFrame:LayoutHeader()
    local container = self.frame.container
    local name, tail = container.name, self.tail
    local left = Left()
    local room = math.max(1, FRAME_WIDTH - CORNER_X - self.controls:GetWidth() - NAME_GAP - left)
    local tailRoom = tail:Room()
    -- Unbounded first, so the width measured is the text's own.
    name:SetWidth(0)
    name:SetText(name:GetText())
    local nameWidth = math.min((name:GetStringWidth() or 0) + 1, math.max(1, room - tailRoom))
    name:SetWidth(nameWidth)
    if tailRoom > 0 then
        tail:Place(name, nameWidth)
        tail:Paint()
    end
end

function PlayerFrame:ConfigureActions(clip)
    self.row = Actions:HeaderControls(self.frame, self.controls, self.buttons, clip)
    Actions.LayOutRow(self.controls, self.row, ROUND_GAP)
end

function PlayerFrame:UpdateControls()
    local head = self:Current()
    if not head then return end
    Actions.SetPlayGlyph(self.play, Actions.HeadState())
    self.tail:SetHeld(SoundQueue:GetHeldReason(head))
    self.tail:SetStopped(SoundQueue:IsPaused())
    self.tail:SetCount(Waiting())
    Actions.SetPausable(self.buttons)
    self:LayoutHeader()
end

function PlayerFrame:UpdateProgress()
    local clip = self:Current()
    if not clip then return end
    if clip ~= self.timed then self.timed, self.seconds = clip, 0 end
    self.seconds = Actions.Elapsed(clip, self.seconds)
    Actions.SetProgress(self.progress, SoundQueue:Share(clip, self.seconds))
end

function PlayerFrame:Tick(elapsed)
    if not self.frame:IsShown() then return end
    self:UpdateProgress()
    -- Stopped faded out: its room given back.
    if self.tail:Step(elapsed) then
        self.tail:SetCount(Waiting())
        self:LayoutHeader()
    end
    self.poll = (self.poll or 0) + elapsed
    if self.poll >= .2 then
        self.poll = 0
        self:UpdateControls()
    end
end

--- A line to show while none is playing, so a window chosen as the narrator style in the welcome
--- window can be seen at once, as the subtitles show theirs. Either window draws it; the first
--- real line puts it away.
function PlayerFrame:ShowSample(shown)
    self.sample = shown and {
        key = "sample", length = 0,
        source = { key = "sample", gates = {}, interClipGap = 0 },
        present = { header = L.SAMPLE_SPEAKER, label = L.SAMPLE_LINE,
            transcript = L.SAMPLE_WINDOW_TEXT,
            portrait = { kind = "texture", texture = [[Interface\AddOns\Spoken\icon.tga]] } },
    } or nil
    Transcript:Sync()
    self:Update()
end

function PlayerFrame:IsShowingSample()
    return self.sample ~= nil
end

--- Whether this window, showing a line, will fade out to turn to `clip`.
function PlayerFrame:WillTurn(clip)
    return self:IsShowing() and self.shown ~= nil and clip ~= self.shown and self.frame:IsShown()
        and not self.fader:Leaving() and not Actions.DialogCovers()
end

--- The line playing, or the sample while nothing is.
function PlayerFrame:Head()
    if not SoundQueue:IsEmpty() then self.sample = nil end
    return SoundQueue:GetCurrentSound() or self.sample
end

--- The line the window stands for: the head, unless its module has Show Narrator off.
function PlayerFrame:Current()
    local head = self:Head()
    if head and not Addon:ShowsNarrator(head) then return nil end
    return head
end

function PlayerFrame:Update()
    if not self.frame then return end
    local skin = self:Skin()
    if skin then skin:Update(); return end
    -- The captions taking this window's look ask for an update: the layout under way has it.
    if self.styling then return end
    -- Hidden, not torn down, while subtitles stand in for it: going back finds it as it was.
    -- Faded out with nothing to say, or while a DialogueUI dialog hides the interface; put away at
    -- once for another style.
    local head = self:Current()
    local classic = Addon:DisplayStyle() == "classic"
    local want = classic and head ~= nil and not Actions.DialogCovers()
    if not want then
        self.turning = nil
        self.fader:Set(false, not classic)
        return
    end
    -- Fading out to turn to the next line: it comes in once faded.
    if self.turning and self.frame:IsShown() then return end
    -- Following another line on screen: this one fades out whole and the next fades in from
    -- nothing once it has, so the change happens unseen.
    if self.shown and head ~= self.shown and self.frame:IsShown() and not self.fader:Leaving() then
        self.turning = true
        self.fader:Set(false)
        return
    end
    self.shown = head
    self.fader:Set(true)

    -- The speaker, or the line's name where nobody speaks.
    local header = head.present and head.present.header
    self.frame.container.name:SetText((header and header ~= "") and header or Label(head))
    Addon:ClipFont(self.frame.container.name, head)

    Portrait:Configure(self.frame.portrait, head)
    self:ConfigureActions(head)
    self:Layout()
    self:UpdateControls()
    self:UpdateProgress()
end

--- What the frame is actually doing, for a bug report. A header that is set but drawn nowhere,
--- or drawn under something, looks from the outside exactly like one that was never set; this
--- tells the two apart without a client to poke at.
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
    Say(format("frame shown=%s w=%.0f h=%.0f art=%s", tostring(self.frame:IsShown()),
        self.frame:GetWidth() or 0, self.frame:GetHeight() or 0, self.art and self.art.box or "own"))
    Say(format("container shown=%s w=%.0f h=%.0f header=%q count=%q", tostring(container:IsShown()),
        container:GetWidth() or 0, container:GetHeight() or 0, container.name:GetText() or "",
        self.count:GetText() or ""))
    Say(format("portrait kind=%s", tostring(self.frame.portrait.active)))
    for _, button in ipairs(self.row or {}) do
        Say(format("  control %s shown=%s", button.action and button.action.id or (button == self.play
            and tostring(self.play.state) or "skip"), tostring(button:IsShown())))
    end
    Say(format("head can be stopped=%s", tostring(SoundQueue:CanBePaused())))
    Say(format("queue=%d", SoundQueue:GetQueueSize()))
    return lines
end

function PlayerFrame:SaveLayout()
    Addon:SaveLayout("Player", self.frame)
end

--- Every window back to its default spot, forgetting the place saved for each, whichever is in
--- use: for a frame dragged off-screen or in the way. The subtitles have their own (Subtitle:Reset).
function PlayerFrame:Reset()
    Addon:Layout().Player = nil
    MinimalPlayer:Reset()
    if DialogueUIPlayer.Reset then DialogueUIPlayer:Reset() end
    if not self.frame then return end
    self.frame:Reset()
    self:RefreshConfig()
end
