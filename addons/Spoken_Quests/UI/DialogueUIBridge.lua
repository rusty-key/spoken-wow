setfenv(1, VoiceOver)

-- DialogueUI hides UIParent while its quest and gossip window is open, taking Spoken's player
-- and captions with it. This file shows them on DialogueUI's window instead: its text marks
-- the words being read, and the player, a Play button and the Contribute button sit on it.
--
-- A page's line is read by the module that reads it outside DialogueUI: a quest window's by this
-- addon, gossip and a quest-giver's greeting by the gossip module (Spoken_Gossip), which hands
-- this file its reader where it is installed (ReaderFor).
--
-- DUIQuestFrame, its fontStringPool and its Handle* methods are DialogueUI internals, not an
-- API: Recognised checks them once at setup and the module stands down if any is missing.
--
-- Marks go into the paragraph's own text: colour codes take no width and a left-aligned
-- prefix wraps as the whole did, so nothing moves. The original text goes back when the line
-- ends, because DialogueUI reads it for its own text-to-speech.
--
-- Parses as Lua 5.0 (no #, no %) because addon.xml is shared with the 1.12 client.

DialogueUIBridge = { status = "waiting" }
local Bridge = DialogueUIBridge

if Version.IsAnyLegacy then
    Bridge.status = "legacy client"
    return
end

-- A page can be built again (an item reward resolving, QUEST_DETAIL firing twice).
local HANDLERS = { "HandleQuestDetail", "HandleQuestProgress", "HandleQuestComplete",
    "HandleQuestGreeting", "HandleGossip" }
local TICK = 0.05
-- Spoken Quests reads a dialog a moment after DialogueUI draws it, so typed-out words the line
-- will read stay blank for up to this long; shown whole until the voice began, they flashed.
local HOLD = 2.5
-- The longest autoplay waits for DialogueUI's window to fade in: its slowest intro is 0.75s
-- and its text fades in over 0.35s. Past it the line reads anyway.
local WAIT_LIMIT = 1.5
local EVENTS = { HandleQuestDetail = "QUEST_DETAIL", HandleQuestProgress = "QUEST_PROGRESS",
    HandleQuestComplete = "QUEST_COMPLETE", HandleQuestGreeting = "QUEST_GREETING", HandleGossip = "GOSSIP_SHOW" }
-- Keyed by the page names DialogueUI passes its voiceover provider.
local QUEST_EVENTS = { detail = "QUEST_DETAIL", progress = "QUEST_PROGRESS", completion = "QUEST_COMPLETE" }

local function Config()
    return Addon.db.profile.DialogueUI
end

-- Who reads a page's line: GetVisibleLine(event), ExpectedLine(event, textIsCurrent),
-- ReadNow(event, source) at once ahead of the queue, QueuedClipFor(line), Remove(clip), source()
-- the player source its lines carry, and `autoplay` where it has a Read Automatically switch.
local QUESTS = {
    GetVisibleLine = function(event) return Addon:GetVisibleLine(event) end,
    ExpectedLine = function(event, textIsCurrent) return Addon:ExpectedLine(event, textIsCurrent) end,
    ReadNow = function(event, source)
        Player.playNow = true
        local ok, err = pcall(Addon.InvokeQuestHandler, Addon, event, source, true)
        Player.playNow = nil
        return ok, err
    end,
    QueuedClipFor = function(line) return Player:QueuedClipFor(line) end,
    Remove = function(clip) Player:Remove(clip) end,
    source = function() return Player.source end,
    autoplay = {
        IsOn = function() return Addon:IsAutoplayOn() end,
        Set = function(on) Addon:SetAutoplay(on) end,
    },
}
local SPEECH = { GOSSIP_SHOW = true, QUEST_GREETING = true }

--- The gossip module's reader, where it is installed (Spoken_Gossip/DialogueUI.lua).
local function GossipReader()
    local env = rawget(_G, "SpokenGossipEnv")
    return env and rawget(env, "DialogueUIReader")
end

--- The reader of `event`'s page, or nil where no module installed reads it.
local function ReaderFor(event)
    if SPEECH[event] then
        return GossipReader()
    end
    return event and QUESTS or nil
end

--- The line `event`'s page would read, asked of the module that reads it, or nil: for the
--- Report button on DialogueUI's window (the dialogue core's ContributeButton.lua).
function Bridge:LineFor(event)
    local reader = ReaderFor(event)
    return reader and reader.GetVisibleLine(event) or nil
end

--- Whether `clip` is a line one of the dialogue modules read off a window, as against a zone's
--- story or a book's page, which never match DialogueUI's text.
local function IsDialogueClip(clip)
    if not clip then
        return false
    end
    if clip.source == Player.source then
        return true
    end
    local gossip = GossipReader()
    return gossip ~= nil and clip.source == gossip.source()
end

local function IsLoaded(name)
    return IsAddOnLoaded ~= nil and IsAddOnLoaded(name) and true or false
end

--- Whether DUIQuestFrame still has everything this file reaches for.
local function Recognised()
    local frame = _G.DUIQuestFrame
    if type(frame) ~= "table" or type(frame.fontStringPool) ~= "table" or not frame.ContentFrame then
        return false
    end
    if type(frame.fontStringPool.EnumerateActive) ~= "function" then
        return false
    end
    for _, name in ipairs(HANDLERS) do
        if type(frame[name]) ~= "function" then
            return false
        end
    end
    return true
end

--- Why `feature` (a key of the DialogueUI settings) cannot work, or nil when it can. The
--- settings panel greys the option and shows this.
function Bridge:Problem(feature)
    if not IsLoaded("DialogueUI") then
        return L.OPT_DUI_MISSING
    elseif not (_G.Spoken and Spoken.IsCompatible and Spoken:IsCompatible(1)) then
        return L.OPT_DUI_NO_PLAYER
    elseif not Recognised() then
        return L.OPT_DUI_UNKNOWN
    elseif (feature == "Captions" or feature == "AutoScroll")
        and not (Spoken.GetCaption and Spoken.SplitCaption and Spoken.WordMarks) then
        return L.OPT_DUI_OLD_PLAYER
    elseif feature == "ShowPlayer" and not Spoken.SetPlayerHost then
        return L.OPT_DUI_OLD_PLAYER
    end
end

--------------------------------------------------------------------------------
-- Matching the caption to the window
--------------------------------------------------------------------------------

-- Spoken's (UI/WordMarks.lua), shared with Spoken Books' book view: finding the caption's words in
-- the window's paragraphs, the pair to light, how far to type. Nil from a player too old to have
-- it, which Problem reports.
local Marks = _G.Spoken and Spoken.WordMarks and Spoken:WordMarks()
if Marks then
    Bridge.Key, Bridge.MarkLinks, Bridge.AlignFrom, Bridge.Align = Marks.Key, Marks.MarkLinks, Marks.AlignFrom, Marks.Align
    Bridge.Pick, Bridge.Cut, Bridge.Wrap, Bridge.ColorFor = Marks.Pick, Marks.Cut, Marks.Wrap, Marks.ColorFor
end

--------------------------------------------------------------------------------
-- Drawing it
--------------------------------------------------------------------------------

-- paragraphs: { fs, text (DialogueUI's), shown (what this file last set), words, color }.
-- clip, map and span: the caption last matched against them. lit/neighbor: the caption words
-- lit; cutP/cutByte: how far the text is typed out (Bridge.Cut). pending: the line about to be
-- read for the page just built, before it is queued: { words, untilTime, map, span }.
local state = { dirty = true }
-- Whether the player reports the word being read (Spoken:GetCaption).
local canMark = false

-- A FontString set to "" may read back as nil.
local function Showing(fs)
    return fs:GetText() or ""
end

--- Put every paragraph's own text back. Only where it still shows what this file set:
--- DialogueUI may have reused the FontString for something else since.
local function Restore()
    for _, para in ipairs(state.paragraphs or {}) do
        if para.shown ~= para.text and Showing(para.fs) == para.shown then
            para.fs:SetText(para.text)
        end
        para.shown = para.text
    end
    state.lit, state.neighbor, state.cutP, state.cutByte = nil, nil, nil, nil
end

--- The text DialogueUI is showing now: its paragraphs, not their translations, not the
--- title or the objectives' heading (which carry no text-to-speech flag).
local function Collect()
    local paragraphs = {}
    for _, fs in DUIQuestFrame.fontStringPool:EnumerateActive() do
        if not fs.isTranslation and (fs.ttsFlag ~= nil or fs.isTranslation == false) then
            local text = fs:GetText()
            local words = type(text) == "string" and Spoken:SplitCaption(text)
            if words and table.getn(words) > 0 then
                table.insert(paragraphs, { fs = fs, text = text, shown = text, words = Bridge.MarkLinks(text, words),
                    color = Bridge.ColorFor(fs:GetTextColor()) })
            end
        end
    end
    return paragraphs
end

--- A page was built: drop what was matched against the last one. Kept gossip history is not
--- rebuilt, so its paragraphs are restored first.
local function Invalidate()
    Restore()
    state.paragraphs, state.clip, state.map, state.span, state.dirty = nil, nil, nil, nil, true
    state.scrolledTo = nil
end

local function ScrollIntoView(fs)
    local frame = DUIQuestFrame
    if not (frame.IsScrollable and frame:IsScrollable() and frame.ScrollTo and frame.ScrollFrame) then
        return
    end
    local scroll = frame.ScrollFrame
    local contentTop, top, bottom = frame.ContentFrame:GetTop(), fs:GetTop(), fs:GetBottom()
    if not (contentTop and top and bottom) then
        return
    end
    local from, to = contentTop - top, contentTop - bottom
    local view = scroll:GetHeight()
    local current = scroll.scrollTarget or scroll.value or 0
    if from >= current and to <= current + view then
        return
    end
    -- A little of what came before stays in view above it.
    frame:ScrollTo(math.max(0, math.min(scroll.range or 0, from - view * 0.2)))
end

local function Draw(map, span, lit, neighbor, cutP, cutByte)
    local spans = {}
    for _, index in ipairs({ lit, neighbor }) do
        local at = map[index]
        if at then
            spans[at.p] = spans[at.p] or {}
            table.insert(spans[at.p], state.paragraphs[at.p].words[at.w])
        end
    end
    for p, para in ipairs(state.paragraphs) do
        local want = para.text
        -- Only the line's paragraphs type out; earlier gossip and the objectives stay whole.
        if cutP and p >= span.first and p <= span.last then
            if p > cutP then
                want = ""
            elseif p == cutP then
                want = string.sub(para.text, 1, cutByte)
            end
        end
        if spans[p] then
            -- Only words already typed: the neighbour past the voice is not shown yet.
            local shown, kept = string.len(want), {}
            for _, word in ipairs(spans[p]) do
                if word.last <= shown then
                    table.insert(kept, word)
                end
            end
            table.sort(kept, function(a, b) return a.first < b.first end)
            want = Bridge.Wrap(want, kept, para.color)
        end
        if want ~= para.shown then
            if Showing(para.fs) ~= para.shown then
                -- DialogueUI changed it under us without a rebuild this file heard of.
                Invalidate()
                return
            end
            para.fs:SetText(want)
            para.shown = want
        end
    end
    state.lit, state.neighbor, state.cutP, state.cutByte = lit, neighbor, cutP, cutByte
    -- Keep the voice in view: the word lit, or else the paragraph being typed.
    local target = lit and map[lit] and map[lit].p or cutP
    if target and target ~= state.scrolledTo then
        state.scrolledTo = target
        if Config().AutoScroll then
            ScrollIntoView(state.paragraphs[target].fs)
        end
    end
end

local function Tick()
    if not Config().Captions then
        Restore()
        state.pending = nil
        return
    end
    if state.dirty then
        state.paragraphs, state.dirty = Collect(), false
        state.clip = nil
    end
    local caption = Spoken:GetCaption()
    local clip = caption and caption.clip
    -- A quest's or an NPC's line only: a zone's or a book's never match DialogueUI's text anyway.
    if IsDialogueClip(clip) then
        if clip ~= state.clip then
            -- Put back and drawn again in this one call: nothing shows in between.
            Restore()
            state.clip, state.scrolledTo = clip, nil
            state.map, state.span = Bridge.Align(caption.words, state.paragraphs)
        end
    else
        state.clip, state.map = nil, nil
    end
    if state.map and (caption.highlight or caption.typewriter) then
        state.pending = nil
        local lit, neighbor
        if caption.highlight then
            lit, neighbor = Bridge.Pick(state.map, caption.speaking and caption.activeWord or nil)
        end
        local cutP, cutByte = Bridge.Cut(caption, state.map, state.span, state.paragraphs)
        if lit ~= state.lit or neighbor ~= state.neighbor or cutP ~= state.cutP or cutByte ~= state.cutByte then
            Draw(state.map, state.span, lit, neighbor, cutP, cutByte)
        end
        return
    end
    -- A line is about to be queued for this page: its words wait blank, unless another part's
    -- line (a zone's lore, a book page) is playing, which the quest's waits behind.
    local pending = state.pending
    local otherPart = clip ~= nil and not IsDialogueClip(clip)
    if pending and not otherPart and GetTime() < pending.untilTime then
        if not pending.span then
            pending.map, pending.span = Bridge.Align(pending.words, state.paragraphs)
        end
        if pending.map then
            if state.lit or state.cutP ~= pending.span.first or state.cutByte ~= 0 then
                Draw(pending.map, pending.span, nil, nil, pending.span.first, 0)
            end
            return
        end
    end
    state.pending = nil
    Restore()
end

--- A page was just built. When Spoken Quests is about to read it and Spoken types words
--- out, remember the words its line will carry, so the first frame the page is drawn in
--- already has them blank (Tick, run at once by the hook in Hook).
function Bridge.Expect(handler)
    state.pending = nil
    local event = EVENTS[handler]
    local reader = ReaderFor(event)
    if not (reader and Config().Captions and Spoken.GetCaptionOptions) then
        return
    end
    local _, typewriter = Spoken:GetCaptionOptions()
    if not typewriter then
        return
    end
    local ok, text = pcall(reader.ExpectedLine, event, true)
    local words = ok and type(text) == "string" and Spoken:SplitCaption(text)
    if words and table.getn(words) > 0 then
        state.pending = { event = event, words = words, untilTime = GetTime() + HOLD }
    end
end

--- Spoken Quests read `event`'s page: `queued` when a line came of it. When none did, the
--- words kept blank for it show at once (next Tick) rather than after HOLD.
function Bridge:Read(event, queued)
    if not queued and state.pending and state.pending.event == event then
        state.pending = nil
    end
end

--------------------------------------------------------------------------------
-- The player over the window
--------------------------------------------------------------------------------

local hosting = false

--- Put the player on DialogueUI's window while it is open and the setting is on; back on
--- UIParent otherwise.
function Bridge:UpdatePlayerHost()
    if not (_G.Spoken and Spoken.SetPlayerHost and self.driver) then
        return
    end
    local want = self.driver:IsVisible() and Config().ShowPlayer and true or false
    if want ~= hosting then
        hosting = want
        Spoken:SetPlayerHost(want and DUIQuestFrame or nil)
    end
end

--------------------------------------------------------------------------------
-- The Contribute button
--------------------------------------------------------------------------------

--- The dialog event of the page DialogueUI's window shows, or nil while it is closed or this
--- file stood down. `frame.handler` is nil until the first dialog, so Recognised skips it.
function Bridge:Page()
    local frame = self.driver and _G.DUIQuestFrame
    if frame and frame:IsShown() then
        return EVENTS[frame.handler]
    end
end

-- Puts the Report icon in the row of controls on the title line (below).
local SlotReport

--- The Contribute button follows the window: it opens, closes and changes page with no
--- event the button hears in time, since DialogueUI builds the page before showing it.
local function RefreshContribute()
    local button = rawget(VoiceOver, "ContributeButton")
    if button and button.Refresh then
        button.dialogueUISlot = SlotReport
        button:Refresh()
    end
end

--- Spoken's copy box, which a click on the button opens, over the window while it is open:
--- it is a child of UIParent, which DialogueUI hides.
local function HostContributeBox(host)
    if _G.Spoken and Spoken.SetContributeHost then
        Spoken:SetContributeHost(host)
    end
end

--------------------------------------------------------------------------------
-- The controls at the top right
--------------------------------------------------------------------------------
--
-- DialogueUI draws a Play button only while its Text To Speech is on, which is off by default
-- and read only at load. This file puts the player's own round buttons at the window's top
-- right instead, beside a close button, as on DialogueUI's book view: Play (Stop while the
-- page's line speaks), Skip, and Report (ContributeButton's icon, handed over through its
-- dialogueUISlot).
-- Read Automatically, never DialogueUI's Auto Play, decides whether a line reads on its own.

local ROUND, ROUND_GAP = 24, 4
-- DialogueUI's own speaker button, as it draws it.
local THEIRS_ALPHA = 0.6
-- How often the row looks again for the page's line while the window is open: a quest's ID
-- can arrive a moment after its page is drawn, and the packs load after login.
local LOOK_EVERY = 0.5

-- The line the window's page would read, and its event; Play and Stop act on it.
local line, lineEvent
-- DialogueUI's minimum autoplay delay.
local AUTOPLAY_DELAY = 0.5
-- When DialogueUI's autoplay will call playFile. It asks the delay (getAutoPlayDelay) just
-- before it waits, and a click on its button never does, which is how the two are told apart.
local autoplayAt
-- { frame, play, skip }, built the first time the window shows a page; `report` is
-- ContributeButton's icon once it is handed over.
local row, report

--- Whether `soundData` is the line at the head of the player's queue, and not stopped there:
--- the line Stop acts on. A line stopped at the head is one to play again.
local function IsSpeaking(soundData)
    local head = Spoken.GetCurrent and Spoken:GetCurrent()
    return head ~= nil and head.fileName == soundData.fileName
        and not (Spoken.IsPaused and Spoken:IsPaused())
end

--- Read the page's line now, in front of whatever speaks (Player:PlayPreparedNow).
local function PlayLine(source)
    local reader = ReaderFor(lineEvent)
    if not (line and reader) then
        return
    end
    local ok, err = reader.ReadNow(lineEvent, source)
    if not ok then
        Debug:Record("dialogueui-play-error", tostring(err))
    end
end

--- Take the page's line out of the queue, speaking or waiting.
local function StopLine()
    local reader = ReaderFor(lineEvent)
    local clip = line and reader and reader.QueuedClipFor(line)
    if clip then
        reader.Remove(clip)
    end
end

--- The line for `event`'s page, or none, with the setting off or no pack voicing it.
local function LookForLine(event)
    line, lineEvent = nil, nil
    local reader = ReaderFor(event)
    if reader and Config().PlayButton then
        local ok, found = pcall(reader.GetVisibleLine, event)
        if ok and found then
            line, lineEvent = found, event
        end
    end
end

--- The window's own tooltip: the game's is a child of UIParent, which DialogueUI hides.
local function Tooltip()
    local contribute = rawget(VoiceOver, "ContributeButton")
    return contribute and contribute.DialogueUITooltip and contribute:DialogueUITooltip(DUIQuestFrame)
        or GameTooltip
end

--- What a click on Play does now, and Read Automatically, which a right-click switches.
local function ShowPlayTooltip(button)
    local tooltip = Tooltip()
    local speaking = line ~= nil and IsSpeaking(line)
    tooltip:SetOwner(button, "ANCHOR_RIGHT")
    tooltip:SetText(speaking and SpokenEnv.L.DIALOGUE_STOP or SpokenEnv.L.DIALOGUE_LISTEN)
    tooltip:AddLine(speaking and SpokenEnv.L.DIALOGUE_STOP_TIP or SpokenEnv.L.DIALOGUE_READ_TIP, 1, 1, 1, true)
    -- Read Automatically is the quests module's; gossip goes by NPC Greetings, on its own page.
    local reader = ReaderFor(lineEvent)
    local autoplay = reader and reader.autoplay
    if autoplay then
        local on = autoplay.IsOn()
        tooltip:AddDoubleLine(L.OPT_PANEL_AUTOPLAY, on and L.OPT_DUI_ON or L.OPT_DUI_OFF, 1, 1, 1,
            on and 0.1 or 1, on and 1 or 0.125, on and 0.1 or 0.125)
        tooltip:AddLine(L.OPT_DUI_PLAY_RIGHT_CLICK, 1, 0.82, 0, true)
    end
    tooltip:Show()
    button.tooltip = tooltip
end

local function HideTooltip(button)
    if button.tooltip then
        button.tooltip:Hide()
    end
end

--- Play and Skip in a row on the window: children of it, so they show while DialogueUI hides
--- UIParent and close with it, and drawn above it.
local function Row()
    if row then
        return row
    end
    local frame = DUIQuestFrame
    local holder = CreateFrame("Frame", nil, frame)
    holder:SetFrameStrata("FULLSCREEN")
    holder:SetSize(ROUND, ROUND)
    local play = Spoken:CreateRoundButton(holder, "play")
    play:SetFrameStrata("FULLSCREEN")
    play:RegisterForClicks("LeftButtonUp", "RightButtonUp")
    play:SetScript("OnClick", function(_, mouse)
        local reader = ReaderFor(lineEvent)
        if mouse == "RightButton" then
            if reader and reader.autoplay then
                reader.autoplay.Set(not reader.autoplay.IsOn())
            end
        elseif line and IsSpeaking(line) then
            StopLine()
        else
            PlayLine("Spoken's Play button on DialogueUI")
        end
        Bridge:DrawPlayButton()
        if play.tooltip and play.tooltip:IsShown() then
            ShowPlayTooltip(play)
        end
    end)
    -- Skips by itself.
    local skip = Spoken:CreateRoundButton(holder, "skip")
    skip:SetFrameStrata("FULLSCREEN")
    local function ShowSkipTooltip()
        local tooltip = Tooltip()
        tooltip:SetOwner(skip, "ANCHOR_RIGHT")
        tooltip:SetText(SpokenEnv.L.BIND_SKIP)
        tooltip:Show()
        skip.tooltip = tooltip
    end
    -- Brighter under the pointer as the ring's own hover has it, and the tooltip on the window's.
    for button, Show in pairs({ [play] = ShowPlayTooltip, [skip] = ShowSkipTooltip }) do
        button:SetScript("OnEnter", function(self)
            if self:IsEnabled() then self.glyph:SetAlpha(1) end
            Show(self)
        end)
        button:SetScript("OnLeave", function(self)
            if self:IsEnabled() then self.glyph:SetAlpha(0.85) end
            HideTooltip(self)
        end)
    end
    holder:Hide()
    row = { frame = holder, play = play, skip = skip }
    return row
end

--------------------------------------------------------------------------------
-- A close button, as DialogueUI's book view has
--------------------------------------------------------------------------------
--
-- The book view's own close button, in its art: the paper's on DialogueUI's parchment theme, the
-- stone's on its dark one; at the window's top right as on the book, 64 of the book art's pixels
-- across and 26 in, drawn at 0.5333 of a pixel to DialogueUI's size, as the book view draws it.
-- Its middle halfway between the window's top and its header's, so it stands as far from the
-- title as from the edge, and in the same place on a gossip page, which has no header to show.

local BOOK_ART = "Interface/AddOns/DialogueUI/Art/Book/TextureKit-"
local CLOSE_SIZE, CLOSE_INSET, ART_PIXEL = 64, 26, 0.53333
local close

--- DialogueUI's size setting, as its header strip is drawn at it (358 across at 1).
local function Multiplier()
    local front = type(DUIQuestFrame.FrontFrame) == "table" and DUIQuestFrame.FrontFrame
    local header = front and type(front.Header) == "table" and front.Header
    local width = header and tonumber(header:GetWidth())
    return width and width > 0 and width / 358 or 1
end

local function CloseButton()
    if close then
        return close
    end
    local frame = DUIQuestFrame
    close = CreateFrame("Button", nil, frame)
    close:SetFrameStrata("FULLSCREEN")
    close.texture = close:CreateTexture(nil, "ARTWORK")
    close.texture:SetAllPoints()
    close.texture:SetTexCoord(768 / 1024, 832 / 1024, 1488 / 2048, 1552 / 2048)
    close.highlight = close:CreateTexture(nil, "HIGHLIGHT")
    close.highlight:SetAllPoints()
    close.highlight:SetTexCoord(832 / 1024, 896 / 1024, 1488 / 2048, 1552 / 2048)
    -- As Escape closes it: DialogueUI's own way out.
    close:SetScript("OnClick", function()
        if type(frame.HideUI) == "function" then frame:HideUI() else frame:Hide() end
    end)
    return close
end

-- Room above the controls' line and below it, in UIParent's units, as the buttons' 24 are. The
-- line sits that far under the window's top on every page; DialogueUI's quest title, or a gossip
-- page's text, moves down to start that far under it.
local LINE_ROOM = 36
-- Where DialogueUI puts its header (28 under the window's top at its size, 51 tall, its title
-- centred 2 over its middle), its text on a quest page (68 under the top), and on a gossip page,
-- which has no header, its text and the line over it (42, at any size).
local HEADER_TOP, HEADER_HEIGHT, TITLE_LIFT = 28, 51, 2
local QUEST_TEXT_TOP, GOSSIP_TEXT_TOP = 68, 42

local function PlaceClose()
    local frame = DUIQuestFrame
    local button = CloseButton()
    local file = BOOK_ART .. (Utils:DialogueUIThemeID() == 2 and "Metal.png" or "Parchment.png")
    if button.file ~= file then
        button.file = file
        button.texture:SetTexture(file)
        button.highlight:SetTexture(file)
    end
    local pixel = ART_PIXEL * Multiplier()
    button:SetSize(CLOSE_SIZE * pixel, CLOSE_SIZE * pixel)
    local scale = UIParent:GetEffectiveScale() / math.max(0.01, frame:GetEffectiveScale() or 1)
    local middle = -(LINE_ROOM + ROUND / 2) * scale
    if button.middle ~= middle or button.pixel ~= pixel then
        button.middle, button.pixel = middle, pixel
        button:ClearAllPoints()
        button:SetPoint("RIGHT", frame, "TOPRIGHT", -CLOSE_INSET * pixel, middle)
    end
    button:Show()
end

--- DialogueUI's header and text moved down so the quest title's top, or a gossip page's text's,
--- is LINE_ROOM under the controls' line, as the book view's title is; the text's height, which
--- DialogueUI scrolls by, shorter by as much. Measured from the title, not the portrait beside
--- it. Run after DialogueUI lays a page out (UseQuestLayout), sets its title or resizes.
local function Lower()
    local frame = DUIQuestFrame
    local front = type(frame.FrontFrame) == "table" and frame.FrontFrame
    local header = front and type(front.Header) == "table" and front.Header
    local scroll = type(frame.ScrollFrame) == "table" and frame.ScrollFrame
    if not (header and scroll) then
        return
    end
    local size = Multiplier()
    local scale = UIParent:GetEffectiveScale() / math.max(0.01, frame:GetEffectiveScale() or 1)
    local below = (2 * LINE_ROOM + ROUND) * scale
    local title = type(header.Title) == "table" and header.Title
    local titleInset = (HEADER_HEIGHT / 2 - TITLE_LIFT) * size - (title and tonumber(title:GetHeight()) or 0) / 2
    local shift = math.max(0, below - titleInset - HEADER_TOP * size)
    header:SetPoint("TOP", front, "TOP", 0, -(HEADER_TOP * size + shift))
    local base = tonumber(frame.scrollFrameBaseHeight)
    if frame.questLayout then
        scroll:SetPoint("TOPLEFT", frame, "TOPLEFT", 0, -(QUEST_TEXT_TOP * size + shift))
        if base then frame.scrollViewHeight = base - 40 * size - shift end
    else
        shift = math.max(0, below - GOSSIP_TEXT_TOP)
        scroll:SetPoint("TOPLEFT", frame, "TOPLEFT", 0, -(GOSSIP_TEXT_TOP + shift))
        if base then frame.scrollViewHeight = base - shift end
        if type(front.HeaderDivider) == "table" then
            front.HeaderDivider:SetPoint("CENTER", front, "TOP", 0, -(GOSSIP_TEXT_TOP + shift))
        end
    end
end

--- Lay the row out right to left from the close button, on its middle: Report, Skip, Play, as
--- large on screen as Place Lore draws them (24 at UIParent's scale, whatever DialogueUI's own
--- size), in the same place on every page. DialogueUI's buttons in that corner (Copy Text, the
--- translator's) go left of it.
local placedKey
local function PlaceRow(force)
    local frame = DUIQuestFrame
    local scale = UIParent:GetEffectiveScale() / math.max(0.01, frame:GetEffectiveScale() or 1)
    local list = {}
    if report and report:IsShown() then
        table.insert(list, report)
    end
    table.insert(list, row.skip)
    if row.play:IsShown() then
        table.insert(list, row.play)
    end
    local holder = row.frame
    local key = table.concat({ #list, format("%.3f", scale) }, " ")
    if key ~= placedKey or force then
        placedKey = key
        holder:SetSize((#list * ROUND + (#list - 1) * ROUND_GAP) * scale, ROUND * scale)
        local right
        for _, button in ipairs(list) do
            button:SetScale(scale)
            button:SetSize(ROUND, ROUND)
            button:ClearAllPoints()
            if right then
                button:SetPoint("RIGHT", right, "LEFT", -ROUND_GAP, 0)
            else
                button:SetPoint("RIGHT", holder, "RIGHT", 0, 0)
            end
            right = button
        end
        holder:ClearAllPoints()
        holder:SetPoint("RIGHT", CloseButton(), "LEFT", -ROUND_GAP, 0)
    end
    -- DialogueUI's first button there (Copy Text, else the translator's) left of the row, on its
    -- middle; the other keeps its place left of that one. Again whenever DialogueUI lays them out.
    local first
    for _, key in ipairs({ "TranslatorButton", "CopyTextButton" }) do
        local widget = frame[key]
        if type(widget) == "table" and widget.IsShown and widget:IsShown() then
            first = widget
        end
    end
    if first and select(2, first:GetPoint(1)) ~= holder then
        first:ClearAllPoints()
        first:SetPoint("RIGHT", holder, "LEFT", -ROUND_GAP, 0)
    end
end

--- ContributeButton's slot: its Report icon joins the row.
function SlotReport(icon)
    if not _G.DUIQuestFrame then
        return false
    end
    report = icon
    Row()
    PlaceRow(true)
    return true
end

--- DialogueUI's own button, kept out of sight while this row stands in for it, and given back
--- as DialogueUI leaves it when Play goes.
local covering = false
local function CoverTheirs(cover)
    local theirs = _G.DUIQuestFrame and DUIQuestFrame.TTSButton
    if type(theirs) ~= "table" or not theirs.SetAlpha then
        covering = false
        return
    end
    if cover then
        if (theirs:GetAlpha() or 0) > 0 then
            theirs:SetAlpha(0)
        end
        covering = true
    elseif covering then
        theirs:SetAlpha(THEIRS_ALPHA)
        covering = false
    end
end

local function SetEnabled(button, on)
    if (button:IsEnabled() and true or false) ~= on then
        if on then button:Enable() else button:Disable() end
    end
end

--- Show the row while the window shows a page: Play with the Play Button setting on, greyed
--- with no line to read and Stop while that line speaks; Skip greyed with nothing speaking.
--- Run as a page is built, as the window opens, and on the driver's tick.
function Bridge:DrawPlayButton()
    if self:Page() == nil then
        CoverTheirs(false)
        if row and row.frame:IsShown() then
            row.frame:Hide()
            HideTooltip(row.play)
            HideTooltip(row.skip)
        end
        return
    end
    PlaceClose()
    local r = Row()
    r.frame:Show()
    local on = Config().PlayButton and true or false
    r.play:SetShown(on)
    CoverTheirs(on)
    SetEnabled(r.play, line ~= nil)
    local state = line ~= nil and IsSpeaking(line) and "stop" or "play"
    if r.play.state ~= state then
        r.play:SetState(state)
    end
    SetEnabled(r.skip, Spoken.GetCurrent ~= nil and Spoken:GetCurrent() ~= nil)
    PlaceRow()
end

--- Look again for the page's line and redraw the row: `event` is the page just built, or the
--- page the window shows.
function Bridge:RefreshPlayButton(event)
    LookForLine(event or self:Page())
    self:DrawPlayButton()
end

--- The row as a test or /spq diagnostics sees it: Play, the page's line, the row, the close button.
function Bridge:PlayButtonState()
    return row and row.play, line, row, close
end

--------------------------------------------------------------------------------
-- DialogueUI's own Play button
--------------------------------------------------------------------------------
--
-- Where the player has DialogueUI's Text To Speech on, its button and hotkey play the
-- recording too, through the voiceover provider DialogueUI lets one addon register.

local provider = {
    name = "Spoken Quests",
    -- DialogueUI hears the client's event before this addon's recorder does, so the event is
    -- taken from what DialogueUI says it is showing, never from GetVisibleDialogueEvent.
    doesFileExist = function(interactionType, _, page)
        local event = interactionType == "gossip" and "GOSSIP_SHOW" or QUEST_EVENTS[page]
        if not event then
            line, lineEvent = nil, nil
            return false
        end
        LookForLine(event)
        return line ~= nil
    end,
    playFile = function()
        -- Ignore DialogueUI's autoplay: Read Automatically decides that.
        local now = GetTime()
        if autoplayAt and now >= autoplayAt - 0.1 and now <= autoplayAt + 0.5 then
            autoplayAt = nil
            return
        end
        -- A line queued behind another is brought to the front.
        if line and not IsSpeaking(line) then
            PlayLine("DialogueUI Play button")
        end
    end,
    -- Only while the window is up: DialogueUI also calls this on close (its TTS Auto Stop, on
    -- by default), and this addon's Stop When Window Closes decides that case.
    stopPlaying = function()
        if DUIQuestFrame:IsShown() then
            StopLine()
        end
    end,
    -- Speaking, not just queued: DialogueUI's button stops a line that plays and plays one that
    -- does not, and a line waiting behind another is one to bring forward, not to drop.
    isPlaying = function()
        return line ~= nil and IsSpeaking(line)
    end,
    getAutoPlayDelay = function()
        autoplayAt = GetTime() + AUTOPLAY_DELAY
        return AUTOPLAY_DELAY
    end,
}

--------------------------------------------------------------------------------
-- Waiting for the window
--------------------------------------------------------------------------------

-- The read waiting for DialogueUI's window: { event, run, untilTime }.
local waiting

--- Whether DialogueUI's window shows `event`'s page in full: open on that page, its intro
--- played (DialogueUI fades or unfolds the window in) and its text faded in.
local function InFullView(event)
    local frame = _G.DUIQuestFrame
    if not (frame and frame:IsShown() and EVENTS[frame.handler] == event) then
        return false
    end
    local content = frame.ContentFrame
    return (frame:GetAlpha() or 1) >= 0.99 and not (content and (content:GetAlpha() or 1) < 0.99)
end

--- An automatic read of `event`, held until DialogueUI's window shows its page in full, so the
--- voice starts with the words on screen rather than while the window is still appearing.
--- `run` reads it then, or after WAIT_LIMIT. False (read at once) where DialogueUI is not
--- showing this page: not hooked, closed (a muted quest, an instance), or on another page.
function Bridge:Defer(event, run)
    if not self.driver or self.reading then
        return false
    end
    local frame = _G.DUIQuestFrame
    if not (frame and frame:IsShown() and EVENTS[frame.handler] == event) or InFullView(event) then
        return false
    end
    waiting = { event = event, run = run, untilTime = GetTime() + WAIT_LIMIT }
    return true
end

--- Read what was waiting, once its page is in full view or it has waited long enough. Run by
--- the driver, which ticks only while the window is open.
local function Release()
    if not waiting or not (InFullView(waiting.event) or GetTime() >= waiting.untilTime) then
        return
    end
    local run = waiting.run
    waiting = nil
    Bridge.reading = true
    local ok, err = pcall(run)
    Bridge.reading = nil
    if not ok then
        Debug:Record("dialogueui-wait-error", tostring(err))
    end
end

--------------------------------------------------------------------------------
-- Setup
--------------------------------------------------------------------------------

function Bridge:Hook()
    if self.driver then
        return
    end
    local problem = self:Problem()
    if problem then
        self.status = problem
        return
    end
    local frame = DUIQuestFrame
    -- Asked once: the player's API cannot change within a session.
    canMark = not self:Problem("Captions")
    -- Room for the controls' line, laid out again as DialogueUI lays a page out, sets its title
    -- (which may take two lines) or resizes.
    for _, name in ipairs({ "UseQuestLayout", "UpdateQuestTitle", "UpdateFrameSize" }) do
        if type(frame[name]) == "function" then
            hooksecurefunc(frame, name, Lower)
        end
    end
    local contribute = rawget(VoiceOver, "ContributeButton")
    if contribute then
        contribute.dialogueUISlot = SlotReport
    end
    for _, name in ipairs(HANDLERS) do
        local handler = name
        hooksecurefunc(frame, handler, function()
            Invalidate()
            -- At once rather than on the next tick: the page DialogueUI just built is drawn
            -- at the end of this frame, and must already be as it should look.
            if canMark then
                Bridge.Expect(handler)
                Tick()
            end
            Bridge:RefreshPlayButton(EVENTS[handler])
            RefreshContribute()
        end)
    end

    -- A child of the window, so it runs only while the window is up. DUIQuestFrame's own
    -- OnHide is no use: DialogueUI sets it with SetScript, replacing any hook.
    local driver = CreateFrame("Frame", nil, frame)
    local elapsedSince, lookedSince = 0, 0
    driver:SetScript("OnUpdate", function(_, elapsed)
        Release()
        elapsedSince = elapsedSince + elapsed
        lookedSince = lookedSince + elapsed
        if elapsedSince >= TICK then
            elapsedSince = 0
            if canMark then
                Tick()
            end
            -- The page's line looked for again now and then; whether it sounds, every tick.
            if lookedSince >= LOOK_EVERY then
                lookedSince = 0
                self:RefreshPlayButton()
            else
                self:DrawPlayButton()
            end
        end
    end)
    driver:SetScript("OnShow", function()
        self:UpdatePlayerHost()
        HostContributeBox(frame)
        self:RefreshPlayButton()
        RefreshContribute()
    end)
    driver:SetScript("OnHide", function()
        Restore()
        state.pending = nil
        -- Closed before it showed in full: the player walked on, and the line is not read.
        waiting = nil
        self:UpdatePlayerHost()
        HostContributeBox(nil)
        self:DrawPlayButton()
        RefreshContribute()
    end)
    self.driver = driver

    -- Registered even with the setting off, so turning it on needs no reload. DialogueUI takes
    -- one provider per session and warns if another voiceover addon has it.
    if _G.DialogueUIAPI and DialogueUIAPI.SetVOProvider then
        DialogueUIAPI.SetVOProvider(provider)
        self.provider = true
    end
    self.status = "hooked"
end

function Bridge:Setup()
    if not IsLoaded("DialogueUI") then
        self.status = L.OPT_DUI_MISSING
        return
    end
    -- After every addon has loaded: DialogueUI builds the page methods with its frame.
    if IsLoggedIn and IsLoggedIn() then
        self:Hook()
        return
    end
    local login = CreateFrame("Frame")
    login:RegisterEvent("PLAYER_LOGIN")
    login:SetScript("OnEvent", function(waiter)
        waiter:UnregisterEvent("PLAYER_LOGIN")
        local ok, err = pcall(self.Hook, self)
        if not ok then
            self.status = "error: " .. tostring(err)
            Debug:Record("dialogueui-error", tostring(err))
        end
    end)
end

--- A setting changed on the panel.
function Bridge:Refresh()
    if not Config().Captions then
        Restore()
    end
    self:RefreshPlayButton()
    self:UpdatePlayerHost()
end

--- One line for /spq diagnostics.
function Bridge:Describe()
    local cfg = Config()
    return format("DialogueUI: %s; words=%s scroll=%s player=%s play=%s button=%s provider=%s", tostring(self.status),
        tostring(cfg.Captions), tostring(cfg.AutoScroll), tostring(cfg.ShowPlayer),
        tostring(cfg.PlayButton), row and row.frame:IsShown() and row.play:IsShown() and "shown" or "hidden",
        tostring(self.provider == true))
end
